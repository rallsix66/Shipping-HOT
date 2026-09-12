import { Buffer } from "node:buffer"
import { lookup as dnsLookup } from "node:dns/promises"
import { request as httpRequest } from "node:http"
import { request as httpsRequest } from "node:https"
import type { ArticleSourcePolicy } from "@shared/article"
import { articlePolicyHostResolves } from "#/services/source-policy"

export const ARTICLE_FETCH_DEFAULTS = {
  maxBytes: 512 * 1024,
  timeoutMs: 10_000,
  maxRedirects: 3,
  maxConcurrency: 2,
} as const

export interface ResolvedAddress {
  address: string
  family: 4 | 6
}

export interface ArticleHttpResponse {
  status: number
  headers: Record<string, string | string[] | undefined>
  body: string
}

export type ArticleLookup = (hostname: string) => Promise<ResolvedAddress[]>
export type ArticleTransport = (
  url: URL,
  address: ResolvedAddress,
  options: { timeoutMs: number, maxBytes: number, headers: Record<string, string> },
) => Promise<ArticleHttpResponse>

export interface SecureFetchOptions {
  policy: ArticleSourcePolicy
  lookup?: ArticleLookup
  transport?: ArticleTransport
  maxBytes?: number
  timeoutMs?: number
  maxRedirects?: number
  signal?: AbortSignal
}

export interface SecureFetchSuccess {
  ok: true
  status: number
  finalUrl: string
  contentType?: string
  body: string
  hops: number
}

export interface SecureFetchFailure {
  ok: false
  code: string
  message: string
}

function ipv4ToInt(address: string): number | null {
  const parts = address.split(".")
  if (parts.length !== 4) return null
  let value = 0
  for (const part of parts) {
    const octet = Number(part)
    if (!Number.isInteger(octet) || octet < 0 || octet > 255) return null
    value = value * 256 + octet
  }
  return value >>> 0
}

const BLOCKED_V4_RANGES: ReadonlyArray<readonly [number, number]> = [
  ["0.0.0.0", "0.255.255.255"],
  ["10.0.0.0", "10.255.255.255"],
  ["100.64.0.0", "100.127.255.255"],
  ["127.0.0.0", "127.255.255.255"],
  ["169.254.0.0", "169.254.255.255"],
  ["172.16.0.0", "172.31.255.255"],
  ["192.0.0.0", "192.0.0.255"],
  ["192.0.2.0", "192.0.2.255"],
  ["192.88.99.0", "192.88.99.255"],
  ["192.168.0.0", "192.168.255.255"],
  ["198.18.0.0", "198.19.255.255"],
  ["198.51.100.0", "198.51.100.255"],
  ["203.0.113.0", "203.0.113.255"],
  ["224.0.0.0", "239.255.255.255"],
  ["240.0.0.0", "255.255.255.255"],
].map(([start, end]) => [ipv4ToInt(start)!, ipv4ToInt(end)!] as const)

function ipv4Blocked(value: number): boolean {
  return BLOCKED_V4_RANGES.some(([start, end]) => value >= start && value <= end)
}

function expandIpv6(address: string): number[] | null {
  let head = address
  const zone = head.indexOf("%")
  if (zone !== -1) head = head.slice(0, zone)
  if (head.includes(".")) {
    const lastColon = head.lastIndexOf(":")
    const v4 = ipv4ToInt(head.slice(lastColon + 1))
    if (v4 === null) return null
    head = `${head.slice(0, lastColon)}:${((v4 >>> 16) & 0xFFFF).toString(16)}:${(v4 & 0xFFFF).toString(16)}`
  }
  const doubleColon = head.indexOf("::")
  const left = doubleColon === -1 ? head.split(":") : head.slice(0, doubleColon).split(":")
  const right = doubleColon === -1 ? [] : head.slice(doubleColon + 2).split(":")
  const leftGroups = left.filter(Boolean)
  const rightGroups = right.filter(Boolean)
  const missing = 8 - leftGroups.length - rightGroups.length
  if (missing < 0) return null
  const groups = [...leftGroups, ...Array.from({ length: doubleColon === -1 ? 0 : missing }, () => "0"), ...rightGroups]
  if (groups.length !== 8) return null
  const parsed = groups.map(group => Number.parseInt(group || "0", 16))
  return parsed.some(value => !Number.isInteger(value) || value < 0 || value > 0xFFFF) ? null : parsed
}

/** True for loopback/private/link-local/multicast/metadata/special or unparseable addresses. */
export function isBlockedAddress(address: ResolvedAddress): boolean {
  if (address.family === 4) {
    const value = ipv4ToInt(address.address)
    return value === null ? true : ipv4Blocked(value)
  }
  const groups = expandIpv6(address.address)
  if (!groups) return true
  if (groups.slice(0, 5).every(group => group === 0) && groups[5] === 0xFFFF) {
    return ipv4Blocked(((groups[6] << 16) | groups[7]) >>> 0)
  }
  if (groups.every(group => group === 0)) return true
  if (groups.slice(0, 7).every(group => group === 0) && groups[7] === 1) return true
  const first = groups[0]
  if ((first & 0xFE00) === 0xFC00) return true
  if ((first & 0xFFC0) === 0xFE80) return true
  if ((first & 0xFF00) === 0xFF00) return true
  if (first === 0x2001 && groups[1] === 0x0DB8) return true
  if (first === 0x2002) return true
  return false
}

