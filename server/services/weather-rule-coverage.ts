import type { WeatherRuleInputs } from "@shared/weather-impact"
import { weatherValueGte, weatherValueLt } from "@shared/weather-units"
import type { WeatherImpactRuleConfig, WeatherImpactRuleWhen } from "#/config/weather-impact-rules"
import { weatherImpactRules } from "#/config/weather-impact-rules"
import type { Precipitation24hResult } from "#/services/precipitation-window"
import type { WeatherRuleCoverageEntry } from "#/services/weather-rule-evaluation"

export type SanitizedWeatherRuleInputs = WeatherRuleInputs

export type TyphoonInputState =
  | { status: "unavailable" }
  | { status: "checked", distanceKm: number }

export const TYPHOON_NO_STORM_DISTANCE_KM = 50_000

export function sanitizeWeatherRuleInputs(inputs: WeatherRuleInputs): SanitizedWeatherRuleInputs {
  const out: WeatherRuleInputs = {}
  for (const key of ["windGustMs", "waveHeightM", "visibilityM", "precipitationMm24h", "typhoonDistanceKm"] as const) {
    const value = inputs[key]
    if (value === undefined) continue
    if (typeof value !== "number" || !Number.isFinite(value)) continue
    out[key] = value
  }
  return out
}

type LimbOutcome = "hit" | "miss" | "unknown"

interface LimbEvaluation {
  outcome: LimbOutcome
  reasons: string[]
}

function windGustReason(raw: number | undefined): string {
  return raw === undefined ? "wind_gust_missing" : "wind_gust_invalid"
}

function waveReason(raw: number | undefined): string {
  return raw === undefined ? "wave_height_missing" : "wave_height_invalid"
}

function visibilityReason(raw: number | undefined): string {
  return raw === undefined ? "visibility_missing" : "visibility_invalid"
}

function evaluateLeafLimb(
  when: WeatherImpactRuleWhen,
  inputs: SanitizedWeatherRuleInputs,
  rawInputs: WeatherRuleInputs,
  typhoon: TyphoonInputState,
): LimbEvaluation {
  if (when.typhoonDistanceKmLte !== undefined) {
    if (typhoon.status === "unavailable") {
      return { outcome: "unknown", reasons: ["typhoon_data_unavailable"] }
    }
    return typhoon.distanceKm <= when.typhoonDistanceKmLte
      ? { outcome: "hit", reasons: [] }
      : { outcome: "miss", reasons: [] }
  }
  if (when.windGustMsGte !== undefined) {
    const gust = inputs.windGustMs
    if (gust === undefined) {
      return { outcome: "unknown", reasons: [windGustReason(rawInputs.windGustMs)] }
    }
    return weatherValueGte(gust, when.windGustMsGte)
      ? { outcome: "hit", reasons: [] }
      : { outcome: "miss", reasons: [] }
  }
  if (when.waveHeightMGte !== undefined) {
    const wave = inputs.waveHeightM
    if (wave === undefined) {
      return { outcome: "unknown", reasons: [waveReason(rawInputs.waveHeightM)] }
    }
    return weatherValueGte(wave, when.waveHeightMGte)
      ? { outcome: "hit", reasons: [] }
      : { outcome: "miss", reasons: [] }
  }
  if (when.visibilityMLt !== undefined) {
    const visibility = inputs.visibilityM
    if (visibility === undefined) {
      return { outcome: "unknown", reasons: [visibilityReason(rawInputs.visibilityM)] }
    }
    return weatherValueLt(visibility, when.visibilityMLt)
      ? { outcome: "hit", reasons: [] }
      : { outcome: "miss", reasons: [] }
  }
  if (when.precipitationMm24hGte !== undefined) {
    const precip = inputs.precipitationMm24h
    if (precip === undefined) {
      return { outcome: "unknown", reasons: ["precip_24h_incomplete"] }
    }
    return weatherValueGte(precip, when.precipitationMm24hGte)
      ? { outcome: "hit", reasons: [] }
      : { outcome: "miss", reasons: [] }
  }
  return { outcome: "unknown", reasons: ["rule_limb_unsupported"] }
}

function evaluateWhenLimb(
  when: WeatherImpactRuleWhen,
  inputs: SanitizedWeatherRuleInputs,
  rawInputs: WeatherRuleInputs,
  typhoon: TyphoonInputState,
): LimbEvaluation {
  if (when.any?.length) {
    const limbs = when.any.map(clause => evaluateWhenLimb(clause, inputs, rawInputs, typhoon))
    if (limbs.some(l => l.outcome === "hit")) return { outcome: "hit", reasons: [] }
    const unknownReasons = limbs.filter(l => l.outcome === "unknown").flatMap(l => l.reasons)
    if (unknownReasons.length) return { outcome: "unknown", reasons: [...new Set(unknownReasons)] }
    return { outcome: "miss", reasons: [] }
  }
  return evaluateLeafLimb(when, inputs, rawInputs, typhoon)
}

function precipRuleReason(precipCoverage: Precipitation24hResult): string {
  if (precipCoverage.status === "partial") {
    return `precip_24h_partial_${precipCoverage.hourlySamplesInWindow}_of_24`
  }
  return `precip_24h_insufficient_${precipCoverage.hourlySamplesInWindow}_of_24`
}

export function coverageForRuleWithoutEngineHit(
  rule: WeatherImpactRuleConfig,
  sanitized: SanitizedWeatherRuleInputs,
  rawInputs: WeatherRuleInputs,
  precipCoverage: Precipitation24hResult,
  typhoon: TyphoonInputState,
): WeatherRuleCoverageEntry {
  if (rule.id === "WR-S05" && precipCoverage.status !== "full") {
    return { ruleId: rule.id, evaluation: "unevaluated", reason: precipRuleReason(precipCoverage) }
  }

  const limb = evaluateWhenLimb(rule.when, sanitized, rawInputs, typhoon)
  if (limb.outcome === "unknown") {
    return { ruleId: rule.id, evaluation: "unevaluated", reason: limb.reasons.join(",") }
  }
  return { ruleId: rule.id, evaluation: "evaluated", reason: "no_hit" }
}

export function buildRuleCoverageEntries(
  sanitized: SanitizedWeatherRuleInputs,
  rawInputs: WeatherRuleInputs,
  precipCoverage: Precipitation24hResult,
  hitRuleIds: ReadonlySet<string>,
  typhoon: TyphoonInputState,
): WeatherRuleCoverageEntry[] {
  return weatherImpactRules.map((rule) => {
    if (hitRuleIds.has(rule.id)) {
      return { ruleId: rule.id, evaluation: "evaluated", reason: "hit" }
    }
    return coverageForRuleWithoutEngineHit(rule, sanitized, rawInputs, precipCoverage, typhoon)
  })
}

export function unevaluatedRuleIds(entries: readonly WeatherRuleCoverageEntry[]): string[] {
  return entries.filter(entry => entry.evaluation === "unevaluated").map(entry => entry.ruleId)
}
