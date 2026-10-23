/**
 * Default-off DeepSeek Tools Search/Fetch service.
 * Gates enabled+budget BEFORE SecretStore / paidRequest.
 * Reuses paid_receipt BEGIN IMMEDIATE reserve; response DTOs never carry bodies.
 */
import type { Database } from "db0"
import { type TrimmedFetchMeta, type TrimmedSearchCandidate, receiptPayloadHasBodyLeak, trimFetchMeta, trimSearchCandidates } from "./candidate-trim"
import {
  DEEPSEEK_FETCH_CAPABILITY,
  DEEPSEEK_SEARCH_CAPABILITY,
  DEEPSEEK_SEARCH_DEFAULT_COUNT,
  DEEPSEEK_SEARCH_DEFAULT_NEED_CONTENT,
  DEEPSEEK_SEARCH_FETCH_CURRENCY,
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
  type InjectedFetcher,
  assertPublicHttpUrl,
  deepSeekFetch,
  deepSeekSearch,
} from "#/providers/deepseek/search-fetch-client"

export type IntelPersistence = "full" | "excerpt_only" | "disallowed"

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
  /** CNY monthly budget for deepseek_search. null/undefined/≤0 → no call. */
  monthlyBudgetSearch?: number | null
  /** CNY monthly budget for deepseek_fetch. null/undefined/≤0 → no call. */
  monthlyBudgetFetch?: number | null
  fetcher?: InjectedFetcher
  now?: () => Date
  timeoutMs?: number
}

export interface SearchInput {
  query: string
  count?: number
  purpose: string
  subject?: string | null
  /** Opt-in only; product default false. */
  needContent?: boolean
}

export interface FetchInput {
  url: string
  purpose: string
  subject?: string | null
  persistence: IntelPersistence
}

export interface SearchOutcome {
  receiptId: string
  reused: boolean
  candidates: TrimmedSearchCandidate[]
  billable: boolean
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

function assertBudget(budget: number | null | undefined, capability: string): number {
  if (budget == null || !(typeof budget === "number") || !Number.isFinite(budget) || budget <= 0) {
    throw new PaidGateError(budget === 0 ? "paid_budget_zero" : "paid_budget_unconfigured")
  }
  void capability
  return budget
}

function toInjectedFetcher(fetcher: InjectedFetcher | undefined): InjectedFetcher {
  if (fetcher) return fetcher
  // Default global fetch adapter — only reached after enabled+budget gates.
  return async (input, init) => {
    const response = await fetch(input, {
      method: init?.method,
      headers: init?.headers,
      body: init?.body,
      signal: init?.signal,
    })
    return {
      status: response.status,
      ok: response.ok,
      text: () => response.text(),
      headers: { get: (name: string) => response.headers.get(name) },
    }
  }
}

function searchIdentity(input: SearchInput) {
  const query = normalizeQuery(input.query)
  const count = input.count ?? DEEPSEEK_SEARCH_DEFAULT_COUNT
  const need_content = input.needContent === true
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

function paidCtx(config: SearchFetchServiceConfig, monthlyBudget: number): PaidRequestContext {
  return {
    db: config.db,
    secretStore: config.secretStore,
    monthlyBudget,
    currency: DEEPSEEK_SEARCH_FETCH_CURRENCY,
    now: config.now,
    timeoutMs: config.timeoutMs,
  }
}

function mapClientError(error: unknown): never {
  if (error instanceof DeepSeekToolsClientError) {
    if (error.code === "url_blocked" || error.code === "invalid_url") {
      throw new SearchFetchPolicyError(error.code, error.message)
    }
    throw new SearchFetchPolicyError(error.code, error.message)
  }
  throw error
}

export async function runDeepSeekSearch(config: SearchFetchServiceConfig, input: SearchInput): Promise<SearchOutcome> {
  assertEnabled(config)
  const budget = assertBudget(config.monthlyBudgetSearch, DEEPSEEK_SEARCH_CAPABILITY)
  const identity = searchIdentity(input)
  if (!identity.query) throw new SearchFetchPolicyError("invalid_query", "query must be non-empty")

  const fetcher = toInjectedFetcher(config.fetcher)
  const result: ReceiptResult = await paidRequest(
    paidCtx(config, budget),
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
        }, { apiKey, fetcher })
      } catch (error) {
        mapClientError(error)
      }
      const candidates = trimSearchCandidates(response.results)
      const billable = candidates.length > 0
      return {
        response: { candidates, billable },
        cost: {
          amount: billable ? DEEPSEEK_SEARCH_FETCH_UNIT_COST_CNY : 0,
          currency: DEEPSEEK_SEARCH_FETCH_CURRENCY,
          basis: "estimated",
        },
      }
    },
  )

  const payload = result.response as { candidates: TrimmedSearchCandidate[], billable: boolean }
  if (receiptPayloadHasBodyLeak(payload) || receiptPayloadHasBodyLeak(result)) {
    throw new SearchFetchPolicyError("body_leak", "search receipt payload must not carry body fields")
  }
  return {
    receiptId: result.receiptId,
    reused: result.reused,
    candidates: payload.candidates ?? [],
    billable: Boolean(payload.billable),
  }
}

export async function runDeepSeekFetch(config: SearchFetchServiceConfig, input: FetchInput): Promise<FetchOutcome> {
  assertEnabled(config)
  // Security / license fail-closed before SecretStore or HTTP.
  if (input.persistence === "disallowed") {
    throw new SearchFetchPolicyError("persistence_disallowed", "Fetch refused: persistence disallowed (no preview bypass)")
  }
  let canonical: URL
  try {
    canonical = assertPublicHttpUrl(input.url)
  } catch (error) {
    mapClientError(error)
  }
  const budget = assertBudget(config.monthlyBudgetFetch, DEEPSEEK_FETCH_CAPABILITY)
  const identity = fetchIdentity(input, canonical.toString())
  const fetcher = toInjectedFetcher(config.fetcher)

  let freshBody: DeepSeekFetchResponse | undefined
  const result: ReceiptResult = await paidRequest(
    paidCtx(config, budget),
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
      },
      estimatedCost: DEEPSEEK_SEARCH_FETCH_UNIT_COST_CNY,
    },
    async (apiKey) => {
      let response: DeepSeekFetchResponse
      try {
        response = await deepSeekFetch({ url: canonical.toString() }, { apiKey, fetcher })
      } catch (error) {
        mapClientError(error)
      }
      const meta = trimFetchMeta(canonical.toString(), response)
      const billable = !meta.empty
      // Hold body only in-process for the fresh return; receipt stores meta only.
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
}

export { DEEPSEEK_SEARCH_FETCH_UNIT_COST_CNY, DEEPSEEK_SEARCH_FETCH_POLICY_VERSION, DEEPSEEK_SEARCH_DEFAULT_NEED_CONTENT }
