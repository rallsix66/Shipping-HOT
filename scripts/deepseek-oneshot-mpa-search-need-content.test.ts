import { randomBytes } from "node:crypto"
import { mkdirSync, rmSync } from "node:fs"
import { join } from "node:path"
import process from "node:process"
import { afterEach, describe, expect, it } from "vitest"
import {
  createLiveOutbound,
  createMemorySecretStore,
  resolveFixedPilotPaths,
} from "./deepseek-search-fetch-pilot-lib"
import {
  LEGACY_LIVE_OPERATION_KEY_QUERY_ONLY,
  ONE_SHOT_EXPECTED_OPERATION_KEY,
  ONE_SHOT_SEARCH_QUERY,
  runOneShotMpaSearchNeedContent,
} from "./deepseek-oneshot-mpa-search-need-content"
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
  const name = `dspilot-mpa-needcontent-${label}-${randomBytes(4).toString("hex")}`
  cleanups.push(() => {
    try {
      rmSync(join(REPO_ROOT, ".tmp", name), { recursive: true, force: true })
    } catch {
      /* ignore */
    }
  })
  return name
}

const FAKE_KEY = "sk-test-mpa-needcontent-fake"
const expectedSearchUrl = `${DEEPSEEK_TOOLS_BASE}${DEEPSEEK_SEARCH_PATH}`

describe("oneshot MPA search need_content", () => {
  it("uses need_content-aware operation key distinct from query-only legacy live row", () => {
    expect(ONE_SHOT_EXPECTED_OPERATION_KEY).not.toBe(LEGACY_LIVE_OPERATION_KEY_QUERY_ONLY)
  })

  it("posts need_content true and distinct operation key", async () => {
    const name = isolationName("ok")
    const paths = resolveFixedPilotPaths(REPO_ROOT, name)
    mkdirSync(paths.pilotDir, { recursive: true })

    const bodies: string[] = []
    const original = globalThis.fetch
    globalThis.fetch = (async (_input, init) => {
      bodies.push(typeof init?.body === "string" ? init.body : "")
      return new Response(JSON.stringify({
        results: [{ title: "PMC", url: "https://www.mpa.gov.sg/x", content: "body text" }],
      }), { status: 200, headers: { "Content-Type": "application/json" } })
    }) as typeof globalThis.fetch
    cleanups.push(() => {
      globalThis.fetch = original
    })

    const secrets = createMemorySecretStore(FAKE_KEY)
    const live = await createLiveOutbound({
      paidDbPath: paths.paidDbPath,
      secrets,
      searchNeedContent: true,
    })
    try {
      const summary = await runOneShotMpaSearchNeedContent({
        projectRoot: REPO_ROOT,
        testIsolationName: name,
        readKeyOnce: async () => FAKE_KEY,
        outbound: live.outbound,
      })
      expect(summary.ops[0]?.operationKey).toBe(ONE_SHOT_EXPECTED_OPERATION_KEY)
      expect(summary.ops[0]?.outcome).toBe("succeeded")
    } finally {
      live.dispose()
    }

    expect(bodies.length).toBeGreaterThan(0)
    const parsed = JSON.parse(bodies[0]!) as { query: string, need_content: boolean }
    expect(parsed.query).toBe(ONE_SHOT_SEARCH_QUERY)
    expect(parsed.need_content).toBe(true)
    void expectedSearchUrl
  })
})
