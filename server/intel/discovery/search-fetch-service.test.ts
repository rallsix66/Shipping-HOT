/**
 * Offline DeepSeek Search/Fetch slice-1 tests (contract-gap fixes).
 * Synthetic HTTP only; never reads real SecretStore credentials or calls the network.
 * Temp SQLite / logs stay under project `.tmp`.
 */
import { mkdirSync } from "node:fs"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import NativeDatabase from "better-sqlite3"
import { createDatabase } from "db0"
import { containsSecretLike, receiptPayloadHasBodyLeak, trimFetchMeta, trimSearchCandidates } from "./candidate-trim"
import {
  DEEPSEEK_FETCH_CAPABILITY,
  DEEPSEEK_SEARCH_CAPABILITY,
  DEEPSEEK_SEARCH_FETCH_DEFAULT_TIMEOUT_MS,
  DEEPSEEK_SEARCH_FETCH_POLICY_VERSION,
  DEEPSEEK_SEARCH_FETCH_PROVIDER_ID,
  DEEPSEEK_SEARCH_FETCH_UNIT_COST_CNY,
} from "./deepseek-search-fetch-policy"
import {
  SearchFetchCancelledError,
  SearchFetchDisabledError,
  type SearchFetchServiceConfig,
  readResponseBodyLimited,
  reviewFetchTarget,
  runDeepSeekFetch,
  runDeepSeekSearch,
} from "./search-fetch-service"
import { initShippingTables } from "#/database/shipping"
import type { SecretStore } from "#/providers/contracts"
import { PaidGateError, ReceiptUnknownError } from "#/intel/llm/receipts"
import {
  DEEPSEEK_TOOLS_BASE,
  DeepSeekToolsClientError,
  DeepSeekToolsOutcomeUnknownError,
  type InjectedFetcher,
  staticReadText,
} from "#/providers/deepseek/search-fetch-client"

function isUnknownOutcome(error: unknown): boolean {
  // paidRequest wraps Timeout as ReceiptUnknownError; other post-send ambiguities
  // are rethrown as-is after booking status=unknown.
  return error instanceof ReceiptUnknownError || error instanceof DeepSeekToolsOutcomeUnknownError
}

const T0 = new Date("2026-10-23T03:00:00.000Z")
const PLACEHOLDER_KEY = "test-placeholder-not-a-real-key"
const TMP_ROOT = join(process.cwd(), ".tmp", "deepseek-search-fetch-gapfix3-2026-10-23")
mkdirSync(TMP_ROOT, { recursive: true })

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

async function setup(path?: string) {
  const native = path ? new NativeDatabase(path) : new NativeDatabase(":memory:")
  cleanups.push(() => {
    try {
      native.close()
    } catch { /* already closed */ }
  })
  const db = wrap(native)
  await initShippingTables(db, "mock")
  return { db, native, path }
}

function secrets(values: Record<string, string> = { [DEEPSEEK_SEARCH_FETCH_PROVIDER_ID]: PLACEHOLDER_KEY }, tracker?: { gets: string[] }): SecretStore {
  const map = new Map(Object.entries(values))
  return {
    get: async (id) => {
      tracker?.gets.push(id)
      return map.get(id)
    },
    set: async (id, value) => void map.set(id, value),
    delete: async id => void map.delete(id),
    has: async id => map.has(id),
    source: async id => (map.has(id) ? "file" : "none") as never,
  }
}

function jsonResponse(status: number, body: unknown) {
  const text = typeof body === "string" ? body : JSON.stringify(body)
  return {
    status,
    ok: status >= 200 && status < 300,
    readText: staticReadText(text),
    headers: { get: () => null },
  }
}

function mockFetcher(handler: (url: string, init?: Parameters<InjectedFetcher>[1]) => ReturnType<InjectedFetcher> | Promise<ReturnType<InjectedFetcher>>) {
  const state = { hits: 0, urls: [] as string[], bodies: [] as string[], signals: [] as Array<AbortSignal | undefined> }
  const fetcher: InjectedFetcher = async (url, init) => {
    state.hits++
    state.urls.push(url)
    state.bodies.push(init?.body ?? "")
    state.signals.push(init?.signal)
    return handler(url, init)
  }
  return { state, fetcher }
}

function baseConfig(db: SearchFetchServiceConfig["db"], extra: Partial<SearchFetchServiceConfig> = {}): SearchFetchServiceConfig {
  return {
    db,
    secretStore: secrets(),
    enabled: true,
    monthlyBudgetSearch: 1,
    monthlyBudgetFetch: 1,
    now: () => T0,
    ...extra,
  }
}

const searchHitBody = {
  results: [
    {
      title: "Alpha Port Notice",
      url: "https://example.com/a",
      snippet: "SECRET_SNIPPET_SHOULD_NOT_PERSIST",
      summary: "SECRET_SUMMARY",
      content: "SECRET_CONTENT_BODY",
      date: "2026-10-01",
    },
    {
      title: "Beta",
      url: "https://example.com/b",
      snippet: "more",
    },
  ],
}

