/**
 * DeepSeek Tools Search/Fetch HTTP client (injected fetcher).
 * No SecretStore, no DB, no persistence — pure request/response validation.
 *
 * URL gate is syntactic only: reuses isBlockedAddress for literals after
 * normalizing brackets/trailing dots. Does NOT verify third-party DNS, resolved
 * IPs, or redirects (those remain unknown for remote Tools Fetch).
 */
import { Buffer } from "node:buffer"
import { ProviderRejectedError } from "#/intel/llm/receipts"
import { type ResolvedAddress, isBlockedAddress } from "#/services/article-fetch-security"

/** Hard cap when reading Search/Fetch HTTP bodies (bytes, UTF-8). Mirrored in policy module. */
export const DEEPSEEK_TOOLS_MAX_RESPONSE_BYTES = 512 * 1024

export const DEEPSEEK_TOOLS_BASE = "https://api.deepseek.com"
export const DEEPSEEK_SEARCH_PATH = "/v1/tools/search"
export const DEEPSEEK_FETCH_PATH = "/v1/tools/fetch"

export interface InjectedFetchInit {
  method?: string
  headers?: Record<string, string>
  body?: string
  signal?: AbortSignal
}

export interface InjectedFetchResponse {
  status: number
  ok: boolean
  headers: { get: (name: string) => string | null }
  /**
   * Read body with a hard byte cap. Implementations should stop reading once
   * maxBytes is exceeded (stream when possible). Oversize must reject.
   */
  readText: (maxBytes: number, signal?: AbortSignal) => Promise<string>
}

export type InjectedFetcher = (input: string, init?: InjectedFetchInit) => Promise<InjectedFetchResponse>

export class DeepSeekToolsClientError extends Error {
  readonly code: string
  constructor(code: string, message: string) {
    super(message)
    this.name = "DeepSeekToolsClientError"
    this.code = code
  }
}

/**
 * Thrown after the HTTP request was sent when the billable outcome cannot be
 * confirmed (invalid JSON/schema, oversize, abort). Receipts treat this as
 * unknown and keep the budget reservation — never as a free release.
 */
export class DeepSeekToolsOutcomeUnknownError extends Error {
  readonly code: string
  constructor(code: string) {
    super(code)
    this.name = "DeepSeekToolsOutcomeUnknownError"
    this.code = code
  }
}

export interface DeepSeekSearchRequest {
  query: string
  count?: number
  /** Product default: false. Must not be forced true by this client unless caller opts in. */
  need_content?: boolean
}

export interface DeepSeekSearchResultItem {
  title?: unknown
  url?: unknown
  snippet?: unknown
  summary?: unknown
  content?: unknown
  date?: unknown
  rerank_score?: unknown
  authority?: unknown
}

export interface DeepSeekSearchResponse {
  results: DeepSeekSearchResultItem[]
}

export interface DeepSeekFetchRequest {
  url: string
}

export interface DeepSeekFetchResponse {
  title: string
  content: string
}

export function assertQuery(query: string): string {
  if (typeof query !== "string") throw new DeepSeekToolsClientError("invalid_query", "query must be a string")
  const trimmed = query.trim()
  if (!trimmed) throw new DeepSeekToolsClientError("invalid_query", "query must be non-empty")
  if ([...trimmed].length > 128) throw new DeepSeekToolsClientError("invalid_query", "query exceeds 128 Unicode characters")
  return trimmed
}

export function assertCount(count: number | undefined): number {
  if (count === undefined) return 10
  if (!Number.isInteger(count) || count < 1 || count > 50) {
    throw new DeepSeekToolsClientError("invalid_count", "count must be an integer in 1..50")
  }
  return count
}

/** Normalize hostname: strip optional brackets and trailing DNS dots. */
export function normalizeHostname(hostname: string): string {
  let host = hostname.trim().toLowerCase()
  if (host.startsWith("[") && host.endsWith("]")) host = host.slice(1, -1)
  while (host.endsWith(".")) host = host.slice(0, -1)
  return host
}

