import { describe, expect, it } from "vitest"
import { evaluatePointWeatherRules } from "./weather-rule-evaluation"

function fullPrecip24() {
  const base = Date.parse("2026-08-14T13:00:00.000Z")
  return Array.from({ length: 24 }, (_, index) => ({
    timestamp: new Date(base + index * 60 * 60 * 1000).toISOString(),
    precipitationMm: 0,
    horizon: "hourly" as const,
  }))
}

describe("weather rule coverage (WR-S01..S03 OR limbs)", () => {
  const end = "2026-08-15T12:00:00.000Z"
  const precip = fullPrecip24()

  it("full precip + visibility but missing gust/wave marks S01-S03 unevaluated, not no_hit", () => {
    const result = evaluatePointWeatherRules({ visibilityM: 5000 }, precip, end)
    expect(result.ruleCoverage.find(r => r.ruleId === "WR-S01")).toMatchObject({ evaluation: "unevaluated", reason: "wind_gust_missing" })
    expect(result.ruleCoverage.find(r => r.ruleId === "WR-S02")).toMatchObject({ evaluation: "unevaluated" })
    expect(result.ruleCoverage.find(r => r.ruleId === "WR-S02")?.reason).toContain("wind_gust_missing")
    expect(result.ruleCoverage.find(r => r.ruleId === "WR-S03")?.reason).toContain("typhoon_data_unavailable")
    expect(result.ruleCoverage.find(r => r.ruleId === "WR-S04")?.reason).toBe("no_hit")
    expect(result.hits).toHaveLength(0)
  })

  it("or rule keeps hit when a single limb is sufficient (gust only)", () => {
    const result = evaluatePointWeatherRules({ windGustMs: 18, visibilityM: 5000 }, precip, end)
    expect(result.hits.some(h => h.ruleId === "WR-S02")).toBe(true)
    expect(result.ruleCoverage.find(r => r.ruleId === "WR-S02")).toMatchObject({ evaluation: "evaluated", reason: "hit" })
  })

  it("no hit with missing alternate OR limb stays unevaluated", () => {
    const result = evaluatePointWeatherRules({ windGustMs: 10, waveHeightM: 1, visibilityM: 5000 }, precip, end)
    expect(result.hits.some(h => h.ruleId === "WR-S02")).toBe(false)
    expect(result.ruleCoverage.find(r => r.ruleId === "WR-S02")).toMatchObject({ evaluation: "evaluated", reason: "no_hit" })
    const s03 = result.ruleCoverage.find(r => r.ruleId === "WR-S03")
    expect(s03?.evaluation).toBe("unevaluated")
    expect(s03?.reason).toContain("typhoon_data_unavailable")
  })

  it("no hit with missing wave on WR-S02 is unevaluated, not no_hit", () => {
    const result = evaluatePointWeatherRules({ windGustMs: 10, visibilityM: 5000 }, precip, end)
    expect(result.ruleCoverage.find(r => r.ruleId === "WR-S02")).toMatchObject({ evaluation: "unevaluated" })
    expect(result.ruleCoverage.find(r => r.ruleId === "WR-S02")?.reason).toContain("wave_height_missing")
  })

  it("all relevant inputs sufficient and no threshold hit yields evaluated no_hit (S01/S02)", () => {
    const result = evaluatePointWeatherRules({ windGustMs: 5, waveHeightM: 0.5, visibilityM: 5000 }, precip, end)
    expect(result.ruleCoverage.find(r => r.ruleId === "WR-S01")).toMatchObject({ evaluation: "evaluated", reason: "no_hit" })
    expect(result.ruleCoverage.find(r => r.ruleId === "WR-S02")).toMatchObject({ evaluation: "evaluated", reason: "no_hit" })
    expect(result.hits).toHaveLength(0)
  })

  it("evaluates WR-S03 typhoon limb when JMA distance is checked", () => {
    const full = fullPrecip24()
    const near = evaluatePointWeatherRules(
      { windGustMs: 5, waveHeightM: 0.5, visibilityM: 5000 },
      full,
      end,
      { status: "checked", distanceKm: 250 },
    )
    expect(near.hits.some(h => h.ruleId === "WR-S03")).toBe(true)
    const far = evaluatePointWeatherRules(
      { windGustMs: 5, waveHeightM: 0.5, visibilityM: 5000 },
      full,
      end,
      { status: "checked", distanceKm: 500 },
    )
    expect(far.ruleCoverage.find(r => r.ruleId === "WR-S03")?.reason).toBe("no_hit")
  })

  it("nan gust is unevaluated invalid, not evaluated no_hit", () => {
    const result = evaluatePointWeatherRules({ windGustMs: Number.NaN, waveHeightM: 0.5, visibilityM: 5000 }, precip, end)
    expect(result.ruleCoverage.find(r => r.ruleId === "WR-S01")).toMatchObject({ evaluation: "unevaluated", reason: "wind_gust_invalid" })
  })
})
