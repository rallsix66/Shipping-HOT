import type { WeatherImpactRuleHit, WeatherRuleInputs } from "@shared/weather-impact"
import { type WeatherImpactRuleWhen, weatherImpactRules } from "#/config/weather-impact-rules"

function finiteInput(value: number | undefined): number | undefined {
  if (value === undefined) return undefined
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined
  return value
}

function evalWhen(when: WeatherImpactRuleWhen, inputs: WeatherRuleInputs): boolean {
  if (when.any?.length) return when.any.some(clause => evalWhen(clause, inputs))
  const gustMs = finiteInput(inputs.windGustMs)
  const waveM = finiteInput(inputs.waveHeightM)
  const visibilityM = finiteInput(inputs.visibilityM)
  const precip = finiteInput(inputs.precipitationMm24h)
  const typhoonKm = finiteInput(inputs.typhoonDistanceKm)

  if (when.windGustMsGte !== undefined && (gustMs === undefined || gustMs < when.windGustMsGte)) return false
  if (when.waveHeightMGte !== undefined && (waveM === undefined || waveM < when.waveHeightMGte)) return false
  if (when.visibilityMLt !== undefined && (visibilityM === undefined || visibilityM >= when.visibilityMLt)) return false
  if (when.precipitationMm24hGte !== undefined && (precip === undefined || precip < when.precipitationMm24hGte)) return false
  if (when.typhoonDistanceKmLte !== undefined && (typhoonKm === undefined || typhoonKm > when.typhoonDistanceKmLte)) return false
  if (when.windGustMsGte !== undefined || when.waveHeightMGte !== undefined || when.visibilityMLt !== undefined
    || when.precipitationMm24hGte !== undefined || when.typhoonDistanceKmLte !== undefined) {
    return true
  }
  return false
}

function inputSnapshot(inputs: WeatherRuleInputs): Record<string, number | string | boolean> {
  const out: Record<string, number | string | boolean> = {}
  for (const [key, value] of Object.entries(inputs)) {
    if (value !== undefined && typeof value === "number" && Number.isFinite(value)) out[key] = value
  }
  return out
}

/** Evaluate §4.8 shipping-port rules — outputs are **potential** only. Official-alert row: not implemented. */
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