function asLiteralAddress(host: string): ResolvedAddress | null {
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)) return { address: host, family: 4 }
  if (host.includes(":")) return { address: host, family: 6 }
  return null
}

/**
 * Syntactic public-URL gate (no DNS). Reuses audited isBlockedAddress for
 * literal IPv4/IPv6 (incl. mapped). Rejects userinfo, non-http(s), localhost
 * (incl. trailing-dot), metadata hosts. Does not claim to know third-party
 * resolution or redirects.
 */
export function assertPublicHttpUrl(raw: string): URL {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > 8192) {
    throw new DeepSeekToolsClientError("invalid_url", "url must be a non-empty string ≤8192 chars")
  }
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new DeepSeekToolsClientError("invalid_url", "url is not absolute")
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new DeepSeekToolsClientError("invalid_url", "url must be http or https")
  }
  if (url.username || url.password) {
    throw new DeepSeekToolsClientError("invalid_url", "url must not carry userinfo")
  }
  const host = normalizeHostname(url.hostname)
  if (!host) throw new DeepSeekToolsClientError("invalid_url", "url host required")
  if (
    host === "localhost"
    || host.endsWith(".localhost")
    || host.endsWith(".local")
    || host === "0.0.0.0"
    || host === "metadata.google.internal"
    || host === "metadata"
  ) {
    throw new DeepSeekToolsClientError("url_blocked", "host not publicly sendable")
  }
  const literal = asLiteralAddress(host)
  if (literal && isBlockedAddress(literal)) {
    throw new DeepSeekToolsClientError("url_blocked", "literal address not publicly sendable")
  }
  return url
}

/** Fixed-code HTTP rejection — never attach response body, credentials, or upstream text. */
function mapHttpError(status: number): never {
  const code = `deepseek_tools_http_${status}`
  if (status === 400 || status === 401 || status === 402 || status === 403 || status === 404) {
    throw new ProviderRejectedError(code, status, false)
  }
  if (status === 429 || status >= 500) {
    throw new ProviderRejectedError(code, status, true)
  }
  throw new ProviderRejectedError(code, status, false)
}

/** Fixed unknown codes allowed through transport catch — always rebuilt, never rethrown. */
const TRANSPORT_OUTCOME_CODES = new Set([
  "request_aborted",
  "request_failed",
])

/** Fixed unknown codes allowed through readText catch — always rebuilt, never rethrown. */
const READ_OUTCOME_CODES = new Set([
  "request_aborted",
  "response_too_large",
  "response_read_failed",
])

function readErrorCode(error: unknown): string | null {
  if (error == null || typeof error !== "object") return null
  const code = (error as { code?: unknown }).code
  return typeof code === "string" ? code : null
}

/**
 * Never rethrow typed errors as-is: code/message/cause may carry secrets.
 * Rebuild OutcomeUnknown from a fixed whitelist only.
 */
function remapTransportError(error: unknown, signal?: AbortSignal): never {
  if (signal?.aborted) throw new DeepSeekToolsOutcomeUnknownError("request_aborted")
  const code = readErrorCode(error)
  if (code && TRANSPORT_OUTCOME_CODES.has(code)) {
    throw new DeepSeekToolsOutcomeUnknownError(code)
  }
  throw new DeepSeekToolsOutcomeUnknownError("request_failed")
}

function remapReadTextError(error: unknown, signal?: AbortSignal): never {
  if (signal?.aborted) throw new DeepSeekToolsOutcomeUnknownError("request_aborted")
  const code = readErrorCode(error)
  if (code && READ_OUTCOME_CODES.has(code)) {
    throw new DeepSeekToolsOutcomeUnknownError(code)
  }
  throw new DeepSeekToolsOutcomeUnknownError("response_read_failed")
}

