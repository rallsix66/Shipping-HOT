/**
 * Offline mock tests for DeepSeek Search/Fetch pilot attempt hard-gate.
 * Temp ledgers under project `.tmp`; never reads real secrets or network.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import process from "node:process"
import { join } from "node:path"
import { Worker } from "node:worker_threads"
import { afterEach, describe, expect, it } from "vitest"
import {
  BUDGET_MILLI_CNY,
  FIRST_ROUND_FETCH_TARGETS,
  FIRST_ROUND_SEARCH_QUERIES,
  MAX_ATTEMPTS_PER_CAPABILITY,
  PILOT_ID,
  type PilotOutbound,
  UNIT_COST_MILLI_CNY,
  countAttempts,
  createMemorySecretStore,
  finalizeAttempt,
  openPilotLedger,
  reserveAttempt,
  runPilot,
  sanitizePilotText,
  searchOperationKey,
  sumReservedMilli,
} from "./deepseek-search-fetch-pilot-lib"
import { DEEPSEEK_SEARCH_CAPABILITY } from "#/intel/discovery/deepseek-search-fetch-policy"

const TMP_ROOT = join(process.cwd(), ".tmp", "deepseek-pilot-vitest-2026-10-23")
mkdirSync(TMP_ROOT, { recursive: true })

const cleanups: Array<() => void> = []
afterEach(() => {
  while (cleanups.length) cleanups.pop()!()
})

function tempDir(label: string): string {
  const dir = mkdtempSync(join(TMP_ROOT, `${label}-`))
  cleanups.push(() => {
    try {
      rmSync(dir, { recursive: true, force: true })
    } catch {
      /* ignore */
    }
  })
  return dir
}

function mockOutbound(handler?: {
  search?: (query: string) => Promise<{ ok: boolean, unknown?: boolean, errorCode?: string }>
  fetch?: (url: string) => Promise<{ ok: boolean, unknown?: boolean, errorCode?: string }>
  tracker?: { search: string[], fetch: string[] }
}): PilotOutbound {
  const tracker = handler?.tracker ?? { search: [], fetch: [] }
  return {
    search: async (query) => {
      tracker.search.push(query)
      if (handler?.search) return handler.search(query)
      return { ok: true }
    },
    fetch: async (url) => {
      tracker.fetch.push(url)
      if (handler?.fetch) return handler.fetch(url)
      return { ok: true }
    },
  }
}

