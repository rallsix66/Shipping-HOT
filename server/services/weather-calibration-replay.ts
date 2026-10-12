import type { PortClosureReplayEvent, ReplayWeatherSample, WeatherImpactRuleHit, WeatherRuleInputs } from "@shared/weather-impact"
import { REPLAY_INPUT_UNITS } from "@shared/weather-impact"
import {
  R1_5_4_MIN_HIT_RATE,
  R1_5_4_REQUIRED_QUALIFIED_SAMPLES,
  qualifiedPortClosureReplayEvents,
} from "#/data/weather-calibration/qualified-port-closure-replay"
import { evaluateWeatherImpactRules } from "#/services/weather-impact-engine"

/** Eight-port scope (UN/LOCODE). Out-of-scope ports are never counted. */
export const R1_5_4_EIGHT_PORTS: readonly string[] = ["CNSHK", "CNYTN", "CNNSA", "THLCH", "MYPKG", "PHMNL", "IDJKT", "VNSGN"]

const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?Z$/

function parseUtc(value: string): number | undefined {
  if (typeof value !== "string" || !ISO_UTC.test(value)) return undefined
  const t = Date.parse(value)
  return Number.isFinite(t) ? t : undefined
}

function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === "https:"
  } catch {
    return false
  }
}

export type ReplayAdmissionStatus = "eligible" | "rejected" | "pending_review"

export interface ReplaySampleCheck {
  atUtc: string
  valid: boolean
  /** Why the point was excluded (invalid or outside window). Empty when valid. */
  reasons: string[]
}

export interface ReplayAdmission {
  eventId: string
  portUnlocode: string
  status: ReplayAdmissionStatus
  reasons: string[]
  validSamples: ReplayWeatherSample[]
  sampleChecks: ReplaySampleCheck[]
}

function checkSample(sample: ReplayWeatherSample, startMs: number | undefined, endMs: number | undefined): ReplaySampleCheck {
  const reasons: string[] = []
  const t = parseUtc(sample.atUtc)
  const p = sample.provenance
  if (t === undefined) reasons.push("C6:sample_time_not_utc_iso")
  if (!p || !p.productApproved) reasons.push("C6:product_not_approved")
  if (!p?.productId || !p.source) reasons.push("C6:missing_source")
  if (!p?.locationLabel || !Number.isFinite(p?.latitude) || !Number.isFinite(p?.longitude)
    || Math.abs(p.latitude) > 90 || Math.abs(p.longitude) > 180) {
    reasons.push("C6:invalid_coordinates")
  }
  let provided = 0
  for (const key of Object.keys(REPLAY_INPUT_UNITS) as (keyof WeatherRuleInputs)[]) {
    const value = sample.inputs?.[key]
    if (value === undefined) continue
    if (typeof value !== "number" || !Number.isFinite(value)) {
      reasons.push(`C6:invalid_value:${key}`)
      continue
    }
    provided++
    if (p?.units?.[key] !== REPLAY_INPUT_UNITS[key]) reasons.push(`C6:unit_mismatch:${key}`)
  }
  if (provided === 0) reasons.push("C6:no_valid_value")
  // Rule 4: a cyclone centre wind / best-track product / untimed extreme is never a port gust.
  if (sample.inputs?.windGustMs !== undefined && p && p.kind !== "observation" && p.kind !== "forecast") {
    reasons.push("C6:gust_not_point_observation_or_forecast")
  }
  if (t !== undefined && startMs !== undefined && endMs !== undefined && (t < startMs || t > endMs)) {
    reasons.push("C7:outside_closure_window")
  }
  return { atUtc: sample.atUtc, valid: reasons.length === 0, reasons }
}

