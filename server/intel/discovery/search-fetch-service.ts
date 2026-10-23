/**
 * Default-off DeepSeek Tools Search/Fetch service.
 * Gates enabled+budget BEFORE SecretStore / paidRequest.
 * Reuses paid_receipt BEGIN IMMEDIATE reserve; response DTOs never carry bodies.
 *
 * Target URL review is syntactic only (assertPublicHttpUrl / isBlockedAddress).
 * Persistence license never substitutes for that review. This service does not
 * verify third-party DNS, resolved IPs, or redirects.
 */
import { Buffer } from "node:buffer"
import type { Database } from "db0"
import { type TrimmedFetchMeta, type TrimmedSearchCandidate, receiptPayloadHasBodyLeak, trimFetchMeta, trimSearchCandidates } from "./candidate-trim"
import {
  DEEPSEEK_FETCH_CAPABILITY,
  DEEPSEEK_SEARCH_CAPABILITY,
  DEEPSEEK_SEARCH_DEFAULT_COUNT,
  DEEPSEEK_SEARCH_DEFAULT_NEED_CONTENT,
  DEEPSEEK_SEARCH_FETCH_CURRENCY,
  DEEPSEEK_SEARCH_FETCH_DEFAULT_TIMEOUT_MS,
  DEEPSEEK_SEARCH_FETCH_MAX_RESPONSE_BYTES,
  DEEPSEEK_SEARCH_FETCH_POLICY_VERSION,
  DEEPSEEK_SEARCH_FETCH_PROVIDER_ID,
  DEEPSEEK_SEARCH_FETCH_UNIT_COST_CNY,
} from "./deepseek-search-fetch-policy"
import type { SecretStore } from "#/providers/contracts"
import {
  PaidGateError,
  type PaidRequestContext,
  type ReceiptResult,
  paidRequest,
} from "#/intel/llm/receipts"
import {
  type DeepSeekFetchResponse,
  DeepSeekToolsClientError,
  DeepSeekToolsOutcomeUnknownError,
  type InjectedFetchResponse,
  type InjectedFetcher,
  assertCount,
  assertPublicHttpUrl,
  assertQuery,
  deepSeekFetch,
  deepSeekSearch,
} from "#/providers/deepseek/search-fetch-client"

export type IntelPersistence = "full" | "excerpt_only" | "disallowed"

/** Explicit target-security review outcome. Persistence never implies this. */
export type FetchTargetReview =
  | { status: "syntactically_allowed", canonicalUrl: string }
  | { status: "locally_rejected", code: string, message: string }

export class SearchFetchDisabledError extends Error {
  readonly code = "search_fetch_disabled" as const
  constructor(message = "DeepSeek Search/Fetch is default-off") {
    super(message)
    this.name = "SearchFetchDisabledError"
  }
}

export class SearchFetchPolicyError extends Error {
  readonly code: string
  constructor(code: string, message: string) {
    super(message)
    this.name = "SearchFetchPolicyError"
    this.code = code
  }
}

export interface SearchFetchServiceConfig {
  db: Database
  secretStore: SecretStore
  /** Product default false. When false, never touch SecretStore or HTTP. */
  enabled?: boolean
  /** CNY monthly budget for deepseek_search only (not shared with fetch). */
  monthlyBudgetSearch?: number | null
  /** CNY monthly budget for deepseek_fetch only (not shared with search). */
  monthlyBudgetFetch?: number | null
  fetcher?: InjectedFetcher
  now?: () => Date
  /** Total deadline for one paid call; default DEEPSEEK_SEARCH_FETCH_DEFAULT_TIMEOUT_MS. */
  timeoutMs?: number
  /** Optional outer cancel; combined with the service timeout. */
  signal?: AbortSignal
}

export interface SearchInput {
  query: string
  count?: number
  purpose: string
  subject?: string | null
  /** Opt-in only; product default false. */
  needContent?: boolean
  signal?: AbortSignal
}

export interface FetchInput {
  url: string
  purpose: string
  subject?: string | null
  persistence: IntelPersistence
  /**
   * Optional prior local security decision. If `locally_rejected`, refuse before
   * any third-party call even when persistence would otherwise allow storage.
   * Persistence alone never bypasses review.
   */
  targetReview?: FetchTargetReview
  signal?: AbortSignal
}

