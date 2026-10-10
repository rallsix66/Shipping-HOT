import type { PortWeatherForecastRow, TropicalCycloneSyncMeta } from "@shared/shipping"
import type { WeatherImpactRuleHit, WeatherRuleInputs } from "@shared/weather-impact"
import { windGustKmhToMs } from "@shared/weather-units"
import { evaluateWeatherImpactRules } from "#/services/weather-impact-engine"
import type { Precipitation24hResult, PrecipitationSample } from "#/services/precipitation-window"
import { precipitation24hEndingAtDetailed } from "#/services/precipitation-window"
import { impactValidityInterval } from "#/services/weather-impact-interval"
import { forecastRowsToOpenMeteoPoints } from "#/services/open-meteo-port-forecast"
import {
  TYPHOON_NO_STORM_DISTANCE_KM,
  type TyphoonInputState,
  buildRuleCoverageEntries,
  sanitizeWeatherRuleInputs,
} from "#/services/weather-rule-coverage"
import { isJmaTyphoonSyncTrustworthyForWrS03 } from "#/services/tropical-cyclone-freshness"

export type RuleEvaluationStatus = "evaluated" | "unevaluated"

export interface WeatherRuleCoverageEntry {
  ruleId: string
  evaluation: RuleEvaluationStatus
  reason?: string
}

export interface PointRuleEvaluation {
  hits: WeatherImpactRuleHit[]
  ruleCoverage: WeatherRuleCoverageEntry[]
  precipCoverage: Precipitation24hResult
}

export function evaluatePointWeatherRules(
  inputs: Omit<WeatherRuleInputs, "precipitationMm24h">,
  precipSamples: readonly PrecipitationSample[],
  atTimestamp: string,
  typhoon: TyphoonInputState = { status: "unavailable" },
): PointRuleEvaluation {
  const precipCoverage = precipitation24hEndingAtDetailed(precipSamples, atTimestamp)
  const rawInputs: WeatherRuleInputs = {
    ...inputs,
    precipitationMm24h: precipCoverage.status === "full" ? precipCoverage.totalMm : undefined,
    typhoonDistanceKm: typhoon.status === "checked" ? typhoon.distanceKm : undefined,
  }
  const sanitized = sanitizeWeatherRuleInputs(rawInputs)
  const engineHits = evaluateWeatherImpactRules(sanitized)
  const hitRuleIds = new Set(engineHits.map(hit => hit.ruleId))
  const ruleCoverage = buildRuleCoverageEntries(sanitized, rawInputs, precipCoverage, hitRuleIds, typhoon)
  const blockedRuleIds = new Set(ruleCoverage.filter(entry => entry.evaluation === "unevaluated").map(entry => entry.ruleId))
  const hits = engineHits.filter(hit => !blockedRuleIds.has(hit.ruleId))

  return { hits, ruleCoverage, precipCoverage }
}

export function forecastRowsToPrecipSamples(rows: readonly PortWeatherForecastRow[]): PrecipitationSample[] {
  return rows.map(row => ({
    timestamp: row.forecastAt,
    precipitationMm: row.precipitationMm,
    horizon: row.horizon,
  }))
}

function pickNearestForecastRow(rows: readonly PortWeatherForecastRow[], asOfMs: number): PortWeatherForecastRow | undefined {
  let best: PortWeatherForecastRow | undefined
  let bestDistance = Infinity
  for (const row of rows) {
    const instant = Date.parse(row.forecastAt)
    if (!Number.isFinite(instant)) continue
    const distance = Math.abs(instant - asOfMs)
    if (distance < bestDistance) {
      bestDistance = distance
      best = row
    } else if (distance === bestDistance && row.horizon === "current") {
      best = row
    }
  }
  return best
}

export function evaluatePortWeatherCoverageAt(
  forecasts: readonly PortWeatherForecastRow[],
  asOf: string,
  typhoon: TyphoonInputState = { status: "unavailable" },
  resolveTyphoon?: (validFrom: string, validUntil: string) => TyphoonInputState,
): PointRuleEvaluation | undefined {
  const asOfMs = Date.parse(asOf)
  if (!Number.isFinite(asOfMs)) return undefined
  const row = pickNearestForecastRow(forecasts, asOfMs)
  if (!row) return undefined
  const gustMs = row.windGustKmh === undefined ? undefined : windGustKmhToMs(row.windGustKmh)
  const waveM = row.waveHeightM ?? row.swellWaveHeightM
  let typhoonInput = typhoon
  if (resolveTyphoon) {
    const points = forecastRowsToOpenMeteoPoints(forecasts)
    const sorted = [...points].sort((a, b) => {
      const delta = Date.parse(a.timestamp) - Date.parse(b.timestamp)
      if (delta !== 0) return delta
      return a.horizon === "current" ? 1 : -1
    })
    const index = sorted.findIndex(point => point.timestamp === row.forecastAt && point.horizon === row.horizon)
    if (index >= 0) {
      const interval = impactValidityInterval(sorted[index], sorted, index)
      typhoonInput = resolveTyphoon(interval.validFrom, interval.validUntil)
    }
  }
  return evaluatePointWeatherRules({
    windGustMs: gustMs,
    waveHeightM: waveM,
    visibilityM: row.visibilityM,
  }, forecastRowsToPrecipSamples(forecasts), asOf, typhoonInput)
}

export function typhoonInputFromDistanceKm(distanceKm: number | undefined, syncChecked: boolean): TyphoonInputState {
  if (!syncChecked) return { status: "unavailable" }
  return { status: "checked", distanceKm: distanceKm ?? TYPHOON_NO_STORM_DISTANCE_KM }
}

export function typhoonInputFromSyncAndDistance(
  distanceKm: number | undefined,
  sync: TropicalCycloneSyncMeta,
  nowMs: number,
): TyphoonInputState {
  if (!isJmaTyphoonSyncTrustworthyForWrS03(sync, nowMs)) {
    return { status: "unavailable" }
  }
  if (sync.outcome === "ok_empty") {
    return { status: "checked", distanceKm: TYPHOON_NO_STORM_DISTANCE_KM }
  }
  if (distanceKm === undefined) {
    return { status: "unavailable" }
  }
  return { status: "checked", distanceKm }
}

export function mergeRuleCoverageSummaries(entries: readonly WeatherRuleCoverageEntry[]): WeatherRuleCoverageEntry[] {
  const byRule = new Map<string, WeatherRuleCoverageEntry>()
  for (const entry of entries) {
    const prev = byRule.get(entry.ruleId)
    if (!prev) {
      byRule.set(entry.ruleId, { ...entry })
      continue
    }
    if (prev.evaluation === "unevaluated") continue
    if (entry.evaluation === "unevaluated") {
      byRule.set(entry.ruleId, { ...entry })
      continue
    }
    if (entry.reason === "hit") byRule.set(entry.ruleId, { ...entry })
  }
  return [...byRule.values()]
}
