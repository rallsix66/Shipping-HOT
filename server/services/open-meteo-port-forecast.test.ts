import { describe, expect, it } from "vitest"
import { PRECIP_24H_FULL_HOURLY_SAMPLES } from "./precipitation-window"
import { assertValidImpactInterval } from "./weather-impact-interval"
import { evaluateWeatherImpactRules } from "./weather-impact-engine"
import { computePortWeatherImpacts, mergeOpenMeteoPortPoints, openMeteoPointsToForecastRows } from "./open-meteo-port-forecast"

describe("open-meteo port forecast normalize", () => {
  it("merges marine wave and land wind/precip/visibility hourly points", () => {
    const marine = {
      hourly: {
        time: ["2026-08-15T00:00:00.000Z", "2026-08-15T01:00:00.000Z"],
        wave_height: [1.2, 2.8],
        swell_wave_height: [0.8, 1.1],
      },
    }
    const land = {
      hourly: {
        time: ["2026-08-15T00:00:00.000Z", "2026-08-15T01:00:00.000Z"],
        wind_gusts_10m: [40, 70],
        precipitation: [2, 3],
        visibility: [5000, 900],
      },
    }
    const points = mergeOpenMeteoPortPoints(marine, land)
    expect(points).toHaveLength(2)
    expect(points[1]).toMatchObject({ waveHeightM: 2.8, windGustKmh: 70, visibilityM: 900, precipitationMm: 3 })
    const rows = openMeteoPointsToForecastRows("port-shekou", "CNSHK", points, "2026-08-15T00:00:00.000Z")
    expect(rows[0].portId).toBe("port-shekou")
    const impacts = computePortWeatherImpacts("port-shekou", points, "2026-08-15T00:00:00.000Z")
    expect(impacts.some(i => i.ruleId === "WR-S04")).toBe(true)
  })

  it("computes WR-S05 from rolling 24h precipitation ending at current horizon", () => {
    const base = Date.parse("2026-08-14T13:00:00.000Z")
    const hourly = Array.from({ length: PRECIP_24H_FULL_HOURLY_SAMPLES }, (_, index) => ({
      timestamp: new Date(base + index * 60 * 60 * 1000).toISOString(),
      horizon: "hourly" as const,
      precipitationMm: index === PRECIP_24H_FULL_HOURLY_SAMPLES - 1 ? 100 : 0,
    }))
    const points = [...hourly, {
      timestamp: "2026-08-15T12:00:00.000Z",
      horizon: "current" as const,
      precipitationMm: 100,
    }]
    const impacts = computePortWeatherImpacts("port-shekou", points, "2026-08-15T12:00:00.000Z")
    expect(impacts.some(i => i.ruleId === "WR-S05")).toBe(true)
    expect(evaluateWeatherImpactRules({ precipitationMm24h: 99.9 }).some(h => h.ruleId === "WR-S05")).toBe(false)
  })

  it("keeps validUntil > validFrom when hourly and current share a timestamp", () => {
    const ts = "2026-08-15T12:30:00.000Z"
    const points = [
      { timestamp: ts, horizon: "hourly" as const, windGustKmh: 50, waveHeightM: 1 },
      { timestamp: ts, horizon: "current" as const, windGustKmh: 55, waveHeightM: 1.1 },
      { timestamp: "2026-08-15T18:00:00.000Z", horizon: "hourly" as const, windGustKmh: 30 },
    ]
    const impacts = computePortWeatherImpacts("port-shekou", points, ts)
    expect(impacts.length).toBeGreaterThan(0)
    for (const row of impacts) {
      expect(assertValidImpactInterval({ validFrom: row.validFrom, validUntil: row.validUntil })).toBe(true)
    }
  })

  it("does not stretch hourly impact past one hour when next hour is missing", () => {
    const points = [
      { timestamp: "2026-08-15T12:00:00.000Z", horizon: "hourly" as const, windGustKmh: 70, waveHeightM: 3 },
      { timestamp: "2026-08-15T15:00:00.000Z", horizon: "hourly" as const, windGustKmh: 30 },
    ]
    const impacts = computePortWeatherImpacts("port-shekou", points, "2026-08-15T12:00:00.000Z")
    const first = impacts.find(i => i.validFrom.startsWith("2026-08-15T12"))
    expect(first).toBeDefined()
    const untilMs = Date.parse(first!.validUntil)
    const fromMs = Date.parse(first!.validFrom)
    expect(untilMs - fromMs).toBeLessThanOrEqual(60 * 60 * 1000)
    expect(untilMs).toBeGreaterThan(fromMs)
  })
})
