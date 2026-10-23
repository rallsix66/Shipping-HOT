/**
 * Offline DeepSeek Search/Fetch slice-1 tests.
 * Synthetic HTTP only; never reads real SecretStore credentials or calls the network.
 */
import { afterEach, describe, expect, it } from "vitest"
import NativeDatabase from "better-sqlite3"
import { createDatabase } from "db0"
import { containsSecretLike, receiptPayloadHasBodyLeak, trimSearchCandidates } from "./candidate-trim"
import {
  DEEPSEEK_FETCH_CAPABILITY,
  DEEPSEEK_SEARCH_CAPABILITY,
  DEEPSEEK_SEARCH_FETCH_POLICY_VERSION,
  DEEPSEEK_SEARCH_FETCH_PROVIDER_ID,
  DEEPSEEK_SEARCH_FETCH_UNIT_COST_CNY,
} from "./deepseek-search-fetch-policy"
import {
  SearchFetchDisabledError,
  type SearchFetchServiceConfig,
  runDeepSeekFetch,
  runDeepSeekSearch,
} from "./search-fetch-service"
import { initShippingTables } from "#/database/shipping"
import type { SecretStore } from "#/providers/contracts"
import { PaidGateError, ReceiptUnknownError } from "#/intel/llm/receipts"
import { DEEPSEEK_TOOLS_BASE, type InjectedFetcher } from "#/providers/deepseek/search-fetch-client"

const T0 = new Date("2026-10-23T03:00:00.000Z")
const PLACEHOLDER_KEY = "test-placeholder-not-a-real-key"
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

async function setup() {
  const native = new NativeDatabase(":memory:")
  cleanups.push(() => native.close())
  const db = wrap(native)
  await initShippingTables(db, "mock")
  return { db, native }
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
    text: async () => text,
    headers: { get: () => null },
  }
}

function mockFetcher(handler: (url: string, init?: Parameters<InjectedFetcher>[1]) => ReturnType<InjectedFetcher> | Promise<ReturnType<InjectedFetcher>>) {
  const state = { hits: 0, urls: [] as string[], bodies: [] as string[] }
  const fetcher: InjectedFetcher = async (url, init) => {
    state.hits++
    state.urls.push(url)
    state.bodies.push(init?.body ?? "")
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

  it("empty results book zero cost and leave budget for the next call", async () => {
    const { db, native } = await setup()
    const { state, fetcher } = mockFetcher(async () => jsonResponse(200, { results: [] }))
    const cfg = baseConfig(db, { monthlyBudgetSearch: DEEPSEEK_SEARCH_FETCH_UNIT_COST_CNY, fetcher })
    const first = await runDeepSeekSearch(cfg, { query: "empty-q", purpose: "slice1_test", subject: "empty" })
    expect(first.billable).toBe(false)
    expect(first.candidates).toEqual([])
    expect(state.hits).toBe(1)
    const usage = native.prepare(
      "SELECT COALESCE(SUM(estimated_cost),0) AS cost, COALESCE(SUM(success_count),0) AS ok FROM provider_usage WHERE capability = ?",
    ).get(DEEPSEEK_SEARCH_CAPABILITY) as { cost: number, ok: number }
    expect(usage.cost).toBe(0)
    // Second distinct query still allowed under the same 1-unit budget.
    const { state: state2, fetcher: fetcher2 } = mockFetcher(async () => jsonResponse(200, searchHitBody))
    const second = await runDeepSeekSearch({ ...cfg, fetcher: fetcher2 }, { query: "filled-q", purpose: "slice1_test", subject: "filled" })
    expect(second.billable).toBe(true)
    expect(state2.hits).toBe(1)
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
    // Wait until first has claimed pending inside paidRequest (HTTP started).
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

  it("post-send unknown keeps reservation; restart does not rebuy or free the unit", async () => {
    const { db, native } = await setup()
    const hang: InjectedFetcher = async () => new Promise(() => { /* never resolves */ })
    const cfg = baseConfig(db, {
      monthlyBudgetSearch: DEEPSEEK_SEARCH_FETCH_UNIT_COST_CNY,
      fetcher: hang,
      timeoutMs: 30,
    })
    await expect(runDeepSeekSearch(cfg, { query: "hang-q", purpose: "slice1_test", subject: "hang" }))
      .rejects
      .toBeInstanceOf(ReceiptUnknownError)
    const row = native.prepare("SELECT status, estimated_cost FROM paid_receipt WHERE subject = ?").get("hang") as {
      status: string
      estimated_cost: number
    }
    expect(row.status).toBe("unknown")
    expect(row.estimated_cost).toBeCloseTo(DEEPSEEK_SEARCH_FETCH_UNIT_COST_CNY)
    // Same identity after "restart" must not rebuy.
    const { state, fetcher } = mockFetcher(async () => jsonResponse(200, searchHitBody))
    await expect(runDeepSeekSearch({ ...cfg, fetcher, timeoutMs: undefined }, { query: "hang-q", purpose: "slice1_test", subject: "hang" }))
      .rejects
      .toBeInstanceOf(ReceiptUnknownError)
    expect(state.hits).toBe(0)
    // Distinct query also blocked — unknown still occupies the sole budget unit.
    await expect(runDeepSeekSearch({ ...cfg, fetcher }, { query: "other-q", purpose: "slice1_test", subject: "other" }))
      .rejects
      .toMatchObject({ code: "paid_budget_exhausted" })
    expect(state.hits).toBe(0)
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
    // Different count → different identity → new call.
    await runDeepSeekSearch(cfg, { query: "same query", count: 5, purpose: "slice1_test", subject: "n3" })
    expect(state.hits).toBe(2)
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

  it("persistence disallowed and blocked URL fail closed with zero HTTP / zero SecretStore", async () => {
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
      url: "https://user:pass@example.com/x",
      purpose: "slice1_test",
      persistence: "full",
    })).rejects.toMatchObject({ code: "invalid_url" })
    expect(gets).toEqual([])
    expect(state.hits).toBe(0)
  })

  it("empty Fetch books zero; non-empty stores meta only; reuse has no body and zero HTTP", async () => {
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
    expect(fresh.meta).not.toHaveProperty("content")

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
  })

  it("posts to DeepSeek Tools paths without localization", async () => {
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
  })
})

describe("policy constants", () => {
  it("keeps CNY unit cost and capability ids stable for slice-1", () => {
    expect(DEEPSEEK_SEARCH_FETCH_UNIT_COST_CNY).toBe(0.005)
    expect(DEEPSEEK_SEARCH_CAPABILITY).toBe("deepseek_search")
    expect(DEEPSEEK_FETCH_CAPABILITY).toBe("deepseek_fetch")
    expect(DEEPSEEK_SEARCH_FETCH_PROVIDER_ID).toBe("deepseek")
  })
})
