import type { QualifiedPortClosureReplayEvent } from "@shared/weather-impact"
import { describe, expect, it } from "vitest"
import {
  getR15_4CalibrationStatus,
  observationWithinClosureWindow,
  replayQualifiedPortClosureEvent,
} from "./weather-calibration-replay"
import { portClosureReplayCandidates } from "#/data/weather-calibration/port-closure-replay-candidates"
import { qualifiedPortClosureReplayEvents } from "#/data/weather-calibration/qualified-port-closure-replay"

describe("r1.5-4 port closure calibration replay", () => {
  it("qualified corpus is empty — stage remains blocked", () => {
    expect(qualifiedPortClosureReplayEvents.length).toBe(0)
    const status = getR15_4CalibrationStatus()
    expect(status.status).toBe("blocked")
    expect(status.qualifiedCount).toBeLessThan(10)
  })

  it("candidates are not labeled as qualified historical acceptance data", () => {
    expect(portClosureReplayCandidates.length).toBeGreaterThan(0)
    expect(portClosureReplayCandidates.every(c => c.verificationStatus === "blocked")).toBe(true)
  })

  it("does not count a hit when observation is outside the official closure window", () => {
    const fixture: QualifiedPortClosureReplayEvent = {
      id: "fixture-outside-window",
      portUnlocode: "CNSHK",
      closureStartUtc: "2024-09-05T12:00:00.000Z",
      closureEndUtc: "2024-09-07T00:00:00.000Z",
      observationAtUtc: "2024-08-01T00:00:00.000Z",
      inputs: { windGustMs: 30, typhoonDistanceKm: 100 },
      inputProvenance: {
        source: "test-fixture",
        unit: "m/s",
        location: "port",
        referencedAtUtc: "2024-08-01T00:00:00.000Z",
      },
      closureProvenance: { source: "test-fixture" },
    }
    expect(observationWithinClosureWindow(fixture.observationAtUtc, fixture.closureStartUtc, fixture.closureEndUtc)).toBe(false)
    expect(replayQualifiedPortClosureEvent(fixture)).toBe(false)
  })

  it("counts a hit only when observation overlaps closure and rules fire", () => {
    const fixture: QualifiedPortClosureReplayEvent = {
      id: "fixture-inside-window",
      portUnlocode: "CNSHK",
      closureStartUtc: "2024-09-05T12:00:00.000Z",
      closureEndUtc: "2024-09-07T00:00:00.000Z",
      observationAtUtc: "2024-09-06T00:00:00.000Z",
      inputs: { windGustMs: 30, typhoonDistanceKm: 100 },
      inputProvenance: {
        source: "test-fixture",
        unit: "m/s",
        location: "port",
        referencedAtUtc: "2024-09-06T00:00:00.000Z",
      },
      closureProvenance: { source: "test-fixture" },
    }
    expect(replayQualifiedPortClosureEvent(fixture)).toBe(true)
  })
})
