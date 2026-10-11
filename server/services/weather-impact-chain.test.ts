import NativeDatabase from "better-sqlite3"
import { createDatabase } from "db0"
import { describe, expect, it } from "vitest"
import { ShippingRepository, initShippingTables } from "#/database/shipping"
import { computePortWeatherImpacts, mergeOpenMeteoPortPoints, openMeteoPointsToForecastRows } from "#/services/open-meteo-port-forecast"
import { getPortWeatherPanel } from "#/services/port-weather-panel"
import { assertValidImpactInterval } from "#/services/weather-impact-interval"

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

describe("weather impact full chain", () => {
  it("merge → compute → sqlite → panel with partial precip and valid intervals", async () => {
    const { database, native } = createNativeDatabase()
    await initShippingTables(database, "mock")
    const repository = new ShippingRepository(database, "mock")
    const fetchedAt = "2026-08-15T10:00:00.000Z"
    const now = new Date("2026-08-15T12:30:00.000Z")

    const marine = {
      hourly: {
        time: ["2026-08-15T12:30:00.000Z", "2026-08-15T13:00:00.000Z"],
        wave_height: [2.6, 1.2],
      },
      current: { time: "2026-08-15T12:30:00.000Z", wave_height: 2.7 },
    }
    const land = {
      hourly: {
        time: ["2026-08-15T12:30:00.000Z", "2026-08-15T13:00:00.000Z"],
        wind_gusts_10m: [62, 40],
        precipitation: [2, 0],
        visibility: [8000, 9000],
      },
      current: { time: "2026-08-15T12:30:00.000Z", wind_gusts_10m: 63, precipitation: 2, visibility: 7500 },
    }

    const points = mergeOpenMeteoPortPoints(marine, land)
    const forecasts = openMeteoPointsToForecastRows("port-shekou", "CNSHK", points, fetchedAt)
    const impacts = computePortWeatherImpacts("port-shekou", points, fetchedAt)
    expect(impacts.length).toBeGreaterThan(0)
    for (const row of impacts) {
      expect(assertValidImpactInterval({ validFrom: row.validFrom, validUntil: row.validUntil })).toBe(true)
    }

    await repository.replaceWeatherPortBatch("port-shekou", forecasts, impacts)
    const panel = await getPortWeatherPanel(repository, "port-shekou", [], "Open-Meteo", "alerts", { now })

    expect(panel.precipCoverage.status).toBe("insufficient")
    expect(panel.ruleCoverage.find(r => r.ruleId === "WR-S05")?.evaluation).toBe("unevaluated")
    expect(panel.impacts.some(i => i.ruleId === "WR-S02")).toBe(true)
    expect(panel.state).toBe("partial_rule_coverage")
    expect(panel.impacts.length).toBeGreaterThan(0)
    expect(panel.ruleCoverage.find(r => r.ruleId === "WR-S03")?.reason).toContain("typhoon_data_unavailable")

    native.close()
  })
})