/** C1–C8 structural admission. Validates fields/consistency only; cannot prove source content is true. */
export function admitReplayEvents(events: readonly PortClosureReplayEvent[]): ReplayAdmission[] {
  const seenIds = new Set<string>()
  const seenSystemPort = new Set<string>()
  return events.map((event) => {
    const reasons: string[] = []
    let pending = false
    if (!event.eventId) reasons.push("C1:missing_event_id")
    else if (seenIds.has(event.eventId)) reasons.push("C1:duplicate_event_id")
    if (event.eventId) seenIds.add(event.eventId)
    if (event.weatherSystemId) {
      const key = `${event.weatherSystemId}|${event.portUnlocode}`
      if (seenSystemPort.has(key)) reasons.push("C1:duplicate_event_port")
      seenSystemPort.add(key)
    }
    if (!R1_5_4_EIGHT_PORTS.includes(event.portUnlocode)) reasons.push("C2:port_outside_eight_ports")
    if (!event.operationScope?.trim()) reasons.push("C3:missing_operation_scope")
    for (const [label, src] of [["stop", event.stopSource], ["resume", event.resumeSource]] as const) {
      if (!src || !isHttpsUrl(src.url)) reasons.push(`C4:${label}_locator_invalid`)
      if (!src?.quote?.trim()) reasons.push(`C4:${label}_quote_missing`)
      if (src && src.publisher !== "official" && src.publisher !== "operator") reasons.push(`C4:${label}_not_official_or_operator`)
    }
    const tz = event.timeZoneBasis
    if (!tz || (!tz.statedOffset && !(tz.inferredOffset && tz.inferenceReason?.trim()))) reasons.push("C5:time_zone_basis_missing")
    else if (tz.ambiguous) pending = true
    const startMs = parseUtc(event.closureStartUtc)
    const endMs = parseUtc(event.closureEndUtc)
    if (startMs === undefined || endMs === undefined || startMs >= endMs) reasons.push("C5:invalid_utc_window")
    const sampleChecks = [...(event.samples ?? [])]
      .sort((a, b) => (parseUtc(a.atUtc) ?? 0) - (parseUtc(b.atUtc) ?? 0))
      .map(s => checkSample(s, startMs, endMs))
    const times = new Set<string>()
    for (const c of sampleChecks) {
      if (times.has(c.atUtc)) reasons.push("C6:duplicate_sample_time")
      times.add(c.atUtc)
    }
    const validSamples = [...(event.samples ?? [])]
      .filter(s => sampleChecks.find(c => c.atUtc === s.atUtc)?.valid)
      .sort((a, b) => (parseUtc(a.atUtc) ?? 0) - (parseUtc(b.atUtc) ?? 0))
    if (validSamples.length === 0) reasons.push("C6:no_valid_samples_in_window")
    const status: ReplayAdmissionStatus = reasons.length > 0 ? "rejected" : pending ? "pending_review" : "eligible"
    if (status === "pending_review") reasons.push("C5:time_zone_ambiguous_manual_review")
    return { eventId: event.eventId, portUnlocode: event.portUnlocode, status, reasons, validSamples, sampleChecks }
  })
}

export function isR15_4ReplayRuleHit(hit: { object: string, severity: string }): boolean {
  return hit.object === "shipping_port" && (hit.severity === "critical" || hit.severity === "warning")
}

export interface ReplayPointResult {
  atUtc: string
  ruleHits: Pick<WeatherImpactRuleHit, "ruleId" | "severity" | "object">[]
  counted: boolean
}

export interface ReplayEventResult {
  eventId: string
  weatherSystemId?: string
  portUnlocode: string
  hit: boolean
  hitAtUtc?: string
  hitRuleIds: string[]
  validSampleCount: number
  missReason?: string
  points: ReplayPointResult[]
}

