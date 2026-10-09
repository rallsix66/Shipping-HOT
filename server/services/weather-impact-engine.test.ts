import { describe, expect, it } from "vitest"
import { assertNoImplementedWeatherImpact, evaluateWeatherImpactRules, listWeatherImpactRuleIds } from "./weather-impact-engine"

describe("weather impact rules (R1.5-2 / R1.5-3)", () => {
  it("lists configured rule ids from plan §4.8 initial table", () => {
    expect(listWeatherImpactRuleIds()).toEqual(["WR-S01", "WR-S02", "WR-S03", "WR-S04", "WR-S05"])
  })

  it("wR-S01 hit and miss", () => {
    const hit = evaluateWeatherImpactRules({ windGustKmh: 14 })
    expect(hit.some(h => h.ruleId === "WR-S01" && h.status === "potential" && h.provenance === "system")).toBe(true)
    const miss = evaluateWeatherImpactRules({ windGustKmh: 10 })
    expect(miss.some(h => h.ruleId === "WR-S01")).toBe(false)
  })

  it("wR-S02 hit via gust and miss below thresholds", () => {
    expect(evaluateWeatherImpactRules({ windGustKmh: 18 }).some(h => h.ruleId === "WR-S02")).toBe(true)
    expect(evaluateWeatherImpactRules({ waveHeightM: 2.6 }).some(h => h.ruleId === "WR-S02")).toBe(true)
    expect(evaluateWeatherImpactRules({ windGustKmh: 16, waveHeightM: 2 }).some(h => h.ruleId === "WR-S02")).toBe(false)
  })

  it("wR-S03 typhoon proximity hit", () => {
    const hit = evaluateWeatherImpactRules({ typhoonDistanceKm: 250 })
    const row = hit.find(h => h.ruleId === "WR-S03")
    expect(row?.severity).toBe("critical")
    expect(row?.inputValues.typhoonDistanceKm).toBe(250)
  })

  it("wR-S04 visibility and WR-S05 precipitation", () => {
    expect(evaluateWeatherImpactRules({ visibilityM: 800 }).some(h => h.ruleId === "WR-S04")).toBe(true)
    expect(evaluateWeatherImpactRules({ visibilityM: 1500 }).some(h => h.ruleId === "WR-S04")).toBe(false)
    expect(evaluateWeatherImpactRules({ precipitationMm24h: 120 }).some(h => h.ruleId === "WR-S05")).toBe(true)
  })

  it("never produces implemented status (R1.5-3)", () => {
    const hits = evaluateWeatherImpactRules({
      windGustKmh: 30,
      waveHeightM: 5,
      typhoonDistanceKm: 100,
      visibilityM: 500,
      precipitationMm24h: 200,
    })
    expect(hits.length).toBeGreaterThan(0)
    expect(() => assertNoImplementedWeatherImpact(hits)).not.toThrow()
    expect(hits.every(h => h.status === "potential")).toBe(true)
  })
})
