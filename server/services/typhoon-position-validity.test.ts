import { describe, expect, it } from "vitest"
import type { NormalizedTropicalCyclone } from "#/services/jma-typhoon-parse"
import {
  TYPHOON_CURRENT_POSITION_VALID_MS,
  currentPositionApplicability,
  forecastPointApplicability,
  minTyphoonDistanceKmForWrS03InInterval,
} from "#/services/typhoon-position-validity"

const shekou = { lat: 22.48, lon: 113.91 }

function cyclone(overrides: Partial<NormalizedTropicalCyclone>): NormalizedTropicalCyclone {
  return {
    id: "tc",
    basin: "NW_PACIFIC",
    jmaId: "TC1",
    trackHistory: [],
    forecast: [],
    rawForecastJson: [],
    lifecycleStatus: "active",
    ...overrides,
  }
}

describe("typhoon position validity windows", () => {
  it("applies 12:00 current positioning to 12:15 weather current interval", () => {
    const atMs = Date.parse("2026-08-15T12:00:00.000Z")
    const sample = cyclone({
      current: { lat: 22.49, lon: 113.92, at: "2026-08-15T12:00:00.000Z" },
    })
    const window = currentPositionApplicability(sample)
    expect(window).toBeDefined()
    expect(window!.untilMs - window!.fromMs).toBe(TYPHOON_CURRENT_POSITION_VALID_MS)
    const impactFrom = Date.parse("2026-08-15T12:15:00.000Z")
    const impactUntil = impactFrom + 15 * 60 * 1000 - 1
    const distance = minTyphoonDistanceKmForWrS03InInterval(sample, shekou.lat, shekou.lon, impactFrom, impactUntil)
    expect(distance).toBeDefined()
    expect(distance!).toBeLessThan(50)
    void atMs
  })

  it("does not extend current applicability across hourly boundary after TTL", () => {
    const sample = cyclone({
      current: { lat: 22.49, lon: 113.92, at: "2026-08-15T08:00:00.000Z" },
    })
    const impactFrom = Date.parse("2026-08-15T12:00:00.000Z")
    const impactUntil = impactFrom + 60 * 60 * 1000 - 1
    expect(minTyphoonDistanceKmForWrS03InInterval(sample, shekou.lat, shekou.lon, impactFrom, impactUntil)).toBeUndefined()
  })

  it("uses sparse forecast window until default horizon", () => {
    const sample = cyclone({
      forecast: [{ lat: 22.49, lon: 113.92, at: "2026-08-17T12:00:00.000Z" }],
    })
    const window = forecastPointApplicability(sample.forecast, 0)
    expect(window).toBeDefined()
    const impactFrom = Date.parse("2026-08-17T12:30:00.000Z")
    const impactUntil = impactFrom + 60 * 60 * 1000
    expect(minTyphoonDistanceKmForWrS03InInterval(sample, shekou.lat, shekou.lon, impactFrom, impactUntil)).toBeDefined()
    const earlyImpactFrom = Date.parse("2026-08-15T12:00:00.000Z")
    expect(minTyphoonDistanceKmForWrS03InInterval(
      sample,
      shekou.lat,
      shekou.lon,
      earlyImpactFrom,
      earlyImpactFrom + 60 * 60 * 1000,
    )).toBeUndefined()
  })
})
