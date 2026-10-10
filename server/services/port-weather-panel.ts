import type { FeedItem, PortWeatherPanelNotice, PortWeatherPanelResponse, PortWeatherPanelState } from "@shared/shipping"
import { isOfficialWeatherAlertFeedItem } from "#/providers/shipping"
import type { ShippingRepository } from "#/database/shipping"
import {
  PORT_WEATHER_FORECAST_DISPLAY_LIMIT,
  WEATHER_FORECAST_HORIZON_MS,
  WEATHER_IMPACT_DISPLAY_LIMIT,
  forecastHasMeasurableFields,
  isForecastInstantInWindow,
  portWeatherFeedHealthy,
  resolvePortWeatherPanelState,
} from "#/services/weather-panel-policy"

export interface PortWeatherPanelOptions {
  now?: Date
  weatherSourceId?: string
}

function panelNoticeForState(
  state: PortWeatherPanelState,
  showingHistoricalData: boolean,
  referenceFetchedAt?: string,
  referenceComputedAt?: string,
): PortWeatherPanelNotice | undefined {
  if (!showingHistoricalData && state === "ready") return undefined
  if (state === "ready" && !showingHistoricalData) return undefined
  const fetchedLabel = referenceFetchedAt ? `获取于 ${referenceFetchedAt}` : "获取时间未知"
  const messages: Record<PortWeatherPanelState, string> = {
    ready: `以下为历史结果（${fetchedLabel}），当前状态：可用。`,
    no_rule_hits: `有效窗口内无规则命中（${fetchedLabel}）；不含已实施封港结论。`,
    data_stale: `预报已过期（${fetchedLabel}）；以下为旧结果，请重新同步。`,
    data_empty: "暂无持久化预报。",
    data_insufficient: `测值不足（${fetchedLabel}）；无法判断规则命中。`,
    sync_failed: `天气同步失败（${fetchedLabel}）；以下为上次成功写入的旧结果。`,
  }
  return {
    code: state,
    messageZh: messages[state],
    referenceFetchedAt,
    referenceComputedAt,
    showingHistoricalData,
  }
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
  const horizonEnd = new Date(nowMs + WEATHER_FORECAST_HORIZON_MS).toISOString()
  const weatherSourceId = options.weatherSourceId ?? "open-meteo-marine"

  const storedForecasts = await repository.listWeatherForecastsForPort(portId, 7 * 24 + 4)
  const inWindowForecasts = storedForecasts.filter((row) => {
    const t = Date.parse(row.forecastAt)
    return Number.isFinite(t) && isForecastInstantInWindow(t, nowMs)
  })
  const latestFetchedAtMs = storedForecasts.reduce<number | undefined>((latest, row) => {
    const t = Date.parse(row.fetchedAt)
    if (!Number.isFinite(t)) return latest
    return latest === undefined || t > latest ? t : latest
  }, undefined)
  const referenceFetchedAt = latestFetchedAtMs === undefined ? undefined : new Date(latestFetchedAtMs).toISOString()

  const displayForecasts = (inWindowForecasts.length > 0
    ? inWindowForecasts
    : storedForecasts.slice(-PORT_WEATHER_FORECAST_DISPLAY_LIMIT)).slice(0, PORT_WEATHER_FORECAST_DISPLAY_LIMIT)

  const measurableForecastCount = displayForecasts.filter(forecastHasMeasurableFields).length
  const totalMatched = await repository.countWeatherImpactsActiveInHorizon(portId, asOf, horizonEnd)
  const impacts = await repository.listWeatherImpactsForPortRanked(
    portId,
    asOf,
    horizonEnd,
    WEATHER_IMPACT_DISPLAY_LIMIT,
  )

  const state = resolvePortWeatherPanelState({
    nowMs,
    inWindowForecastCount: inWindowForecasts.length,
    storedForecastCount: storedForecasts.length,
    measurableForecastCount,
    activeImpactCount: totalMatched,
    latestFetchedAtMs,
    weatherFeedHealthy: portWeatherFeedHealthy(feedItems, portId, weatherSourceId),
  })

  const showingHistoricalData = displayForecasts.length > 0
    && (state === "data_stale" || state === "sync_failed" || state === "data_insufficient" || inWindowForecasts.length === 0)

  const referenceComputedAt = impacts[0]?.computedAt ?? storedForecasts.at(-1)?.fetchedAt

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

  const panelNotice = panelNoticeForState(
    state,
    showingHistoricalData || (state !== "ready" && state !== "data_empty"),
    referenceFetchedAt,
    referenceComputedAt,
  )

  return {
    portId,
    state,
    asOf,
    forecasts: displayForecasts,
    impacts,
    panelNotice,
    displayMeta: {
      forecastLimit: PORT_WEATHER_FORECAST_DISPLAY_LIMIT,
      impactLimit: WEATHER_IMPACT_DISPLAY_LIMIT,
      forecastsReturned: displayForecasts.length,
      impactsReturned: impacts.length,
    },
    impactMeta: {
      totalMatched,
      returned: impacts.length,
      truncated: totalMatched > impacts.length,
    },
    officialAlerts,
    sources: {
      forecast: displayForecasts.length ? forecastSourceLabel : "暂无有效窗口内预报",
      impacts: "system",
      alerts: officialAlerts.length ? alertsSourceLabel : "未启用或未命中官方预警",
    },
  }
}
