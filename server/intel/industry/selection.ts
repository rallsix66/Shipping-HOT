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
  /** 紧迫度 0–10 */
  urgency: number
  /** 可行动性 0–10 */
  actionability: number
}

export interface SeverityAttemptEvidence {
  attemptIndex: number
  dimensions: DimensionScores
  weighted: number
  beforeCap: number
  severity: number
  capsApplied: string[]
  rumourOnly: boolean | null
}

export interface SeverityBasis {
  eventType: EventType
  /** Single-attempt dimensions; for median3 this mirrors the attempt whose severity equals the median. */
  dimensions: DimensionScores
  weighted: number
  beforeCap: number
  severity: number
  capsApplied: string[]
  aggregation: "single" | "median3"
  /** Full per-attempt evidence (required for auditable median3). */
  evidence: SeverityAttemptEvidence[]
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
  const mapped = Math.ceil(weighted0to10 / 2)
  return Math.max(1, Math.min(5, mapped || 1))
}

export function isEventType(value: unknown): value is EventType {
  return typeof value === "string" && (EVENT_TYPES as readonly string[]).includes(value)
}

/**
 * Compute severity 1–5 from dimension scores and event type.
 * Caps (plan §4.2): routine announcements ≤1 (needs clear routine evidence — NOT every holiday_notice);
 * single unverified rumour ≤2.
 */
export function computeSeverity(
  eventType: EventType,
  dimensions: DimensionScores,
  flags: {
    isOfficialStatement?: boolean | null
    isFirstParty?: boolean | null
    rumourOnly?: boolean | null
    /** Explicit routine-notice evidence (e.g. scheduled holiday calendar notice). */
    routineNotice?: boolean | null
  } = {},
  meta: { attemptIndex?: number } = {},
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

  // Routine cap: only with clear routine evidence. Major disruption under a holiday_notice
  // label must NOT be forced to 1. Low impact+urgency holiday/advisory may count as routine-like.
  const routineByFlag = flags.routineNotice === true
  const routineHolidayDims = eventType === "holiday_notice" && d.impact <= 2 && d.urgency <= 2
  const routineAdvisory = eventType === "carrier_advisory" && d.impact <= 2 && d.urgency <= 2
  if (routineByFlag || routineHolidayDims || routineAdvisory) {
    if (severity > 1) severity = 1
    // Always record that the routine path applied (even when already <=1).
    capsApplied.push("routine_notice_max_1")
  }
  if (flags.rumourOnly === true && flags.isOfficialStatement !== true && flags.isFirstParty !== true) {
    if (severity > 2) {
      severity = 2
      capsApplied.push("unverified_rumour_max_2")
    }
  }

  const evidence: SeverityAttemptEvidence[] = [{
    attemptIndex: meta.attemptIndex ?? 1,
    dimensions: d,
    weighted: Number(weighted.toFixed(4)),
    beforeCap,
    severity,
    capsApplied: [...capsApplied],
    rumourOnly: flags.rumourOnly ?? null,
  }]

  return {
    eventType,
    dimensions: d,
    weighted: Number(weighted.toFixed(4)),
    beforeCap,
    severity,
    capsApplied,
    aggregation: "single",
    evidence,
  }
}

/** Median of three integers (for severity tie-break). */
export function median3(a: number, b: number, c: number): number {
  const xs = [a, b, c].sort((x, y) => x - y)
  return xs[1]!
}

/**
 * Aggregate three independent severity bases via median of severity scores.
 * Preserves all three evidences; dimensions/weighted/beforeCap come from the
 * earliest attempt whose severity equals the median (never blindly from attempt 3).
 */
export function aggregateMedianSeverity(
  eventType: EventType,
  bases: [SeverityBasis, SeverityBasis, SeverityBasis],
): SeverityBasis {
  const scores = bases.map(b => b.severity) as [number, number, number]
  const med = median3(scores[0], scores[1], scores[2])
  const evidence: SeverityAttemptEvidence[] = bases.flatMap(b => b.evidence)
  const match = bases.find(b => b.severity === med) ?? bases[0]!
  return {
    eventType,
    dimensions: match.dimensions,
    weighted: match.weighted,
    beforeCap: match.beforeCap,
    severity: med,
    capsApplied: ["median3"],
    aggregation: "median3",
    evidence,
  }
}