describe("candidate-trim", () => {
  it("drops snippet/summary/content and dedupes by URL", () => {
    const trimmed = trimSearchCandidates([
      ...searchHitBody.results,
      { title: "dup", url: "https://example.com/a", snippet: "x" },
      { title: "bad", url: "not-a-url" },
    ])
    expect(trimmed).toHaveLength(2)
    expect(trimmed[0]).toMatchObject({ url: "https://example.com/a", title: "Alpha Port Notice", providerDate: "2026-10-01" })
    expect(trimmed[0]?.titleUrlHash).toMatch(/^[a-f0-9]{64}$/)
    expect(JSON.stringify(trimmed)).not.toMatch(/SECRET_|snippet|summary|content/)
  })

  it("labels Fetch meta as third_party_markdown without origin/local evidence", () => {
    const meta = trimFetchMeta("https://example.com/x", {
      title: "T",
      content: "# md SECRET_BODY",
    })
    expect(meta).toMatchObject({
      provenance: "third_party_markdown",
      originResponseHash: null,
      localFetchEvidence: "none",
      empty: false,
    })
    expect(meta.convertedContentHash).toMatch(/^[a-f0-9]{64}$/)
    expect(meta).not.toHaveProperty("contentHash")
    expect(JSON.stringify(meta)).not.toMatch(/SECRET_BODY/)
  })
})

describe("reviewFetchTarget", () => {
  it("rejects blocked targets and allows public https", () => {
    expect(reviewFetchTarget("http://[::1]/")).toMatchObject({ status: "locally_rejected", code: "url_blocked" })
    expect(reviewFetchTarget("http://localhost./")).toMatchObject({ status: "locally_rejected" })
    expect(reviewFetchTarget("https://example.com/a")).toMatchObject({
      status: "syntactically_allowed",
      canonicalUrl: "https://example.com/a",
    })
  })
})

