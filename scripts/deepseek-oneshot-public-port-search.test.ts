/**
 * Offline chain test for one-shot public-port Search wrapper.
 * Uses the SAME runOneShotPublicPortSearch / executeOneshotCli logic as the CLI
 * for the one-shot execute path (not a parallel reimplementation).
 * Isolated DBs under .tmp/ only — never touches live pilot dual DB.
 * Fake key + fail-closed global fetch stub (no live net).
 */
import { randomBytes } from "node:crypto"
import { mkdirSync, rmSync } from "node:fs"
import { join } from "node:path"
import process from "node:process"
import { afterEach, describe, expect, it } from "vitest"
import NativeDatabase from "better-sqlite3"
import {
  FIRST_ROUND_SEARCH_QUERIES,
  PILOT_ID,
  createLiveOutbound,
  createMemorySecretStore,
  resolveFixedPilotPaths,
  runPilot,
} from "./deepseek-search-fetch-pilot-lib"
import {
  ONE_SHOT_EXPECTED_OPERATION_KEY,
  ONE_SHOT_OPERATION_KEY,
  ONE_SHOT_SEARCH_QUERY,
  executeOneshotCli,
  runOneShotPublicPortSearch,
} from "./deepseek-oneshot-public-port-search"
import {
  DEEPSEEK_SEARCH_PATH,
  DEEPSEEK_TOOLS_BASE,
} from "#/providers/deepseek/search-fetch-client"

const REPO_ROOT = process.cwd()
mkdirSync(join(REPO_ROOT, ".tmp"), { recursive: true })

const cleanups: Array<() => void> = []
afterEach(() => {
  while (cleanups.length) cleanups.pop()!()
})

