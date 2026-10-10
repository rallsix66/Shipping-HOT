import type {
  FeedItem,
  PortWeatherForecastMeta,
  PortWeatherPanelNotice,
  PortWeatherPanelResponse,
  PortWeatherPanelState,
  PortWeatherPrecipCoverage,
} from "@shared/shipping"
import { portDirectoryBaseline } from "@shared/port-directory"
import { isOfficialWeatherAlertFeedItem } from "#/providers/shipping"
import type { ShippingRepository } from "#/database/shipping"
import {
  PRECIP_24H_FULL_HOURLY_SAMPLES,
  PRECIP_24H_PARTIAL_MIN_HOURLY_SAMPLES,
  type Precipitation24hResult,
} from "#/services/precipitation-window"
import { evaluateOfficialAlertImpactRules } from "#/services/official-alert-impact"
import { resolveTyphoonInputForImpactInterval } from "#/services/typhoon-wr-s03-resolve"
import { evaluatePortWeatherCoverageAt } from "#/services/weather-rule-evaluation"
import {
  FORECAST_RETENTION_LIMIT,
  PORT_WEATHER_FORECAST_DISPLAY_LIMIT,
  WEATHER_FORECAST_HORIZON_MS,
  WEATHER_IMPACT_DISPLAY_LIMIT,
  forecastHasMeasurableFields,
  forecastRetentionWindow,
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
    partial_rule_coverage: `部分规则因输入缺测或未接入分支尚未评估（${fetchedLabel}）；18–23/24 小时降水仅作参考，不能当作完整 24 小时 WR-S05 判定。`,
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

function toPanelPrecipCoverage(result: Precipitation24hResult): PortWeatherPrecipCoverage {
  return {
    hourlySamplesInWindow: result.hourlySamplesInWindow,
    fullRequired: PRECIP_24H_FULL_HOURLY_SAMPLES,
    partialMinimum: PRECIP_24H_PARTIAL_MIN_HOURLY_SAMPLES,
    status: result.status,
    totalMm: result.totalMm,
    partialSumMm: result.partialSumMm,
  }
}

const emptyPrecipCoverage: PortWeatherPrecipCoverage = {
  hourlySamplesInWindow: 0,
  fullRequired: PRECIP_24H_FULL_HOURLY_SAMPLES,
  partialMinimum: PRECIP_24H_PARTIAL_MIN_HOURLY_SAMPLES,
  status: "insufficient",
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
  const portBaseline = portDirectoryBaseline.find(row => row.shippingPortId === portId)

  // Window first ([now-1h-24h precip lookback, now+7d]), then cap (drops oldest). Only when nothing is in
  // that window do we fall back to the most recent stored rows for the stale/historical display.
  const retention = forecastRetentionWindow(nowMs)
  const windowedForecasts = await repository.listWeatherForecastsForPortInRange(
    portId,
    new Date(retention.startMs).toISOString(),
    new Date(retention.endMs).toISOString(),
    FORECAST_RETENTION_LIMIT,
  )
  const storedForecasts = windowedForecasts.length > 0
    ? windowedForecasts
    : await repository.listLatestWeatherForecastsForPort(portId, PORT_WEATHER_FORECAST_DISPLAY_LIMIT)
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
    : storedForecasts.slice(-PORT_WEATHER_FORECAST_DISPLAY_LIMIT))
    .sort((a, b) => Date.parse(a.forecastAt) - Date.parse(b.forecastAt))

  const measurableForecastCount = (inWindowForecasts.length > 0 ? inWindowForecasts : displayForecasts)
    .filter(forecastHasMeasurableFields)
    .length

  const hourlyInWindow = displayForecasts.filter(row => row.horizon === "hourly")
  const currentInWindow = displayForecasts.filter(row => row.horizon === "current")
  const missingCounts = {
    windGust: hourlyInWindow.filter(row => row.windGustKmh === undefined).length,
    wave: hourlyInWindow.filter(row => row.waveHeightM === undefined && row.swellWaveHeightM === undefined).length,
    precipitation: hourlyInWindow.filter(row => row.precipitationMm === undefined).length,
    visibility: hourlyInWindow.filter(row => row.visibilityM === undefined).length,
  }
  const sortedInstants = displayForecasts
    .map(row => Date.parse(row.forecastAt))
    .filter(ms => Number.isFinite(ms))
    .sort((a, b) => a - b)
  const marineAllMissing = hourlyInWindow.length > 0
    && hourlyInWindow.every(row => row.waveHeightM === undefined && row.swellWaveHeightM === undefined)
    && hourlyInWindow.some(row => row.windGustKmh !== undefined)
  const forecastMeta: PortWeatherForecastMeta = {
    targetWindow: {
      start: new Date(nowMs - 60 * 60 * 1000).toISOString(),
      end: horizonEnd,
    },
    actualCoverage: {
      firstInstant: sortedInstants.length ? new Date(sortedInstants[0]).toISOString() : undefined,
      lastInstant: sortedInstants.length ? new Date(sortedInstants[sortedInstants.length - 1]).toISOString() : undefined,
      totalReturned: displayForecasts.length,
      hourlyReturned: hourlyInWindow.length,
      currentReturned: currentInWindow.length,
    },
    sourceId: displayForecasts[0]?.sourceId,
    fetchedAt: referenceFetchedAt,
    missingCounts,
    marineCoverageNote: marineAllMissing && portBaseline?.unlocode === "VNSGN"
      ? "Open-Meteo marine（cell_selection=sea）在胡志明市坐标未返回浪高/涌浪；非填 0，WR-S02 等海况分支可能缺测。"
      : marineAllMissing
        ? "Open-Meteo marine 未返回浪高/涌浪测值（cell_selection=sea 近岸/内河坐标常见）。"
        : undefined,
  }
  const totalMatched = await repository.countWeatherImpactsActiveInHorizon(portId, asOf, horizonEnd)
  const impacts = await repository.listWeatherImpactsForPortRanked(
    portId,
    asOf,
    horizonEnd,
    WEATHER_IMPACT_DISPLAY_LIMIT,
  )

  const typhoonSync = await repository.getTropicalCycloneSyncMeta({ nowMs })
  const storedCyclones = await repository.listNormalizedTropicalCyclones()
  const portCoord = portBaseline
    ? {
        portId,
        unlocode: portBaseline.unlocode,
        latitude: portBaseline.latitude,
        longitude: portBaseline.longitude,
      }
    : undefined
  const resolveTyphoon = (validFrom: string, validUntil: string) => {
    if (!portCoord) return { status: "unavailable" as const }
    return resolveTyphoonInputForImpactInterval(typhoonSync, storedCyclones, portCoord, validFrom, validUntil, nowMs)
  }
  const coverageEval = evaluatePortWeatherCoverageAt(
    storedForecasts,
    asOf,
    { status: "unavailable" },
    resolveTyphoon,
  )
  const ruleCoverage = coverageEval?.ruleCoverage ?? []
  const precipCoverage = coverageEval ? toPanelPrecipCoverage(coverageEval.precipCoverage) : emptyPrecipCoverage
  const unevaluatedRuleCount = ruleCoverage.filter(entry => entry.evaluation === "unevaluated").length
  const evaluatedRuleCount = ruleCoverage.filter(entry => entry.evaluation === "evaluated").length

  const state = resolvePortWeatherPanelState({
    nowMs,
    inWindowForecastCount: inWindowForecasts.length,
    storedForecastCount: storedForecasts.length,
    measurableForecastCount,
    activeImpactCount: totalMatched,
    latestFetchedAtMs,
    weatherFeedHealthy: portWeatherFeedHealthy(feedItems, portId, weatherSourceId),
    unevaluatedRuleCount,
    evaluatedRuleCount,
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

  const officialAlertImpacts = evaluateOfficialAlertImpactRules(feedItems, {
    portId,
    countryCode: portBaseline?.countryCode,
    nowMs,
  })

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
    forecastMeta,
    impacts,
    ruleCoverage,
    precipCoverage,
    typhoonSync,
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
    officialAlertImpacts,
    sources: {
      forecast: displayForecasts.length ? forecastSourceLabel : "暂无有效窗口内预报",
      impacts: "system",
      alerts: officialAlerts.length ? alertsSourceLabel : "未启用或未命中官方预警",
    },
  }
}
