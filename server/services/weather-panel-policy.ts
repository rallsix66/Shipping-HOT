import type { FeedItem, PortWeatherForecastRow, PortWeatherPanelState } from "@shared/shipping"

export const WEATHER_FORECAST_HORIZON_MS = 7 * 24 * 60 * 60 * 1000
export const WEATHER_FORECAST_STALE_MS = 6 * 60 * 60 * 1000
const HOUR_MS = 60 * 60 * 1000
/** History kept behind the display window so rolling 24h precipitation (WR-S05) can be evaluated near `now`. */
export const PRECIP_HISTORY_LOOKBACK_MS = 24 * HOUR_MS
/**
 * Hard cap on stored/read forecast rows per port (hourly + current) for the retention window
 * [now - 1h - 24h, now + 7d] (= 193 whole hours + current). Applied only AFTER window filtering and
 * always drops the oldest rows first, so future hours at the window end are never squeezed out.
 */
export const FORECAST_RETENTION_LIMIT = 7 * 24 + 24 + 8

export function forecastRetentionWindow(nowMs: number): { startMs: number, endMs: number } {
  return { startMs: nowMs - HOUR_MS - PRECIP_HISTORY_LOOKBACK_MS, endMs: nowMs + WEATHER_FORECAST_HORIZON_MS }
}

/** Filter to the retention window first, sort ascending, then cap by dropping the OLDEST rows. */
export function selectForecastRetention<T>(items: readonly T[], instantOf: (item: T) => string, nowMs: number, limit = FORECAST_RETENTION_LIMIT): T[] {
  const { startMs, endMs } = forecastRetentionWindow(nowMs)
  const inWindow = items
    .map(item => ({ item, t: Date.parse(instantOf(item)) }))
    .filter(({ t }) => Number.isFinite(t) && t >= startMs && t <= endMs)
    .sort((a, b) => a.t - b.t)
    .map(({ item }) => item)
  return inWindow.length > limit ? inWindow.slice(inWindow.length - limit) : inWindow
}
export const WEATHER_IMPACT_DISPLAY_LIMIT = 48
/** Max hourly steps returned for the 7-day port panel (full window, not a preview cap). */
export const PORT_WEATHER_FORECAST_DISPLAY_LIMIT = 7 * 24 + 4

const severityRank = { critical: 4, warning: 3, watch: 2, info: 1 } as const

export function severitySortRank(severity: string): number {
  return severityRank[severity as keyof typeof severityRank] ?? 0
}

export function isForecastInstantInWindow(instantMs: number, nowMs: number): boolean {
  return instantMs >= nowMs - 60 * 60 * 1000 && instantMs <= nowMs + WEATHER_FORECAST_HORIZON_MS
}

/** Impact is active when asOf ∈ [validFrom, validUntil]. */
export function isWeatherImpactActiveAt(asOfMs: number, validFromIso: string, validUntilIso: string): boolean {
  const from = Date.parse(validFromIso)
  const until = Date.parse(validUntilIso)
  if (!Number.isFinite(from) || !Number.isFinite(until)) return false
  return asOfMs >= from && asOfMs <= until
}

export function forecastHasMeasurableFields(row: PortWeatherForecastRow): boolean {
  return row.windGustKmh !== undefined
    || row.windSpeedKmh !== undefined
    || row.waveHeightM !== undefined
    || row.swellWaveHeightM !== undefined
    || row.precipitationMm !== undefined
    || row.visibilityM !== undefined
}

export function resolvePortWeatherPanelState(input: {
  nowMs: number
  inWindowForecastCount: number
  storedForecastCount: number
  measurableForecastCount: number
  activeImpactCount: number
  latestFetchedAtMs?: number
  weatherFeedHealthy: boolean
  unevaluatedRuleCount: number
  evaluatedRuleCount: number
}): PortWeatherPanelState {
  if (!input.weatherFeedHealthy) return "sync_failed"
  if (input.storedForecastCount === 0) return "data_empty"
  if (input.measurableForecastCount === 0) return "data_insufficient"
  if (input.latestFetchedAtMs === undefined || input.nowMs - input.latestFetchedAtMs > WEATHER_FORECAST_STALE_MS) {
    return "data_stale"
  }
  if (input.inWindowForecastCount === 0) return "data_stale"
  const hasUnevaluated = input.unevaluatedRuleCount > 0
  const hasEvaluated = input.evaluatedRuleCount > 0
  if (input.activeImpactCount === 0) {
    if (hasUnevaluated && hasEvaluated) return "partial_rule_coverage"
    if (hasUnevaluated && !hasEvaluated) return "partial_rule_coverage"
    return "no_rule_hits"
  }
  if (hasUnevaluated) return "partial_rule_coverage"
  return "ready"
}

export function portWeatherFeedHealthy(feedItems: FeedItem[], portId: string, weatherSourceId: string): boolean {
  const items = feedItems.filter(item => item.sourceId === weatherSourceId && item.relatedPortIds.includes(portId))
  if (!items.length) return true
  return items.some(item => item.sourceStatus === "healthy" && !item.stale)
}
