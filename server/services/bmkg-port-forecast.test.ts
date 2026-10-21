import { describe, expect, it, vi } from "vitest"
import { BmkgForecastParseError, parseBmkgPortForecast } from "./bmkg-port-forecast"

const context = { source: { url: "https://maritim.bmkg.go.id/marine2026-data/pelabuhan/XJ001.json", fetchedAt: "2024-02-29T00:30:00.000Z" }, expected: { code: "XJ001", name: "Synthetic port" } }
const point = (time: string) => ({ time, visibility: 10, temp_avg: -5, rh_avg: 70, wind_speed: 4, wind_gust: 8, wave_height: 0.1, current_speed: 0.5, tides: -0.52, weather: "Synthetic condition", wind_from: "Synthetic direction", wave_cat: "Synthetic category", current_to: "Synthetic current" })
function fixture() {
  return { "code": "XJ001", "name": "Synthetic port", "issued": "2024-02-28 12:00 UTC", "valid_from": "2024-02-29 00:00 UTC", "valid_to": "2024-03-02 00:00 UTC", "forecast_day1": [point("2024-02-29 00:00 UTC"), point("2024-02-29 01:00 UTC")], "forecast_day2-4": [point("2024-03-01 00:00 UTC"), point("2024-03-01 03:00 UTC")] }
}
const first = (raw: ReturnType<typeof fixture>) => raw.forecast_day1[0] as Record<string, unknown>

