/**
 * One-shot public-port Fetch wrapper (MPA Singapore PMC 10/2026 from 9th Search hit).
 * Same pilot-lib contract as Search oneshot: preflight key once, then runPilot with
 * empty searchQueries and exactly one reviewed fetchTargets entry.
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

/** Candidate URL from 9th Search (official MPA host); bound via reviewFetchTarget at load. */
export const ONE_SHOT_FETCH_URL_INPUT
  = "https://www.mpa.gov.sg/media-centre/details/port-marine-circular-no-10-of-2026-submission-of-accurate-information-for-vessel-port-calls-and-port-clearance" as const

const reviewed = reviewFetchTarget(ONE_SHOT_FETCH_URL_INPUT)
if (reviewed.status !== "syntactically_allowed") {
  throw new Error("oneshot_fetch_url_locally_rejected")
}

export const ONE_SHOT_FETCH_URL = reviewed.canonicalUrl

/** Pilot round: excerpt_only — does not grant intel catalog full-body rights. */
export const ONE_SHOT_FETCH_PERSISTENCE = "excerpt_only" as const

export const ONE_SHOT_FETCH_TARGET: PilotFetchTarget = {
  url: ONE_SHOT_FETCH_URL,
  persistence: ONE_SHOT_FETCH_PERSISTENCE,
  targetReview: reviewed,
}

export const ONE_SHOT_OPERATION_KEY = fetchOperationKey(ONE_SHOT_FETCH_URL)

export const ONE_SHOT_EXPECTED_OPERATION_KEY = "fetch:d646eba2d9be14dbe7a090f790f90fe7" as const

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

export interface OneshotPublicPortFetchOptions {
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

export async function runOneShotPublicPortFetch(
  options: OneshotPublicPortFetchOptions,
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
  options: OneshotPublicPortFetchOptions,
): Promise<OneshotFetchCliResult> {
  try {
    const summary = await runOneShotPublicPortFetch(options)
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

export { summaryForStdout }
