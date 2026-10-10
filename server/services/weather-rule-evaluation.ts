import type { PortWeatherForecastRow } from "@shared/shipping"
import type { WeatherImpactRuleHit, WeatherRuleInputs } from "@shared/weather-impact"
import { windGustKmhToMs } from "@shared/weather-units"
import { weatherImpactRules } from "#/config/weather-impact-rules"
import { evaluateWeatherImpactRules } from "#/services/weather-impact-engine"
import type { Precipitation24hResult, PrecipitationSample } from "#/services/precipitation-window"
import { precipitation24hEndingAtDetailed } from "#/services/precipitation-window"

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

const RULES_REQUIRING_FULL_PRECIP = new Set(["WR-S05"])
const RULES_REQUIRING_VISIBILITY = new Set(["WR-S04"])

export function evaluatePointWeatherRules(
  inputs: Omit<WeatherRuleInputs, "precipitationMm24h">,
  precipSamples: readonly PrecipitationSample[],
  atTimestamp: string,
): PointRuleEvaluation {
  const precipCoverage = precipitation24hEndingAtDetailed(precipSamples, atTimestamp)
  const ruleCoverage: WeatherRuleCoverageEntry[] = []
  const blockedRuleIds = new Set<string>()

  for (const rule of weatherImpactRules) {
    if (RULES_REQUIRING_FULL_PRECIP.has(rule.id)) {
      if (precipCoverage.status !== "full") {
        blockedRuleIds.add(rule.id)
        ruleCoverage.push({
          ruleId: rule.id,
          evaluation: "unevaluated",
          reason: precipCoverage.status === "partial"
            ? `precip_24h_partial_${precipCoverage.hourlySamplesInWindow}_of_24`
            : `precip_24h_insufficient_${precipCoverage.hourlySamplesInWindow}_of_24`,
        })
        continue
      }
    }
    if (RULES_REQUIRING_VISIBILITY.has(rule.id) && inputs.visibilityM === undefined) {
      blockedRuleIds.add(rule.id)
      ruleCoverage.push({ ruleId: rule.id, evaluation: "unevaluated", reason: "visibility_missing" })
      continue
    }
    ruleCoverage.push({ ruleId: rule.id, evaluation: "evaluated" })
  }

  const fullInputs: WeatherRuleInputs = {
    ...inputs,
    precipitationMm24h: precipCoverage.status === "full" ? precipCoverage.totalMm : undefined,
  }
  const hits = evaluateWeatherImpactRules(fullInputs).filter(h => !blockedRuleIds.has(h.ruleId))

  for (const entry of ruleCoverage) {
    if (entry.evaluation === "evaluated") {
      entry.reason = hits.some(h => h.ruleId === entry.ruleId) ? "hit" : "no_hit"
    }
  }

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
