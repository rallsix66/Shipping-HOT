// Behaviours of AIHOT@44578fa tests/receipts.test.ts (reuse, budget stop, valve, unknown outcome) re-expressed for
// SQLite with a fake caller. Offline only: no credentials, no network, no paid request.
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import NativeDatabase from "better-sqlite3"
import { createDatabase } from "db0"
import { afterEach, describe, expect, it } from "vitest"
import { initShippingTables } from "#/database/shipping"
import { readDatabaseMetadata } from "#/database/runtime"
import type { SecretStore } from "#/providers/contracts"
import {
  type CallOutcome,
  PaidCostError,
  PaidGateError,
  type PaidRequestContext,
  ProviderRejectedError,
  ReceiptBusyError,
  type ReceiptRequest,
  ReceiptUnknownError,
  completeReceipt,
  logicalKeyFor,
  markPendingReceiptsUnknownAtExclusiveStartup,
  markStalePendingReceipts,
  paidRequest,
  rejectReceivedResponse,
} from "#/intel/llm/receipts"
import { decidePaidBudget } from "#/services/paid-budget"

const T0 = new Date("2026-10-12T08:00:00.000Z")
const cleanups: Array<() => void> = []
afterEach(() => {
  while (cleanups.length) cleanups.pop()!()
})

type Native = InstanceType<typeof NativeDatabase>

function wrap(native: Native) {
  return createDatabase({
    name: "sqlite",
    dialect: "sqlite",
    getInstance: () => native,
    exec: (sql: string) => native.exec(sql),
    prepare: (sql: string) => {
      const statement = native.prepare(sql)
      return {
        all: async (...params: (string | number | boolean | null | undefined)[]) => statement.all(...params),
        get: async (...params: (string | number | boolean | null | undefined)[]) => statement.get(...params),
        run: async (...params: (string | number | boolean | null | undefined)[]) => {
          const result = statement.run(...params)
          return { success: result.changes > 0, changes: result.changes, lastInsertRowid: result.lastInsertRowid }
        },
      }
    },
    dispose: () => native.close(),
  } as never)
}

async function setup(path = ":memory:") {
  const native = new NativeDatabase(path)
  cleanups.push(() => native.close())
  const db = wrap(native)
  await initShippingTables(db, "mock")
  return { db, native }
}

/** In-memory SecretStore (same contract as the file store); the value is a test placeholder, not a credential. */
function secrets(values: Record<string, string> = { "fake-llm": "test-placeholder" }): SecretStore {
  const map = new Map(Object.entries(values))
  return {
    get: async id => map.get(id),
    set: async (id, value) => void map.set(id, value),
    delete: async id => void map.delete(id),
    has: async id => map.has(id),
    source: async id => (map.has(id) ? "file" : "none") as never,
  }
}

/** Fake paid caller: counts every request "sent"; never opens a socket. */
function fakeCaller(reply: (hit: number) => CallOutcome | Promise<CallOutcome> = hit => ({ response: { ok: true, hit }, requestId: `fake-${hit}`, usage: { tokensIn: 80, tokensOut: 20 } })) {
  const state = { hits: 0, keys: [] as string[] }
  const call = async (apiKey: string) => {
    state.hits++
    state.keys.push(apiKey)
    return reply(state.hits)
  }
  return { state, call }
}

function request(subject: string, extra: Partial<ReceiptRequest> = {}): ReceiptRequest {
  return {
    providerId: "fake-llm",
    capability: "intel_extract",
    model: "fake-model",
    purpose: "invariant_test",
    subject,
    identity: { subject, prompt: "t1" },
    requestSummary: { subject },
    estimatedCost: 0.01,
    ...extra,
  }
}

function context(db: PaidRequestContext["db"], extra: Partial<PaidRequestContext> = {}): PaidRequestContext {
  return { db, secretStore: secrets(), monthlyBudget: 5, currency: "USD", now: () => T0, ...extra }
}