async function postJson(
  fetcher: InjectedFetcher,
  path: string,
  apiKey: string,
  body: Record<string, unknown>,
  options: { signal?: AbortSignal, maxBytes?: number },
): Promise<unknown> {
  if (!apiKey || typeof apiKey !== "string") throw new DeepSeekToolsClientError("auth_failed", "api key required")
  const { localization: _drop, ...safe } = body as Record<string, unknown> & { localization?: unknown }
  void _drop
  const maxBytes = options.maxBytes ?? DEEPSEEK_TOOLS_MAX_RESPONSE_BYTES
  let response: InjectedFetchResponse
  try {
    response = await fetcher(`${DEEPSEEK_TOOLS_BASE}${path}`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "Accept": "application/json",
      },
      body: JSON.stringify(safe),
      signal: options.signal,
    })
  } catch (error) {
    // Never rethrow: typed errors may carry arbitrary code/message/cause.
    remapTransportError(error, options.signal)
  }
  let text: string
  try {
    text = await response.readText(maxBytes, options.signal)
  } catch (error) {
    remapReadTextError(error, options.signal)
  }
  if (!response.ok) {
    // Drain happened; never pass body into the rejection message.
    void text
    mapHttpError(response.status)
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(text) as unknown
  } catch {
    throw new DeepSeekToolsOutcomeUnknownError("invalid_json")
  }
  return parsed
}

function parseSearchResponse(raw: unknown): DeepSeekSearchResponse {
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new DeepSeekToolsOutcomeUnknownError("invalid_schema")
  }
  const record = raw as Record<string, unknown>
  if (!("results" in record) || !Array.isArray(record.results)) {
    throw new DeepSeekToolsOutcomeUnknownError("invalid_schema")
  }
  return { results: record.results as DeepSeekSearchResultItem[] }
}

function parseFetchResponse(raw: unknown): DeepSeekFetchResponse {
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new DeepSeekToolsOutcomeUnknownError("invalid_schema")
  }
  const record = raw as Record<string, unknown>
  if (!("content" in record) || typeof record.content !== "string") {
    throw new DeepSeekToolsOutcomeUnknownError("invalid_schema")
  }
  if ("title" in record && record.title != null && typeof record.title !== "string") {
    throw new DeepSeekToolsOutcomeUnknownError("invalid_schema")
  }
  return {
    title: typeof record.title === "string" ? record.title : "",
    content: record.content,
  }
}

export async function deepSeekSearch(
  req: DeepSeekSearchRequest,
  options: { apiKey: string, fetcher: InjectedFetcher, signal?: AbortSignal, maxBytes?: number },
): Promise<DeepSeekSearchResponse> {
  const query = assertQuery(req.query)
  const count = assertCount(req.count)
  const need_content = req.need_content === true
  const raw = await postJson(options.fetcher, DEEPSEEK_SEARCH_PATH, options.apiKey, {
    query,
    count,
    need_content,
  }, { signal: options.signal, maxBytes: options.maxBytes })
  return parseSearchResponse(raw)
}

export async function deepSeekFetch(
  req: DeepSeekFetchRequest,
  options: { apiKey: string, fetcher: InjectedFetcher, signal?: AbortSignal, maxBytes?: number },
): Promise<DeepSeekFetchResponse> {
  const url = assertPublicHttpUrl(req.url)
  const raw = await postJson(options.fetcher, DEEPSEEK_FETCH_PATH, options.apiKey, {
    url: url.toString(),
  }, { signal: options.signal, maxBytes: options.maxBytes })
  return parseFetchResponse(raw)
}

export function buildSearchRequestBody(req: DeepSeekSearchRequest): Record<string, unknown> {
  return {
    query: assertQuery(req.query),
    count: assertCount(req.count),
    need_content: req.need_content === true,
  }
}

/** Helper for tests / adapters: wrap a full string as a capped readText body. */
export function staticReadText(body: string): InjectedFetchResponse["readText"] {
  return async (maxBytes, signal) => {
    if (signal?.aborted) throw new DeepSeekToolsOutcomeUnknownError("request_aborted")
    if (Buffer.byteLength(body, "utf8") > maxBytes) {
      throw new DeepSeekToolsOutcomeUnknownError("response_too_large")
    }
    return body
  }
}
