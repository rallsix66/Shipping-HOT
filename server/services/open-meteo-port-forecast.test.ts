import { describe, expect, it } from "vitest"
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
})