const row = (native: Native, subject: string) => native.prepare("SELECT * FROM paid_receipt WHERE subject = ?").get(subject) as Record<string, unknown> | undefined
const attempts = (native: Native, subject: string) => native.prepare("SELECT a.* FROM paid_receipt_attempt a JOIN paid_receipt r ON r.id = a.receipt_id WHERE r.subject = ? ORDER BY a.attempt").all(subject) as Array<Record<string, unknown>>
const usage = (native: Native) => native.prepare("SELECT COALESCE(SUM(request_count),0) AS requests, COALESCE(SUM(success_count),0) AS ok, COALESCE(SUM(failure_count),0) AS failed, COALESCE(SUM(estimated_cost),0) AS cost FROM provider_usage WHERE provider_id = 'fake-llm'").get() as { requests: number, ok: number, failed: number, cost: number }

describe("migrations 024/025 (paid_receipt)", () => {
  it("applies on a fresh isolated database to current schema v28 and is idempotent", async () => {
    const { db, native } = await setup()
    expect((await readDatabaseMetadata(db)).schemaVersion).toBe(28)
    await initShippingTables(db, "mock")
    expect((await readDatabaseMetadata(db)).schemaVersion).toBe(28)
    const tables = native.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'paid_receipt%' ORDER BY name").all()
    expect(tables).toEqual([{ name: "paid_receipt" }, { name: "paid_receipt_attempt" }])
    expect(native.prepare("SELECT name FROM sqlite_master WHERE name IN ('budgets', 'budget')").all()).toEqual([])
  })

  it("refuses an actual cost without an actual-cost receipt at the schema level", async () => {
    const { native } = await setup()
    const insert = (basis: string | null, actual: number | null) => native.prepare(`
      INSERT INTO paid_receipt (id, logical_key, provider_id, capability, purpose, status, actual_cost, cost_basis, created_at, updated_at)
      VALUES (?, ?, 'fake-llm', 'x', 'p', 'received', ?, ?, 't', 't')`).run(`id-${basis}-${actual}`, `k-${basis}-${actual}`, actual, basis)
    expect(() => insert("estimated", 0.5)).toThrow(/CHECK/)
    expect(() => insert(null, 0.5)).toThrow(/CHECK/)
    expect(() => insert("actual", null)).toThrow(/CHECK/)
    expect(() => insert("actual", 0.5)).not.toThrow()
    expect(() => insert("estimated", null)).not.toThrow()
  })
})

