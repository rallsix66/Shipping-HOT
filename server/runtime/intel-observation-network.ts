import { createHash } from "node:crypto"
import { Buffer } from "node:buffer"
import { PRODUCTION_ALLOW_SELECT_CATALOG_IDS } from "./intel-allow-select"
import type { IntelFetchDeps } from "#/intel/collect"
import { registeredIntelSources } from "#/intel/sources/registry"
import { isBlockedAddress } from "#/services/article-fetch-security"

export interface IntelObservationConfig {
  sourceIds: string[]
  durationMs: number
  maxHttpRequests: number
  approvedRedirects: { from: string, to: string }[]
  /** When set, the existing observer stops after this many successful source rounds, or on the first failed round. */
  stopAfterSuccessfulRounds?: 1 | 2
}
const ALLOW_SELECT = new Set<string>(PRODUCTION_ALLOW_SELECT_CATALOG_IDS)

function selectedEntries(sourceIds: string[]) {
  return sourceIds.map((id) => {
    const seed = registeredIntelSources.find(row => row.catalogId === id)
    if (!seed) throw new Error("observation_sources_invalid")
    return seed.url
  })
}
export type ObservationEvent = Record<string, unknown> & { type: string }
const redirects = new Set([301, 302, 303, 307, 308])
const digest = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex")

export function validateObservationConfig(input: IntelObservationConfig): IntelObservationConfig {
  if (!input || Object.keys(input).some(key => !["sourceIds", "durationMs", "maxHttpRequests", "approvedRedirects", "stopAfterSuccessfulRounds"].includes(key))) throw new Error("observation_config_invalid")
  if (!Array.isArray(input.sourceIds) || !input.sourceIds.length || new Set(input.sourceIds).size !== input.sourceIds.length || input.sourceIds.some(id => !ALLOW_SELECT.has(id))) throw new Error("observation_sources_invalid")
  if (input.stopAfterSuccessfulRounds !== undefined && input.stopAfterSuccessfulRounds !== 1 && input.stopAfterSuccessfulRounds !== 2) throw new Error("observation_round_bound_invalid")
  if (!Number.isSafeInteger(input.durationMs) || input.durationMs <= 0 || input.durationMs > 24 * 60 * 60 * 1000) throw new Error("observation_duration_invalid")
  if (!Number.isSafeInteger(input.maxHttpRequests) || input.maxHttpRequests < 0 || input.maxHttpRequests > 200) throw new Error("observation_budget_invalid")
  if (!Array.isArray(input.approvedRedirects) || input.approvedRedirects.length > 6) throw new Error("observation_redirects_invalid")
  const reachable = new Set(selectedEntries(input.sourceIds))
  const edges = new Set<string>()
  for (const edge of input.approvedRedirects) {
    if (!edge || Object.keys(edge).sort().join(",") !== "from,to" || typeof edge.from !== "string" || typeof edge.to !== "string") throw new Error("observation_redirects_invalid")
    const from = new URL(edge.from)
    const to = new URL(edge.to)
    if (!reachable.has(edge.from) || to.href !== edge.to || to.protocol !== "https:" || to.hostname !== from.hostname || to.username || to.password || to.hash || to.port || edge.from === edge.to || Array.from(to.searchParams.keys()).some(key => /key|token|secret|password|auth|credential|signature|cookie|csrf/i.test(key))) throw new Error("observation_redirects_invalid")
    const key = JSON.stringify([edge.from, edge.to])
    if (edges.has(key)) throw new Error("observation_redirects_invalid")
    edges.add(key)
    reachable.add(edge.to)
  }
  return { sourceIds: [...input.sourceIds], durationMs: input.durationMs, maxHttpRequests: input.maxHttpRequests, approvedRedirects: input.approvedRedirects.map(edge => ({ ...edge })), ...(input.stopAfterSuccessfulRounds ? { stopAfterSuccessfulRounds: input.stopAfterSuccessfulRounds } : {}) }
}

