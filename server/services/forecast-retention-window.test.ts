import NativeDatabase from "better-sqlite3"
import { createDatabase } from "db0"
import { describe, expect, it } from "vitest"
import type { PortWeatherForecastRow } from "@shared/shipping"
import { evaluateForecastWindowCoverage } from "../../scripts/lib/forecast-window-coverage.mjs"
import { ShippingRepository, initShippingTables } from "#/database/shipping"
import { mergeOpenMeteoPortPoints, openMeteoPointsToForecastRows } from "#/services/open-meteo-port-forecast"
import { getPortWeatherPanel } from "#/services/port-weather-panel"
import { FORECAST_RETENTION_LIMIT, WEATHER_FORECAST_HORIZON_MS, forecastRetentionWindow, selectForecastRetention } from "#/services/weather-panel-policy"

const HOUR = 60 * 60 * 1000
const floorH = (ms: number) => Math.floor(ms / HOUR) * HOUR
const iso = (ms: number) => new Date(ms).toISOString()

function createNativeDatabase() {
  const native = new NativeDatabase(":memory:")
  const database = createDatabase({
    name: "sqlite",
    dialect: "sqlite",
    getInstance: () => native,
    exec: (sql: string) => native.exec(sql),
    prepare: (sql: string) => {
      const statement = native.prepare(sql)
      return {
        all: async (...params: (string | number | boolean | null | undefined)[]) => statement.all(...params),
        get: async (...params: (string | number | boolean | null | undefined)[]) => statement.get(...params),
        run: async (...params: (string | number | boolean | null | undefined)[]) => {
          const result = statement.run(...params)
          return { success: result.changes > 0, changes: result.changes, lastInsertRowid: result.lastInsertRowid }
        },
      }
    },
    dispose: () => native.close(),
  } as never)
  return { database, native }
}

/** Open-Meteo-shaped payloads (unix seconds) for `days` whole UTC days starting at the UTC midnight of `nowMs`, plus `pastHours` before it. */
function openMeteoPayloads(nowMs: number, days: number, pastHours = 0) {
  const startMs = Math.floor(nowMs / (24 * HOUR)) * 24 * HOUR - pastHours * HOUR
  const count = days * 24 + pastHours
  const time = Array.from({ length: count }, (_, i) => (startMs + i * HOUR) / 1000)
  const marine = {
    current: { time: floorH(nowMs) / 1000, wave_height: 1, swell_wave_height: 0.5 },
    hourly: { time, wave_height: time.map(() => 1), swell_wave_height: time.map(() => 0.5) },
  }
  const land = {
    current: { time: floorH(nowMs) / 1000, wind_speed_10m: 10, wind_gusts_10m: 20, precipitation: 0, visibility: 10000 },
    hourly: { time, wind_speed_10m: time.map(() => 10), wind_gusts_10m: time.map(() => 20), precipitation: time.map(() => 0), visibility: time.map(() => 10000) },
  }
  return { marine, land }
}

const FIXED_TIMES = {
  afternoon: Date.parse("2026-10-10T14:37:12.000Z"),
  beforeMidnight: Date.parse("2026-10-10T23:59:30.000Z"),
  exactMidnight: Date.parse("2026-10-11T00:00:00.000Z"),
}

