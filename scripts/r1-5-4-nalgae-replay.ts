/**
 * R1.5-4 Nalgae single-event post-hoc replay — reproducible machine output (JSON on stdout).
 * Runs the fixed C1–C8 admission + all-points rule replay over the REAL corpus. No network, no thresholds changed.
 * Usage: node --import tsx/esm --experimental-loader ./scripts/tsx-alias-loader.mjs ./scripts/r1-5-4-nalgae-replay.ts
 */
import process from "node:process"
import { qualifiedPortClosureReplayEvents } from "#/data/weather-calibration/qualified-port-closure-replay"
import { admitReplayEvents, getR15_4CalibrationStatus, runR15_4Replay } from "#/services/weather-calibration-replay"

const admissions = admitReplayEvents(qualifiedPortClosureReplayEvents)
const report = runR15_4Replay(qualifiedPortClosureReplayEvents)
const out = {
  note: "Post-hoc consistency trial on 1 event; not proof of predictive ability. ready would still not be PASS.",
  corpusEventIds: qualifiedPortClosureReplayEvents.map(e => e.eventId),
  admissions: admissions.map(a => ({ eventId: a.eventId, portUnlocode: a.portUnlocode, status: a.status, reasons: a.reasons, sampleChecks: a.sampleChecks })),
  events: report.events.map(e => ({
    eventId: e.eventId,
    hit: e.hit,
    hitAtUtc: e.hitAtUtc ?? null,
    hitRuleIds: e.hitRuleIds,
    validSampleCount: e.validSampleCount,
    missReason: e.missReason ?? null,
    points: e.points.map(p => ({ atUtc: p.atUtc, counted: p.counted, ruleHits: p.ruleHits })),
  })),
  rejected: report.rejected,
  pendingReview: report.pendingReview,
  correlatedGroups: report.correlatedGroups,
  summary: { status: report.status, eligibleCount: report.eligibleCount, hits: report.hits, hitRate: report.hitRate, requiredCount: report.requiredCount, minHitRate: report.minHitRate, reason: report.reason ?? null },
  calibrationStatus: getR15_4CalibrationStatus(),
}
process.stdout.write(`${JSON.stringify(out, null, 2)}\n`)
