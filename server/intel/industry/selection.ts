/**
 * Industry severity selection weights (plan §4.2).
 * Pure system math — no LLM calls. Caps keep routine/rumour noise down.
 */

export const EVENT_TYPES = [
  "port_closure",
  "port_congestion",
  "weather_hazard",
  "carrier_advisory",
  "freight_rate",
  "customs_rule",
  "trade_policy",
  "platform_rule",
  "labor_strike",
  "lastmile_disruption",
  "civil_unrest",
  "holiday_notice",
  "other",
] as const

export type EventType = (typeof EVENT_TYPES)[number]

export interface DimensionScores {
  /** 影响程度 0–10 */
  impact: number
  /** 影响范围 0–10 */
  scope: number
  /** 紧迫性 0–10 */
  urgency: number
  /** 可行动性 0–10 */
  actionability: number
}

export interface SeverityBasis {
  eventType: EventType
  dimensions: DimensionScores
  weighted: number
  beforeCap: number
  severity: number
  capsApplied: string[]
}

/** Per-event-type weights for the four internal dimensions. */
export const EVENT_TYPE_WEIGHTS: Record<EventType, DimensionScores> = {
  port_closure: { impact: 0.4, scope: 0.25, urgency: 0.25, actionability: 0.1 },
  port_congestion: { impact: 0.35, scope: 0.25, urgency: 0.25, actionability: 0.15 },
  weather_hazard: { impact: 0.35, scope: 0.3, urgency: 0.25, actionability: 0.1 },
  carrier_advisory: { impact: 0.3, scope: 0.25, urgency: 0.25, actionability: 0.2 },
  freight_rate: { impact: 0.35, scope: 0.3, urgency: 0.15, actionability: 0.2 },
  customs_rule: { impact: 0.35, scope: 0.3, urgency: 0.15, actionability: 0.2 },
  trade_policy: { impact: 0.35, scope: 0.35, urgency: 0.1, actionability: 0.2 },
  platform_rule: { impact: 0.3, scope: 0.3, urgency: 0.15, actionability: 0.25 },
  labor_strike: { impact: 0.35, scope: 0.25, urgency: 0.3, actionability: 0.1 },
  lastmile_disruption: { impact: 0.3, scope: 0.25, urgency: 0.3, actionability: 0.15 },
  civil_unrest: { impact: 0.4, scope: 0.3, urgency: 0.25, actionability: 0.05 },
  holiday_notice: { impact: 0.2, scope: 0.3, urgency: 0.2, actionability: 0.3 },
  other: { impact: 0.25, scope: 0.25, urgency: 0.25, actionability: 0.25 },
}

function clamp01to10(n: number): number {
  if (!Number.isFinite(n)) return 0
  return Math.max(0, Math.min(10, n))
}

function mapToSeverity1to5(weighted0to10: number): number {
  // 0–10 → 1–5 (ceil of /2, floor at 1)
  const mapped = Math.ceil(weighted0to10 / 2)
  return Math.max(1, Math.min(5, mapped || 1))
}

export function isEventType(value: unknown): value is EventType {
  return typeof value === "string" && (EVENT_TYPES as readonly string[]).includes(value)
}

/**
 * Compute severity 1–5 from dimension scores and event type.
 * Caps (plan §4.2): routine holiday/advisory ≤1; single unverified rumour ≤2.
 */
export function computeSeverity(
  eventType: EventType,
  dimensions: DimensionScores,
  flags: { isOfficialStatement?: boolean | null, isFirstParty?: boolean | null, rumourOnly?: boolean | null } = {},
): SeverityBasis {
  const weights = EVENT_TYPE_WEIGHTS[eventType]
  const d = {
    impact: clamp01to10(dimensions.impact),
    scope: clamp01to10(dimensions.scope),
    urgency: clamp01to10(dimensions.urgency),
    actionability: clamp01to10(dimensions.actionability),
  }
  const weighted = d.impact * weights.impact
    + d.scope * weights.scope
    + d.urgency * weights.urgency
    + d.actionability * weights.actionability
  let severity = mapToSeverity1to5(weighted)
  const beforeCap = severity
  const capsApplied: string[] = []

  if (eventType === "holiday_notice" || (eventType === "carrier_advisory" && d.impact <= 2 && d.urgency <= 2)) {
    if (severity > 1) {
      severity = 1
      capsApplied.push("routine_notice_max_1")
    }
  }
  if (flags.rumourOnly === true && flags.isOfficialStatement !== true && flags.isFirstParty !== true) {
    if (severity > 2) {
      severity = 2
      capsApplied.push("unverified_rumour_max_2")
    }
  }

  return { eventType, dimensions: d, weighted: Number(weighted.toFixed(4)), beforeCap, severity, capsApplied }
}

/** Median of three integers (for severity tie-break). */
export function median3(a: number, b: number, c: number): number {
  const xs = [a, b, c].sort((x, y) => x - y)
  return xs[1]!
}
