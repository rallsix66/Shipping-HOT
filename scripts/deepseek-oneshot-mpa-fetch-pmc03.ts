/**
 * One-shot Fetch: MPA PMC 03/2026 (alternate URL; PMC 10 fetch failed with http_404).
 */
import {
  KeyStdinDecodeError,
  type PilotFetchTarget,
  type PilotLstat,
  type PilotOutbound,
  type PilotSummary,
  fetchOperationKey,
  resolveExecuteKey,
  runPilot,
  runPreflightKeyRequest,
  summaryForStdout,
} from "./deepseek-search-fetch-pilot-lib.ts"
import { reviewFetchTarget } from "#/intel/discovery/search-fetch-service"
import type { InjectedFetcher, PreflightResultCode } from "#/providers/deepseek/search-fetch-client"

export const ONE_SHOT_FETCH_URL_INPUT
  = "https://www.mpa.gov.sg/media-centre/details/port-marine-circular-no.-03-of-2026--maritime-declaration-of-health" as const

const reviewed = reviewFetchTarget(ONE_SHOT_FETCH_URL_INPUT)
if (reviewed.status !== "syntactically_allowed") {
  throw new Error("oneshot_fetch_url_locally_rejected")
}

export const ONE_SHOT_FETCH_URL = reviewed.canonicalUrl

export const ONE_SHOT_FETCH_PERSISTENCE = "excerpt_only" as const

export const ONE_SHOT_FETCH_TARGET: PilotFetchTarget = {
  url: ONE_SHOT_FETCH_URL,
  persistence: ONE_SHOT_FETCH_PERSISTENCE,
  targetReview: reviewed,
}

export const ONE_SHOT_OPERATION_KEY = fetchOperationKey(ONE_SHOT_FETCH_URL)

export const ONE_SHOT_EXPECTED_OPERATION_KEY = "fetch:eb9fa871aba2dcdf0069d91d3c67b602" as const

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

export interface OneshotMpaFetchPmc03Options {
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

export async function runOneShotMpaFetchPmc03(
  options: OneshotMpaFetchPmc03Options,
): Promise<PilotSummary> {
  if (ONE_SHOT_OPERATION_KEY !== ONE_SHOT_EXPECTED_OPERATION_KEY) {
    throw new Error("oneshot_operation_key_mismatch")
  }
  return runPilot({
    projectRoot: options.projectRoot,
    mode: "execute",
    searchQueries: [],
    fetchTargets: [ONE_SHOT_FETCH_TARGET],
    readKey: createOneshotReadKey(options.readKeyOnce),
    testIsolationName: options.testIsolationName,
    injectedFetcher: options.injectedFetcher,
    outbound: options.outbound,
    lstat: options.lstat,
  })
}

export type OneshotFetchCliResult =
  | { ok: true, summary: PilotSummary }
  | {
    ok: false
    code: OneshotPreflightFailCode | "oneshot_failed"
    exitCode: number
  }

export async function executeOneshotFetchCli(
  options: OneshotMpaFetchPmc03Options,
): Promise<OneshotFetchCliResult> {
  try {
    const summary = await runOneShotMpaFetchPmc03(options)
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

export async function runOneshotFetchStdinCli(projectRoot: string): Promise<OneshotFetchCliResult> {
  return executeOneshotFetchCli({
    projectRoot,
    readKeyOnce: () => resolveExecuteKey({ keyFromStdin: true }),
  })
}

export function printOneshotFetchCliResult(result: OneshotFetchCliResult): number {
  if (result.ok) {
    console.log(JSON.stringify(summaryForStdout(result.summary), null, 2))
    return result.summary.exitCode
  }
  console.error(result.code)
  return result.exitCode
}
