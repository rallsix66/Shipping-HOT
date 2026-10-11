import { describe, expect, it } from "vitest"
import { evaluatePointWeatherRules } from "./weather-rule-evaluation"

function hourlyPrecipSeries(count: number, mmPerHour: number, endIso: string) {
  const endMs = Date.parse(endIso)
  return Array.from({ length: count }, (_, index) => ({
    timestamp: new Date(endMs - (count - 1 - index) * 60 * 60 * 1000).toISOString(),
    precipitationMm: mmPerHour,
    horizon: "hourly" as const,
  }))
}

describe("evaluatePointWeatherRules", () => {
  const end = "2026-08-15T12:00:00.000Z"

  it("evaluates WR-S05 only on 24/24 full precip", () => {
    const full = hourlyPrecipSeries(24, 1, end)
    const evalFull = evaluatePointWeatherRules({ windGustMs: 5, waveHeightM: 0.5, visibilityM: 5000 }, full, end)
    expect(evalFull.precipCoverage.status).toBe("full")
    expect(evalFull.ruleCoverage.find(r => r.ruleId === "WR-S05")?.evaluation).toBe("evaluated")
    expect(evalFull.hits.some(h => h.ruleId === "WR-S05")).toBe(false)
  })

  it("18/24 partial: WR-S05 unevaluated, WR-S01 still evaluated", () => {
    const partial = hourlyPrecipSeries(18, 10, end)
    const result = evaluatePointWeatherRules({ windGustMs: 20, waveHeightM: 0.5, visibilityM: 5000 }, partial, end)
    expect(result.precipCoverage.status).toBe("partial")
    expect(result.ruleCoverage.find(r => r.ruleId === "WR-S05")).toMatchObject({ evaluation: "unevaluated" })
    expect(result.hits.some(h => h.ruleId === "WR-S02")).toBe(true)
    expect(result.hits.some(h => h.ruleId === "WR-S05")).toBe(false)
  })

  it("1/24 insufficient: WR-S05 unevaluated without treating as no_hit", () => {
    const sparse = hourlyPrecipSeries(1, 500, end)
    const result = evaluatePointWeatherRules({ windGustMs: 5, waveHeightM: 0.5, visibilityM: 5000 }, sparse, end)
    expect(result.precipCoverage.status).toBe("insufficient")
    const wrS05 = result.ruleCoverage.find(r => r.ruleId === "WR-S05")
    expect(wrS05?.evaluation).toBe("unevaluated")
    expect(wrS05?.reason).toContain("1_of_24")
    expect(result.hits.some(h => h.ruleId === "WR-S05")).toBe(false)
  })

  it("full 24/24 with 100mm triggers WR-S05 hit", () => {
    const base = Date.parse("2026-08-14T13:00:00.000Z")
    const samples = Array.from({ length: 24 }, (_, index) => ({
      timestamp: new Date(base + index * 60 * 60 * 1000).toISOString(),
      precipitationMm: index === 23 ? 100 : 0,
      horizon: "hourly" as const,
    }))
    const result = evaluatePointWeatherRules({ windGustMs: 5, visibilityM: 5000 }, samples, end)
    expect(result.precipCoverage.status).toBe("full")
    expect(result.hits.some(h => h.ruleId === "WR-S05")).toBe(true)
  })
})