describe("paid receipts (fake caller, offline)", () => {
  it("unconfigured or zero budget sends zero requests and writes no receipt", async () => {
    const { db, native } = await setup()
    const fake = fakeCaller()
    for (const [budget, code] of [[undefined, "paid_budget_unconfigured"], [null, "paid_budget_unconfigured"], [Number.NaN, "paid_budget_unconfigured"], [0, "paid_budget_zero"]] as const) {
      await expect(paidRequest(context(db, { monthlyBudget: budget }), request(`gate-${String(budget)}`), fake.call)).rejects.toMatchObject({ name: "PaidGateError", code })
    }
    expect(fake.state.hits).toBe(0)
    expect(native.prepare("SELECT COUNT(*) AS c FROM paid_receipt").get()).toEqual({ c: 0 })
    expect(usage(native).requests).toBe(0)
  })

  it("a missing credential in the SecretStore sends zero requests", async () => {
    const { db, native } = await setup()
    const fake = fakeCaller()
    await expect(paidRequest(context(db, { secretStore: secrets({}) }), request("nokey"), fake.call)).rejects.toMatchObject({ code: "paid_secret_missing" })
    expect(fake.state.hits).toBe(0)
    expect(row(native, "nokey")).toBeUndefined()
  })

  it("the budget stops calls before sending, counting pending reservations and recorded spend", async () => {
    const { db, native } = await setup()
    let release!: () => void
    const gate = new Promise<void>(resolve => (release = resolve))
    const fake = fakeCaller(async (hit) => {
      if (hit === 1) await gate
      return { response: { hit } }
    })
    const ctx = context(db, { monthlyBudget: 1 })
    const first = paidRequest(ctx, request("b1", { estimatedCost: 0.6 }), fake.call)
    await Promise.resolve()
    await new Promise(resolve => setTimeout(resolve, 0))
    // first is pending with 0.6 reserved: 0.6 + 0.6 > 1
    await expect(paidRequest(ctx, request("b2", { estimatedCost: 0.6 }), fake.call)).rejects.toMatchObject({ code: "paid_budget_exhausted" })
    release()
    await first
    await expect(paidRequest(ctx, request("b3", { estimatedCost: 0.6 }), fake.call)).rejects.toMatchObject({ code: "paid_budget_exhausted" })
    expect((await paidRequest(ctx, request("b4", { estimatedCost: 0.3 }), fake.call)).reused).toBe(false)
    expect(fake.state.hits).toBe(2)
    expect(usage(native)).toMatchObject({ requests: 2, ok: 2 })
    expect(usage(native).cost).toBeCloseTo(0.9)
  })

  it("same-key concurrency sends exactly one request; the other caller sees it in flight, later callers reuse it", async () => {
    const { db } = await setup()
    let release!: () => void
    const gate = new Promise<void>(resolve => (release = resolve))
    const fake = fakeCaller(async (hit) => {
      await gate
      return { response: { hit } }
    })
    const ctx = context(db)
    const racing = Promise.allSettled([paidRequest(ctx, request("same"), fake.call), paidRequest(ctx, request("same"), fake.call), paidRequest(ctx, request("same"), fake.call)])
    await new Promise(resolve => setTimeout(resolve, 0))
    release()
    const settled = await racing
    expect(fake.state.hits).toBe(1)
    expect(settled.filter(s => s.status === "fulfilled")).toHaveLength(1)
    expect(settled.filter(s => s.status === "rejected").every(s => (s as PromiseRejectedResult).reason instanceof ReceiptBusyError)).toBe(true)
    const again = await paidRequest(ctx, request("same"), fake.call)
    expect(again).toMatchObject({ reused: true, response: { hit: 1 } })
    expect(fake.state.hits).toBe(1)
  })

  it("same-process dual connections: same-key claims through two connections on one database file send exactly one request", async () => {
    const dir = mkdtempSync(join(tmpdir(), "paid-receipt-"))
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }))
    const file = join(dir, "shipping.db")
    const a = await setup(file)
    const nativeB = new NativeDatabase(file)
    cleanups.push(() => nativeB.close())
    const dbB = wrap(nativeB)
    let release!: () => void
    const gate = new Promise<void>(resolve => (release = resolve))
    const fake = fakeCaller(async (hit) => {
      await gate
      return { response: { hit } }
    })
    const both = Promise.allSettled([paidRequest(context(a.db), request("file-key"), fake.call), paidRequest(context(dbB), request("file-key"), fake.call)])
    await new Promise(resolve => setTimeout(resolve, 0))
    release()
    const settled = await both
    expect(fake.state.hits).toBe(1)
    expect(settled.map(s => s.status).sort()).toEqual(["fulfilled", "rejected"])
    expect((await paidRequest(context(dbB), request("file-key"), fake.call)).reused).toBe(true)
    expect(nativeB.prepare("SELECT COUNT(*) AS c FROM paid_receipt").get()).toEqual({ c: 1 })
  })

  it("a received answer is reused instead of bought again (also after completeReceipt)", async () => {
    const { db, native } = await setup()
    const fake = fakeCaller()
    const ctx = context(db)
    const first = await paidRequest(ctx, request("reuse"), fake.call)
    const second = await paidRequest(ctx, request("reuse"), fake.call)
    expect(first.reused).toBe(false)
    expect(second).toMatchObject({ reused: true, receiptId: first.receiptId, response: first.response })
    await completeReceipt(db, first.receiptId, T0)
    expect((await paidRequest(context(db, { monthlyBudget: 0 }), request("reuse"), fake.call)).reused).toBe(true)
    expect(fake.state.hits).toBe(1)
    expect(fake.state.keys).toEqual(["test-placeholder"])
    expect(row(native, "reuse")).toMatchObject({ status: "completed", attempts: 1 })
    expect(usage(native)).toMatchObject({ requests: 1, ok: 1 })
  })

  it("a timeout after sending keeps the outcome unknown and is never re-sent", async () => {
    const { db, native } = await setup()
    const fake = fakeCaller(() => new Promise<CallOutcome>(() => {}))
    const ctx = context(db, { timeoutMs: 20 })
    await expect(paidRequest(ctx, request("timeout"), fake.call)).rejects.toBeInstanceOf(ReceiptUnknownError)
    expect(row(native, "timeout")).toMatchObject({ status: "unknown", error: "timeout after send", actual_cost: null })
    expect(attempts(native, "timeout").map(a => a.status)).toEqual(["unknown"])
    await expect(paidRequest(ctx, request("timeout"), fake.call)).rejects.toBeInstanceOf(ReceiptUnknownError)
    expect(fake.state.hits).toBe(1)
    // counted conservatively at its estimate: it may have been billed
    expect(usage(native)).toMatchObject({ requests: 1, failed: 1 })
    expect(usage(native).cost).toBeCloseTo(0.01)
  })

  it("a connection reset after sending is unknown; a clear provider rejection is failed, unbilled and retryable", async () => {
    const { db, native } = await setup()
    const reset = fakeCaller(() => Promise.reject(new Error("socket hang up after sending")))
    await expect(paidRequest(context(db), request("reset"), reset.call)).rejects.toThrow(/socket hang up/)
    expect(row(native, "reset")).toMatchObject({ status: "unknown" })
    await expect(paidRequest(context(db), request("reset"), reset.call)).rejects.toBeInstanceOf(ReceiptUnknownError)
    expect(reset.state.hits).toBe(1)

    const flaky = fakeCaller(hit => (hit === 1 ? Promise.reject(new ProviderRejectedError("429 rate limited", 429, true)) : { response: { ok: true } }))
    await expect(paidRequest(context(db), request("rejected"), flaky.call)).rejects.toBeInstanceOf(ProviderRejectedError)
    expect(row(native, "rejected")).toMatchObject({ status: "failed" })
    expect((await paidRequest(context(db), request("rejected"), flaky.call)).reused).toBe(false)
    expect(flaky.state.hits).toBe(2)
    expect(attempts(native, "rejected").map(a => [a.attempt, a.status])).toEqual([[1, "failed"], [2, "received"]])
    const rejectedUsage = native.prepare("SELECT a.estimated_cost FROM paid_receipt_attempt a JOIN paid_receipt r ON r.id = a.receipt_id WHERE r.subject = 'rejected' AND a.attempt = 1").get()
    expect(rejectedUsage).toEqual({ estimated_cost: 0.01 })
  })

  it("restart: a placeholder left in flight is not re-sent by a new process, before or after the startup step", async () => {
    const { db, native } = await setup()
    const crashed = fakeCaller(() => new Promise<CallOutcome>(() => {}))
    void paidRequest(context(db), request("restart"), crashed.call).catch(() => undefined)
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(crashed.state.hits).toBe(1)
    expect(row(native, "restart")).toMatchObject({ status: "pending" })

    const restarted = fakeCaller()
    const ctx = context(db, { now: () => new Date(T0.getTime() + 60_000) })
    await expect(paidRequest(ctx, request("restart"), restarted.call)).rejects.toBeInstanceOf(ReceiptBusyError)
    expect(await markPendingReceiptsUnknownAtExclusiveStartup(db, new Date(T0.getTime() + 60_000))).toBe(1)
    expect(row(native, "restart")).toMatchObject({ status: "unknown" })
    await expect(paidRequest(ctx, request("restart"), restarted.call)).rejects.toBeInstanceOf(ReceiptUnknownError)
    expect(restarted.state.hits).toBe(0)
  })

  it("restart without the startup step: a stale placeholder becomes unknown, never re-sent", async () => {
    const { db, native } = await setup()
    const crashed = fakeCaller(() => new Promise<CallOutcome>(() => {}))
    void paidRequest(context(db), request("stale"), crashed.call).catch(() => undefined)
    void paidRequest(context(db), request("stale-2"), crashed.call).catch(() => undefined)
    await new Promise(resolve => setTimeout(resolve, 0))
    const later = new Date(T0.getTime() + 11 * 60_000)
    const restarted = fakeCaller()
    await expect(paidRequest(context(db, { now: () => later }), request("stale"), restarted.call)).rejects.toBeInstanceOf(ReceiptUnknownError)
    expect(await markStalePendingReceipts(db, later)).toBe(1)
    expect(row(native, "stale-2")).toMatchObject({ status: "unknown" })
    expect(restarted.state.hits).toBe(0)
  })

  it("keeps actual cost apart from the estimate and never records an actual cost without an actual-cost receipt", async () => {
    const { db, native } = await setup()
    await paidRequest(context(db), request("actual"), async () => ({ response: 1, cost: { amount: 0.0042, currency: "USD", basis: "actual" } }))
    expect(row(native, "actual")).toMatchObject({ estimated_cost: 0.01, actual_cost: 0.0042, cost_basis: "actual" })
    expect(attempts(native, "actual")[0]).toMatchObject({ estimated_cost: 0.01, actual_cost: 0.0042, cost_basis: "actual" })

    await paidRequest(context(db), request("no-cost"), async () => ({ response: 2 }))
    expect(row(native, "no-cost")).toMatchObject({ estimated_cost: 0.01, actual_cost: null, cost_basis: "estimated" })

    await paidRequest(context(db), request("est"), async () => ({ response: 3, cost: { amount: 0.02, currency: "USD", basis: "estimated" } }))
    expect(row(native, "est")).toMatchObject({ estimated_cost: 0.02, actual_cost: null, cost_basis: "estimated" })

    await paidRequest(context(db), request("bad-actual"), async () => ({ response: 4, cost: { amount: Number.NaN, currency: "USD", basis: "actual" } }))
    expect(row(native, "bad-actual")).toMatchObject({ actual_cost: null, cost_basis: "estimated" })
    // provider_usage carries estimates only
    expect(usage(native).cost).toBeCloseTo(0.01 + 0.01 + 0.02 + 0.01)
  })

  it("an unusable received answer can be rejected, and the retry is a new counted attempt", async () => {
    const { db, native } = await setup()
    const fake = fakeCaller(hit => ({ response: hit === 1 ? "sorry, not json" : { ok: true } }))
    const first = await paidRequest(context(db), request("unusable"), fake.call)
    await rejectReceivedResponse(db, first.receiptId, "unparsable", T0)
    const second = await paidRequest(context(db), request("unusable"), fake.call)
    expect(second).toMatchObject({ receiptId: first.receiptId, reused: false, response: { ok: true } })
    expect(attempts(native, "unusable").map(a => a.status)).toEqual(["received", "received"])
    expect(usage(native)).toMatchObject({ requests: 2 })
  })

  describe("unknown recovery keeps the possibly-billed reservation (budget 1, sent 0.6)", () => {
    const hang = () => new Promise<CallOutcome>(() => {})
    const recoveries: Array<[string, (db: PaidRequestContext["db"]) => Promise<unknown>]> = [
      ["expired claim on the same key", db => paidRequest(context(db, { monthlyBudget: 1, now: () => new Date(T0.getTime() + 11 * 60_000) }), request("held", { estimatedCost: 0.6 }), fakeCaller().call).catch(error => error)],
      ["batch stale cleanup", db => markStalePendingReceipts(db, new Date(T0.getTime() + 11 * 60_000))],
      ["exclusive startup recovery", db => markPendingReceiptsUnknownAtExclusiveStartup(db, new Date(T0.getTime() + 60_000))],
    ]
    for (const [name, recover] of recoveries) {
      it(`${name}: unknown is booked once, another key's 0.6 stays blocked, repeated recovery adds nothing`, async () => {
        const { db, native } = await setup()
        const ctx = context(db, { monthlyBudget: 1 })
        void paidRequest(ctx, request("held", { estimatedCost: 0.6 }), hang).catch(() => undefined)
        await new Promise(resolve => setTimeout(resolve, 0))
        const other = fakeCaller()
        await expect(paidRequest(ctx, request("other", { estimatedCost: 0.6 }), other.call)).rejects.toMatchObject({ code: "paid_budget_exhausted" })
        await recover(db)
        expect(row(native, "held")).toMatchObject({ status: "unknown" })
        expect(attempts(native, "held").map(a => [a.status, a.usage_recorded])).toEqual([["unknown", 1]])
        expect(usage(native)).toMatchObject({ requests: 1, failed: 1 })
        expect(usage(native).cost).toBeCloseTo(0.6)
        await expect(paidRequest(ctx, request("other", { estimatedCost: 0.6 }), other.call)).rejects.toMatchObject({ code: "paid_budget_exhausted" })
        for (const [, again] of recoveries) await again(db)
        expect(usage(native)).toMatchObject({ requests: 1 })
        expect(usage(native).cost).toBeCloseTo(0.6)
        await expect(paidRequest(ctx, request("other", { estimatedCost: 0.6 }), other.call)).rejects.toMatchObject({ code: "paid_budget_exhausted" })
        expect(other.state.hits).toBe(0)
      })
    }

    it("a late result after recovery is stored and reusable but not booked twice; the budget stays held", async () => {
      const { db, native } = await setup()
      const ctx = context(db, { monthlyBudget: 1 })
      let release!: () => void
      const gate = new Promise<void>(resolve => (release = resolve))
      const late = fakeCaller(async () => {
        await gate
        return { response: { late: true }, cost: { amount: 0.5, currency: "USD", basis: "actual" } }
      })
      const original = paidRequest(ctx, request("late", { estimatedCost: 0.6 }), late.call)
      await new Promise(resolve => setTimeout(resolve, 0))
      expect(await markPendingReceiptsUnknownAtExclusiveStartup(db, T0)).toBe(1)
      release()
      expect(await original).toMatchObject({ reused: false, response: { late: true } })
      expect(row(native, "late")).toMatchObject({ status: "received", actual_cost: 0.5, cost_basis: "actual" })
      expect(attempts(native, "late").map(a => [a.status, a.usage_recorded, a.estimated_cost])).toEqual([["received", 1, 0.6]])
      expect(usage(native)).toMatchObject({ requests: 1 })
      expect(usage(native).cost).toBeCloseTo(0.6)
      expect((await paidRequest(ctx, request("late", { estimatedCost: 0.6 }), late.call)).reused).toBe(true)
      await expect(paidRequest(ctx, request("other", { estimatedCost: 0.6 }), fakeCaller().call)).rejects.toMatchObject({ code: "paid_budget_exhausted" })
      expect(late.state.hits).toBe(1)
    })

    it("a captured timeout followed by recovery books the attempt exactly once", async () => {
      const { db, native } = await setup()
      const ctx = context(db, { monthlyBudget: 1, timeoutMs: 10 })
      await expect(paidRequest(ctx, request("t", { estimatedCost: 0.6 }), hang)).rejects.toBeInstanceOf(ReceiptUnknownError)
      await markStalePendingReceipts(db, new Date(T0.getTime() + 11 * 60_000))
      await markPendingReceiptsUnknownAtExclusiveStartup(db, T0)
      expect(usage(native)).toMatchObject({ requests: 1 })
      expect(usage(native).cost).toBeCloseTo(0.6)
    })
  })

  describe("costs are finite, non-negative and in the budget currency", () => {
    it("rejects an invalid request estimate before claiming or sending", async () => {
      const { db, native } = await setup()
      const fake = fakeCaller()
      for (const bad of [-1, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, "0.1" as unknown as number]) {
        await expect(paidRequest(context(db), request(`bad-${String(bad)}`, { estimatedCost: bad }), fake.call)).rejects.toBeInstanceOf(PaidCostError)
      }
      expect(fake.state.hits).toBe(0)
      expect(native.prepare("SELECT COUNT(*) AS c FROM paid_receipt").get()).toEqual({ c: 0 })
      expect(usage(native).requests).toBe(0)
    })

    it("invalid returned costs keep the valid estimate, store no negative or fake actual, and never lower the ledger or unlock the budget", async () => {
      const { db, native } = await setup()
      const ctx = context(db, { monthlyBudget: 0.05 })
      const returned: Array<[string, CallOutcome["cost"]]> = [
        ["neg-est", { amount: -1, currency: "USD", basis: "estimated" }],
        ["neg-actual", { amount: -0.5, currency: "USD", basis: "actual" }],
        ["nan", { amount: Number.NaN, currency: "USD", basis: "actual" }],
        ["inf", { amount: Number.POSITIVE_INFINITY, currency: "USD", basis: "estimated" }],
        ["eur", { amount: 0.001, currency: "EUR", basis: "actual" }],
      ]
      let ledger = 0
      for (const [subject, cost] of returned.slice(0, 4)) {
        await paidRequest(ctx, request(subject), async () => ({ response: subject, cost }))
        expect(row(native, subject)).toMatchObject({ estimated_cost: 0.01, actual_cost: null, cost_basis: "estimated", currency: "USD" })
        expect(String(row(native, subject)!.error)).toMatch(/returned cost rejected/)
        expect(usage(native).cost).toBeGreaterThanOrEqual(ledger)
        ledger = usage(native).cost
      }
      expect(ledger).toBeCloseTo(0.04)
      await paidRequest(ctx, request("eur"), async () => ({ response: "eur", cost: returned[4]![1] }))
      expect(row(native, "eur")).toMatchObject({ estimated_cost: 0.01, actual_cost: null, cost_basis: "estimated", currency: "USD" })
      expect(String(row(native, "eur")!.error)).toMatch(/currency EUR != USD/)
      expect(usage(native).cost).toBeCloseTo(0.05)
      const blocked = fakeCaller()
      await expect(paidRequest(ctx, request("after", { estimatedCost: 0.001 }), blocked.call)).rejects.toMatchObject({ code: "paid_budget_exhausted" })
      expect(blocked.state.hits).toBe(0)
      expect(native.prepare("SELECT COUNT(*) AS c FROM paid_receipt WHERE actual_cost < 0 OR estimated_cost < 0").get()).toEqual({ c: 0 })
      expect(native.prepare("SELECT COUNT(*) AS c FROM paid_receipt_attempt WHERE actual_cost < 0 OR estimated_cost < 0").get()).toEqual({ c: 0 })
    })

    it("zero cost is valid: a zero estimate is accepted and a zero actual receipt is recorded as actual", async () => {
      const { db, native } = await setup()
      await paidRequest(context(db), request("zero-est", { estimatedCost: 0 }), async () => ({ response: 1 }))
      expect(row(native, "zero-est")).toMatchObject({ estimated_cost: 0, actual_cost: null, cost_basis: "estimated" })
      await paidRequest(context(db), request("zero-actual"), async () => ({ response: 2, cost: { amount: 0, currency: "USD", basis: "actual" } }))
      expect(row(native, "zero-actual")).toMatchObject({ estimated_cost: 0.01, actual_cost: 0, cost_basis: "actual", error: null })
    })
  })

  it("the logical key is stable for the same identity regardless of key order and differs by attempt tag", () => {
    const a = logicalKeyFor(request("k", { identity: { a: 1, b: 2 } }))
    expect(logicalKeyFor(request("k", { identity: { b: 2, a: 1 } }))).toBe(a)
    expect(logicalKeyFor(request("k", { identity: { a: 1, b: 2 }, attemptTag: "rerun-1" }))).not.toBe(a)
  })

  it("shares the one budget decision with translation", () => {
    expect(decidePaidBudget(undefined, 0)).toBe("budget_unconfigured")
    expect(decidePaidBudget(0, 0)).toBe("budget_zero")
    expect(decidePaidBudget(2, 2)).toBe("budget_exhausted")
    expect(decidePaidBudget(2, 1.5, 0.6)).toBe("budget_exhausted")
    expect(decidePaidBudget(2, 1.5, 0.5)).toBeNull()
    expect(new PaidGateError("paid_budget_zero").code).toBe("paid_budget_zero")
  })
})