describe("runDeepSeekSearch (offline)", () => {
  it("default-off never reads SecretStore and never HTTP", async () => {
    const { db } = await setup()
    const gets: string[] = []
    const { state, fetcher } = mockFetcher(async () => jsonResponse(200, searchHitBody))
    await expect(runDeepSeekSearch(baseConfig(db, {
      enabled: false,
      secretStore: secrets({}, { gets }),
      fetcher,
    }), { query: "port congestion", purpose: "slice1_test" })).rejects.toBeInstanceOf(SearchFetchDisabledError)
    expect(gets).toEqual([])
    expect(state.hits).toBe(0)
  })

  it("budget zero / unconfigured never reads SecretStore and never HTTP", async () => {
    const { db } = await setup()
    for (const budget of [0, null, undefined] as const) {
      const gets: string[] = []
      const { state, fetcher } = mockFetcher(async () => jsonResponse(200, searchHitBody))
      await expect(runDeepSeekSearch(baseConfig(db, {
        monthlyBudgetSearch: budget,
        secretStore: secrets({}, { gets }),
        fetcher,
      }), { query: "q", purpose: "slice1_test" })).rejects.toBeInstanceOf(PaidGateError)
      expect(gets).toEqual([])
      expect(state.hits).toBe(0)
    }
  })

  it("invalid query/count fail before paidRequest (no unknown receipt)", async () => {
    const { db, native } = await setup()
    const { state, fetcher } = mockFetcher(async () => jsonResponse(200, searchHitBody))
    const cfg = baseConfig(db, { fetcher })
    await expect(runDeepSeekSearch(cfg, { query: "   ", purpose: "slice1_test", subject: "bad-q" }))
      .rejects
      .toMatchObject({ code: "invalid_query" })
    await expect(runDeepSeekSearch(cfg, { query: "ok", count: 0, purpose: "slice1_test", subject: "bad-c" }))
      .rejects
      .toMatchObject({ code: "invalid_count" })
    expect(state.hits).toBe(0)
    const rows = native.prepare("SELECT COUNT(*) AS n FROM paid_receipt").get() as { n: number }
    expect(rows.n).toBe(0)
  })

  it("empty results book zero cost and leave budget for the next call", async () => {
    const { db, native } = await setup()
    const { state, fetcher } = mockFetcher(async () => jsonResponse(200, { results: [] }))
    const cfg = baseConfig(db, { monthlyBudgetSearch: DEEPSEEK_SEARCH_FETCH_UNIT_COST_CNY, fetcher })
    const first = await runDeepSeekSearch(cfg, { query: "empty-q", purpose: "slice1_test", subject: "empty" })
    expect(first.billable).toBe(false)
    expect(first.candidates).toEqual([])
    expect(first.upstreamResultCount).toBe(0)
    expect(state.hits).toBe(1)
    const usage = native.prepare(
      "SELECT COALESCE(SUM(estimated_cost),0) AS cost, COALESCE(SUM(success_count),0) AS ok FROM provider_usage WHERE capability = ?",
    ).get(DEEPSEEK_SEARCH_CAPABILITY) as { cost: number, ok: number }
    expect(usage.cost).toBe(0)
    const { state: state2, fetcher: fetcher2 } = mockFetcher(async () => jsonResponse(200, searchHitBody))
    const second = await runDeepSeekSearch({ ...cfg, fetcher: fetcher2 }, { query: "filled-q", purpose: "slice1_test", subject: "filled" })
    expect(second.billable).toBe(true)
    expect(state2.hits).toBe(1)
  })

  it("upstream non-empty still bills when every candidate is trimmed away", async () => {
    const { db, native } = await setup()
    const { state, fetcher } = mockFetcher(async () => jsonResponse(200, {
      results: [{ title: "x", url: "not-a-url", snippet: "SECRET" }],
    }))
    const cfg = baseConfig(db, { monthlyBudgetSearch: DEEPSEEK_SEARCH_FETCH_UNIT_COST_CNY, fetcher })
    const out = await runDeepSeekSearch(cfg, { query: "all-filtered", purpose: "slice1_test", subject: "filtered" })
    expect(out.candidates).toEqual([])
    expect(out.upstreamResultCount).toBe(1)
    expect(out.billable).toBe(true)
    expect(state.hits).toBe(1)
    const receipt = native.prepare("SELECT estimated_cost, status FROM paid_receipt WHERE subject = ?").get("filtered") as {
      estimated_cost: number
      status: string
    }
    expect(receipt.status).toBe("received")
    expect(receipt.estimated_cost).toBeCloseTo(DEEPSEEK_SEARCH_FETCH_UNIT_COST_CNY)
    // Budget consumed — second distinct search blocked.
    const { state: state2, fetcher: fetcher2 } = mockFetcher(async () => jsonResponse(200, searchHitBody))
    await expect(runDeepSeekSearch({ ...cfg, fetcher: fetcher2 }, { query: "next", purpose: "slice1_test", subject: "next" }))
      .rejects
      .toMatchObject({ code: "paid_budget_exhausted" })
    expect(state2.hits).toBe(0)
  })

  it("billable success reserves unit cost; cache hit issues zero HTTP", async () => {
    const { db, native } = await setup()
    const { state, fetcher } = mockFetcher(async () => jsonResponse(200, searchHitBody))
    const cfg = baseConfig(db, { fetcher })
    const first = await runDeepSeekSearch(cfg, { query: "cache-me", purpose: "slice1_test", subject: "cache" })
    expect(first.reused).toBe(false)
    expect(first.candidates).toHaveLength(2)
    expect(first.candidates[0]?.title).toBe("Alpha Port Notice")
    expect(JSON.stringify(first.candidates)).not.toMatch(/SECRET_/)
    const second = await runDeepSeekSearch(cfg, { query: "cache-me", purpose: "slice1_test", subject: "cache" })
    expect(second.reused).toBe(true)
    expect(state.hits).toBe(1)
    const receipt = native.prepare("SELECT response, estimated_cost, actual_cost, cost_basis, status FROM paid_receipt WHERE subject = ?").get("cache") as {
      response: string
      estimated_cost: number
      actual_cost: number | null
      cost_basis: string
      status: string
    }
    expect(receipt.status).toBe("received")
    expect(receipt.cost_basis).toBe("estimated")
    expect(receipt.actual_cost).toBeNull()
    expect(receipt.estimated_cost).toBeCloseTo(DEEPSEEK_SEARCH_FETCH_UNIT_COST_CNY)
    expect(receiptPayloadHasBodyLeak(JSON.parse(receipt.response))).toBe(false)
    expect(containsSecretLike(receipt.response, PLACEHOLDER_KEY)).toBe(false)
  })

  it("last-unit concurrency: only one of two distinct searches may spend the final unit", async () => {
    const { db } = await setup()
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    let entered = 0
    const { state, fetcher } = mockFetcher(async () => {
      entered++
      if (entered === 1) await gate
      return jsonResponse(200, searchHitBody)
    })
    const cfg = baseConfig(db, {
      monthlyBudgetSearch: DEEPSEEK_SEARCH_FETCH_UNIT_COST_CNY,
      fetcher,
    })
    const a = runDeepSeekSearch(cfg, { query: "concurrent-a", purpose: "slice1_test", subject: "ca" })
    for (let i = 0; i < 50; i++) {
      if (entered >= 1) break
      await new Promise(r => setTimeout(r, 10))
    }
    expect(entered).toBe(1)
    const b = runDeepSeekSearch(cfg, { query: "concurrent-b", purpose: "slice1_test", subject: "cb" })
    await expect(b).rejects.toMatchObject({ code: "paid_budget_exhausted" })
    release()
    const won = await a
    expect(won.billable).toBe(true)
    expect(state.hits).toBe(1)
  })

  it("post-send unknown keeps reservation; temp-file restart does not rebuy", async () => {
    const dbPath = join(TMP_ROOT, `search-restart-${Date.now()}.sqlite`)
    const { db, native } = await setup(dbPath)
    const hang: InjectedFetcher = async (_url, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true })
    })
    const cfg = baseConfig(db, {
      monthlyBudgetSearch: DEEPSEEK_SEARCH_FETCH_UNIT_COST_CNY,
      fetcher: hang,
      timeoutMs: 40,
    })
    await expect(runDeepSeekSearch(cfg, { query: "hang-q", purpose: "slice1_test", subject: "hang" }))
      .rejects
      .toSatisfy(isUnknownOutcome)
    const row = native.prepare("SELECT status, estimated_cost, error FROM paid_receipt WHERE subject = ?").get("hang") as {
      status: string
      estimated_cost: number
      error: string | null
    }
    expect(row.status).toBe("unknown")
    expect(row.estimated_cost).toBeCloseTo(DEEPSEEK_SEARCH_FETCH_UNIT_COST_CNY)
    expect(String(row.error ?? "")).not.toMatch(/Bearer |sk-|SECRET_/)
    native.close()

    // Re-open the same on-disk DB — restart evidence, not same in-memory handle.
    const native2 = new NativeDatabase(dbPath)
    cleanups.push(() => {
      try {
        native2.close()
      } catch { /* */ }
    })
    const db2 = wrap(native2)
    const { state, fetcher } = mockFetcher(async () => jsonResponse(200, searchHitBody))
    const cfg2 = baseConfig(db2, {
      monthlyBudgetSearch: DEEPSEEK_SEARCH_FETCH_UNIT_COST_CNY,
      fetcher,
    })
    await expect(runDeepSeekSearch(cfg2, { query: "hang-q", purpose: "slice1_test", subject: "hang" }))
      .rejects
      .toSatisfy(isUnknownOutcome)
    expect(state.hits).toBe(0)
    await expect(runDeepSeekSearch(cfg2, { query: "other-q", purpose: "slice1_test", subject: "other" }))
      .rejects
      .toMatchObject({ code: "paid_budget_exhausted" })
    expect(state.hits).toBe(0)
  })

  it("hTTP 200 invalid JSON keeps unknown reservation (not free release)", async () => {
    const { db, native } = await setup()
    const { state, fetcher } = mockFetcher(async () => jsonResponse(200, "NOT_JSON{{{"))
    const cfg = baseConfig(db, {
      monthlyBudgetSearch: DEEPSEEK_SEARCH_FETCH_UNIT_COST_CNY,
      fetcher,
    })
    await expect(runDeepSeekSearch(cfg, { query: "bad-json", purpose: "slice1_test", subject: "bad-json" }))
      .rejects
      .toSatisfy(isUnknownOutcome)
    const row = native.prepare("SELECT status, estimated_cost, error FROM paid_receipt WHERE subject = ?").get("bad-json") as {
      status: string
      estimated_cost: number
      error: string | null
    }
    expect(row.status).toBe("unknown")
    expect(row.estimated_cost).toBeCloseTo(DEEPSEEK_SEARCH_FETCH_UNIT_COST_CNY)
    expect(String(row.error ?? "")).not.toMatch(/NOT_JSON/)
    expect(state.hits).toBe(1)
    const { state: state2, fetcher: fetcher2 } = mockFetcher(async () => jsonResponse(200, searchHitBody))
    await expect(runDeepSeekSearch({ ...cfg, fetcher: fetcher2 }, { query: "after", purpose: "slice1_test", subject: "after" }))
      .rejects
      .toMatchObject({ code: "paid_budget_exhausted" })
    expect(state2.hits).toBe(0)
  })

  it("error bodies with fake Bearer/key never land in receipt or request columns", async () => {
    const { db, native } = await setup()
    const poison = "Authorization: Bearer sk-FAKESECRET999 body SECRET_UPSTREAM"
    const { fetcher } = mockFetcher(async () => jsonResponse(401, poison))
    await expect(runDeepSeekSearch(baseConfig(db, { fetcher }), {
      query: "leak-check",
      purpose: "slice1_test",
      subject: "leak",
    })).rejects.toBeTruthy()
    const row = native.prepare("SELECT response, request, error, status FROM paid_receipt WHERE subject = ?").get("leak") as {
      response: string | null
      request: string | null
      error: string | null
      status: string
    }
    expect(row.status).toBe("failed")
    const blob = `${row.response ?? ""}${row.request ?? ""}${row.error ?? ""}`
    expect(blob).not.toMatch(/Bearer |sk-FAKESECRET|SECRET_UPSTREAM/)
    expect(containsSecretLike(blob, PLACEHOLDER_KEY)).toBe(false)
    expect(String(row.error ?? "")).toBe("deepseek_tools_http_401")
  })

  it("receipt and requestSummary never carry body or key material", async () => {
    const { db, native } = await setup()
    const { fetcher } = mockFetcher(async () => jsonResponse(200, searchHitBody))
    await runDeepSeekSearch(baseConfig(db, { fetcher }), { query: "redact", purpose: "slice1_test", subject: "redact" })
    const row = native.prepare("SELECT response, request FROM paid_receipt WHERE subject = ?").get("redact") as {
      response: string
      request: string
    }
    expect(receiptPayloadHasBodyLeak(JSON.parse(row.response))).toBe(false)
    expect(row.response + (row.request ?? "")).not.toMatch(/SECRET_|Bearer |sk-/)
    expect(containsSecretLike(row.response + (row.request ?? ""), PLACEHOLDER_KEY)).toBe(false)
    expect(JSON.parse(row.request ?? "{}")).toMatchObject({
      policyVersion: DEEPSEEK_SEARCH_FETCH_POLICY_VERSION,
      query: "redact",
      need_content: false,
    })
  })

  it("search cache key uses normalized query + params + policy version (not result dedupeKey)", async () => {
    const { db } = await setup()
    const { state, fetcher } = mockFetcher(async () => jsonResponse(200, searchHitBody))
    const cfg = baseConfig(db, { fetcher })
    await runDeepSeekSearch(cfg, { query: "  same   query ", purpose: "slice1_test", subject: "n1" })
    const reuse = await runDeepSeekSearch(cfg, { query: "same query", purpose: "slice1_test", subject: "n2" })
    expect(reuse.reused).toBe(true)
    expect(state.hits).toBe(1)
    await runDeepSeekSearch(cfg, { query: "same query", count: 5, purpose: "slice1_test", subject: "n3" })
    expect(state.hits).toBe(2)
  })

  it("caller cancel after send keeps unknown and does not auto-retry", async () => {
    const { db, native } = await setup()
    const ac = new AbortController()
    const { state, fetcher } = mockFetcher(async (_url, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true })
    }))
    const pending = runDeepSeekSearch(baseConfig(db, {
      monthlyBudgetSearch: DEEPSEEK_SEARCH_FETCH_UNIT_COST_CNY,
      fetcher,
      timeoutMs: 5_000,
    }), { query: "cancel-q", purpose: "slice1_test", subject: "cancel", signal: ac.signal })
    for (let i = 0; i < 50; i++) {
      if (state.hits >= 1) break
      await new Promise(r => setTimeout(r, 10))
    }
    expect(state.hits).toBe(1)
    ac.abort()
    await expect(pending).rejects.toSatisfy(isUnknownOutcome)
    const row = native.prepare("SELECT status FROM paid_receipt WHERE subject = ?").get("cancel") as { status: string }
    expect(row.status).toBe("unknown")
  })

  it("default timeoutMs is finite when omitted", () => {
    expect(DEEPSEEK_SEARCH_FETCH_DEFAULT_TIMEOUT_MS).toBeGreaterThan(0)
    expect(DEEPSEEK_SEARCH_FETCH_DEFAULT_TIMEOUT_MS).toBeLessThanOrEqual(60_000)
  })
})