function isolationName(label: string): string {
  const name = `dspilot-oneshot-${label}-${randomBytes(4).toString("hex")}`
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

const FAKE_KEY = "sk-test-oneshot-chain-fake-not-real"
const expectedSearchUrl = `${DEEPSEEK_TOOLS_BASE}${DEEPSEEK_SEARCH_PATH}`

interface FetchCall {
  url: string
  method?: string
  body?: string
}

type FetchInput = Parameters<typeof fetch>[0]

type FetchHandler = (input: FetchInput, init?: RequestInit) => Promise<Response> | Response

function installMutableFailClosedFetchStub() {
  const original = globalThis.fetch
  const calls: FetchCall[] = []
  let armed = false
  let handler: FetchHandler = () => {
    throw new Error("OUTBOUND_FORBIDDEN_NO_HANDLER")
  }
  const hung = async () => {
    throw new Error("OUTBOUND_FORBIDDEN_BEFORE_STUB_ARMED")
  }
  globalThis.fetch = hung as typeof globalThis.fetch
  const stub = (async (input: FetchInput, init?: RequestInit) => {
    if (!armed) throw new Error("OUTBOUND_FORBIDDEN_STUB_NOT_ARMED")
    const url = typeof input === "string"
      ? input
      : input instanceof URL
        ? input.toString()
        : String((input as Request).url)
    calls.push({
      url,
      method: init?.method,
      body: typeof init?.body === "string" ? init.body : init?.body != null ? String(init.body) : undefined,
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
  return {
    calls,
    restore,
    setHandler: (h: FetchHandler) => {
      handler = h
    },
  }
}

interface AttemptRow {
  id: string
  pilot_id: string
  capability: string
  operation_key: string
  status: string
  reserved_milli: number
  created_at: string
  finished_at: string | null
  error_code: string | null
  receipt_id: string | null
  result_summary_json: string | null
}

interface PaidRow {
  id: string
  subject: string | null
  status: string
  error: string | null
  purpose: string
  capability: string
}

function readAllAttempts(ledgerPath: string): AttemptRow[] {
  const native = new NativeDatabase(ledgerPath, { readonly: true })
  try {
    return native.prepare(
      `SELECT id, pilot_id, capability, operation_key, status, reserved_milli,
              created_at, finished_at, error_code, receipt_id, result_summary_json
       FROM pilot_attempt ORDER BY created_at ASC, id ASC`,
    ).all() as AttemptRow[]
  } finally {
    native.close()
  }
}

function readPaidUnknown(paidDbPath: string): PaidRow[] {
  const native = new NativeDatabase(paidDbPath, { readonly: true })
  try {
    return native.prepare(
      `SELECT id, subject, status, error, purpose, capability
       FROM paid_receipt WHERE status = 'unknown' ORDER BY created_at ASC, id ASC`,
    ).all() as PaidRow[]
  } finally {
    native.close()
  }
}

describe("oneshot public-port Search offline chain (same wrapper)", () => {
  it("8 unknown/40milli seed -> oneshot +1 POST exact query; duplicate HTTP0; bad key HTTP0", async () => {
    expect(FIRST_ROUND_SEARCH_QUERIES).toHaveLength(8)
    expect(ONE_SHOT_OPERATION_KEY).toBe(ONE_SHOT_EXPECTED_OPERATION_KEY)
    expect((FIRST_ROUND_SEARCH_QUERIES as readonly string[]).includes(ONE_SHOT_SEARCH_QUERY)).toBe(false)

    const name = isolationName("chain")
    const paths = resolveFixedPilotPaths(REPO_ROOT, name)
    mkdirSync(paths.pilotDir, { recursive: true })

    const { calls, setHandler } = installMutableFailClosedFetchStub()
    const secrets = createMemorySecretStore(FAKE_KEY)

    // Seed 8 unknown (ledger + paid) via createLiveOutbound + TypeError (not oneshot wrapper)
    setHandler(() => {
      throw new TypeError("synthetic_seed_transport_unknown")
    })
    const live = await createLiveOutbound({ paidDbPath: paths.paidDbPath, secrets })
    try {
      for (const q of FIRST_ROUND_SEARCH_QUERIES) {
        const seeded = await runPilot({
          projectRoot: REPO_ROOT,
          mode: "execute",
          testIsolationName: name,
          searchQueries: [q],
          fetchTargets: [],
          readKey: async () => FAKE_KEY,
          outbound: live.outbound,
        })
        expect(seeded.ops[0]?.outcome).toBe("unknown")
        expect(seeded.outboundCalls).toBe(1)
      }
    } finally {
      live.dispose()
    }

    expect(calls).toHaveLength(8)
    const attemptsBefore = readAllAttempts(paths.ledgerPath)
    const paidBefore = readPaidUnknown(paths.paidDbPath)
    expect(attemptsBefore).toHaveLength(8)
    expect(attemptsBefore.every(r => r.status === "unknown" && r.reserved_milli === 5)).toBe(true)
    expect(attemptsBefore.reduce((s, r) => s + r.reserved_milli, 0)).toBe(40)
    expect(paidBefore).toHaveLength(8)
    expect(paidBefore.every(r => r.status === "unknown")).toBe(true)
    const attemptFpBefore = JSON.stringify(attemptsBefore)
    const paidFpBefore = JSON.stringify(paidBefore)
    const callsAfterSeed = calls.length

    // --- oneshot success via SAME wrapper; stub returns 200 Search ---
    setHandler(() =>
      new Response(JSON.stringify({
        results: [{ title: "MPA Circular", url: "https://example.com/mpa", date: "2026-10-01" }],
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    )
    const live2 = await createLiveOutbound({ paidDbPath: paths.paidDbPath, secrets })
    try {
      const summary = await runOneShotPublicPortSearch({
        projectRoot: REPO_ROOT,
        testIsolationName: name,
        readKeyOnce: async () => FAKE_KEY,
        outbound: live2.outbound,
      })
      expect(summary.searchQueries).toEqual([ONE_SHOT_SEARCH_QUERY])
      expect(summary.fetchTargetCount).toBe(0)
      expect(summary.searchAttempts).toBe(9)
      expect(summary.searchReservedMilli).toBe(45)
      expect(summary.ops).toHaveLength(1)
      expect(summary.ops[0]?.operationKey).toBe(ONE_SHOT_EXPECTED_OPERATION_KEY)
      expect(summary.ops[0]?.outcome).toBe("succeeded")
      expect(summary.outboundCalls).toBe(1)
      expect(summary.exitCode).toBe(0)
    } finally {
      live2.dispose()
    }

    const postsAfterOneshot = calls.slice(callsAfterSeed)
    expect(postsAfterOneshot).toHaveLength(1)
    expect(postsAfterOneshot[0]?.method).toBe("POST")
    expect(postsAfterOneshot[0]?.url).toBe(expectedSearchUrl)
    const body = JSON.parse(postsAfterOneshot[0]!.body!) as { query: string }
    expect(body.query).toBe(ONE_SHOT_SEARCH_QUERY)

    const attemptsMid = readAllAttempts(paths.ledgerPath)
    expect(attemptsMid).toHaveLength(9)
    expect(attemptsMid.reduce((s, r) => s + r.reserved_milli, 0)).toBe(45)
    // original 8 rows unchanged field-for-field
    expect(JSON.stringify(attemptsMid.slice(0, 8))).toBe(attemptFpBefore)
    expect(JSON.stringify(readPaidUnknown(paths.paidDbPath))).toBe(paidFpBefore)
    const oneshotRow = attemptsMid[8]!
    expect(oneshotRow.operation_key).toBe(ONE_SHOT_EXPECTED_OPERATION_KEY)
    expect(oneshotRow.status).toBe("succeeded")
    expect(oneshotRow.reserved_milli).toBe(5)
    expect(oneshotRow.pilot_id).toBe(PILOT_ID)

    const callsBeforeDup = calls.length

    // --- duplicate same op: restore, HTTP 0, still 9 ---
    const live3 = await createLiveOutbound({ paidDbPath: paths.paidDbPath, secrets })
    try {
      const dup = await runOneShotPublicPortSearch({
        projectRoot: REPO_ROOT,
        testIsolationName: name,
        readKeyOnce: async () => FAKE_KEY,
        outbound: live3.outbound,
      })
      expect(dup.outboundCalls).toBe(0)
      expect(dup.searchAttempts).toBe(9)
      expect(dup.searchReservedMilli).toBe(45)
      expect(dup.ops[0]?.outcome === "duplicate_restored" || dup.ops[0]?.outcome === "duplicate_incomplete").toBe(true)
    } finally {
      live3.dispose()
    }
    expect(calls.length).toBe(callsBeforeDup)
    expect(readAllAttempts(paths.ledgerPath)).toHaveLength(9)
    expect(JSON.stringify(readAllAttempts(paths.ledgerPath).slice(0, 8))).toBe(attemptFpBefore)
    expect(JSON.stringify(readPaidUnknown(paths.paidDbPath))).toBe(paidFpBefore)

    const callsBeforeBad = calls.length
    const attemptsBeforeBad = JSON.stringify(readAllAttempts(paths.ledgerPath))
    const paidBeforeBad = JSON.stringify(readPaidUnknown(paths.paidDbPath))

    // --- illegal fake key: preflight fail, HTTP 0, both DBs unchanged ---
    // NUL => preflight_key_format (header format)
    const bad = await executeOneshotCli({
      projectRoot: REPO_ROOT,
      testIsolationName: name,
      readKeyOnce: async () => "sk-bad\u0000key",
      // satisfy isolation gate without opening live path
      injectedFetcher: async () => {
        throw new Error("OUTBOUND_FORBIDDEN_BAD_KEY_SHOULD_NOT_FETCH")
      },
    })
    expect(bad.ok).toBe(false)
    if (!bad.ok) {
      expect(bad.code).toBe("preflight_key_format")
      expect(bad.exitCode).toBe(3)
    }
    expect(calls.length).toBe(callsBeforeBad)
    expect(JSON.stringify(readAllAttempts(paths.ledgerPath))).toBe(attemptsBeforeBad)
    expect(JSON.stringify(readPaidUnknown(paths.paidDbPath))).toBe(paidBeforeBad)

    // missing key also fixed code, no HTTP
    const missing = await executeOneshotCli({
      projectRoot: REPO_ROOT,
      testIsolationName: name,
      readKeyOnce: async () => undefined,
      injectedFetcher: async () => {
        throw new Error("OUTBOUND_FORBIDDEN_MISSING_KEY")
      },
    })
    expect(missing.ok).toBe(false)
    if (!missing.ok) {
      expect(missing.code).toBe("preflight_key_missing")
    }
    expect(calls.length).toBe(callsBeforeBad)
    expect(JSON.stringify(readAllAttempts(paths.ledgerPath))).toBe(attemptsBeforeBad)

    secrets.clear()
  })

  it("createOneshotReadKey does not re-read and rejects non-ok preflight before runPilot ledger", async () => {
    const name = isolationName("preread")
    let reads = 0
    const result = await executeOneshotCli({
      projectRoot: REPO_ROOT,
      testIsolationName: name,
      readKeyOnce: async () => {
        reads += 1
        return ""
      },
      injectedFetcher: async () => {
        throw new Error("OUTBOUND_FORBIDDEN")
      },
    })
    expect(reads).toBe(1)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe("preflight_key_missing")
    const paths = resolveFixedPilotPaths(REPO_ROOT, name)
    // ledger may be absent — preflight failed inside readKey before openPilotLedger
    let attemptCount = 0
    try {
      attemptCount = readAllAttempts(paths.ledgerPath).length
    } catch {
      attemptCount = 0
    }
    expect(attemptCount).toBe(0)
  })
})
