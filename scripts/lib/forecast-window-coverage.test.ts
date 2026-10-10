import { describe, expect, it } from "vitest"
import type { CoverageRow } from "./forecast-window-coverage.mjs"
import { HOUR_MS, evaluateForecastWindowCoverage } from "./forecast-window-coverage.mjs"

function full(t: number, horizon = "hourly"): CoverageRow {
  return {
    forecastAt: new Date(t).toISOString(),
    horizon,
    windGustKmh: 20,
    precipitationMm: 0,
    visibilityM: 10000,
    waveHeightM: 1,
    swellWaveHeightM: 0.5,
  }
}

function grid(fromMs: number, toMs: number): CoverageRow[] {
  const rows: CoverageRow[] = []
  for (let t = fromMs; t <= toMs; t += HOUR_MS) rows.push(full(t))
  return rows
}

const NOW = Date.parse("2026-10-10T02:49:00.000Z")
const floorH = (ms: number) => Math.floor(ms / HOUR_MS) * HOUR_MS

describe("evaluateForecastWindowCoverage", () => {
  it("passes a complete hourly grid over [now-1h, now+7d] and keeps current separate", () => {
    const rows = [...grid(floorH(NOW - HOUR_MS), floorH(NOW + 7 * 24 * HOUR_MS)), full(NOW, "current")]
    const result = evaluateForecastWindowCoverage(rows, NOW)
    expect(result.pass).toBe(true)
    expect(result.currentRows).toBe(1)
    expect(result.hourlyInWindow).toBe(result.window.expectedHours)
  })

  it("does not let current rows pad hourly coverage", () => {
    const rows = grid(floorH(NOW), floorH(NOW + 7 * 24 * HOUR_MS) - HOUR_MS)
    rows.push(full(floorH(NOW + 7 * 24 * HOUR_MS), "current"))
    const result = evaluateForecastWindowCoverage(rows, NOW)
    expect(result.failed).toContain("window_end_covered")
  })

  it("fails when the forecast is one day short even though hourly >= 140", () => {
    const rows = grid(floorH(NOW), floorH(NOW + 6 * 24 * HOUR_MS))
    const result = evaluateForecastWindowCoverage(rows, NOW)
    expect(result.hourlyInWindow).toBeGreaterThanOrEqual(140)
    expect(result.pass).toBe(false)
    expect(result.failed).toEqual(expect.arrayContaining(["window_end_covered", "no_missing_hours"]))
    expect(result.missingHoursCount).toBe(24)
  })

  it("fails when an Open-Meteo forecast_days=7 calendar grid stops at 23:00 of day 7", () => {
    const rows = grid(Date.parse("2026-10-10T00:00:00.000Z"), Date.parse("2026-10-16T23:00:00.000Z"))
    const result = evaluateForecastWindowCoverage(rows, NOW)
    expect(result.failed).toContain("window_end_covered")
    expect(result.missingHoursSample[0]).toBe("2026-10-17T00:00:00.000Z")
  })

  it("fails on duplicate timestamps", () => {
    const rows = grid(floorH(NOW), floorH(NOW + 7 * 24 * HOUR_MS))
    rows.push(full(floorH(NOW) + 5 * HOUR_MS))
    const result = evaluateForecastWindowCoverage(rows, NOW)
    expect(result.failed).toContain("hourly_timestamps_unique")
  })

  it("fails on missing hours inside the window", () => {
    const rows = grid(floorH(NOW), floorH(NOW + 7 * 24 * HOUR_MS)).filter((_, i) => i !== 30 && i !== 31)
    const result = evaluateForecastWindowCoverage(rows, NOW)
    expect(result.failed).toContain("no_missing_hours")
    expect(result.maxGapHours).toBe(3)
  })

  it("fails on missing start hour", () => {
    const rows = grid(floorH(NOW) + HOUR_MS, floorH(NOW + 7 * 24 * HOUR_MS))
    const result = evaluateForecastWindowCoverage(rows, NOW)
    expect(result.failed).toContain("window_start_covered")
  })

  it("computes the grid correctly near UTC midnight", () => {
    const now = Date.parse("2026-10-10T23:59:30.000Z")
    const rows = grid(Date.parse("2026-10-10T23:00:00.000Z"), Date.parse("2026-10-17T23:00:00.000Z"))
    const result = evaluateForecastWindowCoverage(rows, now)
    expect(result.window.gridStart).toBe("2026-10-10T23:00:00.000Z")
    expect(result.window.gridEnd).toBe("2026-10-17T23:00:00.000Z")
    expect(result.pass).toBe(true)
    const short = evaluateForecastWindowCoverage(rows.slice(1), now)
    expect(short.failed).toContain("window_start_covered")
  })

  it("detects a truncated earliest-N read that drops future hours", () => {
    const past = grid(floorH(NOW) - 48 * HOUR_MS, floorH(NOW) - 2 * HOUR_MS)
    const all = [...past, ...grid(floorH(NOW), floorH(NOW + 7 * 24 * HOUR_MS))]
    const earliest172 = [...all].sort((a, b) => Date.parse(a.forecastAt) - Date.parse(b.forecastAt)).slice(0, 172)
    expect(evaluateForecastWindowCoverage(all, NOW).pass).toBe(true)
    const truncated = evaluateForecastWindowCoverage(earliest172, NOW)
    expect(truncated.failed).toContain("window_end_covered")
  })

  it("treats 'missing marine with a note' as not covered", () => {
    const rows = grid(floorH(NOW), floorH(NOW + 7 * 24 * HOUR_MS)).map(r => ({ ...r, waveHeightM: undefined, swellWaveHeightM: undefined }))
    const result = evaluateForecastWindowCoverage(rows, NOW)
    expect(result.failed).toEqual(["marine_wave_or_swell_present"])
  })

  it("fails required land fields", () => {
    const rows = grid(floorH(NOW), floorH(NOW + 7 * 24 * HOUR_MS))
    rows[3] = { ...rows[3], visibilityM: undefined }
    expect(evaluateForecastWindowCoverage(rows, NOW).failed).toEqual(["land_visibilityM_present"])
  })
})