describe("runDeepSeekFetch (offline)", () => {
  const fetchBody = {
    title: "Notice Title",
    content: "# Markdown body that must never hit receipt\nSECRET_FETCH_BODY",
  }

  it("default-off and budget-zero never touch SecretStore or HTTP", async () => {
    const { db } = await setup()
    const gets: string[] = []
    const { state, fetcher } = mockFetcher(async () => jsonResponse(200, fetchBody))
    await expect(runDeepSeekFetch(baseConfig(db, {
      enabled: false,
      secretStore: secrets({}, { gets }),
      fetcher,
    }), { url: "https://example.com/x", purpose: "slice1_test", persistence: "full" }))
      .rejects
      .toBeInstanceOf(SearchFetchDisabledError)
    expect(gets).toEqual([])
    expect(state.hits).toBe(0)

    await expect(runDeepSeekFetch(baseConfig(db, {
      monthlyBudgetFetch: 0,
      secretStore: secrets({}, { gets }),
      fetcher,
    }), { url: "https://example.com/x", purpose: "slice1_test", persistence: "full" }))
      .rejects
      .toBeInstanceOf(PaidGateError)
    expect(gets).toEqual([])
    expect(state.hits).toBe(0)
  })

  it("persistence disallowed, blocked URL, and prior locally_rejected fail closed with zero HTTP", async () => {
    const { db } = await setup()
    const gets: string[] = []
    const { state, fetcher } = mockFetcher(async () => jsonResponse(200, fetchBody))
    const cfg = baseConfig(db, { secretStore: secrets({}, { gets }), fetcher })
    await expect(runDeepSeekFetch(cfg, {
      url: "https://example.com/x",
      purpose: "slice1_test",
      persistence: "disallowed",
    })).rejects.toMatchObject({ code: "persistence_disallowed" })
    await expect(runDeepSeekFetch(cfg, {
      url: "http://127.0.0.1/secret",
      purpose: "slice1_test",
      persistence: "full",
    })).rejects.toMatchObject({ code: "url_blocked" })
    await expect(runDeepSeekFetch(cfg, {
      url: "http://[::1]/",
      purpose: "slice1_test",
      persistence: "full",
    })).rejects.toMatchObject({ code: "url_blocked" })
    await expect(runDeepSeekFetch(cfg, {
      url: "https://user:pass@example.com/x",
      purpose: "slice1_test",
      persistence: "full",
    })).rejects.toMatchObject({ code: "invalid_url" })
    // Caller already marked rejected — persistence=full cannot bypass.
    await expect(runDeepSeekFetch(cfg, {
      url: "https://example.com/ok",
      purpose: "slice1_test",
      persistence: "full",
      targetReview: { status: "locally_rejected", code: "url_blocked", message: "prior reject" },
    })).rejects.toMatchObject({ code: "url_blocked" })
    expect(gets).toEqual([])
    expect(state.hits).toBe(0)
  })

  it("empty Fetch books zero; non-empty stores provenance meta only; reuse has no body", async () => {
    const { db, native } = await setup()
    const { state, fetcher } = mockFetcher(async (_url, init) => {
      const body = JSON.parse(init?.body ?? "{}") as { url?: string }
      if (body.url?.includes("empty")) return jsonResponse(200, { title: "", content: "" })
      return jsonResponse(200, fetchBody)
    })
    const cfg = baseConfig(db, { monthlyBudgetFetch: 1, fetcher })
    const empty = await runDeepSeekFetch(cfg, {
      url: "https://example.com/empty",
      purpose: "slice1_test",
      subject: "f-empty",
      persistence: "full",
    })
    expect(empty.billable).toBe(false)
    expect(empty.content).toBeUndefined()

    const fresh = await runDeepSeekFetch(cfg, {
      url: "https://example.com/full",
      purpose: "slice1_test",
      subject: "f-full",
      persistence: "excerpt_only",
    })
    expect(fresh.billable).toBe(true)
    expect(fresh.content).toContain("SECRET_FETCH_BODY")
    expect(fresh.meta.contentByteLength).toBeGreaterThan(0)
    expect(fresh.meta.provenance).toBe("third_party_markdown")
    expect(fresh.meta.originResponseHash).toBeNull()
    expect(fresh.meta.localFetchEvidence).toBe("none")
    expect(fresh.meta).not.toHaveProperty("content")
    expect(fresh.meta).not.toHaveProperty("contentHash")

    const reused = await runDeepSeekFetch(cfg, {
      url: "https://example.com/full",
      purpose: "slice1_test",
      subject: "f-full",
      persistence: "excerpt_only",
    })
    expect(reused.reused).toBe(true)
    expect(reused.content).toBeUndefined()
    expect(state.hits).toBe(2)

    const row = native.prepare("SELECT response FROM paid_receipt WHERE subject = ?").get("f-full") as { response: string }
    expect(receiptPayloadHasBodyLeak(JSON.parse(row.response))).toBe(false)
    expect(row.response).not.toMatch(/SECRET_FETCH_BODY|Markdown body/)
    expect(containsSecretLike(row.response, PLACEHOLDER_KEY)).toBe(false)
    const parsed = JSON.parse(row.response) as { meta: Record<string, unknown> }
    expect(parsed.meta.convertedContentHash).toMatch(/^[a-f0-9]{64}$/)
  })

  it("fetch last-unit concurrency: only one of two distinct fetches may spend the final unit", async () => {
    const { db } = await setup()
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    let entered = 0
    const { state, fetcher } = mockFetcher(async () => {
      entered++
      if (entered === 1) await gate
      return jsonResponse(200, fetchBody)
    })
    const cfg = baseConfig(db, {
      monthlyBudgetFetch: DEEPSEEK_SEARCH_FETCH_UNIT_COST_CNY,
      fetcher,
    })
    const a = runDeepSeekFetch(cfg, {
      url: "https://example.com/fa",
      purpose: "slice1_test",
      subject: "fa",
      persistence: "full",
    })
    for (let i = 0; i < 50; i++) {
      if (entered >= 1) break
      await new Promise(r => setTimeout(r, 10))
    }
    expect(entered).toBe(1)
    const b = runDeepSeekFetch(cfg, {
      url: "https://example.com/fb",
      purpose: "slice1_test",
      subject: "fb",
      persistence: "full",
    })
    await expect(b).rejects.toMatchObject({ code: "paid_budget_exhausted" })
    release()
    const won = await a
    expect(won.billable).toBe(true)
    expect(state.hits).toBe(1)
  })

  it("search and fetch budgets are separate (not one shared pool)", async () => {
    const { db } = await setup()
    const { state, fetcher } = mockFetcher(async (url) => {
      if (url.endsWith("/v1/tools/search")) return jsonResponse(200, searchHitBody)
      return jsonResponse(200, fetchBody)
    })
    const cfg = baseConfig(db, {
      monthlyBudgetSearch: DEEPSEEK_SEARCH_FETCH_UNIT_COST_CNY,
      monthlyBudgetFetch: DEEPSEEK_SEARCH_FETCH_UNIT_COST_CNY,
      fetcher,
    })
    await runDeepSeekSearch(cfg, { query: "sep-s", purpose: "slice1_test", subject: "sep-s" })
    await runDeepSeekFetch(cfg, {
      url: "https://example.com/sep-f",
      purpose: "slice1_test",
      subject: "sep-f",
      persistence: "full",
    })
    expect(state.hits).toBe(2)
    // Exhaust search — fetch still has its own unit already spent; another search blocked, another fetch blocked independently.
    await expect(runDeepSeekSearch(cfg, { query: "sep-s2", purpose: "slice1_test", subject: "sep-s2" }))
      .rejects
      .toMatchObject({ code: "paid_budget_exhausted" })
    await expect(runDeepSeekFetch(cfg, {
      url: "https://example.com/sep-f2",
      purpose: "slice1_test",
      subject: "sep-f2",
      persistence: "full",
    })).rejects.toMatchObject({ code: "paid_budget_exhausted" })
  })

  it("posts to DeepSeek Tools paths without localization; passes abort signal", async () => {
    const { db } = await setup()
    const { state, fetcher } = mockFetcher(async (url) => {
      if (url.endsWith("/v1/tools/search")) return jsonResponse(200, searchHitBody)
      if (url.endsWith("/v1/tools/fetch")) return jsonResponse(200, fetchBody)
      return jsonResponse(404, { error: "nope" })
    })
    const cfg = baseConfig(db, { fetcher })
    await runDeepSeekSearch(cfg, { query: "path-check", purpose: "slice1_test" })
    await runDeepSeekFetch(cfg, { url: "https://example.com/p", purpose: "slice1_test", persistence: "full" })
    expect(state.urls[0]).toBe(`${DEEPSEEK_TOOLS_BASE}/v1/tools/search`)
    expect(state.urls[1]).toBe(`${DEEPSEEK_TOOLS_BASE}/v1/tools/fetch`)
    for (const body of state.bodies) {
      expect(body).not.toMatch(/localization/)
    }
    expect(state.signals[0]).toBeInstanceOf(AbortSignal)
    expect(state.signals[1]).toBeInstanceOf(AbortSignal)
  })

  it("response oversize after send keeps unknown", async () => {
    const { db, native } = await setup()
    const big = { title: "t", content: "Y".repeat(600_000) }
    const { fetcher } = mockFetcher(async () => jsonResponse(200, big))
    await expect(runDeepSeekFetch(baseConfig(db, {
      monthlyBudgetFetch: DEEPSEEK_SEARCH_FETCH_UNIT_COST_CNY,
      fetcher,
    }), {
      url: "https://example.com/huge",
      purpose: "slice1_test",
      subject: "huge",
      persistence: "full",
    })).rejects.toSatisfy(isUnknownOutcome)
    const row = native.prepare("SELECT status FROM paid_receipt WHERE subject = ?").get("huge") as { status: string }
    expect(row.status).toBe("unknown")
  })
})

