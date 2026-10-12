import type { PortClosureReplayEvent, ReplayWeatherSample } from "@shared/weather-impact"
import { describe, expect, it } from "vitest"
import { admitReplayEvents, getR15_4CalibrationStatus, isR15_4ReplayRuleHit, runR15_4Replay } from "./weather-calibration-replay"
import { PLAN_WIND_GUST_MS } from "#/config/weather-impact-rules"
import { portClosureReplayCandidates } from "#/data/weather-calibration/port-closure-replay-candidates"
import { qualifiedPortClosureReplayEvents } from "#/data/weather-calibration/qualified-port-closure-replay"

// All events below are SYNTHETIC test fixtures (example.org); they are never part of the real corpus.
const START = "2030-01-01T00:00:00Z"
const END = "2030-01-02T00:00:00Z"

function sample(atUtc: string, inputs: ReplayWeatherSample["inputs"], over: Partial<ReplayWeatherSample["provenance"]> = {}): ReplayWeatherSample {
  const units: ReplayWeatherSample["provenance"]["units"] = {}
  if (inputs.windGustMs !== undefined) units.windGustMs = "m/s"
  if (inputs.typhoonDistanceKm !== undefined) units.typhoonDistanceKm = "km"
  if (inputs.waveHeightM !== undefined) units.waveHeightM = "m"
  return {
    atUtc,
    inputs,
    provenance: { productId: "fixture-product", productApproved: true, source: "fixture", kind: "observation", locationLabel: "fixture station", latitude: 22.5, longitude: 113.9, units, ...over },
  }
}

function event(id: string, over: Partial<PortClosureReplayEvent> = {}): PortClosureReplayEvent {
  return {
    eventId: id,
    portUnlocode: "CNSHK",
    operationScope: "fixture gate pickup/drop-off",
    stopSource: { url: "https://example.org/stop", publisher: "operator", quote: "fixture stop 08:00" },
    resumeSource: { url: "https://example.org/resume", publisher: "operator", quote: "fixture resume 08:00" },
    timeZoneBasis: { statedOffset: null, inferredOffset: "UTC+8", inferenceReason: "fixture: local operator, local clock", ambiguous: false },
    closureStartUtc: START,
    closureEndUtc: END,
    samples: [sample("2030-01-01T06:00:00Z", { windGustMs: 30 })],
    ...over,
  }
}

describe("r1.5-4 replay: real corpus", () => {
  it("real qualified corpus stays empty and blocked (no synthetic events, no PASS)", () => {
    expect(qualifiedPortClosureReplayEvents.length).toBe(0)
    const status = getR15_4CalibrationStatus()
    expect(status.status).toBe("blocked")
    expect(status.qualifiedCount).toBe(0)
  })

  it("candidates (incl. HKO/Nalgae) are not qualified", () => {
    expect(portClosureReplayCandidates.every(c => c.verificationStatus === "blocked")).toBe(true)
    expect(portClosureReplayCandidates.some(c => c.id === "2022-nalgae-shekou-gate")).toBe(true)
  })
})

