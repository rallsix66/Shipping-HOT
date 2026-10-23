/**
 * DeepSeek Tools Search/Fetch HTTP client (injected fetcher).
 * No SecretStore, no DB, no persistence — pure request/response validation.
 */
import { ProviderRejectedError } from "#/intel/llm/receipts"

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
  text: () => Promise<string>
  headers: { get: (name: string) => string | null }
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

function assertQuery(query: string): string {
  if (typeof query !== "string") throw new DeepSeekToolsClientError("invalid_query", "query must be a string")
  const trimmed = query.trim()
  if (!trimmed) throw new DeepSeekToolsClientError("invalid_query", "query must be non-empty")
  if ([...trimmed].length > 128) throw new DeepSeekToolsClientError("invalid_query", "query exceeds 128 Unicode characters")
  return trimmed
}

function assertCount(count: number | undefined): number {
  if (count === undefined) return 10
  if (!Number.isInteger(count) || count < 1 || count > 50) {
    throw new DeepSeekToolsClientError("invalid_count", "count must be an integer in 1..50")
  }
  return count
}

/** Syntactic public-URL gate (no DNS). Rejects userinfo, non-http(s), localhost, obvious private/literal hosts. */
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
  const host = url.hostname.toLowerCase()
  if (!host) throw new DeepSeekToolsClientError("invalid_url", "url host required")
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host === "0.0.0.0") {
    throw new DeepSeekToolsClientError("url_blocked", `host not publicly sendable: ${host}`)
  }
  if (host === "metadata.google.internal" || host === "metadata") {
    throw new DeepSeekToolsClientError("url_blocked", `host not publicly sendable: ${host}`)
  }
  // Literal IPv4 private / loopback / link-local / docs ranges (no DNS).
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)) {
    const parts = host.split(".").map(Number)
    const [a, b] = parts
    const blocked
      = a === 0 || a === 10 || a === 127 || a === 224 || a >= 240
        || (a === 169 && b === 254)
        || (a === 172 && b >= 16 && b <= 31)
        || (a === 192 && b === 168)
        || (a === 100 && b >= 64 && b <= 127)
        || (a === 192 && b === 0)
        || (a === 198 && (b === 18 || b === 19))
    if (blocked) throw new DeepSeekToolsClientError("url_blocked", `literal address not publicly sendable: ${host}`)
  }
  if (host.includes(":")) {
    // IPv6 literals: reject loopback/link-local/unique-local heuristically.
    if (host === "::1" || host.startsWith("fe80:") || host.startsWith("fc") || host.startsWith("fd") || host.startsWith("::ffff:")) {
      throw new DeepSeekToolsClientError("url_blocked", `IPv6 address not publicly sendable: ${host}`)
    }
  }
  return url
}

function mapHttpError(status: number, bodyText: string): never {
  const snippet = bodyText.slice(0, 200)
  // Clear non-billable / non-retryable per official docs → ProviderRejectedError (receipt books 0).
  if (status === 400 || status === 401 || status === 402 || status === 403 || status === 404) {
    throw new ProviderRejectedError(`deepseek_tools_http_${status}: ${snippet}`, status, false)
  }
  if (status === 429 || status >= 500) {
    throw new ProviderRejectedError(`deepseek_tools_http_${status}: ${snippet}`, status, true)
  }
  throw new ProviderRejectedError(`deepseek_tools_http_${status}: ${snippet}`, status, false)
}

async function postJson<T>(
  fetcher: InjectedFetcher,
  path: string,
  apiKey: string,
  body: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<T> {
  if (!apiKey || typeof apiKey !== "string") throw new DeepSeekToolsClientError("auth_failed", "api key required")
  // Defence: never allow localization in the outbound body even if a caller stuffed it.
  const { localization: _drop, ...safe } = body as Record<string, unknown> & { localization?: unknown }
  void _drop
  const response = await fetcher(`${DEEPSEEK_TOOLS_BASE}${path}`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "Accept": "application/json",
    },
    body: JSON.stringify(safe),
    signal,
  })
  const text = await response.text()
  if (!response.ok) mapHttpError(response.status, text)
  let parsed: unknown
  try {
    parsed = JSON.parse(text) as unknown
  } catch {
    throw new ProviderRejectedError("deepseek_tools_invalid_json", response.status, false)
  }
  return parsed as T
}

export async function deepSeekSearch(
  req: DeepSeekSearchRequest,
  options: { apiKey: string, fetcher: InjectedFetcher, signal?: AbortSignal },
): Promise<DeepSeekSearchResponse> {
  const query = assertQuery(req.query)
  const count = assertCount(req.count)
  const need_content = req.need_content === true
  const raw = await postJson<Record<string, unknown>>(options.fetcher, DEEPSEEK_SEARCH_PATH, options.apiKey, {
    query,
    count,
    need_content,
  }, options.signal)
  const results = Array.isArray(raw.results) ? raw.results as DeepSeekSearchResultItem[] : []
  return { results }
}

export async function deepSeekFetch(
  req: DeepSeekFetchRequest,
  options: { apiKey: string, fetcher: InjectedFetcher, signal?: AbortSignal },
): Promise<DeepSeekFetchResponse> {
  const url = assertPublicHttpUrl(req.url)
  const raw = await postJson<Record<string, unknown>>(options.fetcher, DEEPSEEK_FETCH_PATH, options.apiKey, {
    url: url.toString(),
  }, options.signal)
  const title = typeof raw.title === "string" ? raw.title : ""
  const content = typeof raw.content === "string" ? raw.content : ""
  if (!content) {
    // HTTP 200 with empty body: treat as clear non-billable empty outcome for the service layer.
    return { title, content: "" }
  }
  return { title, content }
}

export function buildSearchRequestBody(req: DeepSeekSearchRequest): Record<string, unknown> {
  return {
    query: assertQuery(req.query),
    count: assertCount(req.count),
    need_content: req.need_content === true,
  }
}
