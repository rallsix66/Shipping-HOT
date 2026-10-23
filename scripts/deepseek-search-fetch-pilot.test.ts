/**
 * Offline mock + synthetic-HTTP tests for DeepSeek Search/Fetch pilot hard-gate.
 * Temp ledgers under project `.tmp`; never reads real secrets or live network.
 */
import { randomBytes } from "node:crypto"
import { type Stats, existsSync, lstatSync, mkdirSync, rmSync, statSync, symlinkSync } from "node:fs"
import { join } from "node:path"
import process from "node:process"
import { type TestContext, afterEach, describe, expect, it } from "vitest"
import NativeDatabase from "better-sqlite3"
import {
  BUDGET_MILLI_CNY,
  FIRST_ROUND_FETCH_TARGETS,
  FIRST_ROUND_SEARCH_QUERIES,
  MAX_ATTEMPTS_PER_CAPABILITY,
  PILOT_ID,
  PILOT_LEDGER_FILENAME,
  type PilotFetchTarget,
  type PilotLstat,
  type PilotOutbound,
  UNIT_COST_MILLI_CNY,
  assertTestIsolationAllowed,
  countAttempts,
  createLiveOutbound,
  createMemorySecretStore,
  finalizeAttempt,
  lstatExistingEntry,
  openPilotLedger,
  parsePilotArgs,
  readPilotLedgerSnapshot,
  reserveAttempt,
  resolveFixedPilotPaths,
  runPilot,
  sanitizePilotText,
  searchOperationKey,
  spawnReserveOnce,
  sumReservedMilli,
} from "./deepseek-search-fetch-pilot-lib"
import { DEEPSEEK_SEARCH_CAPABILITY } from "#/intel/discovery/deepseek-search-fetch-policy"
import type { InjectedFetcher } from "#/providers/deepseek/search-fetch-client"
import {
  DEEPSEEK_SEARCH_PATH,
  DEEPSEEK_TOOLS_BASE,
  staticReadText,
} from "#/providers/deepseek/search-fetch-client"

const REPO_ROOT = process.cwd()
mkdirSync(join(REPO_ROOT, ".tmp"), { recursive: true })

const cleanups: Array<() => void> = []
afterEach(() => {
  while (cleanups.length) cleanups.pop()!()
})

/** Flat single-segment name under projectRoot/.tmp/ (no path separators). */
function isolationName(label: string): string {
  const name = `dspilot-${label}-${randomBytes(4).toString("hex")}`
  const dir = join(REPO_ROOT, ".tmp", name)
  cleanups.push(() => {
    try {
      rmSync(dir, { recursive: true, force: true })
    } catch {
      /* ignore */
    }
  })
  return name
}