describe("forecast retention window (window first, then cap)", () => {
  for (const [label, nowMs] of Object.entries(FIXED_TIMES)) {
    it(`past_days=1 + forecast_days=8 covers the full [now-1h, now+7d] window at ${label}`, () => {
      const { marine, land } = openMeteoPayloads(nowMs, 8, 24)
      const points = mergeOpenMeteoPortPoints(marine, land, nowMs)
      const coverage = evaluateForecastWindowCoverage(points.map(p => ({ ...p, forecastAt: p.timestamp })), nowMs)
      expect(coverage.failed).toEqual([])
      expect(points.at(-1)!.timestamp >= iso(floorH(nowMs + WEATHER_FORECAST_HORIZON_MS))).toBe(true)
      expect(points.length).toBeLessThanOrEqual(FORECAST_RETENTION_LIMIT)
    })

    it(`forecast_days=7 does NOT cover the window end at ${label} (regression guard)`, () => {
      const { marine, land } = openMeteoPayloads(nowMs, 7, 24)
      const points = mergeOpenMeteoPortPoints(marine, land, nowMs)
      const coverage = evaluateForecastWindowCoverage(points.map(p => ({ ...p, forecastAt: p.timestamp })), nowMs)
      // exact UTC midnight: 7 whole days end at now+7d-1h, still one hour short
      expect(coverage.failed).toContain("window_end_covered")
    })
  }

  it("old hours beyond the cap are dropped first; window-end future hours survive", () => {
    const nowMs = FIXED_TIMES.afternoon
    const { marine, land } = openMeteoPayloads(nowMs, 8, 400)
    const points = mergeOpenMeteoPortPoints(marine, land, nowMs)
    const { startMs } = forecastRetentionWindow(nowMs)
    expect(points.every(p => Date.parse(p.timestamp) >= startMs)).toBe(true)
    expect(points.some(p => p.timestamp === iso(floorH(nowMs + WEATHER_FORECAST_HORIZON_MS)))).toBe(true)
    // the old earliest-170 behaviour would have kept only the stale past hours
    const earliest170 = [...points].sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp)).slice(0, 170)
    expect(earliest170.some(p => p.timestamp === iso(floorH(nowMs + WEATHER_FORECAST_HORIZON_MS)))).toBe(false)
  })

  it("keeps up to 24h of history behind the window for rolling precipitation", () => {
    const nowMs = FIXED_TIMES.afternoon
    const { marine, land } = openMeteoPayloads(nowMs, 8, 48)
    const points = mergeOpenMeteoPortPoints(marine, land, nowMs)
    const history = points.filter(p => p.horizon === "hourly" && Date.parse(p.timestamp) < nowMs - HOUR)
    expect(history.length).toBe(24)
  })

  it("cap drops the oldest even when called without a window", () => {
    const items = Array.from({ length: FORECAST_RETENTION_LIMIT + 50 }, (_, i) => ({ t: iso(FIXED_TIMES.afternoon - 30 * HOUR + i * HOUR) }))
    const kept = selectForecastRetention(items, x => x.t, FIXED_TIMES.afternoon, 10)
    expect(kept).toHaveLength(10)
    expect(kept.at(-1)!.t).toBe(iso(FIXED_TIMES.afternoon + WEATHER_FORECAST_HORIZON_MS))
  })

  it("without past_days the exact-UTC-midnight window start (now-1h) is missing (why past_days=1 is requested)", () => {
    const nowMs = FIXED_TIMES.exactMidnight
    const { marine, land } = openMeteoPayloads(nowMs, 8, 0)
    const points = mergeOpenMeteoPortPoints(marine, land, nowMs)
    const coverage = evaluateForecastWindowCoverage(points.map(p => ({ ...p, forecastAt: p.timestamp })), nowMs)
    expect(coverage.failed).toContain("window_start_covered")
  })

  it("current and hourly at the same instant coexist", () => {
    const nowMs = FIXED_TIMES.exactMidnight
    const { marine, land } = openMeteoPayloads(nowMs, 8)
    const points = mergeOpenMeteoPortPoints(marine, land, nowMs)
    const atNow = points.filter(p => p.timestamp === iso(nowMs))
    expect(atNow.map(p => p.horizon).sort()).toEqual(["current", "hourly"])
  })
})

describe("repository + panel read the window, not the earliest N rows", () => {
  for (const [label, nowMs] of Object.entries(FIXED_TIMES)) {
    it(`panel returns window-end hours even with 300 old rows stored (${label})`, async () => {
      const { database, native } = createNativeDatabase()
      await initShippingTables(database, "mock")
      const repository = new ShippingRepository(database, "mock")
      const { marine, land } = openMeteoPayloads(nowMs, 8, 24)
      const fresh = openMeteoPointsToForecastRows("port-shekou", "CNSHK", mergeOpenMeteoPortPoints(marine, land, nowMs), iso(nowMs))
      const old: PortWeatherForecastRow[] = Array.from({ length: 300 }, (_, i) => ({
        id: `wf-old-${i}`,
        portId: "port-shekou",
        forecastAt: iso(floorH(nowMs) - (40 + i) * HOUR),
        horizon: "hourly",
        windGustKmh: 5,
        sourceId: "open-meteo-marine",
        fetchedAt: iso(nowMs),
      }))
      await repository.replaceWeatherPortBatch("port-shekou", [...old, ...fresh], [])
      // legacy earliest-N read would be all old rows
      const earliest = await repository.listWeatherForecastsForPort("port-shekou", 7 * 24 + 4)
      expect(earliest.every(r => r.id.startsWith("wf-old"))).toBe(true)

      const panel = await getPortWeatherPanel(repository, "port-shekou", [], "test", "alerts", { now: new Date(nowMs) })
      const gridEnd = iso(floorH(nowMs + WEATHER_FORECAST_HORIZON_MS))
      expect(panel.forecastMeta.actualCoverage.lastInstant).toBe(gridEnd)
      const coverage = evaluateForecastWindowCoverage(panel.forecasts, nowMs)
      expect(coverage.failed).toEqual([])
      expect(panel.forecastMeta.actualCoverage.hourlyReturned).toBe(coverage.window.expectedHours)
      expect(panel.forecastMeta.actualCoverage.currentReturned).toBe(1)
      native.close()
    })
  }

  it("falls back to the latest stored rows (stale) when nothing is in the window", async () => {
    const { database, native } = createNativeDatabase()
    await initShippingTables(database, "mock")
    const repository = new ShippingRepository(database, "mock")
    const nowMs = FIXED_TIMES.afternoon
    const stale: PortWeatherForecastRow[] = Array.from({ length: 5 }, (_, i) => ({
      id: `wf-stale-${i}`,
      portId: "port-shekou",
      forecastAt: iso(floorH(nowMs) - (100 - i) * HOUR),
      horizon: "hourly",
      windGustKmh: 5,
      sourceId: "open-meteo-marine",
      fetchedAt: iso(nowMs - 100 * HOUR),
    }))
    await repository.replaceWeatherPortBatch("port-shekou", stale, [])
    const panel = await getPortWeatherPanel(repository, "port-shekou", [], "test", "alerts", { now: new Date(nowMs) })
    expect(panel.state).toBe("data_stale")
    expect(panel.forecasts).toHaveLength(5)
    native.close()
  })
})