describe("r1.5-4 replay: C1–C8 admission", () => {
  it("rejects out-of-scope port, missing scope, non-https locator, missing quote, missing tz basis, invalid window", () => {
    const [a, b, c, d, e] = admitReplayEvents([
      event("e-port", { portUnlocode: "CNSHA" }),
      event("e-scope", { operationScope: " " }),
      event("e-url", { stopSource: { url: "http://example.org/x", publisher: "operator", quote: "q" } }),
      event("e-tz", { timeZoneBasis: { statedOffset: null, ambiguous: false } }),
      event("e-window", { closureStartUtc: END, closureEndUtc: START }),
    ])
    expect(a.reasons).toContain("C2:port_outside_eight_ports")
    expect(b.reasons).toContain("C3:missing_operation_scope")
    expect(c.reasons).toContain("C4:stop_locator_invalid")
    expect(d.reasons).toContain("C5:time_zone_basis_missing")
    expect(e.reasons).toContain("C5:invalid_utc_window")
    expect([a, b, c, d, e].every(x => x.status === "rejected")).toBe(true)
  })

  it("rejects unapproved product, wrong unit, untimed/non-UTC point, and centre wind used as gust", () => {
    const [a, b, c, d] = admitReplayEvents([
      event("s-unapproved", { samples: [sample("2030-01-01T06:00:00Z", { typhoonDistanceKm: 50 }, { productApproved: false, kind: "derived_distance" })] }),
      event("s-unit", { samples: [sample("2030-01-01T06:00:00Z", { windGustMs: 30 }, { units: { windGustMs: "km/h" } })] }),
      event("s-time", { samples: [sample("2030-01-01 06:00", { windGustMs: 30 })] }),
      event("s-centre", { samples: [sample("2030-01-01T06:00:00Z", { windGustMs: 40 }, { kind: "post_analysis" })] }),
    ])
    expect(a.sampleChecks[0].reasons).toContain("C6:product_not_approved")
    expect(b.sampleChecks[0].reasons).toContain("C6:unit_mismatch:windGustMs")
    expect(c.sampleChecks[0].reasons).toContain("C6:sample_time_not_utc_iso")
    expect(d.sampleChecks[0].reasons).toContain("C6:gust_not_point_observation_or_forecast")
    for (const x of [a, b, c, d]) {
      expect(x.status).toBe("rejected")
      expect(x.reasons).toContain("C6:no_valid_samples_in_window")
    }
  })

  it("rejects duplicate event id and duplicate weather-system/port pair (no splitting one event)", () => {
    const r = admitReplayEvents([
      event("dup", { weatherSystemId: "TC-X" }),
      event("dup"),
      event("dup-2", { weatherSystemId: "TC-X" }),
    ])
    expect(r[0].status).toBe("eligible")
    expect(r[1].reasons).toContain("C1:duplicate_event_id")
    expect(r[2].reasons).toContain("C1:duplicate_event_port")
  })

  it("ambiguous time zone → pending manual review, not eligible", () => {
    const [a] = admitReplayEvents([event("tz-amb", { timeZoneBasis: { statedOffset: null, inferredOffset: "UTC+7", inferenceReason: "Indonesia multi-zone", ambiguous: true } })])
    expect(a.status).toBe("pending_review")
    const report = runR15_4Replay([event("tz-amb", { timeZoneBasis: { statedOffset: null, inferredOffset: "UTC+7", inferenceReason: "x", ambiguous: true } })])
    expect(report.eligibleCount).toBe(0)
    expect(report.pendingReview).toHaveLength(1)
  })

  it("window boundaries are inclusive; points outside are excluded, not counted", () => {
    const samples = [
      sample("2029-12-31T23:59:59Z", { windGustMs: 30 }),
      sample(START, { windGustMs: 10 }),
      sample(END, { windGustMs: 10 }),
      sample("2030-01-02T00:00:01Z", { windGustMs: 30 }),
    ]
    const [a] = admitReplayEvents([event("bounds", { samples })])
    expect(a.status).toBe("eligible")
    expect(a.validSamples.map(s => s.atUtc)).toEqual([START, END])
    expect(a.sampleChecks.filter(c => !c.valid).every(c => c.reasons.includes("C7:outside_closure_window"))).toBe(true)
    const report = runR15_4Replay([event("bounds", { samples })])
    expect(report.events[0].hit).toBe(false)
    expect(report.events[0].validSampleCount).toBe(2)
  })
})