function mockOutbound(handler?: {
  search?: (query: string) => Promise<{
    ok: boolean
    unknown?: boolean
    errorCode?: string
    receiptId?: string
    reused?: boolean
    billable?: boolean
    upstreamResultCount?: number
    candidates?: Array<{ url: string, title: string, providerDate: string | null, titleUrlHash: string }>
  }>
  fetch?: (url: string) => Promise<{ ok: boolean, unknown?: boolean, errorCode?: string }>
  tracker?: { search: string[], fetch: string[] }
}): PilotOutbound {
  const tracker = handler?.tracker ?? { search: [], fetch: [] }
  return {
    search: async (query) => {
      tracker.search.push(query)
      if (handler?.search) return handler.search(query)
      return {
        ok: true,
        receiptId: "rcpt-mock",
        reused: false,
        billable: true,
        upstreamResultCount: 1,
        candidates: [{
          url: "https://example.com/a",
          title: "Mock Title",
          providerDate: "2026-10-01",
          titleUrlHash: "a".repeat(64),
        }],
      }
    },
    fetch: async (target) => {
      tracker.fetch.push(target.url)
      if (handler?.fetch) return handler.fetch(target.url)
      return { ok: true, receiptId: "rcpt-fetch", reused: false, billable: true }
    },
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

function mockFetcher(handler: (url: string) => ReturnType<InjectedFetcher> | Promise<ReturnType<InjectedFetcher>>) {
  const state = { hits: 0, bodies: [] as string[] }
  const fetcher: InjectedFetcher = async (url, init) => {
    state.hits += 1
    state.bodies.push(init?.body ?? "")
    return handler(url)
  }
  return { state, fetcher }
}

function symlinkStats(): Stats {
  return {
    isSymbolicLink: () => true,
    isDirectory: () => false,
    isFile: () => false,
  } as Stats
}

/** Injected lstat that reports DB path(s) as symlinks (dangling: lstat ok, existsSync would be false). */
function danglingDbLstat(
  paths: { ledgerPath: string, paidDbPath: string },
  which: "ledger" | "paid" | "both" = "both",
): PilotLstat {
  return (p: string) => {
    const s = String(p)
    const hitLedger = which !== "paid" && s === paths.ledgerPath
    const hitPaid = which !== "ledger" && s === paths.paidDbPath
    if (hitLedger || hitPaid) return symlinkStats()
    return lstatSync(p)
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

describe("deepseek-search-fetch-pilot attempt hard gate", () => {
  it("aligns integer milli unit with policy 0.005 CNY and fixed caps", () => {
    expect(UNIT_COST_MILLI_CNY).toBe(5)
    expect(BUDGET_MILLI_CNY).toBe(50)
    expect(MAX_ATTEMPTS_PER_CAPABILITY).toBe(10)
    expect(BUDGET_MILLI_CNY / UNIT_COST_MILLI_CNY).toBe(10)
    expect(PILOT_ID).toBe("ds-pilot-2026-10-23-r1")
  })

  it("lists first-round Search queries and empty Fetch", () => {
    expect(FIRST_ROUND_SEARCH_QUERIES).toHaveLength(8)
    expect(FIRST_ROUND_FETCH_TARGETS).toEqual([])
  })

  it("forbids CLI path/pilot overrides", () => {
    expect(() => parsePilotArgs(["--ledger", "x"])).toThrow(/arg_forbidden/)
    expect(() => parsePilotArgs(["--paid-db", "x"])).toThrow(/arg_forbidden/)
    expect(() => parsePilotArgs(["--pilot-id", "x"])).toThrow(/arg_forbidden/)
    expect(() => parsePilotArgs(["--cwd", "x"])).toThrow(/arg_forbidden/)
  })

  it("refuses path escape and test isolation without mock", () => {
    expect(() => resolveFixedPilotPaths(REPO_ROOT, "../escape")).toThrow()
    expect(() => resolveFixedPilotPaths(REPO_ROOT, "a/b")).toThrow()
    expect(() => assertTestIsolationAllowed({
      mode: "plan",
      projectRoot: REPO_ROOT,
      testIsolationName: "no-mock",
    })).toThrow(/test_isolation_requires_mock/)
  })

  it("plan-only never outbound and never creates ledger file", async () => {
    const name = isolationName("plan")
    const paths = resolveFixedPilotPaths(REPO_ROOT, name)
    expect(existsSync(paths.ledgerPath)).toBe(false)
    const tracker = { search: [] as string[], fetch: [] as string[] }
    const summary = await runPilot({
      mode: "plan",
      projectRoot: REPO_ROOT,
      testIsolationName: name,
      outbound: mockOutbound({ tracker }),
      readKey: async () => "sk-should-not-be-used-plan",
    })
    expect(summary.outboundCalls).toBe(0)
    expect(tracker.search).toEqual([])
    expect(existsSync(paths.ledgerPath)).toBe(false)
    expect(summary.notes.some(n => n.includes("ledger_absent") || n.includes("plan_only"))).toBe(true)
    expect(summary.exitCode).toBe(0)
  })

  it("plan read-only does not mutate an existing ledger", async () => {
    const name = isolationName("plan-ro")
    const paths = resolveFixedPilotPaths(REPO_ROOT, name)
    const ledger = openPilotLedger(paths.ledgerPath, PILOT_ID)
    try {
      const r = reserveAttempt(ledger.native, {
        pilotId: PILOT_ID,
        capability: DEEPSEEK_SEARCH_CAPABILITY,
        operationKey: searchOperationKey("seed"),
      })
      expect(r.ok && r.fresh).toBe(true)
      if (r.ok) finalizeAttempt(ledger.native, { attemptId: r.attemptId, status: "succeeded" })
    } finally {
      ledger.close()
    }
    const before = statSync(paths.ledgerPath)
    const snapBefore = readPilotLedgerSnapshot(paths.ledgerPath, PILOT_ID)
    await runPilot({
      mode: "plan",
      projectRoot: REPO_ROOT,
      testIsolationName: name,
      outbound: mockOutbound(),
    })
    const after = statSync(paths.ledgerPath)
    const snapAfter = readPilotLedgerSnapshot(paths.ledgerPath, PILOT_ID)
    expect(snapAfter.searchAttempts).toBe(snapBefore.searchAttempts)
    expect(after.size).toBe(before.size)
  })

  it("missing key: zero outbound and zero new reservations", async () => {
    const name = isolationName("nokey")
    const tracker = { search: [] as string[], fetch: [] as string[] }
    const summary = await runPilot({
      mode: "execute",
      projectRoot: REPO_ROOT,
      testIsolationName: name,
      searchQueries: FIRST_ROUND_SEARCH_QUERIES.slice(0, 2),
      outbound: mockOutbound({ tracker }),
      readKey: async () => undefined,
    })
    expect(summary.failureCode).toBe("missing_api_key")
    expect(summary.outboundCalls).toBe(0)
    expect(tracker.search).toEqual([])
  })

  it("failed outbound still counts as an attempt", async () => {
    const name = isolationName("fail")
    const paths = resolveFixedPilotPaths(REPO_ROOT, name)
    const summary = await runPilot({
      mode: "execute",
      projectRoot: REPO_ROOT,
      testIsolationName: name,
      searchQueries: ["q-fail-1"],
      readKey: async () => "sk-test-placeholder",
      outbound: mockOutbound({
        search: async () => ({ ok: false, errorCode: "provider_unavailable" }),
      }),
    })
    expect(summary.searchAttempts).toBe(1)
    expect(summary.ops[0]?.outcome).toBe("failed")
    const ledger = openPilotLedger(paths.ledgerPath, PILOT_ID)
    try {
      expect(countAttempts(ledger.native, PILOT_ID, DEEPSEEK_SEARCH_CAPABILITY)).toBe(1)
    } finally {
      ledger.close()
    }
  })

  it("unknown outbound still counts as an attempt", async () => {
    const name = isolationName("unknown")
    const summary = await runPilot({
      mode: "execute",
      projectRoot: REPO_ROOT,
      testIsolationName: name,
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
    const name = isolationName("reopen")
    const paths = resolveFixedPilotPaths(REPO_ROOT, name)
    await runPilot({
      mode: "execute",
      projectRoot: REPO_ROOT,
      testIsolationName: name,
      searchQueries: ["q-a", "q-b"],
      readKey: async () => "sk-test-placeholder",
      outbound: mockOutbound(),
    })
    const again = openPilotLedger(paths.ledgerPath, PILOT_ID)
    try {
      expect(countAttempts(again.native, PILOT_ID, DEEPSEEK_SEARCH_CAPABILITY)).toBe(2)
      expect(sumReservedMilli(again.native, PILOT_ID, DEEPSEEK_SEARCH_CAPABILITY)).toBe(10)
    } finally {
      again.close()
    }
    const third = await runPilot({
      mode: "execute",
      projectRoot: REPO_ROOT,
      testIsolationName: name,
      searchQueries: ["q-c"],
      readKey: async () => "sk-test-placeholder",
      outbound: mockOutbound(),
    })
    expect(third.searchAttempts).toBe(3)
  })

  it("duplicate operation restores trimmed candidates without re-buy", async () => {
    const name = isolationName("dup")
    const tracker = { search: [] as string[], fetch: [] as string[] }
    const queries = ["same-query-twice"]
    const first = await runPilot({
      mode: "execute",
      projectRoot: REPO_ROOT,
      testIsolationName: name,
      searchQueries: queries,
      readKey: async () => "sk-test-placeholder",
      outbound: mockOutbound({ tracker }),
    })
    expect(first.ops[0]?.candidates?.[0]?.title).toBe("Mock Title")
    expect(first.ops[0]?.receiptId).toBe("rcpt-mock")
    const second = await runPilot({
      mode: "execute",
      projectRoot: REPO_ROOT,
      testIsolationName: name,
      searchQueries: queries,
      readKey: async () => "sk-test-placeholder",
      outbound: mockOutbound({ tracker }),
    })
    expect(second.searchAttempts).toBe(1)
    expect(second.ops[0]?.outcome).toBe("duplicate_restored")
    expect(second.ops[0]?.candidates?.[0]?.url).toBe("https://example.com/a")
    expect(second.ops[0]?.receiptId).toBe("rcpt-mock")
    expect(tracker.search).toEqual(["same-query-twice"])
  })

  it("hard-stops at attempt 10 via runPilot fixed caps", async () => {
    const name = isolationName("cap10")
    const queries = Array.from({ length: 12 }, (_, i) => `q-${i}`)
    const summary = await runPilot({
      mode: "execute",
      projectRoot: REPO_ROOT,
      testIsolationName: name,
      searchQueries: queries,
      readKey: async () => "sk-test-placeholder",
      outbound: mockOutbound(),
    })
    expect(summary.searchAttempts).toBe(10)
    expect(summary.ops.filter(op => op.outcome === "succeeded")).toHaveLength(10)
    expect(summary.ops.some(op => op.errorCode === "attempt_limit_reached")).toBe(true)
  })

  it("budget milli integer gate via reserveAttempt overrides (unit tests only)", async () => {
    const name = isolationName("budget")
    const paths = resolveFixedPilotPaths(REPO_ROOT, name)
    const ledger = openPilotLedger(paths.ledgerPath, PILOT_ID)
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

  it("concurrent last-slot reserves call real reserveAttempt (child processes)", async () => {
    const name = isolationName("concurrent")
    const paths = resolveFixedPilotPaths(REPO_ROOT, name)
    const ledger = openPilotLedger(paths.ledgerPath, PILOT_ID)
    try {
      for (let i = 0; i < 9; i += 1) {
        const r = reserveAttempt(ledger.native, {
          pilotId: PILOT_ID,
          capability: DEEPSEEK_SEARCH_CAPABILITY,
          operationKey: `seed:${i}`,
        })
        expect(r.ok && r.fresh).toBe(true)
        if (r.ok) finalizeAttempt(ledger.native, { attemptId: r.attemptId, status: "succeeded" })
      }
    } finally {
      ledger.close()
    }

    const scriptPath = join(REPO_ROOT, "scripts", "deepseek-search-fetch-pilot-reserve-once.ts")
    const nodeArgs = [
      "--import",
      "tsx/esm",
      "--experimental-loader",
      "./scripts/tsx-alias-loader.mjs",
    ]

    const runOne = (operationKey: string) => spawnReserveOnce({
      projectRoot: REPO_ROOT,
      testIsolationName: name,
      capability: DEEPSEEK_SEARCH_CAPABILITY,
      operationKey,
      nodeArgs,
      scriptPath,
    })

    const [a, b] = await Promise.all([
      runOne("concurrent:a"),
      runOne("concurrent:b"),
    ])
    expect(a.stdout.trim().length + b.stdout.trim().length, `spawn empty stdout a=${a.status} b=${b.status} stderrA=${a.stderr.slice(0, 200)} stderrB=${b.stderr.slice(0, 200)}`).toBeGreaterThan(0)
    const parsed = [a, b].map((r) => {
      try {
        return JSON.parse(r.stdout.trim().split("\n").pop()!) as { ok: boolean, fresh?: boolean }
      } catch {
        return { ok: false as const }
      }
    })
    const freshWins = parsed.filter(r => r.ok && r.fresh).length
    const losses = parsed.filter(r => !r.ok || r.fresh === false).length
    expect(freshWins, JSON.stringify(parsed)).toBe(1)
    expect(losses).toBe(1)
    const check = openPilotLedger(paths.ledgerPath, PILOT_ID)
    try {
      expect(countAttempts(check.native, PILOT_ID, DEEPSEEK_SEARCH_CAPABILITY)).toBe(10)
    } finally {
      check.close()
    }
  })

  it("createLiveOutbound synthetic HTTP exposes trimmed candidates + receipt; duplicate restores", async () => {
    const name = isolationName("live-chain")
    const { state, fetcher } = mockFetcher(async () => jsonResponse(200, searchHitBody))
    const first = await runPilot({
      mode: "execute",
      projectRoot: REPO_ROOT,
      testIsolationName: name,
      searchQueries: ["live-chain-q"],
      readKey: async () => "sk-test-placeholder-not-real",
      injectedFetcher: fetcher,
    })
    expect(state.hits).toBe(1)
    expect(first.ops[0]?.outcome).toBe("succeeded")
    expect(first.ops[0]?.receiptId).toBeTruthy()
    expect(first.ops[0]?.billable).toBe(true)
    expect(first.ops[0]?.upstreamResultCount).toBe(2)
    expect(first.ops[0]?.candidates).toHaveLength(2)
    expect(first.ops[0]?.candidates?.[0]).toMatchObject({
      url: "https://example.com/a",
      title: "Alpha Port Notice",
      providerDate: "2026-10-01",
    })
    const dumped = JSON.stringify(first)
    expect(dumped).not.toMatch(/SECRET_SNIPPET|SECRET_SUMMARY|SECRET_CONTENT|SECRETVALUE/)
    expect(dumped).not.toContain("\"snippet\"")
    expect(first.searchReservedMilli).toBe(UNIT_COST_MILLI_CNY)

    const second = await runPilot({
      mode: "execute",
      projectRoot: REPO_ROOT,
      testIsolationName: name,
      searchQueries: ["live-chain-q"],
      readKey: async () => "sk-test-placeholder-not-real",
      injectedFetcher: fetcher,
    })
    expect(state.hits).toBe(1)
    expect(second.outboundCalls).toBe(0)
    expect(second.ops[0]?.outcome).toBe("duplicate_restored")
    expect(second.ops[0]?.candidates?.[0]?.title).toBe("Alpha Port Notice")
    expect(second.ops[0]?.receiptId).toBe(first.ops[0]?.receiptId)
  })

  it("sanitizes secret-like text; store clear drops configured flag", async () => {
    const name = isolationName("sanitize")
    const apiKey = "sk-live-SECRETVALUE999"
    expect(sanitizePilotText(`Bearer ${apiKey} boom`, apiKey)).not.toContain("SECRETVALUE")
    const store = createMemorySecretStore(apiKey)
    expect(store.peekConfigured()).toBe(true)
    const summary = await runPilot({
      mode: "execute",
      projectRoot: REPO_ROOT,
      testIsolationName: name,
      searchQueries: ["q-sanitize"],
      readKey: async () => apiKey,
      outbound: mockOutbound({
        search: async () => ({ ok: false, errorCode: `auth ${apiKey} failed` }),
      }),
    })
    expect(JSON.stringify(summary)).not.toContain("SECRETVALUE")
    store.clear()
    expect(store.peekConfigured()).toBe(false)
  })

  it("empty Fetch list yields zero fetch attempts; disallowed fetch refuses with non-zero exit", async () => {
    const name = isolationName("nofetch")
    const tracker = { search: [] as string[], fetch: [] as string[] }
    const empty = await runPilot({
      mode: "execute",
      projectRoot: REPO_ROOT,
      testIsolationName: name,
      searchQueries: ["only-search"],
      fetchTargets: [],
      readKey: async () => "sk-test-placeholder",
      outbound: mockOutbound({ tracker }),
    })
    expect(tracker.fetch).toEqual([])
    expect(empty.fetchAttempts).toBe(0)

    const refusedName = isolationName("fetch-refuse")
    const bad: PilotFetchTarget = {
      url: "https://example.com/x",
      persistence: "disallowed",
      targetReview: { status: "syntactically_allowed", canonicalUrl: "https://example.com/x" },
    }
    const refused = await runPilot({
      mode: "execute",
      projectRoot: REPO_ROOT,
      testIsolationName: refusedName,
      searchQueries: [],
      fetchTargets: [bad],
      readKey: async () => "sk-test-placeholder",
      outbound: mockOutbound({ tracker }),
    })
    expect(refused.ops[0]?.outcome).toBe("fetch_refused")
    expect(refused.exitCode).toBe(5)
    expect(tracker.fetch).toEqual([])
  })

  it("fetch failure sets non-zero exit like search", async () => {
    const name = isolationName("fetch-fail")
    const target: PilotFetchTarget = {
      url: "https://example.com/fail",
      persistence: "excerpt_only",
      targetReview: { status: "syntactically_allowed", canonicalUrl: "https://example.com/fail" },
    }
    const summary = await runPilot({
      mode: "execute",
      projectRoot: REPO_ROOT,
      testIsolationName: name,
      searchQueries: [],
      fetchTargets: [target],
      readKey: async () => "sk-test-placeholder",
      outbound: mockOutbound({
        fetch: async () => ({ ok: false, errorCode: "provider_unavailable" }),
      }),
    })
    expect(summary.ops[0]?.outcome).toBe("failed")
    expect(summary.exitCode).toBe(4)
    expect(summary.fetchAttempts).toBe(1)
  })

  it("refuses dangling ledger symlink via lstat with zero key/DB/HTTP", async () => {
    const name = isolationName("dangling-ledger")
    const paths = resolveFixedPilotPaths(REPO_ROOT, name)
    const fake = danglingDbLstat(paths, "ledger")
    expect(() => lstatExistingEntry(paths.ledgerPath, PILOT_LEDGER_FILENAME, fake)).toThrow(
      /pilot_symlink_refused/,
    )
    expect(() => resolveFixedPilotPaths(REPO_ROOT, name, { lstat: fake })).toThrow(
      /pilot_symlink_refused:pilot-attempt-ledger/,
    )
    const tracker = { search: [] as string[], fetch: [] as string[] }
    let keyReads = 0
    await expect(
      runPilot({
        mode: "execute",
        projectRoot: REPO_ROOT,
        testIsolationName: name,
        outbound: mockOutbound({ tracker }),
        lstat: fake,
        readKey: async () => {
          keyReads += 1
          return "sk-should-not-be-read"
        },
      }),
    ).rejects.toThrow(/pilot_symlink_refused/)
    expect(keyReads).toBe(0)
    expect(tracker.search).toEqual([])
    expect(tracker.fetch).toEqual([])
    expect(existsSync(paths.ledgerPath)).toBe(false)
    expect(existsSync(paths.paidDbPath)).toBe(false)
  })

  it("refuses dangling paid DB symlink the same way", async () => {
    const name = isolationName("dangling-paid")
    const paths = resolveFixedPilotPaths(REPO_ROOT, name)
    const fake = danglingDbLstat(paths, "paid")
    expect(() => resolveFixedPilotPaths(REPO_ROOT, name, { lstat: fake })).toThrow(
      /pilot_symlink_refused:pilot-paid/,
    )
    const tracker = { search: [] as string[], fetch: [] as string[] }
    let keyReads = 0
    await expect(
      runPilot({
        mode: "execute",
        projectRoot: REPO_ROOT,
        testIsolationName: name,
        outbound: mockOutbound({ tracker }),
        lstat: fake,
        readKey: async () => {
          keyReads += 1
          return "sk-should-not-be-read"
        },
      }),
    ).rejects.toThrow(/pilot_symlink_refused/)
    expect(keyReads).toBe(0)
    expect(tracker.search).toEqual([])
    expect(existsSync(paths.ledgerPath)).toBe(false)
    expect(existsSync(paths.paidDbPath)).toBe(false)
  })

  it("fail-closed on non-ENOENT lstat errors for DB paths", () => {
    const name = isolationName("lstat-eacces")
    const paths = resolveFixedPilotPaths(REPO_ROOT, name)
    const boom: PilotLstat = (p) => {
      if (String(p) === paths.ledgerPath) {
        const err = new Error("denied") as NodeJS.ErrnoException
        err.code = "EACCES"
        throw err
      }
      return lstatSync(p)
    }
    expect(() => resolveFixedPilotPaths(REPO_ROOT, name, { lstat: boom })).toThrow(
      /path_lstat_failed:pilot-attempt-ledger\.sqlite3:EACCES/,
    )
  })

  it("refuses lstat override without test isolation", () => {
    expect(() => assertTestIsolationAllowed({
      mode: "plan",
      projectRoot: REPO_ROOT,
      lstat: () => symlinkStats(),
    })).toThrow(/lstat_override_requires_test_isolation/)
  })

  it("refuses real dangling file symlink when OS allows", (context: TestContext) => {
    const name = isolationName("dangling-os")
    const paths = resolveFixedPilotPaths(REPO_ROOT, name)
    mkdirSync(paths.pilotDir, { recursive: true })
    const missingTarget = join(paths.pilotDir, "missing-outside-target")
    try {
      symlinkSync(missingTarget, paths.ledgerPath)
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      context.skip(`file symlink unsupported: ${msg}`)
      return
    }
    // Hole: existsSync is false for dangling links and used to skip the check.
    expect(existsSync(paths.ledgerPath)).toBe(false)
    expect(() => resolveFixedPilotPaths(REPO_ROOT, name)).toThrow(/pilot_symlink_refused/)
    expect(existsSync(paths.paidDbPath)).toBe(false)
  })
})

describe("default HTTP adapter via global fetch stub (no injectedFetcher)", () => {
  const FAKE_KEY = "sk-test-default-adapter-fake-not-real"
  const expectedSearchUrl = `${DEEPSEEK_TOOLS_BASE}${DEEPSEEK_SEARCH_PATH}`

  interface FetchCall {
    url: string
    method?: string
    headers?: Record<string, string>
    body?: string
    hasSignal: boolean
  }

  type FetchInput = Parameters<typeof fetch>[0]

  function installOutboundHangThenStub(handler: (input: FetchInput, init?: RequestInit) => Promise<Response> | Response) {
    const original = globalThis.fetch
    const calls: FetchCall[] = []
    let armed = false
    const hung = async () => {
      throw new Error("OUTBOUND_FORBIDDEN_BEFORE_STUB_ARMED")
    }
    // Hang first so any accidental call before stub arming fails closed.
    globalThis.fetch = hung as typeof globalThis.fetch
    const stub = (async (input: FetchInput, init?: RequestInit) => {
      if (!armed) throw new Error("OUTBOUND_FORBIDDEN_STUB_NOT_ARMED")
      const url = typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : String((input as Request).url)
      const headersRaw = init?.headers
      const headers: Record<string, string> = {}
      if (headersRaw && typeof headersRaw === "object" && !Array.isArray(headersRaw) && !(headersRaw instanceof Headers)) {
        for (const [k, v] of Object.entries(headersRaw as Record<string, string>)) headers[k] = String(v)
      } else if (headersRaw instanceof Headers) {
        headersRaw.forEach((v, k) => {
          headers[k] = v
        })
      }
      calls.push({
        url,
        method: init?.method,
        headers,
        body: typeof init?.body === "string" ? init.body : init?.body != null ? String(init.body) : undefined,
        hasSignal: init?.signal instanceof AbortSignal,
      })
      if (url !== expectedSearchUrl) {
        throw new Error("OUTBOUND_FORBIDDEN_UNEXPECTED_URL")
      }
      return handler(input, init)
    }) as typeof globalThis.fetch
    globalThis.fetch = stub
    armed = true
    const restore = () => {
      armed = false
      globalThis.fetch = original
    }
    cleanups.push(restore)
    return { calls, restore }
  }

  function freshPaidDb(label: string): string {
    const name = isolationName(`default-fetch-${label}`)
    const dir = join(REPO_ROOT, ".tmp", name)
    mkdirSync(dir, { recursive: true })
    return join(dir, "pilot-paid.sqlite3")
  }

  function readReceipt(paidDbPath: string, subject: string): { id: string, status: string, error: string | null } | undefined {
    const native = new NativeDatabase(paidDbPath, { readonly: true })
    try {
      return native.prepare(
        "SELECT id, status, error FROM paid_receipt WHERE subject = ? ORDER BY created_at DESC LIMIT 1",
      ).get(subject) as { id: string, status: string, error: string | null } | undefined
    } finally {
      native.close()
    }
  }

  it("200 Search through default adapter: asserts URL/method/headers/body/signal and success", async () => {
    const paidDbPath = freshPaidDb("ok200")
    const body = {
      results: [{ title: "Default Adapter Hit", url: "https://example.com/default-ok", date: "2026-10-02" }],
    }
    const { calls } = installOutboundHangThenStub(() =>
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    )
    const secrets = createMemorySecretStore(FAKE_KEY)
    const live = await createLiveOutbound({ paidDbPath, secrets })
    try {
      const attemptId = "attempt-default-ok-200"
      const out = await live.outbound.search("default-adapter-ok-query", attemptId)
      expect(out.ok).toBe(true)
      expect(out.receiptId).toBeTruthy()
      expect(out.billable).toBe(true)
      expect(out.upstreamResultCount).toBe(1)
      expect(out.candidates).toHaveLength(1)
      expect(calls).toHaveLength(1)
      expect(calls[0]?.url).toBe(expectedSearchUrl)
      expect(calls[0]?.method).toBe("POST")
      expect(calls[0]?.hasSignal).toBe(true)
      expect(calls[0]?.headers?.["Content-Type"]).toBe("application/json")
      expect(calls[0]?.headers?.Accept).toBe("application/json")
      expect(calls[0]?.headers?.Authorization).toBe(`Bearer ${FAKE_KEY}`)
      const parsed = JSON.parse(calls[0]!.body!) as Record<string, unknown>
      expect(parsed).toMatchObject({
        query: "default-adapter-ok-query",
        count: 10,
        need_content: false,
      })
      expect(parsed).not.toHaveProperty("localization")
      const row = readReceipt(paidDbPath, attemptId)
      expect(row?.id).toBe(out.receiptId)
      expect(row?.status).toBe("received")
    } finally {
      live.dispose()
      secrets.clear()
    }
  })

  it("http 401 reject through default adapter books failed (not request_failed/unknown)", async () => {
    const paidDbPath = freshPaidDb("http401")
    const { calls } = installOutboundHangThenStub(() =>
      new Response(JSON.stringify({ error: "nope" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      }),
    )
    const secrets = createMemorySecretStore(FAKE_KEY)
    const live = await createLiveOutbound({ paidDbPath, secrets })
    try {
      const attemptId = "attempt-default-http-401"
      const out = await live.outbound.search("default-adapter-401-query", attemptId)
      expect(out.ok).toBe(false)
      expect(out.unknown).toBeFalsy()
      expect(out.errorCode).toBe("ProviderRejectedError")
      expect(out.receiptId).toBeTruthy()
      expect(calls).toHaveLength(1)
      expect(calls[0]?.url).toBe(expectedSearchUrl)
      const row = readReceipt(paidDbPath, attemptId)
      expect(row?.id).toBe(out.receiptId)
      expect(row?.status).toBe("failed")
      expect(row?.error).toBe("deepseek_tools_http_401")
    } finally {
      live.dispose()
      secrets.clear()
    }
  })

  it("underlying fetch throw maps to request_failed/unknown and backfills receiptId", async () => {
    const paidDbPath = freshPaidDb("throw")
    const { calls } = installOutboundHangThenStub(() => {
      throw new TypeError("synthetic_transport_boom")
    })
    const secrets = createMemorySecretStore(FAKE_KEY)
    const live = await createLiveOutbound({ paidDbPath, secrets })
    try {
      const attemptId = "attempt-default-throw"
      const out = await live.outbound.search("default-adapter-throw-query", attemptId)
      expect(out.ok).toBe(false)
      expect(out.unknown).toBe(true)
      expect(out.errorCode).toBe("DeepSeekToolsOutcomeUnknownError")
      expect(out.detail).toBe("request_failed")
      expect(out.receiptId).toBeTruthy()
      expect(calls).toHaveLength(1)
      expect(calls[0]?.url).toBe(expectedSearchUrl)
      expect(calls[0]?.method).toBe("POST")
      const row = readReceipt(paidDbPath, attemptId)
      expect(row?.id).toBe(out.receiptId)
      expect(row?.status).toBe("unknown")
      expect(row?.error).toBe("request_failed")
    } finally {
      live.dispose()
      secrets.clear()
    }
  })

  it("response stream body is read via default adapter readText path", async () => {
    const paidDbPath = freshPaidDb("stream")
    const payload = JSON.stringify({
      results: [{ title: "Stream Hit", url: "https://example.com/stream", date: "2026-10-03" }],
    })
    const { calls } = installOutboundHangThenStub(() => {
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(payload))
          controller.close()
        },
      })
      return new Response(stream, {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    })
    const secrets = createMemorySecretStore(FAKE_KEY)
    const live = await createLiveOutbound({ paidDbPath, secrets })
    try {
      const attemptId = "attempt-default-stream"
      const out = await live.outbound.search("default-adapter-stream-query", attemptId)
      expect(out.ok).toBe(true)
      expect(out.receiptId).toBeTruthy()
      expect(out.candidates?.[0]?.title).toBe("Stream Hit")
      expect(calls).toHaveLength(1)
      expect(calls[0]?.url).toBe(expectedSearchUrl)
    } finally {
      live.dispose()
      secrets.clear()
    }
  })

  it("adapter sync throw while reading status/ok after fetch resolves still becomes request_failed", async () => {
    const paidDbPath = freshPaidDb("adapt-sync")
    const { calls } = installOutboundHangThenStub(() => {
      // Not a real Response: default adapter accesses .status/.ok after await fetch(...)
      return {
        get status(): number {
          throw new TypeError("synthetic_status_access_boom")
        },
        get ok(): boolean {
          throw new TypeError("synthetic_ok_access_boom")
        },
        headers: { get: () => null },
        body: null,
        text: async () => "",
      } as unknown as Response
    })
    const secrets = createMemorySecretStore(FAKE_KEY)
    const live = await createLiveOutbound({ paidDbPath, secrets })
    try {
      const attemptId = "attempt-default-adapt-sync"
      const out = await live.outbound.search("default-adapter-adapt-sync-query", attemptId)
      expect(out.ok).toBe(false)
      expect(out.unknown).toBe(true)
      expect(out.errorCode).toBe("DeepSeekToolsOutcomeUnknownError")
      expect(out.detail).toBe("request_failed")
      expect(out.receiptId).toBeTruthy()
      expect(calls).toHaveLength(1)
      const row = readReceipt(paidDbPath, attemptId)
      expect(row?.status).toBe("unknown")
      expect(row?.error).toBe("request_failed")
      expect(row?.id).toBe(out.receiptId)
    } finally {
      live.dispose()
      secrets.clear()
    }
  })
})