export interface SearchOutcome {
  receiptId: string
  reused: boolean
  candidates: TrimmedSearchCandidate[]
  billable: boolean
  /** Upstream result row count before trim (drives billing). */
  upstreamResultCount: number
}

export interface FetchOutcome {
  receiptId: string
  reused: boolean
  meta: TrimmedFetchMeta
  billable: boolean
  /**
   * In-process only on a fresh (non-reused) billable call. Never written to receipt/cache/logs.
   * Absent on reuse and on empty results.
   */
  content?: string
  title?: string
}

function normalizeQuery(query: string): string {
  return query.trim().replace(/\s+/g, " ")
}

function assertEnabled(config: SearchFetchServiceConfig): void {
  if (config.enabled !== true) throw new SearchFetchDisabledError()
}

function assertBudget(budget: number | null | undefined, _capability: string): number {
  if (budget == null || !(typeof budget === "number") || !Number.isFinite(budget) || budget <= 0) {
    throw new PaidGateError(budget === 0 ? "paid_budget_zero" : "paid_budget_unconfigured")
  }
  return budget
}

/** Syntactic URL review. Does not verify third-party DNS/IP/redirects. */
export function reviewFetchTarget(url: string): FetchTargetReview {
  try {
    const canonical = assertPublicHttpUrl(url)
    return { status: "syntactically_allowed", canonicalUrl: canonical.toString() }
  } catch (error) {
    if (error instanceof DeepSeekToolsClientError) {
      return { status: "locally_rejected", code: error.code, message: error.message }
    }
    throw error
  }
}

async function readResponseBodyLimited(
  response: Response,
  maxBytes: number,
  signal?: AbortSignal,
): Promise<string> {
  if (signal?.aborted) throw new DeepSeekToolsOutcomeUnknownError("request_aborted")
  if (!response.body || typeof response.body.getReader !== "function") {
    const text = await response.text()
    if (Buffer.byteLength(text, "utf8") > maxBytes) {
      throw new DeepSeekToolsOutcomeUnknownError("response_too_large")
    }
    return text
  }
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    while (true) {
      if (signal?.aborted) {
        await reader.cancel().catch(() => undefined)
        throw new DeepSeekToolsOutcomeUnknownError("request_aborted")
      }
      const { done, value } = await reader.read()
      if (done) break
      if (!value) continue
      total += value.byteLength
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined)
        throw new DeepSeekToolsOutcomeUnknownError("response_too_large")
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  return Buffer.concat(chunks).toString("utf8")
}

function toInjectedFetcher(fetcher: InjectedFetcher | undefined): InjectedFetcher {
  if (fetcher) return fetcher
  return async (input, init) => {
    const response = await fetch(input, {
      method: init?.method,
      headers: init?.headers,
      body: init?.body,
      signal: init?.signal,
    })
    const adapted: InjectedFetchResponse = {
      status: response.status,
      ok: response.ok,
      headers: { get: (name: string) => response.headers.get(name) },
      readText: (maxBytes, signal) => readResponseBodyLimited(response, maxBytes, signal ?? init?.signal),
    }
    return adapted
  }
}

function searchIdentity(input: SearchInput, query: string, count: number, need_content: boolean) {
  return {
    policyVersion: DEEPSEEK_SEARCH_FETCH_POLICY_VERSION,
    capability: DEEPSEEK_SEARCH_CAPABILITY,
    query,
    count,
    need_content,
  }
}

function fetchIdentity(input: FetchInput, canonicalUrl: string) {
  return {
    policyVersion: DEEPSEEK_SEARCH_FETCH_POLICY_VERSION,
    capability: DEEPSEEK_FETCH_CAPABILITY,
    url: canonicalUrl,
    persistence: input.persistence,
    converter: "deepseek_tools_fetch",
  }
}

function resolveTimeoutMs(config: SearchFetchServiceConfig): number {
  const raw = config.timeoutMs
  if (raw == null) return DEEPSEEK_SEARCH_FETCH_DEFAULT_TIMEOUT_MS
  if (!Number.isFinite(raw) || raw <= 0) return DEEPSEEK_SEARCH_FETCH_DEFAULT_TIMEOUT_MS
  return raw
}

