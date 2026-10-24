/**
 * Offline chain for one-shot Fetch (MPA PMC 10/2026). Isolated DB under .tmp/ only.
 */
import { randomBytes } from "node:crypto"
import { mkdirSync, rmSync } from "node:fs"
import { join } from "node:path"
import process from "node:process"
import { afterEach, describe, expect, it } from "vitest"
import NativeDatabase from "better-sqlite3"
import {
  PILOT_ID,
  createLiveOutbound,
  createMemorySecretStore,
  resolveFixedPilotPaths,
} from "./deepseek-search-fetch-pilot-lib"
import {
  ONE_SHOT_EXPECTED_OPERATION_KEY,
  ONE_SHOT_FETCH_URL,
  ONE_SHOT_OPERATION_KEY,
  runOneShotPublicPortFetch,
} from "./deepseek-oneshot-public-port-fetch"
import {
  DEEPSEEK_FETCH_PATH,
  DEEPSEEK_TOOLS_BASE,
} from "#/providers/deepseek/search-fetch-client"

const REPO_ROOT = process.cwd()
mkdirSync(join(REPO_ROOT, ".tmp"), { recursive: true })

const cleanups: Array<() => void> = []
afterEach(() => {
  while (cleanups.length) cleanups.pop()!()
})

function isolationName(label: string): string {
  const name = `dspilot-fetch-oneshot-${label}-${randomBytes(4).toString("hex")}`
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

const FAKE_KEY = "sk-test-oneshot-fetch-fake-not-real"
const expectedFetchUrl = `${DEEPSEEK_TOOLS_BASE}${DEEPSEEK_FETCH_PATH}`

describe("oneshot public-port Fetch offline chain", () => {
  it("binds MPA URL, posts once to tools/fetch, succeeds with excerpt_only target", async () => {
    expect(ONE_SHOT_OPERATION_KEY).toBe(ONE_SHOT_EXPECTED_OPERATION_KEY)

    const name = isolationName("ok")
    const paths = resolveFixedPilotPaths(REPO_ROOT, name)
    mkdirSync(paths.pilotDir, { recursive: true })

    const calls: Array<{ url: string, method?: string, body?: string }> = []
    const original = globalThis.fetch
    globalThis.fetch = (async (input, init) => {
      const url = typeof input === "string" ? input : String(input)
      calls.push({
        url,
        method: init?.method,
        body: typeof init?.body === "string" ? init.body : undefined,
      })
      if (url !== expectedFetchUrl) {
        throw new Error("OUTBOUND_FORBIDDEN_UNEXPECTED_URL")
      }
      return new Response(JSON.stringify({
        title: "PORT MARINE CIRCULAR NO. 10 OF 2026",
        content: "Synthetic excerpt body for offline test.",
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    }) as typeof globalThis.fetch
    cleanups.push(() => {
      globalThis.fetch = original
    })

    const secrets = createMemorySecretStore(FAKE_KEY)
    const live = await createLiveOutbound({ paidDbPath: paths.paidDbPath, secrets })
    try {
      const summary = await runOneShotPublicPortFetch({
        projectRoot: REPO_ROOT,
        testIsolationName: name,
        readKeyOnce: async () => FAKE_KEY,
        outbound: live.outbound,
      })
      expect(summary.searchQueries).toEqual([])
      expect(summary.fetchTargetCount).toBe(1)
      expect(summary.fetchAttempts).toBe(1)
      expect(summary.fetchReservedMilli).toBe(5)
      expect(summary.ops[0]?.operationKey).toBe(ONE_SHOT_EXPECTED_OPERATION_KEY)
      expect(summary.ops[0]?.outcome).toBe("succeeded")
      expect(summary.outboundCalls).toBe(1)
      expect(summary.exitCode).toBe(0)
    } finally {
      live.dispose()
    }

    expect(calls).toHaveLength(1)
    expect(calls[0]?.method).toBe("POST")
    const body = JSON.parse(calls[0]!.body!) as { url: string }
    expect(body.url).toBe(ONE_SHOT_FETCH_URL)

    const native = new NativeDatabase(paths.ledgerPath, { readonly: true })
    try {
      const row = native.prepare(
        "SELECT status, operation_key FROM pilot_attempt WHERE pilot_id = ? AND capability = ?",
      ).get(PILOT_ID, "deepseek_fetch") as { status: string, operation_key: string }
      expect(row.status).toBe("succeeded")
      expect(row.operation_key).toBe(ONE_SHOT_EXPECTED_OPERATION_KEY)
    } finally {
      native.close()
    }
  })

  it("duplicate execute restores without second HTTP", async () => {
    const name = isolationName("dup")
    const paths = resolveFixedPilotPaths(REPO_ROOT, name)
    mkdirSync(paths.pilotDir, { recursive: true })

    let httpCount = 0
    const original = globalThis.fetch
    globalThis.fetch = (async () => {
      httpCount += 1
      return new Response(JSON.stringify({ title: "T", content: "C" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    }) as typeof globalThis.fetch
    cleanups.push(() => {
      globalThis.fetch = original
    })

    const secrets = createMemorySecretStore(FAKE_KEY)
    const live = await createLiveOutbound({ paidDbPath: paths.paidDbPath, secrets })
    try {
      await runOneShotPublicPortFetch({
        projectRoot: REPO_ROOT,
        testIsolationName: name,
        readKeyOnce: async () => FAKE_KEY,
        outbound: live.outbound,
      })
      const dup = await runOneShotPublicPortFetch({
        projectRoot: REPO_ROOT,
        testIsolationName: name,
        readKeyOnce: async () => FAKE_KEY,
        outbound: live.outbound,
      })
      expect(dup.outboundCalls).toBe(0)
      expect(httpCount).toBe(1)
    } finally {
      live.dispose()
    }
  })
})
