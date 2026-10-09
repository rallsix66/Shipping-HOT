import type { Severity } from "./shipping"

/** System-computed weather influence only — never "implemented" without official notice. */
export type WeatherImpactObject = "shipping_port" | "delivery_region"

export type WeatherImpactStatus = "potential"

export interface WeatherImpactRuleHit {
  ruleId: string
  object: WeatherImpactObject
  severity: Severity
  status: WeatherImpactStatus
  provenance: "system"
  inputValues: Record<string, number | string | boolean>
  summaryZh: string
}

export interface WeatherRuleInputs {
  windGustKmh?: number
  waveHeightM?: number
  visibilityM?: number
  precipitationMm24h?: number
  typhoonDistanceKm?: number
  hasOfficialAlert?: boolean
  officialAlertSeverity?: Severity
}