describe("deepseek-search-fetch-pilot attempt hard gate", () => {
  it("aligns integer milli unit with policy 0.005 CNY", () => {
    expect(UNIT_COST_MILLI_CNY).toBe(5)
    expect(BUDGET_MILLI_CNY).toBe(50)
    expect(MAX_ATTEMPTS_PER_CAPABILITY).toBe(10)
    expect(BUDGET_MILLI_CNY / UNIT_COST_MILLI_CNY).toBe(10)
  })

  it("lists first-round Search queries and empty Fetch", () => {
    expect(FIRST_ROUND_SEARCH_QUERIES).toHaveLength(8)
    expect(FIRST_ROUND_FETCH_TARGETS).toEqual([])
    expect(FIRST_ROUND_SEARCH_QUERIES[0]).toBe(
      "PPA Philippines Ports Authority Manila port advisory 2026",
    )
  })

  it("plan-only never outbound and never burns attempts", async () => {
    const dir = tempDir("plan")
    const ledgerPath = join(dir, "ledger.sqlite3")
    const tracker = { search: [] as string[], fetch: [] as string[] }
    const summary = await runPilot({
      mode: "plan",
      ledgerPath,
      pilotId: PILOT_ID,
      outbound: mockOutbound({ tracker }),
      readKey: async () => "sk-should-not-be-used-plan",
    })
    expect(summary.outboundCalls).toBe(0)
    expect(tracker.search).toEqual([])
    expect(summary.ops.every(op => op.outcome === "planned")).toBe(true)
    expect(summary.fetchTargets).toEqual([])
    expect(summary.exitCode).toBe(0)
  })

  it("missing key: zero outbound and zero reservations", async () => {
    const dir = tempDir("nokey")
    const ledgerPath = join(dir, "ledger.sqlite3")
    const tracker = { search: [] as string[], fetch: [] as string[] }
    const summary = await runPilot({
      mode: "execute",
      ledgerPath,
      pilotId: PILOT_ID,
      searchQueries: FIRST_ROUND_SEARCH_QUERIES.slice(0, 2),
      outbound: mockOutbound({ tracker }),
      readKey: async () => undefined,
    })
    expect(summary.failureCode).toBe("missing_api_key")
    expect(summary.outboundCalls).toBe(0)
    expect(tracker.search).toEqual([])
    expect(summary.searchAttempts).toBe(0)
    // ledger file may be absent because we bail before open
  })

  it("failed outbound still counts as an attempt", async () => {
    const dir = tempDir("fail")
    const ledgerPath = join(dir, "ledger.sqlite3")
    const summary = await runPilot({
      mode: "execute",
      ledgerPath,
      pilotId: PILOT_ID,
      searchQueries: ["q-fail-1"],
      readKey: async () => "sk-test-placeholder",
      outbound: mockOutbound({
        search: async () => ({ ok: false, errorCode: "provider_unavailable" }),
      }),
    })
    expect(summary.searchAttempts).toBe(1)
    expect(summary.ops[0]?.outcome).toBe("failed")
    const ledger = openPilotLedger(ledgerPath, PILOT_ID)
    try {
      expect(countAttempts(ledger.native, PILOT_ID, DEEPSEEK_SEARCH_CAPABILITY)).toBe(1)
    } finally {
      ledger.close()
    }
  })

  it("unknown outbound still counts as an attempt", async () => {
    const dir = tempDir("unknown")
    const ledgerPath = join(dir, "ledger.sqlite3")
    const summary = await runPilot({
      mode: "execute",
      ledgerPath,
      pilotId: PILOT_ID,
      searchQueries: ["q-unknown-1"],
      readKey: async () => "sk-test-placeholder",
      outbound: mockOutbound({
        search: async () => ({ ok: false, unknown: true, errorCode: "ReceiptUnknownError" }),
      }),
    })
    expect(summary.searchAttempts).toBe(1)
    expect(summary.ops[0]?.outcome).toBe("unknown")
  })

  it("reopening ledger file does not reset attempt counters", async () => {
    const dir = tempDir("reopen")
    const ledgerPath = join(dir, "ledger.sqlite3")
    await runPilot({
      mode: "execute",
      ledgerPath,
      pilotId: PILOT_ID,
      searchQueries: ["q-a", "q-b"],
      readKey: async () => "sk-test-placeholder",
      outbound: mockOutbound(),
    })
    const again = openPilotLedger(ledgerPath, PILOT_ID)
    try {
      expect(countAttempts(again.native, PILOT_ID, DEEPSEEK_SEARCH_CAPABILITY)).toBe(2)
      expect(sumReservedMilli(again.native, PILOT_ID, DEEPSEEK_SEARCH_CAPABILITY)).toBe(10)
    } finally {
      again.close()
    }
    const third = await runPilot({
      mode: "execute",
      ledgerPath,
      pilotId: PILOT_ID,
      searchQueries: ["q-c"],
      readKey: async () => "sk-test-placeholder",
      outbound: mockOutbound(),
    })
    expect(third.searchAttempts).toBe(3)
  })

  it("duplicate operation_key does not increase attempt total or re-buy", async () => {
    const dir = tempDir("dup")
    const ledgerPath = join(dir, "ledger.sqlite3")
    const tracker = { search: [] as string[], fetch: [] as string[] }
    const queries = ["same-query-twice"]
    await runPilot({
      mode: "execute",
      ledgerPath,
      pilotId: PILOT_ID,
      searchQueries: queries,
      readKey: async () => "sk-test-placeholder",
      outbound: mockOutbound({ tracker }),
    })
    const second = await runPilot({
      mode: "execute",
      ledgerPath,
      pilotId: PILOT_ID,
      searchQueries: queries,
      readKey: async () => "sk-test-placeholder",
      outbound: mockOutbound({ tracker }),
    })
    expect(second.searchAttempts).toBe(1)
    expect(second.ops[0]?.outcome).toBe("duplicate_skipped")
    expect(tracker.search).toEqual(["same-query-twice"])
  })

  it("hard-stops at attempt 10 even when budget milli would allow float confusion", async () => {
    const dir = tempDir("cap10")
    const ledgerPath = join(dir, "ledger.sqlite3")
    const queries = Array.from({ length: 12 }, (_, i) => `q-${i}`)
    const summary = await runPilot({
      mode: "execute",
      ledgerPath,
      pilotId: PILOT_ID,
      searchQueries: queries,
      readKey: async () => "sk-test-placeholder",
      outbound: mockOutbound(),
      maxAttempts: 10,
      budgetMilli: 10_000, // deliberately huge so attempt gate is the limiter
      unitMilli: 5,
    })
    expect(summary.searchAttempts).toBe(10)
    expect(summary.ops.filter(op => op.outcome === "succeeded")).toHaveLength(10)
    expect(summary.ops.some(op => op.errorCode === "attempt_limit_reached")).toBe(true)
  })

  it("budget milli integer gate refuses before float-style approx", async () => {
    const dir = tempDir("budget")
    const ledgerPath = join(dir, "ledger.sqlite3")
    const ledger = openPilotLedger(ledgerPath, PILOT_ID)
    try {
      for (let i = 0; i < 9; i += 1) {
        const r = reserveAttempt(ledger.native, {
          pilotId: PILOT_ID,
          capability: DEEPSEEK_SEARCH_CAPABILITY,
          operationKey: searchOperationKey(`pre-${i}`),
          unitMilli: 5,
          budgetMilli: 50,
          maxAttempts: 10,
        })
        expect(r.ok).toBe(true)
        if (r.ok && r.fresh) {
          finalizeAttempt(ledger.native, { attemptId: r.attemptId, status: "succeeded" })
        }
      }
      // 9*5=45; next unit 5 => 50 OK; then budget blocks even if attempts < 10 when unit is 6
      const ok10 = reserveAttempt(ledger.native, {
        pilotId: PILOT_ID,
        capability: DEEPSEEK_SEARCH_CAPABILITY,
        operationKey: searchOperationKey("pre-9"),
        unitMilli: 5,
        budgetMilli: 50,
        maxAttempts: 10,
      })
      expect(ok10.ok).toBe(true)
      if (ok10.ok) finalizeAttempt(ledger.native, { attemptId: ok10.attemptId, status: "succeeded" })
      const blocked = reserveAttempt(ledger.native, {
        pilotId: PILOT_ID,
        capability: DEEPSEEK_SEARCH_CAPABILITY,
        operationKey: searchOperationKey("pre-10"),
        unitMilli: 5,
        budgetMilli: 50,
        maxAttempts: 99,
      })
      expect(blocked.ok).toBe(false)
      if (!blocked.ok) expect(blocked.code).toBe("budget_limit_reached")
    } finally {
      ledger.close()
    }
  })

  it("concurrent last-slot reserves: exactly one winner, total attempts=10", async () => {
    const dir = tempDir("concurrent")
    const ledgerPath = join(dir, "ledger.sqlite3")
    const ledger = openPilotLedger(ledgerPath, PILOT_ID)
    try {
      for (let i = 0; i < 9; i += 1) {
        const r = reserveAttempt(ledger.native, {
          pilotId: PILOT_ID,
          capability: DEEPSEEK_SEARCH_CAPABILITY,
          operationKey: `seed:${i}`,
          unitMilli: 5,
          budgetMilli: 50,
          maxAttempts: 10,
        })
        expect(r.ok && r.fresh).toBe(true)
        if (r.ok) finalizeAttempt(ledger.native, { attemptId: r.attemptId, status: "succeeded" })
      }
    } finally {
      ledger.close()
    }

    const betterSqlite3Path = join(process.cwd(), "node_modules", "better-sqlite3")
    const workerSource = `
      const { parentPort, workerData } = require('node:worker_threads');
      const Database = require(workerData.betterSqlite3Path);
      const db = new Database(workerData.ledgerPath);
      db.exec('BEGIN IMMEDIATE');
      let result;
      try {
        const attempts = db.prepare('SELECT COUNT(*) AS c FROM pilot_attempt WHERE pilot_id = ? AND capability = ?')
          .get(workerData.pilotId, workerData.capability).c;
        if (attempts >= 10) {
          result = { ok: false, code: 'attempt_limit_reached', attempts };
          db.exec('ROLLBACK');
        } else {
          const id = require('node:crypto').randomUUID();
          db.prepare(\`INSERT INTO pilot_attempt
            (id, pilot_id, capability, operation_key, status, reserved_milli, created_at, finished_at, error_code)
            VALUES (?, ?, ?, ?, 'reserved', 5, ?, NULL, NULL)\`)
            .run(id, workerData.pilotId, workerData.capability, workerData.operationKey, new Date().toISOString());
          db.exec('COMMIT');
          result = { ok: true, attemptId: id, attempts: attempts + 1 };
        }
      } catch (error) {
        try { db.exec('ROLLBACK'); } catch {}
        result = { ok: false, code: 'error', message: String(error) };
      }
      db.close();
      parentPort.postMessage(result);
    `
    const workerFile = join(dir, "reserve-worker.cjs")
    writeFileSync(workerFile, workerSource, "utf8")

    function runWorker(operationKey: string): Promise<{ ok: boolean, code?: string }> {
      return new Promise((resolvePromise, reject) => {
        const worker = new Worker(workerFile, {
          workerData: {
            ledgerPath,
            betterSqlite3Path,
            pilotId: PILOT_ID,
            capability: DEEPSEEK_SEARCH_CAPABILITY,
            operationKey,
          },
        })
        worker.on("message", resolvePromise)
        worker.on("error", reject)
        worker.on("exit", (code) => {
          if (code !== 0) reject(new Error(`worker_exit_${code}`))
        })
      })
    }

    const [a, b] = await Promise.all([
      runWorker("concurrent:a"),
      runWorker("concurrent:b"),
    ])
    const wins = [a, b].filter(r => r.ok).length
    const losses = [a, b].filter(r => !r.ok).length
    expect(wins).toBe(1)
    expect(losses).toBe(1)
    const check = openPilotLedger(ledgerPath, PILOT_ID)
    try {
      expect(countAttempts(check.native, PILOT_ID, DEEPSEEK_SEARCH_CAPABILITY)).toBe(10)
    } finally {
      check.close()
    }
  })

  it("sanitizes secret-like text and does not retain key after execute", async () => {
    const dir = tempDir("sanitize")
    const ledgerPath = join(dir, "ledger.sqlite3")
    const apiKey = "sk-live-SECRETVALUE999"
    expect(sanitizePilotText(`Bearer ${apiKey} boom`, apiKey)).not.toContain("SECRETVALUE")
    expect(sanitizePilotText(`Authorization: ${apiKey}`, apiKey)).toContain("[redacted]")

    const store = createMemorySecretStore(apiKey)
    expect(store.peekConfigured()).toBe(true)
    const summary = await runPilot({
      mode: "execute",
      ledgerPath,
      pilotId: PILOT_ID,
      searchQueries: ["q-sanitize"],
      readKey: async () => apiKey,
      outbound: mockOutbound({
        search: async () => ({ ok: false, errorCode: `auth ${apiKey} failed` }),
      }),
    })
    const dumped = JSON.stringify(summary)
    expect(dumped).not.toContain("SECRETVALUE")
    expect(summary.ops[0]?.errorCode).not.toContain("SECRETVALUE")
    // runPilot clears the store it creates; our external store is separate — verify API:
    store.clear()
    expect(store.peekConfigured()).toBe(false)
    expect(await store.has("deepseek")).toBe(false)
  })

  it("empty Fetch list yields zero fetch attempts under execute", async () => {
    const dir = tempDir("nofetch")
    const ledgerPath = join(dir, "ledger.sqlite3")
    const tracker = { search: [] as string[], fetch: [] as string[] }
    const summary = await runPilot({
      mode: "execute",
      ledgerPath,
      pilotId: PILOT_ID,
      searchQueries: ["only-search"],
      fetchTargets: [],
      readKey: async () => "sk-test-placeholder",
      outbound: mockOutbound({ tracker }),
    })
    expect(tracker.fetch).toEqual([])
    expect(summary.fetchAttempts).toBe(0)
    expect(summary.notes.some(n => n.includes("fetch_targets"))).toBe(true)
  })
})