describe("pure BMKG port parsing, original synthetic fixture", () => {
  it("keeps source/issued/group cadence and projects documented units once without mutating raw evidence", () => {
    const raw = fixture()
    const before = JSON.stringify(raw)
    const a = parseBmkgPortForecast(raw, context)
    const b = parseBmkgPortForecast(raw, context)
    expect(a).toEqual(b)
    expect(JSON.stringify(raw)).toBe(before)
    expect(a.source).toMatchObject({ catalogId: "ID-W02", ...context.source })
    expect(a.issued).toEqual({ raw: raw.issued, iso: "2024-02-28T12:00:00.000Z" })
    expect(a.validRange.from.iso).toBe("2024-02-29T00:00:00.000Z")
    expect(a.groups.map(g => [g.key, g.cadenceMinutes, g.points.length])).toEqual([["forecast_day1", 60, 2], ["forecast_day2-4", 180, 2]])
    expect(a.pointCount).toBe(4)
    expect(a.groups[0].points[0].normalized).toEqual({ waveHeightM: 0.1, windSpeedKmh: 7.408, windGustKmh: 14.816, visibilityM: 10000 })
    expect(a.groups[0].points[0].numeric.wind_speed).toEqual({ state: "value", raw: 4 })
    expect(a.groups[0].points[0].numeric.tides).toEqual({ state: "value", raw: -0.52 })
    expect(a.groups[0].points[0].numeric.temp_avg).toEqual({ state: "value", raw: -5 })
    expect(a.missingFields).toEqual([])
    expect(a.nullFields).toEqual([])
    expect(() => parseBmkgPortForecast(a, context)).toThrow(BmkgForecastParseError)
  })
  it("distinguishes missing/null/value without zero fill or inferred quality/coordinates/current/precipitation", () => {
    const raw = fixture()
    const row = first(raw)
    delete row.wind_speed
    row.wind_gust = null
    row.weather = null
    row.visibility = 0
    row.qc = "uninterpreted"
    ;(raw as Record<string, unknown>).quality_code = 0
    const a = parseBmkgPortForecast(raw, context)
    const p = a.groups[0].points[0]
    expect(p.numeric.wind_speed).toEqual({ state: "missing" })
    expect(p.numeric.wind_gust).toEqual({ state: "null", raw: null })
    expect(p.text.weather).toEqual({ state: "null", raw: null })
    expect(p.normalized).toEqual({ waveHeightM: 0.1, visibilityM: 0 })
    expect(a.missingFields).toContain("$.forecast_day1[0].wind_speed")
    expect(a.nullFields).toContain("$.forecast_day1[0].wind_gust")
    expect(p.uninterpretedFields).toEqual(["qc"])
    expect(a.uninterpretedFields).toEqual(["quality_code"])
    expect(a).not.toHaveProperty("coordinates")
    expect(p.normalized).not.toHaveProperty("precipitationMm")
    expect(p.normalized).not.toHaveProperty("severity")
  })
  it.each(["code", "name"] as const)("rejects mismatched %s", (key) => {
    const raw = fixture()
    raw[key] = "Wrong"
    expect(() => parseBmkgPortForecast(raw, context)).toThrow("identity_mismatch")
  })
  it.each(["2025-02-29 00:00 UTC", "2024-02-30 00:00 UTC", "2024-13-01 00:00 UTC", "2024-02-29 24:00 UTC", "2024-02-29 00:60 UTC", "2024-02-29 00:00", "2024-02-29T00:00:00Z", "2024-02-29 00:00 +07:00"])("rejects invalid/unsupported UTC %s", (value) => {
    const raw = fixture()
    raw.issued = value
    expect(() => parseBmkgPortForecast(raw, context)).toThrow(BmkgForecastParseError)
  })
  it.each([Number.NaN, Infinity, -Infinity, "4", undefined, {}, [], true])("rejects invalid numeric type/value %j", (value) => {
    const raw = fixture()
    first(raw).wind_speed = value
    expect(() => parseBmkgPortForecast(raw, context)).toThrow("invalid_field_type")
  })
  it.each(["visibility", "rh_avg", "wind_speed", "wind_gust", "wave_height", "current_speed"])("rejects negative nonnegative %s", (key) => {
    const raw = fixture()
    first(raw)[key] = -1
    expect(() => parseBmkgPortForecast(raw, context)).toThrow("invalid_physical_value")
  })
  it("rejects impossible humidity, projection overflow and invalid text types", () => {
    for (const [key, value, code] of [["rh_avg", 101, "invalid_physical_value"], ["wind_speed", Number.MAX_VALUE, "projection_overflow"], ["visibility", Number.MAX_VALUE, "projection_overflow"], ["weather", 1, "invalid_field_type"]] as const) {
      const raw = fixture()
      first(raw)[key] = value
      expect(() => parseBmkgPortForecast(raw, context)).toThrow(code)
    }
  })
  it("rejects invalid range, out-of-range times, duplicate and cross-group conflicting identities", () => {
    const cases = [
      { change: (r: ReturnType<typeof fixture>) => {
        r.valid_to = r.valid_from
      }, code: "invalid_valid_range" },
      { change: (r: ReturnType<typeof fixture>) => {
        r.valid_from = "2024-02-29 01:00 UTC"
      }, code: "outside_valid_range" },
      { change: (r: ReturnType<typeof fixture>) => {
        r.forecast_day1[1].time = r.forecast_day1[0].time
      }, code: "duplicate_time" },
      { change: (r: ReturnType<typeof fixture>) => {
        r["forecast_day2-4"][0].time = r.forecast_day1[0].time
        r["forecast_day2-4"][0].wave_height = 9
      }, code: "duplicate_time" },
      { change: (r: ReturnType<typeof fixture>) => {
        r.forecast_day1.reverse()
      }, code: "time_order" },
      { change: (r: ReturnType<typeof fixture>) => {
        r["forecast_day2-4"][0].time = "2024-02-29 00:30 UTC"
      }, code: "time_order" },
      { change: (r: ReturnType<typeof fixture>) => {
        r.forecast_day1[1].time = "2024-02-29 02:00 UTC"
      }, code: "invalid_cadence" },
      { change: (r: ReturnType<typeof fixture>) => {
        r["forecast_day2-4"][1].time = "2024-03-01 04:00 UTC"
      }, code: "invalid_cadence" },
    ]
    for (const c of cases) {
      const raw = fixture()
      c.change(raw)
      expect(() => parseBmkgPortForecast(raw, context)).toThrow(c.code)
    }
  })
  it("rejects malformed required structures and keeps empty groups explicit", () => {
    for (const raw of [null, [], {}, { ...fixture(), forecast_day1: {} }, { ...fixture(), forecast_day1: [null] }]) expect(() => parseBmkgPortForecast(raw, context)).toThrow(BmkgForecastParseError)
    expect(parseBmkgPortForecast({ ...fixture(), "forecast_day1": [], "forecast_day2-4": [] }, context)).toMatchObject({ pointCount: 0, groups: [{ points: [] }, { points: [] }] })
  })
  it("does not read the clock/network or infer freshness from fetchedAt", () => {
    const clock = vi.spyOn(Date, "now").mockImplementation(() => {
      throw new Error("clock forbidden")
    })
    vi.stubGlobal("fetch", () => {
      throw new Error("network forbidden")
    })
    try {
      const a = parseBmkgPortForecast(fixture(), context)
      const b = parseBmkgPortForecast(fixture(), { ...context, source: { ...context.source, fetchedAt: "2099-01-01T00:00:00.000Z" } })
      expect(a.groups).toEqual(b.groups)
      expect(a.issued).toEqual(b.issued)
      expect(a).not.toHaveProperty("fresh")
      expect(b.source.fetchedAt).toBe("2099-01-01T00:00:00.000Z")
    } finally {
      clock.mockRestore()
      vi.unstubAllGlobals()
    }
  })
})
