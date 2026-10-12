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

/** Canonical unit per rule input field (R1.5-4 replay C6 check). */
export const REPLAY_INPUT_UNITS = {
  windGustMs: "m/s",
  waveHeightM: "m",
  visibilityM: "m",
  precipitationMm24h: "mm",
  typhoonDistanceKm: "km",
} as const satisfies Record<keyof WeatherRuleInputs, string>

/** observation = measured; forecast = issued forecast/grid; post_analysis = best track etc.; derived_distance = computed from a position product. */
export type ReplaySampleKind = "observation" | "forecast" | "post_analysis" | "derived_distance"

export interface ReplaySampleProvenance {
  /** Product identifier, e.g. "hko-best-track-six-hourly". */
  productId: string
  /** True only when the product itself is approved for formal replay (catalog/user decision). */
  productApproved: boolean
  source: string
  kind: ReplaySampleKind
  locationLabel: string
  latitude: number
  longitude: number
  /** Unit for every provided input field; must equal REPLAY_INPUT_UNITS. */
  units: Partial<Record<keyof WeatherRuleInputs, string>>
}

/** One time point of the weather series for an event (original source time, UTC). */
export interface ReplayWeatherSample {
  atUtc: string
  inputs: WeatherRuleInputs
  provenance: ReplaySampleProvenance
}

export interface ReplaySourceLocator {
  url: string
  publisher: "official" | "operator"
  /** Verbatim sentence giving the stop or resume time. */
  quote: string
  archivedSha256?: string
}

export interface ReplayTimeZoneBasis {
  /** Offset stated by the source text itself, e.g. "UTC+8"; null when the text gives none. */
  statedOffset: string | null
  /** Inferred offset and the reason (kept for audit) when nothing is stated. */
  inferredOffset?: string
  inferenceReason?: string
  /** Any ambiguity that could change admission → pending manual review. */
  ambiguous: boolean
}

/**
 * R1.5-4 replay event (one independent event per port). Programmatic checks only validate fields and
 * consistency; they cannot prove the source content is true.
 */
export interface PortClosureReplayEvent {
  eventId: string
  /** Linkage id for the weather system (e.g. typhoon) shared across ports; correlation is disclosed, not hidden. */
  weatherSystemId?: string
  portUnlocode: string
  /** Explicit operation scope from the source, e.g. "SCT/CCT/MCT gate pickup/drop-off". */
  operationScope: string
  stopSource: ReplaySourceLocator
  resumeSource: ReplaySourceLocator
  timeZoneBasis: ReplayTimeZoneBasis
  closureStartUtc: string
  closureEndUtc: string
  /** Ordered weather series; every valid in-window point is evaluated. */
  samples: readonly ReplayWeatherSample[]
}