describe("contract gapfix2: exception codes / URL bind / cancel / stream cap", () => {
  it("transport errors with fake key text book unknown using fixed code only (receipt + attempt)", async () => {
    const { db, native } = await setup()
    const poison = `socket hang up url=https://evil.example/ Bearer ${PLACEHOLDER_KEY} sk-FAKE_TRANSPORT`
    const { state, fetcher } = mockFetcher(async () => {
      throw new Error(poison)
    })
    await expect(runDeepSeekSearch(baseConfig(db, {
      monthlyBudgetSearch: DEEPSEEK_SEARCH_FETCH_UNIT_COST_CNY,
      fetcher,
    }), { query: "transport-leak", purpose: "slice1_test", subject: "transport-leak" }))
      .rejects
      .toSatisfy(isUnknownOutcome)
    const row = native.prepare("SELECT id, status, error, request, response FROM paid_receipt WHERE subject = ?").get("transport-leak") as {
      id: string
      status: string
      error: string | null
      request: string | null
      response: string | null
    }
    expect(row.status).toBe("unknown")
    expect(row.error).toBe("request_failed")
    const attempt = native.prepare("SELECT status, error FROM paid_receipt_attempt WHERE receipt_id = ?").get(row.id) as {
      status: string
      error: string | null
    }
    expect(attempt.status).toBe("unknown")
    expect(attempt.error).toBe("request_failed")
    const blob = `${row.error}${row.request}${row.response}${attempt.error}`
    expect(blob).not.toMatch(/Bearer |sk-FAKE|evil\.example|PLACEHOLDER|test-placeholder/)
    expect(containsSecretLike(blob, PLACEHOLDER_KEY)).toBe(false)
    expect(state.hits).toBe(1)
  })

  it("rejects supplied targetReview that does not bind input.url (zero secret/receipt/HTTP)", async () => {
    const { db, native } = await setup()
    const gets: string[] = []
    const { state, fetcher } = mockFetcher(async () => jsonResponse(200, { title: "t", content: "c" }))
    const cfg = baseConfig(db, { secretStore: secrets({}, { gets }), fetcher })
    await expect(runDeepSeekFetch(cfg, {
      url: "https://example.com/real-target",
      purpose: "slice1_test",
      subject: "mismatch",
      persistence: "full",
      targetReview: { status: "syntactically_allowed", canonicalUrl: "https://example.com/other-target" },
    })).rejects.toMatchObject({ code: "target_review_mismatch" })
    // Forged approved private-network object still fails closed on input.url.
    await expect(runDeepSeekFetch(cfg, {
      url: "http://127.0.0.1/secret",
      purpose: "slice1_test",
      subject: "forged-private",
      persistence: "full",
      targetReview: { status: "syntactically_allowed", canonicalUrl: "http://127.0.0.1/secret" },
    })).rejects.toMatchObject({ code: "url_blocked" })
    await expect(runDeepSeekFetch(cfg, {
      url: "http://[::1]/",
      purpose: "slice1_test",
      persistence: "full",
      targetReview: { status: "syntactically_allowed", canonicalUrl: "https://example.com/public" },
    })).rejects.toMatchObject({ code: "url_blocked" })
    expect(gets).toEqual([])
    expect(state.hits).toBe(0)
    const count = native.prepare("SELECT COUNT(*) AS c FROM paid_receipt").get() as { c: number }
    expect(count.c).toBe(0)
  })

  it("matching licensed targetReview still binds to input.url and does not retarget", async () => {
    const { db } = await setup()
    const { state, fetcher } = mockFetcher(async (_url, init) => {
      const body = JSON.parse(init?.body ?? "{}") as { url?: string }
      expect(body.url).toBe("https://example.com/bound")
      return jsonResponse(200, { title: "ok", content: "body" })
    })
    const reviewed = reviewFetchTarget("https://example.com/bound")
    expect(reviewed.status).toBe("syntactically_allowed")
    await runDeepSeekFetch(baseConfig(db, { fetcher }), {
      url: "https://example.com/bound",
      purpose: "slice1_test",
      subject: "bound",
      persistence: "full",
      targetReview: reviewed,
    })
    expect(state.hits).toBe(1)
  })

  it("entry already-cancelled refuses without secret, receipt, or HTTP", async () => {
    const { db, native } = await setup()
    const gets: string[] = []
    const { state, fetcher } = mockFetcher(async () => jsonResponse(200, searchHitBody))
    const ac = new AbortController()
    ac.abort()
    await expect(runDeepSeekSearch(baseConfig(db, {
      secretStore: secrets({}, { gets }),
      fetcher,
    }), { query: "pre-cancel", purpose: "slice1_test", subject: "pre-cancel", signal: ac.signal }))
      .rejects
      .toBeInstanceOf(SearchFetchCancelledError)
    await expect(runDeepSeekFetch(baseConfig(db, {
      secretStore: secrets({}, { gets }),
      fetcher,
    }), {
      url: "https://example.com/pre",
      purpose: "slice1_test",
      persistence: "full",
      signal: ac.signal,
    })).rejects.toBeInstanceOf(SearchFetchCancelledError)
    expect(gets).toEqual([])
    expect(state.hits).toBe(0)
    const count = native.prepare("SELECT COUNT(*) AS c FROM paid_receipt").get() as { c: number }
    expect(count.c).toBe(0)
  })

  it("cancel while awaiting secret stays non-billing (no receipt / no HTTP)", async () => {
    const { db, native } = await setup()
    const ac = new AbortController()
    let getStarted = false
    const hangStore = {
      get: async () => {
        getStarted = true
        await new Promise<never>(() => {
          /* hang until abort races */
        })
        return PLACEHOLDER_KEY
      },
      set: async () => undefined,
      delete: async () => undefined,
      has: async () => true,
      source: async () => "file" as const,
    }
    const { state, fetcher } = mockFetcher(async () => jsonResponse(200, searchHitBody))
    const pending = runDeepSeekSearch(baseConfig(db, {
      secretStore: hangStore as never,
      fetcher,
      timeoutMs: 5_000,
    }), { query: "secret-cancel", purpose: "slice1_test", subject: "secret-cancel", signal: ac.signal })
    for (let i = 0; i < 50; i++) {
      if (getStarted) break
      await new Promise(r => setTimeout(r, 10))
    }
    expect(getStarted).toBe(true)
    ac.abort()
    await expect(pending).rejects.toBeInstanceOf(SearchFetchCancelledError)
    expect(state.hits).toBe(0)
    const count = native.prepare("SELECT COUNT(*) AS c FROM paid_receipt").get() as { c: number }
    expect(count.c).toBe(0)
  })

  it("cancel after HTTP dispatch keeps unknown (existing post-send path)", async () => {
    const { db, native } = await setup()
    const ac = new AbortController()
    const { state, fetcher } = mockFetcher(async (_url, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new Error("aborted-after-send")), { once: true })
    }))
    const pending = runDeepSeekSearch(baseConfig(db, {
      monthlyBudgetSearch: DEEPSEEK_SEARCH_FETCH_UNIT_COST_CNY,
      fetcher,
      timeoutMs: 5_000,
    }), { query: "post-cancel", purpose: "slice1_test", subject: "post-cancel", signal: ac.signal })
    for (let i = 0; i < 50; i++) {
      if (state.hits >= 1) break
      await new Promise(r => setTimeout(r, 10))
    }
    expect(state.hits).toBe(1)
    ac.abort()
    await expect(pending).rejects.toSatisfy(isUnknownOutcome)
    const row = native.prepare("SELECT status, error FROM paid_receipt WHERE subject = ?").get("post-cancel") as {
      status: string
      error: string | null
    }
    expect(row.status).toBe("unknown")
    expect(String(row.error ?? "")).not.toMatch(/aborted-after-send|Bearer/)
  })

  it("readResponseBodyLimited enforces byte cap on synthetic ReadableStream Response", async () => {
    const maxBytes = 64
    const chunk = new TextEncoder().encode("Z".repeat(40))
    let pulls = 0
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls++
        if (pulls <= 3) controller.enqueue(chunk)
        else controller.close()
      },
    })
    const response = new Response(stream, { status: 200 })
    await expect(readResponseBodyLimited(response, maxBytes))
      .rejects
      .toMatchObject({ code: "response_too_large" })
    expect(pulls).toBeLessThanOrEqual(3)

    const small = new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("ok-body"))
        controller.close()
      },
    }), { status: 200 })
    await expect(readResponseBodyLimited(small, maxBytes)).resolves.toBe("ok-body")
  })
})

