import type { WeatherImpactRuleHit, WeatherRuleInputs } from "@shared/weather-impact"
import { type WeatherImpactRuleWhen, weatherImpactRules } from "#/config/weather-impact-rules"

function evalWhen(when: WeatherImpactRuleWhen, inputs: WeatherRuleInputs): boolean {
  if (when.any?.length) return when.any.some(clause => evalWhen(clause, inputs))
  if (when.windGustKmhGte !== undefined && (inputs.windGustKmh ?? -Infinity) < when.windGustKmhGte) return false
  if (when.waveHeightMGte !== undefined && (inputs.waveHeightM ?? -Infinity) < when.waveHeightMGte) return false
  if (when.visibilityMLt !== undefined && (inputs.visibilityM ?? Infinity) >= when.visibilityMLt) return false
  if (when.precipitationMm24hGte !== undefined && (inputs.precipitationMm24h ?? -Infinity) < when.precipitationMm24hGte) return false
  if (when.typhoonDistanceKmLte !== undefined && (inputs.typhoonDistanceKm ?? Infinity) > when.typhoonDistanceKmLte) return false
  if (when.windGustKmhGte !== undefined || when.waveHeightMGte !== undefined || when.visibilityMLt !== undefined
    || when.precipitationMm24hGte !== undefined || when.typhoonDistanceKmLte !== undefined) {
    return true
  }
  return false
}

function inputSnapshot(inputs: WeatherRuleInputs): Record<string, number | string | boolean> {
  const out: Record<string, number | string | boolean> = {}
  for (const [key, value] of Object.entries(inputs)) {
    if (value !== undefined) out[key] = value
  }
  return out
}

/** Evaluate §4.8 rules — outputs are **potential** only (`status: potential`, provenance `system`). */
export function evaluateWeatherImpactRules(inputs: WeatherRuleInputs): WeatherImpactRuleHit[] {
  const hits: WeatherImpactRuleHit[] = []
  for (const rule of weatherImpactRules) {
    if (!evalWhen(rule.when, inputs)) continue
    hits.push({
      ruleId: rule.id,
      object: rule.object,
      severity: rule.severity,
      status: "potential",
      provenance: "system",
      inputValues: inputSnapshot(inputs),
      summaryZh: rule.summaryZh,
    })
  }
  return hits
}

/** Guardrail: rules must never emit an implemented/enacted state. */
export function assertNoImplementedWeatherImpact(hits: WeatherImpactRuleHit[]): void {
  for (const hit of hits) {
    if (hit.status !== "potential") {
      throw new Error(`weather impact rule ${hit.ruleId} emitted non-potential status ${hit.status}`)
    }
  }
}

export function listWeatherImpactRuleIds(): string[] {
  return weatherImpactRules.map(rule => rule.id)
}
