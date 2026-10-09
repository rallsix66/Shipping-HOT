import type { QualifiedPortClosureReplayEvent } from "@shared/weather-impact"
import {
  R1_5_4_MIN_HIT_RATE,
  R1_5_4_REQUIRED_QUALIFIED_SAMPLES,
  qualifiedPortClosureReplayEvents,
} from "#/data/weather-calibration/qualified-port-closure-replay"
import { evaluateWeatherImpactRules } from "#/services/weather-impact-engine"

export interface R15_4CalibrationStatus {
  status: "blocked" | "ready"
  qualifiedCount: number
  requiredCount: number
  reason?: string
}

export function observationWithinClosureWindow(
  observationAtUtc: string,
  closureStartUtc: string,
  closureEndUtc: string,
): boolean {
  const t = Date.parse(observationAtUtc)
  const start = Date.parse(closureStartUtc)
  const end = Date.parse(closureEndUtc)
  if (!Number.isFinite(t) || !Number.isFinite(start) || !Number.isFinite(end)) return false
  return t >= start && t <= end
}

/** Calibration hit: observation overlaps official closure **and** shipping-port rules fire at that instant. */
export function replayQualifiedPortClosureEvent(event: QualifiedPortClosureReplayEvent): boolean {
  if (!observationWithinClosureWindow(event.observationAtUtc, event.closureStartUtc, event.closureEndUtc)) {
    return false
  }
  const hits = evaluateWeatherImpactRules(event.inputs)
  return hits.some(h => h.object === "shipping_port" && (h.severity === "critical" || h.severity === "warning"))
}

export function isR15_4ReplayRuleHit(hit: { object: string, severity: string }): boolean {
  return hit.object === "shipping_port" && (hit.severity === "critical" || hit.severity === "warning")
}

export function getR15_4CalibrationStatus(): R15_4CalibrationStatus {
  const qualifiedCount = qualifiedPortClosureReplayEvents.length
  if (qualifiedCount < R1_5_4_REQUIRED_QUALIFIED_SAMPLES) {
    return {
      status: "blocked",
      qualifiedCount,
      requiredCount: R1_5_4_REQUIRED_QUALIFIED_SAMPLES,
      reason: `Need ${R1_5_4_REQUIRED_QUALIFIED_SAMPLES} independently verified samples with official closure locator and traceable inputs; have ${qualifiedCount}.`,
    }
  }
  const replay = replayAllQualifiedPortClosureEvents()
  if (replay.hitRate < R1_5_4_MIN_HIT_RATE) {
    return {
      status: "blocked",
      qualifiedCount,
      requiredCount: R1_5_4_REQUIRED_QUALIFIED_SAMPLES,
      reason: `Qualified corpus replay hit rate ${(replay.hitRate * 100).toFixed(1)}% is below ${R1_5_4_MIN_HIT_RATE * 100}% (${replay.hits}/${replay.total}).`,
    }
  }
  return { status: "ready", qualifiedCount, requiredCount: R1_5_4_REQUIRED_QUALIFIED_SAMPLES }
}

export function replayAllQualifiedPortClosureEvents(): { hitRate: number, hits: number, total: number } {
  const total = qualifiedPortClosureReplayEvents.length
  if (total === 0) return { hitRate: 0, hits: 0, total: 0 }
  const hits = qualifiedPortClosureReplayEvents.filter(replayQualifiedPortClosureEvent).length
  return { hitRate: hits / total, hits, total }
}
