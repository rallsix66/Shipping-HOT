/**
 * One-shot public-port Search wrapper (MPA Singapore).
 * Product pilot-lib API unchanged. Used by .tmp CLI entry + vitest chain tests.
 * Always: read key once -> runPreflightKeyRequest -> only preflight_ok returns that key;
 * then runPilot with exactly one searchQueries item and empty fetchTargets.
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

/** Fixed reviewed one-shot query (not in FIRST_ROUND_SEARCH_QUERIES). */
export const ONE_SHOT_SEARCH_QUERY = "MPA Singapore port marine circular advisory 2026" as const

export const ONE_SHOT_OPERATION_KEY = searchOperationKey(ONE_SHOT_SEARCH_QUERY)

export const ONE_SHOT_EXPECTED_OPERATION_KEY = "search:3fc560fdf5c1c88bbfbad2a9a826e646" as const

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

export interface OneshotPublicPortSearchOptions {
  projectRoot: string
  /** Called at most once per execute; result is preflighted before any ledger/paid open. */
  readKeyOnce: () => Promise<string | undefined>
  testIsolationName?: string
  injectedFetcher?: InjectedFetcher
  outbound?: PilotOutbound
  lstat?: PilotLstat
}

/**
 * Build the readKey closure: single read + runPreflightKeyRequest before return.
 * runPilot invokes this before openPilotLedger / createLiveOutbound / reserveAttempt.
 */
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

/** Same wrapper used by CLI and tests — do not duplicate execute logic elsewhere. */
export async function runOneShotPublicPortSearch(
  options: OneshotPublicPortSearchOptions,
): Promise<PilotSummary> {
  if (ONE_SHOT_OPERATION_KEY !== ONE_SHOT_EXPECTED_OPERATION_KEY) {
    throw new Error("oneshot_operation_key_mismatch")
  }
  return runPilot({
    projectRoot: options.projectRoot,
    mode: "execute",
    searchQueries: [ONE_SHOT_SEARCH_QUERY],
    fetchTargets: [],
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

/**
 * CLI path: catch maps only to fixed preflight codes or oneshot_failed.
 * Never surfaces error.message / String(error).
 */
export async function executeOneshotCli(
  options: OneshotPublicPortSearchOptions,
): Promise<OneshotCliResult> {
  try {
    const summary = await runOneShotPublicPortSearch(options)
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

/** Stdin CLI entry used by .tmp/run-one-public-port-search.ts */
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
