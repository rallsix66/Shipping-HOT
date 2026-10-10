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
  /** 🏛 Official warning the judgement is based on (WR-O01/WR-O02 only). Never implies an implemented state. */
  officialBasis?: OfficialAlertBasis
}

export interface OfficialAlertBasis {
  provenance: "official"
  sourceId: string
  alertId: string
  title: string
  sourceUrl: string
  severity: Severity
  publishedAt: string
  expiresAt?: string
}

/** Canonical rule inputs — wind gust in m/s (plan §4.8). */
export interface WeatherRuleInputs {
  windGustMs?: number
  waveHeightM?: number
  visibilityM?: number
  precipitationMm24h?: number
  typhoonDistanceKm?: number
}

export interface WeatherInputProvenance {
  source: string
  unit: string
  location: string
  referencedAtUtc: string
}

export interface OfficialClosureProvenance {
  source: string
  locator?: string
}

/** R1.5-4: only rows with full closure + input provenance may enter qualified replay set. */
export interface QualifiedPortClosureReplayEvent {
  id: string
  portUnlocode: string
  closureStartUtc: string
  closureEndUtc: string
  observationAtUtc: string
  inputs: WeatherRuleInputs
  inputProvenance: WeatherInputProvenance
  closureProvenance: OfficialClosureProvenance
}
