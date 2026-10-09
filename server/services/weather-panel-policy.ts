import type { FeedItem, PortWeatherPanelState } from "@shared/shipping"

export const WEATHER_FORECAST_HORIZON_MS = 7 * 24 * 60 * 60 * 1000
export const WEATHER_FORECAST_STALE_MS = 6 * 60 * 60 * 1000
export const WEATHER_IMPACT_DISPLAY_LIMIT = 48

const severityRank = { critical: 4, warning: 3, watch: 2, info: 1 } as const

export function severitySortRank(severity: string): number {
  return severityRank[severity as keyof typeof severityRank] ?? 0
}

export function isForecastInstantInWindow(instantMs: number, nowMs: number): boolean {
  return instantMs >= nowMs - 60 * 60 * 1000 && instantMs <= nowMs + WEATHER_FORECAST_HORIZON_MS
}

export function isImpactInstantInWindow(instantMs: number, nowMs: number): boolean {
  return instantMs >= nowMs - 60 * 60 * 1000 && instantMs <= nowMs + WEATHER_FORECAST_HORIZON_MS
}

export function resolvePortWeatherPanelState(input: {
  nowMs: number
  forecastCount: number
  matchedImpactCount: number
  latestFetchedAtMs?: number
  weatherFeedHealthy: boolean
}): PortWeatherPanelState {
  if (!input.weatherFeedHealthy) return "sync_failed"
  if (input.forecastCount === 0) return "data_empty"
  if (input.latestFetchedAtMs === undefined || input.nowMs - input.latestFetchedAtMs > WEATHER_FORECAST_STALE_MS) {
    return "data_stale"
  }
  if (input.matchedImpactCount === 0) return "no_rule_hits"
  return "ready"
}

export function portWeatherFeedHealthy(feedItems: FeedItem[], portId: string, weatherSourceId: string): boolean {
  const items = feedItems.filter(item => item.sourceId === weatherSourceId && item.relatedPortIds.includes(portId))
  if (!items.length) return true
  return items.some(item => item.sourceStatus === "healthy" && !item.stale)
}
