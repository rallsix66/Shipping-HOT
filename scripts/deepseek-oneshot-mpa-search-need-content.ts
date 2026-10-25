/**
 * One-shot Search with need_content=true and site:mpa.gov.sg (MPA follow-up pilot).
 */
import {
  KeyStdinDecodeError,
  type PilotLstat,
  type PilotOutbound,
  type PilotSummary,
  resolveExecuteKey,
  runPilot,
  runPreflightKeyRequest,
  searchOperationKey,
  summaryForStdout,
} from "./deepseek-search-fetch-pilot-lib.ts"
import type { InjectedFetcher, PreflightResultCode } from "#/providers/deepseek/search-fetch-client"

export const ONE_SHOT_SEARCH_QUERY = "site:mpa.gov.sg port marine circular 2026" as const

export const ONE_SHOT_OPERATION_KEY = searchOperationKey(ONE_SHOT_SEARCH_QUERY, { needContent: true })

/** Post-closeout ledger key (need_content in operation_key). Live row `623d1734…` is legacy query-only — see evidence doc. */
export const ONE_SHOT_EXPECTED_OPERATION_KEY = "search:f0a4887f107d11cca3cdeba88c261a35" as const

/** Legacy live pilot row (2026-10-24 execute) used query-only operation_key before need_content suffix. */
export const LEGACY_LIVE_OPERATION_KEY_QUERY_ONLY = "search:623d1734d7db398bef928df98243d5f3" as const

const FIXED_PREFLIGHT_FAIL: ReadonlySet<string> = new Set([
  "preflight_key_missing",
  "preflight_key_format",
  "preflight_request_construct_failed",
])

export type OneshotPreflightFailCode =
  | "preflight_key_missing"
  | "preflight_key_format"
  | "preflight_request_construct_failed"

export class OneshotPreflightError extends Error {
  readonly code: OneshotPreflightFailCode
  constructor(code: OneshotPreflightFailCode) {
    super(code)
    this.name = "OneshotPreflightError"
    this.code = code
  }
}

export interface OneshotMpaSearchNeedContentOptions {
  projectRoot: string
  readKeyOnce: () => Promise<string | undefined>
  testIsolationName?: string
  injectedFetcher?: InjectedFetcher
  outbound?: PilotOutbound
  lstat?: PilotLstat
}

export function createOneshotReadKey(
  readKeyOnce: () => Promise<string | undefined>,
): () => Promise<string> {
  let used = false
  return async () => {
    if (used) {
      throw new OneshotPreflightError("preflight_key_format")
    }
    used = true
    const key = await readKeyOnce()
    const code: PreflightResultCode = runPreflightKeyRequest(key)
    if (code !== "preflight_ok") {
      if (FIXED_PREFLIGHT_FAIL.has(code)) {
        throw new OneshotPreflightError(code as OneshotPreflightFailCode)
      }
      throw new OneshotPreflightError("preflight_key_format")
    }
    return key as string
  }
}

export async function runOneShotMpaSearchNeedContent(
  options: OneshotMpaSearchNeedContentOptions,
): Promise<PilotSummary> {
  if (ONE_SHOT_OPERATION_KEY !== ONE_SHOT_EXPECTED_OPERATION_KEY) {
    throw new Error("oneshot_operation_key_mismatch")
  }
  return runPilot({
    projectRoot: options.projectRoot,
    mode: "execute",
    searchQueries: [ONE_SHOT_SEARCH_QUERY],
    fetchTargets: [],
    searchNeedContent: true,
    readKey: createOneshotReadKey(options.readKeyOnce),
    testIsolationName: options.testIsolationName,
    injectedFetcher: options.injectedFetcher,
    outbound: options.outbound,
    lstat: options.lstat,
  })
}

export type OneshotCliResult =
  | { ok: true, summary: PilotSummary }
  | {
    ok: false
    code: OneshotPreflightFailCode | "oneshot_failed"
    exitCode: number
  }

export async function executeOneshotCli(
  options: OneshotMpaSearchNeedContentOptions,
): Promise<OneshotCliResult> {
  try {
    const summary = await runOneShotMpaSearchNeedContent(options)
    return { ok: true, summary }
  } catch (error: unknown) {
    if (error instanceof KeyStdinDecodeError) {
      return { ok: false, code: "preflight_key_format", exitCode: 3 }
    }
    if (error instanceof OneshotPreflightError) {
      return { ok: false, code: error.code, exitCode: 3 }
    }
    return { ok: false, code: "oneshot_failed", exitCode: 1 }
  }
}

export async function runOneshotStdinCli(projectRoot: string): Promise<OneshotCliResult> {
  return executeOneshotCli({
    projectRoot,
    readKeyOnce: () => resolveExecuteKey({ keyFromStdin: true }),
  })
}

export function printOneshotCliResult(result: OneshotCliResult): number {
  if (result.ok) {
    console.log(JSON.stringify(summaryForStdout(result.summary), null, 2))
    return result.summary.exitCode
  }
  console.error(result.code)
  return result.exitCode
}
