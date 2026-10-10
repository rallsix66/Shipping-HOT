import type { PortWeatherForecastRow } from "@shared/shipping"
import type { WeatherImpactRuleHit, WeatherRuleInputs } from "@shared/weather-impact"
import { windGustKmhToMs } from "@shared/weather-units"
import { evaluateWeatherImpactRules } from "#/services/weather-impact-engine"
import type { Precipitation24hResult, PrecipitationSample } from "#/services/precipitation-window"
import { precipitation24hEndingAtDetailed } from "#/services/precipitation-window"
import { buildRuleCoverageEntries, sanitizeWeatherRuleInputs } from "#/services/weather-rule-coverage"

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
): PointRuleEvaluation {
  const precipCoverage = precipitation24hEndingAtDetailed(precipSamples, atTimestamp)
  const rawInputs: WeatherRuleInputs = {
    ...inputs,
    precipitationMm24h: precipCoverage.status === "full" ? precipCoverage.totalMm : undefined,
  }
  const sanitized = sanitizeWeatherRuleInputs(rawInputs)
  const engineHits = evaluateWeatherImpactRules(sanitized)
  const hitRuleIds = new Set(engineHits.map(hit => hit.ruleId))
  const ruleCoverage = buildRuleCoverageEntries(sanitized, rawInputs, precipCoverage, hitRuleIds)
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
): PointRuleEvaluation | undefined {
  const asOfMs = Date.parse(asOf)
  if (!Number.isFinite(asOfMs)) return undefined
  const row = pickNearestForecastRow(forecasts, asOfMs)
  if (!row) return undefined
  const gustMs = row.windGustKmh === undefined ? undefined : windGustKmhToMs(row.windGustKmh)
  const waveM = row.waveHeightM ?? row.swellWaveHeightM
  return evaluatePointWeatherRules({
    windGustMs: gustMs,
    waveHeightM: waveM,
    visibilityM: row.visibilityM,
  }, forecastRowsToPrecipSamples(forecasts), asOf)
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