/** One run-wide boundary around the existing transport, not a fetcher or scheduler. */
export function createObservationNetwork(options: {
  config: IntelObservationConfig
  fetch: IntelFetchDeps
  startedAt: number
  now: () => number
  record: (event: ObservationEvent) => void
  onStop: () => void
}) {
  const config = validateObservationConfig(options.config)
  const until = options.startedAt + config.durationMs
  const urls = new Set(selectedEntries(config.sourceIds))
  const edges = new Set(config.approvedRedirects.map(edge => JSON.stringify([edge.from, edge.to])))
  for (const edge of config.approvedRedirects) urls.add(edge.to)
  const hosts = new Set(Array.from(urls, value => new URL(value).hostname))
  const requestAbort = new AbortController()
  const collectionAbort = new AbortController()
  let reason: string | undefined
  const stopReasons: string[] = []
  let lastNow = options.startedAt
  let reservations = 0
  let httpRequests = 0
  let dnsRequests = 0
  let redirectResponses = 0

  function stop(code: string, hard = true) {
    const first = !reason
    reason ??= code
    if (!stopReasons.includes(code)) stopReasons.push(code)
    collectionAbort.abort()
    if (hard) requestAbort.abort()
    if (first) options.onStop()
  }
  function record(event: ObservationEvent) {
    try {
      options.record(event)
    } catch {
      stop("ledger_failed")
      throw new Error("observation_ledger_failed")
    }
  }
  function deadline() {
    const at = options.now()
    if (at < lastNow) stop("clock_reversed")
    lastNow = at
    if (at >= until) stop("deadline")
    if (requestAbort.signal.aborted) throw new Error(`observation_${reason}`)
    return at
  }
  function check() {
    deadline()
    if (reservations >= config.maxHttpRequests) stop("http_budget", false)
    if (reason) throw new Error(`observation_${reason}`)
  }
  const fetch: IntelFetchDeps = {
    async lookup(host) {
      check()
      if (!hosts.has(host)) {
        stop("host_out_of_scope")
        throw new Error("observation_host_out_of_scope")
      }
      dnsRequests++
      record({ type: "dns_started", host, number: dnsRequests })
      const addresses = await options.fetch.lookup(host)
      check()
      if (addresses.some(isBlockedAddress)) {
        stop("unsafe_address")
        throw new Error("observation_unsafe_address")
      }
      record({ type: "dns_completed", host, addresses: addresses.map(row => ({ ...row })) })
      return addresses
    },
    async transport(url, addresses, transportOptions) {
      check()
      if (!urls.has(url.href)) {
        stop("url_out_of_scope")
        throw new Error("observation_url_out_of_scope")
      }
      if (!addresses.length || addresses.some(isBlockedAddress)) {
        stop("unsafe_address")
        throw new Error("observation_unsafe_address")
      }
      // No await between the shared budget test and reservation: concurrent calls cannot overshoot.
      const number = ++reservations
      record({ type: "http_reserved", number, url: url.href })
      if (reservations === config.maxHttpRequests) stop("http_budget", false)
      const at = deadline()
      const signal = transportOptions.signal ? AbortSignal.any([transportOptions.signal, requestAbort.signal]) : requestAbort.signal
      try {
        httpRequests++
        const pending = options.fetch.transport(url, addresses, { ...transportOptions, signal, timeoutMs: Math.min(transportOptions.timeoutMs, Math.max(1, until - at)) })
        void pending.catch(() => {}) // A ledger failure can abort before the await below.
        // Reservation is durable before delegation. A crash is never resumed with a fresh budget.
        record({ type: "http_started", number, url: url.href })
        const response = await pending
        deadline()
        const bytes = typeof response.body === "string" ? Buffer.from(response.body, "utf8") : response.body
        record({ type: "http_completed", number, status: response.status, bytes: bytes.byteLength, wireSha256: digest(bytes) })
        if (redirects.has(response.status)) {
          redirectResponses++
          const raw = response.headers.location ?? response.headers.Location
          const location = Array.isArray(raw) ? raw[0] : raw
          let approved = false
          try {
            approved = Boolean(location && edges.has(JSON.stringify([url.href, new URL(location, url).href])))
          } catch { /* no target is followed */ }
          record({ type: "redirect", number, approved, locationSha256: location ? digest(location) : null })
          if (!approved) {
            stop("redirect_unapproved")
            throw new Error("observation_redirect_unapproved")
          }
        }
        return response
      } catch (error) {
        record({ type: "http_failed", number, aborted: requestAbort.signal.aborted, stopReasons: [...stopReasons] })
        throw error
      }
    },
  }
  return {
    fetch,
    collectionSignal: collectionAbort.signal,
    stop,
    check,
    snapshot: () => ({ reason: reason ?? null, stopReasons: [...stopReasons], reservations, httpRequests, dnsRequests, redirectResponses, startedAt: options.startedAt, until, hardAborted: requestAbort.signal.aborted }),
  }
}
