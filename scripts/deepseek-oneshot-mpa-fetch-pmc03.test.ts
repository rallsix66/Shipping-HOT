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
  runOneShotMpaFetchPmc03,
} from "./deepseek-oneshot-mpa-fetch-pmc03"
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
  const name = `dspilot-mpa-pmc03-${label}-${randomBytes(4).toString("hex")}`
  cleanups.push(() => {
    try {
      rmSync(join(REPO_ROOT, ".tmp", name), { recursive: true, force: true })
    } catch {
      /* ignore */
    }
  })
  return name
}

const FAKE_KEY = "sk-test-mpa-pmc03-fake"
const expectedFetchUrl = `${DEEPSEEK_TOOLS_BASE}${DEEPSEEK_FETCH_PATH}`

describe("oneshot MPA fetch PMC03", () => {
  it("posts canonical PMC03 URL once", async () => {
    const name = isolationName("ok")
    const paths = resolveFixedPilotPaths(REPO_ROOT, name)
    mkdirSync(paths.pilotDir, { recursive: true })

    const calls: Array<{ url: string, body?: string }> = []
    const original = globalThis.fetch
    globalThis.fetch = (async (input, init) => {
      const url = typeof input === "string" ? input : String(input)
      calls.push({
        url,
        body: typeof init?.body === "string" ? init.body : undefined,
      })
      if (url !== expectedFetchUrl) {
        throw new Error("unexpected url")
      }
      return new Response(JSON.stringify({ title: "PMC 03", content: "# MD" }), {
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
      const summary = await runOneShotMpaFetchPmc03({
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

    expect(JSON.parse(calls[0]!.body!).url).toBe(ONE_SHOT_FETCH_URL)

    const native = new NativeDatabase(paths.ledgerPath, { readonly: true })
    try {
      const row = native.prepare(
        "SELECT operation_key, status FROM pilot_attempt WHERE pilot_id = ? AND capability = ?",
      ).get(PILOT_ID, "deepseek_fetch") as { operation_key: string, status: string }
      expect(row.operation_key).toBe(ONE_SHOT_EXPECTED_OPERATION_KEY)
      expect(row.status).toBe("succeeded")
    } finally {
      native.close()
    }
  })
})
