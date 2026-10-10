import { describe, expect, it } from "vitest"
import type { NormalizedTropicalCyclone } from "#/services/jma-typhoon-parse"
import { minTyphoonDistanceKmForPortInInterval, minTyphoonDistanceKmForWrS03InInterval } from "#/services/tropical-cyclone-display"

const shekou = { portId: "port-shekou", unlocode: "CNSHK", latitude: 22.48, longitude: 113.91 }
const asOfMs = Date.parse("2026-08-15T12:00:00.000Z")

function cyclone(overrides: Partial<NormalizedTropicalCyclone>): NormalizedTropicalCyclone {
  return {
    id: "tc-test",
    basin: "NW_PACIFIC",
    jmaId: "TC9999",
    trackHistory: [],
    forecast: [],
    rawForecastJson: [],
    ...overrides,
  }
}

describe("wr-s03 typhoon distance time validity", () => {
  it("does not use undated history min distance for WR-S03 in interval", () => {
    const sample = cyclone({
      trackHistory: [{ lat: 22.49, lon: 113.92 }],
      current: { lat: 21.0, lon: 150.0, at: "2026-08-15T11:00:00.000Z" },
    })
    const hourEnd = asOfMs + 60 * 60 * 1000 - 1
    expect(minTyphoonDistanceKmForWrS03InInterval(sample, shekou.latitude, shekou.longitude, asOfMs, hourEnd)).toBeUndefined()
    expect(minTyphoonDistanceKmForPortInInterval([sample], shekou, asOfMs, hourEnd, false)).toBeUndefined()
  })

  it("uses forecast point only when its valid time falls inside the impact interval", () => {
    const forecastAt = Date.parse("2026-08-16T12:00:00.000Z")
    const sample = cyclone({
      current: { lat: 21.0, lon: 150.0, at: "2026-08-15T11:00:00.000Z" },
      forecast: [{ lat: 22.49, lon: 113.92, at: "2026-08-16T12:00:00.000Z" }],
    })
    const miss = minTyphoonDistanceKmForWrS03InInterval(sample, shekou.latitude, shekou.longitude, asOfMs, asOfMs + 60 * 60 * 1000)
    expect(miss).toBeUndefined()
    const distance = minTyphoonDistanceKmForWrS03InInterval(
      sample,
      shekou.latitude,
      shekou.longitude,
      forecastAt,
      forecastAt + 60 * 60 * 1000 - 1,
    )
    expect(distance).toBeDefined()
    expect(distance!).toBeLessThan(50)
  })

  it("ignores forecast outside the impact interval", () => {
    const sample = cyclone({
      forecast: [{ lat: 22.49, lon: 113.92, at: "2026-08-25T12:00:00.000Z" }],
    })
    const hourEnd = asOfMs + 60 * 60 * 1000 - 1
    expect(minTyphoonDistanceKmForWrS03InInterval(sample, shekou.latitude, shekou.longitude, asOfMs, hourEnd)).toBeUndefined()
  })
})
