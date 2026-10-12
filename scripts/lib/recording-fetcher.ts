// Recording fetcher for isolated live probes. It passes the provider's RequestInit through unchanged
// (notably `redirect: "error"` for CAP bodies), adds a timeout signal, and preserves the final response URL and
// `redirected` flag so the provider's redirect checks still apply. Every request is logged with the redirect
// policy that was actually requested, the final URL and whether a redirect happened.
import type { WeatherAlertFetcher } from "#/providers/weather-alerts"

export interface RecordedRequest {
  url: string
  requestedRedirect: string
  status?: number
  finalUrl?: string
  redirected?: boolean
  bytes?: number
  error?: string
  at: string
}

export interface FetchLikeResponse {
  ok: boolean
  status: number
  url: string
  redirected: boolean
  text: () => Promise<string>
}

export type FetchLike = (url: string, init: { redirect?: "error" | "manual" | "follow", signal?: AbortSignal }) => Promise<FetchLikeResponse>

export function createRecordingFetcher(fetchImpl: FetchLike, log: RecordedRequest[], timeoutMs = 30_000, now: () => Date = () => new Date()): WeatherAlertFetcher {
  return async (url, init) => {
    const at = now().toISOString()
    const requestedRedirect = init?.redirect ?? "follow (fetch default)"
    try {
      const response = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(timeoutMs) })
      const body = await response.text()
      log.push({ url, requestedRedirect, status: response.status, finalUrl: response.url, redirected: response.redirected, bytes: body.length, at })
      return { ok: response.ok, status: response.status, url: response.url, redirected: response.redirected, text: async () => body }
    } catch (error) {
      log.push({ url, requestedRedirect, error: error instanceof Error ? error.message : String(error), at })
      throw error
    }
  }
}
