import { describe, expect, it } from "vitest"
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
    const hourly = Array.from({ length: 24 }, (_, index) => ({
      timestamp: new Date(base + index * 60 * 60 * 1000).toISOString(),
      horizon: "hourly" as const,
      precipitationMm: index === 23 ? 100 : 0,
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
})