function paidCtx(config: SearchFetchServiceConfig, monthlyBudget: number, timeoutMs: number): PaidRequestContext {
  return {
    db: config.db,
    secretStore: config.secretStore,
    monthlyBudget,
    currency: DEEPSEEK_SEARCH_FETCH_CURRENCY,
    now: config.now,
    timeoutMs,
  }
}

function mapClientError(error: unknown): never {
  if (error instanceof DeepSeekToolsOutcomeUnknownError) throw error
  if (error instanceof DeepSeekToolsClientError) {
    throw new SearchFetchPolicyError(error.code, error.message)
  }
  throw error
}

/** Combine service timeout with optional caller signals into one AbortSignal. */
function createCallSignal(
  timeoutMs: number,
  ...outers: Array<AbortSignal | undefined>
): { signal: AbortSignal, dispose: () => void } {
  const ac = new AbortController()
  const timer = setTimeout(() => {
    ac.abort()
  }, timeoutMs)
  const onAbort = () => {
    ac.abort()
  }
  const attached: AbortSignal[] = []
  for (const outer of outers) {
    if (!outer) continue
    if (outer.aborted) {
      onAbort()
      break
    }
    outer.addEventListener("abort", onAbort, { once: true })
    attached.push(outer)
  }
  return {
    signal: ac.signal,
    dispose: () => {
      clearTimeout(timer)
      for (const outer of attached) outer.removeEventListener("abort", onAbort)
    },
  }
}

export async function runDeepSeekSearch(config: SearchFetchServiceConfig, input: SearchInput): Promise<SearchOutcome> {
  assertEnabled(config)
  // Full input validation BEFORE paidRequest — bad params must not create unknown receipts.
  let query: string
  let count: number
  try {
    query = normalizeQuery(assertQuery(input.query))
    count = assertCount(input.count ?? DEEPSEEK_SEARCH_DEFAULT_COUNT)
  } catch (error) {
    mapClientError(error)
  }
  const need_content = input.needContent === true
  const budget = assertBudget(config.monthlyBudgetSearch, DEEPSEEK_SEARCH_CAPABILITY)
  const identity = searchIdentity(input, query, count, need_content)
  const timeoutMs = resolveTimeoutMs(config)
  const fetcher = toInjectedFetcher(config.fetcher)
  const { signal, dispose } = createCallSignal(timeoutMs, config.signal, input.signal)

  try {
    const result: ReceiptResult = await paidRequest(
      paidCtx(config, budget, timeoutMs),
      {
        providerId: DEEPSEEK_SEARCH_FETCH_PROVIDER_ID,
        capability: DEEPSEEK_SEARCH_CAPABILITY,
        model: null,
        purpose: input.purpose,
        subject: input.subject ?? null,
        identity,
        requestSummary: {
          policyVersion: identity.policyVersion,
          query: identity.query,
          count: identity.count,
          need_content: identity.need_content,
        },
        estimatedCost: DEEPSEEK_SEARCH_FETCH_UNIT_COST_CNY,
      },
      async (apiKey) => {
        let response
        try {
          response = await deepSeekSearch({
            query: identity.query,
            count: identity.count,
            need_content: identity.need_content,
          }, {
            apiKey,
            fetcher,
            signal,
            maxBytes: DEEPSEEK_SEARCH_FETCH_MAX_RESPONSE_BYTES,
          })
        } catch (error) {
          mapClientError(error)
        }
        // Bill from upstream non-empty results, not post-trim candidate count.
        const upstreamResultCount = response.results.length
        const candidates = trimSearchCandidates(response.results)
        const billable = upstreamResultCount > 0
        return {
          response: { candidates, billable, upstreamResultCount },
          cost: {
            amount: billable ? DEEPSEEK_SEARCH_FETCH_UNIT_COST_CNY : 0,
            currency: DEEPSEEK_SEARCH_FETCH_CURRENCY,
            basis: "estimated",
          },
        }
      },
    )

    const payload = result.response as {
      candidates: TrimmedSearchCandidate[]
      billable: boolean
      upstreamResultCount: number
    }
    if (receiptPayloadHasBodyLeak(payload) || receiptPayloadHasBodyLeak(result)) {
      throw new SearchFetchPolicyError("body_leak", "search receipt payload must not carry body fields")
    }
    return {
      receiptId: result.receiptId,
      reused: result.reused,
      candidates: payload.candidates ?? [],
      billable: Boolean(payload.billable),
      upstreamResultCount: Number(payload.upstreamResultCount ?? 0),
    }
  } finally {
    dispose()
  }
}