/** Evaluate ALL valid in-window points of one eligible event; the event counts once. */
export function replayEligibleEvent(event: PortClosureReplayEvent, validSamples: readonly ReplayWeatherSample[]): ReplayEventResult {
  const points: ReplayPointResult[] = validSamples.map((s) => {
    const ruleHits = evaluateWeatherImpactRules(s.inputs).map(h => ({ ruleId: h.ruleId, severity: h.severity, object: h.object }))
    return { atUtc: s.atUtc, ruleHits, counted: ruleHits.some(isR15_4ReplayRuleHit) }
  })
  const first = points.find(p => p.counted)
  return {
    eventId: event.eventId,
    weatherSystemId: event.weatherSystemId,
    portUnlocode: event.portUnlocode,
    hit: Boolean(first),
    hitAtUtc: first?.atUtc,
    hitRuleIds: first ? first.ruleHits.filter(isR15_4ReplayRuleHit).map(h => h.ruleId) : [],
    validSampleCount: points.length,
    missReason: first ? undefined : "no_shipping_port_warning_or_critical_in_window",
    points,
  }
}

export interface R15_4ReplayReport {
  status: "blocked" | "ready"
  eligibleCount: number
  hits: number
  hitRate: number
  requiredCount: number
  minHitRate: number
  events: ReplayEventResult[]
  rejected: { eventId: string, portUnlocode: string, reasons: string[] }[]
  pendingReview: { eventId: string, portUnlocode: string, reasons: string[] }[]
  /** Weather systems spanning >1 eligible port: hits are correlated, not independent weather processes. */
  correlatedGroups: { weatherSystemId: string, eventIds: string[] }[]
  reason?: string
}

/** Event-level metric: eligible events (incl. misses) are the denominator; rejected/pending are listed separately. `ready` is never PASS. */
export function runR15_4Replay(events: readonly PortClosureReplayEvent[]): R15_4ReplayReport {
  const admissions = admitReplayEvents(events)
  const results: ReplayEventResult[] = []
  admissions.forEach((a, i) => {
    if (a.status === "eligible") results.push(replayEligibleEvent(events[i], a.validSamples))
  })
  const hits = results.filter(r => r.hit).length
  const eligibleCount = results.length
  const hitRate = eligibleCount === 0 ? 0 : hits / eligibleCount
  const groups = new Map<string, string[]>()
  for (const r of results) {
    if (!r.weatherSystemId) continue
    groups.set(r.weatherSystemId, [...(groups.get(r.weatherSystemId) ?? []), r.eventId])
  }
  let reason: string | undefined
  if (eligibleCount < R1_5_4_REQUIRED_QUALIFIED_SAMPLES) reason = `Need ${R1_5_4_REQUIRED_QUALIFIED_SAMPLES} eligible events; have ${eligibleCount}.`
  else if (hitRate < R1_5_4_MIN_HIT_RATE) reason = `Event hit rate ${(hitRate * 100).toFixed(1)}% is below ${R1_5_4_MIN_HIT_RATE * 100}% (${hits}/${eligibleCount}).`
  return {
    status: reason ? "blocked" : "ready",
    eligibleCount,
    hits,
    hitRate,
    requiredCount: R1_5_4_REQUIRED_QUALIFIED_SAMPLES,
    minHitRate: R1_5_4_MIN_HIT_RATE,
    events: results,
    rejected: admissions.filter(a => a.status === "rejected").map(a => ({ eventId: a.eventId, portUnlocode: a.portUnlocode, reasons: a.reasons })),
    pendingReview: admissions.filter(a => a.status === "pending_review").map(a => ({ eventId: a.eventId, portUnlocode: a.portUnlocode, reasons: a.reasons })),
    correlatedGroups: [...groups].filter(([, ids]) => ids.length > 1).map(([weatherSystemId, eventIds]) => ({ weatherSystemId, eventIds })),
    reason,
  }
}

export interface R15_4CalibrationStatus {
  status: "blocked" | "ready"
  qualifiedCount: number
  requiredCount: number
  reason?: string
}

/** Status of the REAL corpus (currently empty). `ready` would still not be a PASS declaration. */
export function getR15_4CalibrationStatus(): R15_4CalibrationStatus {
  const report = runR15_4Replay(qualifiedPortClosureReplayEvents)
  return { status: report.status, qualifiedCount: report.eligibleCount, requiredCount: report.requiredCount, reason: report.reason }
}
