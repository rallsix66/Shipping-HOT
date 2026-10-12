import { describe, expect, it } from "vitest"
import { windGustKmhMeetsMsThreshold, windGustKmhToMs } from "@shared/weather-units"
import { assertNoImplementedWeatherImpact, evaluateWeatherImpactRules, listWeatherImpactRuleIds } from "./weather-impact-engine"
import { PLAN_WIND_GUST_MS } from "#/config/weather-impact-rules"

describe("weather impact rules — shipping-port subset (R1.5-2 / R1.5-3 implemented scope)", () => {
  it("lists WR-S01..WR-S05 only (official-alert table row not implemented)", () => {
    expect(listWeatherImpactRuleIds()).toEqual(["WR-S01", "WR-S02", "WR-S03", "WR-S04", "WR-S05"])
  })

  describe("wR-S01 wind gust m/s", () => {
    it("hits at threshold and just above", () => {
      expect(evaluateWeatherImpactRules({ windGustMs: PLAN_WIND_GUST_MS.wrS01 }).some(h => h.ruleId === "WR-S01")).toBe(true)
      expect(evaluateWeatherImpactRules({ windGustMs: PLAN_WIND_GUST_MS.wrS01 + 0.01 }).some(h => h.ruleId === "WR-S01")).toBe(true)
    })
    it("misses just below threshold", () => {
      expect(evaluateWeatherImpactRules({ windGustMs: PLAN_WIND_GUST_MS.wrS01 - 0.01 }).some(h => h.ruleId === "WR-S01")).toBe(false)
    })
    it("does not hit at 30 km/h (~8.33 m/s)", () => {
      expect(evaluateWeatherImpactRules({ windGustMs: windGustKmhToMs(30) }).some(h => h.ruleId === "WR-S01")).toBe(false)
    })
    it("hits at exact km/h conversion to WR-S01 threshold (50.04 km/h → 13.9 m/s)", () => {
      expect(windGustKmhMeetsMsThreshold(50.04, PLAN_WIND_GUST_MS.wrS01)).toBe(true)
      expect(evaluateWeatherImpactRules({ windGustMs: windGustKmhToMs(50.04) }).some(h => h.ruleId === "WR-S01")).toBe(true)
    })
    it("misses just below converted threshold (50.039 km/h)", () => {
      expect(windGustKmhMeetsMsThreshold(50.039, PLAN_WIND_GUST_MS.wrS01)).toBe(false)
      expect(evaluateWeatherImpactRules({ windGustMs: windGustKmhToMs(50.039) }).some(h => h.ruleId === "WR-S01")).toBe(false)
    })
  })

  describe("wR-S02", () => {
    it("hits at gust and wave boundaries", () => {
      expect(evaluateWeatherImpactRules({ windGustMs: PLAN_WIND_GUST_MS.wrS02 }).some(h => h.ruleId === "WR-S02")).toBe(true)
      expect(evaluateWeatherImpactRules({ waveHeightM: 2.5 }).some(h => h.ruleId === "WR-S02")).toBe(true)
    })
    it("misses below both branches", () => {
      expect(evaluateWeatherImpactRules({ windGustMs: PLAN_WIND_GUST_MS.wrS02 - 0.01, waveHeightM: 2.4 }).some(h => h.ruleId === "WR-S02")).toBe(false)
    })
  })

  describe("wR-S03", () => {
    it("hits typhoon distance boundary", () => {
      expect(evaluateWeatherImpactRules({ typhoonDistanceKm: 300 }).some(h => h.ruleId === "WR-S03")).toBe(true)
      expect(evaluateWeatherImpactRules({ typhoonDistanceKm: 300.1 }).some(h => h.ruleId === "WR-S03")).toBe(false)
    })
    it("hits gust and wave branches", () => {
      expect(evaluateWeatherImpactRules({ windGustMs: PLAN_WIND_GUST_MS.wrS03 }).some(h => h.ruleId === "WR-S03")).toBe(true)
      expect(evaluateWeatherImpactRules({ waveHeightM: 4 }).some(h => h.ruleId === "WR-S03")).toBe(true)
    })
  })

  describe("wR-S04 visibility", () => {
    it("hits below 1000 m and misses at/above", () => {
      expect(evaluateWeatherImpactRules({ visibilityM: 999 }).some(h => h.ruleId === "WR-S04")).toBe(true)
      expect(evaluateWeatherImpactRules({ visibilityM: 1000 }).some(h => h.ruleId === "WR-S04")).toBe(false)
    })
  })

  describe("wR-S05 precipitation", () => {
    it("hits at 100 mm and misses below", () => {
      expect(evaluateWeatherImpactRules({ precipitationMm24h: 100 }).some(h => h.ruleId === "WR-S05")).toBe(true)
      expect(evaluateWeatherImpactRules({ precipitationMm24h: 99.9 }).some(h => h.ruleId === "WR-S05")).toBe(false)
    })
  })

  describe("invalid numeric inputs", () => {
    it("treats NaN/Infinity as missing (no false hit)", () => {
      expect(evaluateWeatherImpactRules({ windGustMs: Number.NaN }).length).toBe(0)
      expect(evaluateWeatherImpactRules({ windGustMs: Number.POSITIVE_INFINITY }).length).toBe(0)
      expect(evaluateWeatherImpactRules({ waveHeightM: Number.NaN, visibilityM: Number.NaN }).length).toBe(0)
    })
  })

  it("r1.5-3: configured rules only emit potential status", () => {
    const hits = evaluateWeatherImpactRules({
      windGustMs: 30,
      waveHeightM: 5,
      typhoonDistanceKm: 100,
      visibilityM: 500,
      precipitationMm24h: 200,
    })
    expect(hits.length).toBeGreaterThan(0)
    expect(() => assertNoImplementedWeatherImpact(hits)).not.toThrow()
    expect(hits.every(h => h.status === "potential" && h.provenance === "system")).toBe(true)
  })
})