function failure(code: string, message: string): SecureFetchFailure {
  return { ok: false, code, message }
}

function headerValue(headers: ArticleHttpResponse["headers"], name: string): string | undefined {
  const value = headers[name] ?? headers[name.toLowerCase()]
  return Array.isArray(value) ? value[0] : value
}

function validateProtocol(url: URL, policy: ArticleSourcePolicy): SecureFetchFailure | undefined {
  if (url.protocol === "https:") return undefined
  if (url.protocol === "http:") return policy.allowHttp ? undefined : failure("http_not_allowed", "Plain HTTP is not allowed by the source policy")
  return failure("protocol_not_allowed", `Unsupported protocol: ${url.protocol}`)
}

async function defaultLookup(hostname: string): Promise<ResolvedAddress[]> {
  const results = await dnsLookup(hostname, { all: true })
  return results.map(entry => ({ address: entry.address, family: entry.family as 4 | 6 }))
}

function defaultTransport(url: URL, address: ResolvedAddress, options: { timeoutMs: number, maxBytes: number, headers: Record<string, string> }): Promise<ArticleHttpResponse> {
  return new Promise((resolve, reject) => {
    const request = (url.protocol === "https:" ? httpsRequest : httpRequest)(url, {
      method: "GET",
      headers: options.headers,
      timeout: options.timeoutMs,
      lookup: (_hostname, _options, callback) => callback(null, address.address, address.family),
    }, (response) => {
      const chunks: Buffer[] = []
      let total = 0
      response.on("data", (chunk: Buffer) => {
        total += chunk.length
        if (total > options.maxBytes) {
          response.destroy(new Error("body_too_large"))
          return
        }
        chunks.push(chunk)
      })
      response.on("end", () => resolve({ status: response.statusCode ?? 0, headers: response.headers, body: Buffer.concat(chunks).toString("utf8") }))
      response.on("error", reject)
    })
    request.on("timeout", () => request.destroy(new Error("fetch_timeout")))
    request.on("error", reject)
  })
}

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308])

/**
 * Connection-level SSRF-safe fetch. Every hop revalidates protocol, exact host,
 * DNS (all IPv4/IPv6 results) and binds the actual socket to the validated
 * public IP via a custom lookup; hostnames/SNI/cert verification are preserved
 * and redirects (including HTTPS→HTTP downgrade) are re-checked manually.
 */
export async function secureFetchArticle(target: string, options: SecureFetchOptions): Promise<SecureFetchSuccess | SecureFetchFailure> {
  const lookup = options.lookup ?? defaultLookup
  const transport = options.transport ?? defaultTransport
  const maxBytes = options.maxBytes ?? ARTICLE_FETCH_DEFAULTS.maxBytes
  const timeoutMs = options.timeoutMs ?? ARTICLE_FETCH_DEFAULTS.timeoutMs
  const maxRedirects = options.maxRedirects ?? ARTICLE_FETCH_DEFAULTS.maxRedirects
  const headers = {
    "user-agent": "shipping-hot-article/1.0",
    "accept": "text/html,application/xhtml+xml",
    "accept-encoding": "identity",
  }

  let current: URL
  try {
    current = new URL(target)
  } catch {
    return failure("invalid_url", "Article URL is not a valid absolute URL")
  }

  for (let hop = 0; hop <= maxRedirects; hop++) {
    if (current.username || current.password) return failure("credentials_not_allowed", "URL credentials are not allowed")
    const protocolError = validateProtocol(current, options.policy)
    if (protocolError) return protocolError
    if (!articlePolicyHostResolves(options.policy, current.hostname)) {
      return failure("host_not_allowed", `Host is not in the source policy allowlist: ${current.hostname}`)
    }
    let addresses: ResolvedAddress[]
    try {
      addresses = await lookup(current.hostname)
    } catch {
      return failure("dns_failed", `DNS resolution failed for ${current.hostname}`)
    }
    if (addresses.length === 0) return failure("dns_empty", `No addresses resolved for ${current.hostname}`)
    const blocked = addresses.find(isBlockedAddress)
    if (blocked) return failure("blocked_address", `Resolved address is not a public address: ${blocked.address}`)
    let response: ArticleHttpResponse
    try {
      response = await transport(current, addresses[0], { timeoutMs, maxBytes, headers })
    } catch (error) {
      const message = error instanceof Error ? error.message : "fetch failed"
      return failure(message === "body_too_large" ? "body_too_large" : message === "fetch_timeout" ? "fetch_timeout" : "fetch_failed", message)
    }
    if (REDIRECT_STATUSES.has(response.status)) {
      const location = headerValue(response.headers, "location")
      if (!location) return failure("redirect_without_location", "Redirect response had no Location header")
      if (hop === maxRedirects) return failure("redirect_limit", "Too many redirects")
      let next: URL
      try {
        next = new URL(location, current)
      } catch {
        return failure("invalid_redirect", "Redirect target is not a valid URL")
      }
      if (current.protocol === "https:" && next.protocol === "http:") return failure("https_downgrade", "HTTPS to HTTP redirect is not allowed")
      current = next
      continue
    }
    if (response.status >= 400) return failure("http_error", `Article request failed with status ${response.status}`)
    return { ok: true, status: response.status, finalUrl: current.toString(), contentType: headerValue(response.headers, "content-type"), body: response.body, hops: hop }
  }
  return failure("redirect_limit", "Too many redirects")
}
