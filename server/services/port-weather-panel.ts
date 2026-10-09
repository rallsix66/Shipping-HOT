import type { FeedItem, PortWeatherForecastRow, PortWeatherPanelResponse } from "@shared/shipping"
import { isOfficialWeatherAlertFeedItem } from "#/providers/shipping"
import type { ShippingRepository } from "#/database/shipping"
import {
  WEATHER_FORECAST_HORIZON_MS,
  WEATHER_IMPACT_DISPLAY_LIMIT,
  isForecastInstantInWindow,
  portWeatherFeedHealthy,
  resolvePortWeatherPanelState,
} from "#/services/weather-panel-policy"

export interface PortWeatherPanelOptions {
  now?: Date
  weatherSourceId?: string
}

export async function getPortWeatherPanel(
  repository: ShippingRepository,
  portId: string,
  feedItems: FeedItem[],
  forecastSourceLabel: string,
  alertsSourceLabel: string,
  options: PortWeatherPanelOptions = {},
): Promise<PortWeatherPanelResponse> {
  const now = options.now ?? new Date()
  const nowMs = now.getTime()
  const asOf = now.toISOString()
  const windowStart = new Date(nowMs - 60 * 60 * 1000).toISOString()
  const windowEnd = new Date(nowMs + WEATHER_FORECAST_HORIZON_MS).toISOString()
  const weatherSourceId = options.weatherSourceId ?? "open-meteo-marine"

  const storedForecasts = await repository.listWeatherForecastsForPort(portId)
  const forecasts = storedForecasts.filter((row) => {
    const t = Date.parse(row.forecastAt)
    return Number.isFinite(t) && isForecastInstantInWindow(t, nowMs)
  }) as PortWeatherForecastRow[]

  const totalMatched = await repository.countWeatherImpactsForPortInWindow(portId, windowStart, windowEnd)
  const impacts = await repository.listWeatherImpactsForPortRanked(
    portId,
    asOf,
    windowStart,
    windowEnd,
    WEATHER_IMPACT_DISPLAY_LIMIT,
  )

  const latestFetchedAtMs = forecasts.reduce<number | undefined>((latest, row) => {
    const t = Date.parse(row.fetchedAt)
    if (!Number.isFinite(t)) return latest
    return latest === undefined || t > latest ? t : latest
  }, undefined)

  const state = resolvePortWeatherPanelState({
    nowMs,
    forecastCount: forecasts.length,
    matchedImpactCount: totalMatched,
    latestFetchedAtMs,
    weatherFeedHealthy: portWeatherFeedHealthy(feedItems, portId, weatherSourceId),
  })

  const officialAlerts = feedItems
    .filter(item => isOfficialWeatherAlertFeedItem(item) && item.relatedPortIds.includes(portId))
    .slice(0, 6)
    .map(item => ({
      id: item.id,
      title: item.title,
      summary: item.summary,
      severity: item.severity,
      publishedAt: item.publishedAt,
      sourceId: item.sourceId,
      provenance: item.provenance,
    }))

  return {
    portId,
    state,
    asOf,
    forecasts,
    impacts,
    impactMeta: {
      totalMatched,
      returned: impacts.length,
      truncated: totalMatched > impacts.length,
    },
    officialAlerts,
    sources: {
      forecast: forecasts.length ? forecastSourceLabel : "暂无有效窗口内预报",
      impacts: "system",
      alerts: officialAlerts.length ? alertsSourceLabel : "未启用或未命中官方预警",
    },
  }
}