describe("contract gapfix3: typed-error sanitization dual-table", () => {
  it("transport typed OutcomeUnknown with poison message books fixed code only (receipt + attempt)", async () => {
    const { db, native } = await setup()
    const poison = `Bearer ${PLACEHOLDER_KEY} https://evil.example/leak body=SECRET_DOC`
    const { state, fetcher } = mockFetcher(async () => {
      const err = new DeepSeekToolsOutcomeUnknownError("request_failed")
      Object.defineProperty(err, "message", { value: poison, configurable: true })
      throw err
    })
    await expect(runDeepSeekSearch(baseConfig(db, {
      monthlyBudgetSearch: DEEPSEEK_SEARCH_FETCH_UNIT_COST_CNY,
      fetcher,
    }), { query: "typed-transport", purpose: "slice1_test", subject: "typed-transport" }))
      .rejects
      .toSatisfy(isUnknownOutcome)
    const row = native.prepare("SELECT id, status, error, request, response FROM paid_receipt WHERE subject = ?").get("typed-transport") as {
      id: string
      status: string
      error: string | null
      request: string | null
      response: string | null
    }
    expect(row.status).toBe("unknown")
    expect(row.error).toBe("request_failed")
    const attempt = native.prepare("SELECT status, error FROM paid_receipt_attempt WHERE receipt_id = ?").get(row.id) as {
      status: string
      error: string | null
    }
    expect(attempt.status).toBe("unknown")
    expect(attempt.error).toBe("request_failed")
    const blob = `${row.error}${row.request}${row.response}${attempt.error}`
    expect(blob).not.toMatch(/Bearer |evil\.example|SECRET_DOC|PLACEHOLDER|test-placeholder/)
    expect(containsSecretLike(blob, PLACEHOLDER_KEY)).toBe(false)
    expect(state.hits).toBe(1)
  })

  it("readText typed ClientError with poison message books response_read_failed only (receipt + attempt)", async () => {
    const { db, native } = await setup()
    const poison = `Bearer ${PLACEHOLDER_KEY} https://evil.example/read body=SECRET_READ`
    const { state, fetcher } = mockFetcher(async () => ({
      status: 200,
      ok: true,
      headers: { get: () => null },
      readText: async () => {
        throw new DeepSeekToolsClientError("invalid_schema", poison)
      },
    }))
    await expect(runDeepSeekSearch(baseConfig(db, {
      monthlyBudgetSearch: DEEPSEEK_SEARCH_FETCH_UNIT_COST_CNY,
      fetcher,
    }), { query: "typed-read", purpose: "slice1_test", subject: "typed-read" }))
      .rejects
      .toSatisfy(isUnknownOutcome)
    const row = native.prepare("SELECT id, status, error, request, response FROM paid_receipt WHERE subject = ?").get("typed-read") as {
      id: string
      status: string
      error: string | null
      request: string | null
      response: string | null
    }
    expect(row.status).toBe("unknown")
    expect(row.error).toBe("response_read_failed")
    const attempt = native.prepare("SELECT status, error FROM paid_receipt_attempt WHERE receipt_id = ?").get(row.id) as {
      status: string
      error: string | null
    }
    expect(attempt.status).toBe("unknown")
    expect(attempt.error).toBe("response_read_failed")
    const blob = `${row.error}${row.request}${row.response}${attempt.error}`
    expect(blob).not.toMatch(/Bearer |evil\.example|SECRET_READ|PLACEHOLDER|test-placeholder/)
    expect(containsSecretLike(blob, PLACEHOLDER_KEY)).toBe(false)
    expect(state.hits).toBe(1)
  })
})

describe("policy constants", () => {
  it("keeps CNY unit cost and capability ids stable for slice-1", () => {
    expect(DEEPSEEK_SEARCH_FETCH_UNIT_COST_CNY).toBe(0.005)
    expect(DEEPSEEK_SEARCH_CAPABILITY).toBe("deepseek_search")
    expect(DEEPSEEK_FETCH_CAPABILITY).toBe("deepseek_fetch")
    expect(DEEPSEEK_SEARCH_FETCH_PROVIDER_ID).toBe("deepseek")
    expect(DEEPSEEK_SEARCH_FETCH_POLICY_VERSION).toBe("ds-sf-v1.2-2026-10-23")
  })
})