describe("r1.5-4 replay: event-level metric", () => {
  it("evaluates every valid point, counts the event once, reports first hit time and rule id", () => {
    const report = runR15_4Replay([event("multi", { samples: [
      sample("2030-01-01T18:00:00Z", { windGustMs: 30 }),
      sample("2030-01-01T00:00:00Z", { windGustMs: 10 }),
      sample("2030-01-01T06:00:00Z", { windGustMs: 18 }),
    ] })])
    const r = report.events[0]
    expect(report.eligibleCount).toBe(1)
    expect(report.hits).toBe(1)
    expect(r.validSampleCount).toBe(3)
    expect(r.points.map(p => p.atUtc)).toEqual(["2030-01-01T00:00:00Z", "2030-01-01T06:00:00Z", "2030-01-01T18:00:00Z"])
    expect(r.points.map(p => p.counted)).toEqual([false, true, true])
    expect(r.hitAtUtc).toBe("2030-01-01T06:00:00Z")
    expect(r.hitRuleIds).toEqual(["WR-S02"])
  })

  it("watch-only stays a miss; eligible misses remain in the denominator", () => {
    const report = runR15_4Replay([
      event("miss", { samples: [sample("2030-01-01T06:00:00Z", { windGustMs: PLAN_WIND_GUST_MS.wrS01 })] }),
      event("hit"),
    ])
    expect(report.eligibleCount).toBe(2)
    expect(report.hits).toBe(1)
    expect(report.hitRate).toBe(0.5)
    expect(report.events.find(e => e.eventId === "miss")?.missReason).toBe("no_shipping_port_warning_or_critical_in_window")
    expect(isR15_4ReplayRuleHit({ object: "shipping_port", severity: "watch" })).toBe(false)
  })

  it("wR-S03 may use cyclone distance from an approved derived-distance product", () => {
    const report = runR15_4Replay([event("tc", { samples: [sample("2030-01-01T06:00:00Z", { typhoonDistanceKm: 120 }, { kind: "derived_distance" })] })])
    expect(report.events[0].hitRuleIds).toContain("WR-S03")
  })

  it("rejected events are listed separately and never enter the denominator", () => {
    const report = runR15_4Replay([event("ok"), event("bad", { portUnlocode: "TWKHH" })])
    expect(report.eligibleCount).toBe(1)
    expect(report.rejected.map(r => r.eventId)).toEqual(["bad"])
  })

  it("cross-port events of one typhoon are disclosed as a correlated group", () => {
    const report = runR15_4Replay([event("a", { weatherSystemId: "TC-Y" }), event("b", { weatherSystemId: "TC-Y", portUnlocode: "CNYTN" })])
    expect(report.correlatedGroups).toEqual([{ weatherSystemId: "TC-Y", eventIds: ["a", "b"] }])
  })

  const miss = (id: string) => event(id, { samples: [sample("2030-01-01T06:00:00Z", { windGustMs: 5 })] })
  const ids = (n: number, p: string) => Array.from({ length: n }, (_, i) => `${p}-${i}`)

  it("decision: 9 eligible all hit → blocked (count)", () => {
    const r = runR15_4Replay(ids(9, "h").map(id => event(id)))
    expect(r.status).toBe("blocked")
    expect(r.reason).toContain("Need 10")
  })

  it("decision: 10 eligible with 8 hits (80%) → ready (still not PASS)", () => {
    const r = runR15_4Replay([...ids(8, "h").map(id => event(id)), ...ids(2, "m").map(miss)])
    expect(r.hitRate).toBe(0.8)
    expect(r.status).toBe("ready")
  })

  it("decision: 10 eligible with 7 hits (70%) → blocked (rate)", () => {
    const r = runR15_4Replay([...ids(7, "h").map(id => event(id)), ...ids(3, "m").map(miss)])
    expect(r.status).toBe("blocked")
    expect(r.reason).toContain("below 80%")
  })

  it("decision: 9 eligible + 1 rejected does not reach 10", () => {
    const r = runR15_4Replay([...ids(9, "h").map(id => event(id)), event("x", { portUnlocode: "CNSHA" })])
    expect(r.eligibleCount).toBe(9)
    expect(r.status).toBe("blocked")
  })
})
