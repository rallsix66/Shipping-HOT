import NativeDatabase from "better-sqlite3"
import { createDatabase } from "db0"
import { describe, expect, it } from "vitest"
import type { TropicalCycloneSyncMeta } from "@shared/shipping"
import { ShippingRepository, initShippingTables } from "#/database/shipping"
import { createWeatherSyncJob } from "#/runtime/weather-sync-job"
import type { WeatherProvider } from "#/providers/shipping"
import { mergeOpenMeteoPortPoints, openMeteoPointsToForecastRows } from "#/services/open-meteo-port-forecast"
import { getPortWeatherPanel } from "#/services/port-weather-panel"
import { JMA_TYPHOON_DATA_TTL_MS, isJmaTyphoonSyncTrustworthyForWrS03 } from "#/services/tropical-cyclone-freshness"

const TEST_NOW = new Date("2026-08-15T12:00:00.000Z")
const shekou = "port-shekou"

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

describe("wr-s03 weather-sync job to panel chain", () => {
  it("does not hit now for 48h-later forecast; stale sync blocks exclusion", async () => {
    const { database, native } = createNativeDatabase()
    await initShippingTables(database, "real")
    const repository = new ShippingRepository(database, "real")
    const fetchedAt = "2026-08-15T10:00:00.000Z"
    await repository.applyJmaTropicalCycloneSync({
      cyclones: [{
        id: "tc-jma-TC1",
        basin: "NW_PACIFIC",
        jmaId: "TC1",
        lifecycleStatus: "active",
        current: { lat: 18.0, lon: 140.0, at: "2026-08-15T11:00:00.000Z" },
        trackHistory: [],
        forecast: [{ lat: 22.49, lon: 113.92, at: "2026-08-17T12:00:00.000Z" }],
        pathFetchedAt: fetchedAt,
        rawForecastJson: [],
      }],
      outcome: "ok",
      fetchedAt,
      listConfirmedEmpty: false,
      failedTcIds: [],
      parseErrorCount: 0,
    }, [])
    const syncMeta: TropicalCycloneSyncMeta = await repository.getTropicalCycloneSyncMeta({ nowMs: TEST_NOW.getTime() })
    expect(syncMeta.lastFullSuccessAt).toBe(fetchedAt)
    expect(Date.parse(syncMeta.lastFullSuccessAt!) <= TEST_NOW.getTime()).toBe(true)

    const marine = {
      hourly: {
        time: ["2026-08-15T12:00:00.000Z", "2026-08-17T12:00:00.000Z"],
        wave_height: [1.2, 1.2],
      },
    }
    const land = {
      hourly: {
        time: ["2026-08-15T12:00:00.000Z", "2026-08-17T12:00:00.000Z"],
        wind_gusts_10m: [12, 12],
        precipitation: [0, 0],
        visibility: [9000, 9000],
      },
    }
    const points = mergeOpenMeteoPortPoints(marine, land)
    const forecasts = openMeteoPointsToForecastRows(shekou, "CNSHK", points, fetchedAt)
    const batch = { forecastsByPortId: new Map([[shekou, forecasts]]), impactsByPortId: new Map([[shekou, []]]) }
    const provider: WeatherProvider = {
      providerId: "open-meteo-marine",
      getFeedItems: async () => [],
      drainForecastPersistence: () => batch,
      ackForecastPersistence: () => {},
    }
    const job = createWeatherSyncJob({
      database,
      dataMode: "real",
      provider,
      intervalMs: 60_000,
      now: () => TEST_NOW,
      repository,
    })
    await job.run()

    const panel = await getPortWeatherPanel(repository, shekou, [], "test", "alerts", { now: TEST_NOW })
    const wrS03 = panel.impacts.filter(row => row.ruleId === "WR-S03")
    expect(wrS03.some(row => row.validFrom.startsWith("2026-08-15"))).toBe(false)
    expect(wrS03.some(row => row.validFrom.startsWith("2026-08-17"))).toBe(true)

    const staleNow = new Date(TEST_NOW.getTime() + JMA_TYPHOON_DATA_TTL_MS + 60_000)
    const stalePanel = await getPortWeatherPanel(repository, shekou, [], "test", "alerts", { now: staleNow })
    expect(isJmaTyphoonSyncTrustworthyForWrS03(await repository.getTropicalCycloneSyncMeta({ nowMs: staleNow.getTime() }), staleNow.getTime())).toBe(false)
    expect(stalePanel.ruleCoverage.find(row => row.ruleId === "WR-S03")?.evaluation).toBe("unevaluated")
    native.close()
  })
})