export async function runDeepSeekFetch(config: SearchFetchServiceConfig, input: FetchInput): Promise<FetchOutcome> {
  assertEnabled(config)
  // Persistence license is not a security approval and never bypasses target review.
  if (input.persistence === "disallowed") {
    throw new SearchFetchPolicyError("persistence_disallowed", "Fetch refused: persistence disallowed (no preview bypass)")
  }
  if (input.targetReview?.status === "locally_rejected") {
    throw new SearchFetchPolicyError(
      input.targetReview.code || "url_blocked",
      "Fetch refused: target already locally rejected (persistence cannot bypass)",
    )
  }

  const reviewed = input.targetReview?.status === "syntactically_allowed"
    ? input.targetReview
    : reviewFetchTarget(input.url)
  if (reviewed.status === "locally_rejected") {
    throw new SearchFetchPolicyError(reviewed.code, reviewed.message)
  }

  const budget = assertBudget(config.monthlyBudgetFetch, DEEPSEEK_FETCH_CAPABILITY)
  const identity = fetchIdentity(input, reviewed.canonicalUrl)
  const timeoutMs = resolveTimeoutMs(config)
  const fetcher = toInjectedFetcher(config.fetcher)
  const { signal, dispose } = createCallSignal(timeoutMs, config.signal, input.signal)

  let freshBody: DeepSeekFetchResponse | undefined
  try {
    const result: ReceiptResult = await paidRequest(
      paidCtx(config, budget, timeoutMs),
      {
        providerId: DEEPSEEK_SEARCH_FETCH_PROVIDER_ID,
        capability: DEEPSEEK_FETCH_CAPABILITY,
        model: null,
        purpose: input.purpose,
        subject: input.subject ?? null,
        identity,
        requestSummary: {
          policyVersion: identity.policyVersion,
          url: identity.url,
          persistence: identity.persistence,
          converter: identity.converter,
          targetReview: "syntactically_allowed",
        },
        estimatedCost: DEEPSEEK_SEARCH_FETCH_UNIT_COST_CNY,
      },
      async (apiKey) => {
        let response: DeepSeekFetchResponse
        try {
          response = await deepSeekFetch({ url: reviewed.canonicalUrl }, {
            apiKey,
            fetcher,
            signal,
            maxBytes: DEEPSEEK_SEARCH_FETCH_MAX_RESPONSE_BYTES,
          })
        } catch (error) {
          mapClientError(error)
        }
        const meta = trimFetchMeta(reviewed.canonicalUrl, response)
        const billable = !meta.empty
        freshBody = response
        return {
          response: { meta, billable },
          cost: {
            amount: billable ? DEEPSEEK_SEARCH_FETCH_UNIT_COST_CNY : 0,
            currency: DEEPSEEK_SEARCH_FETCH_CURRENCY,
            basis: "estimated",
          },
        }
      },
    )

    const payload = result.response as { meta: TrimmedFetchMeta, billable: boolean }
    if (receiptPayloadHasBodyLeak(payload) || receiptPayloadHasBodyLeak(result)) {
      throw new SearchFetchPolicyError("body_leak", "fetch receipt payload must not carry body fields")
    }
    const outcome: FetchOutcome = {
      receiptId: result.receiptId,
      reused: result.reused,
      meta: payload.meta,
      billable: Boolean(payload.billable),
    }
    if (!result.reused && freshBody && !payload.meta.empty) {
      outcome.content = freshBody.content
      outcome.title = freshBody.title
    }
    return outcome
  } finally {
    dispose()
  }
}

export {
  DEEPSEEK_SEARCH_FETCH_UNIT_COST_CNY,
  DEEPSEEK_SEARCH_FETCH_POLICY_VERSION,
  DEEPSEEK_SEARCH_DEFAULT_NEED_CONTENT,
}
