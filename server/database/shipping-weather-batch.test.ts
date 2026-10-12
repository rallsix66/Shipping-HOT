import NativeDatabase from "better-sqlite3"
import { createDatabase } from "db0"
import { describe, expect, it } from "vitest"
import { ShippingRepository, initShippingTables } from "#/database/shipping"

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

describe("replaceWeatherPortBatch transaction", () => {
  it("rolls back forecast writes when impact insert fails", async () => {
    const { database, native } = createNativeDatabase()
    await initShippingTables(database, "mock")
    const repository = new ShippingRepository(database, "mock")
    await repository.replaceWeatherPortBatch("port-shekou", [{
      id: "wf-old",
      portId: "port-shekou",
      forecastAt: "2026-08-15T12:00:00.000Z",
      horizon: "hourly",
      windGustKmh: 10,
      sourceId: "open-meteo-marine",
      fetchedAt: "2026-08-15T10:00:00.000Z",
    }], [])
    const duplicateImpact = {
      id: "wi-dup",
      portId: "port-shekou",
      validFrom: "2026-08-15T12:00:00.000Z",
      validUntil: "2026-08-15T13:00:00.000Z",
      ruleId: "WR-S01",
      severity: "watch" as const,
      status: "potential" as const,
      provenance: "system" as const,
      summaryZh: "a",
      inputValues: {},
      computedAt: "2026-08-15T10:00:00.000Z",
    }
    await expect(repository.replaceWeatherPortBatch("port-shekou", [{
      id: "wf-new",
      portId: "port-shekou",
      forecastAt: "2026-08-16T12:00:00.000Z",
      horizon: "hourly",
      sourceId: "open-meteo-marine",
      fetchedAt: "2026-08-16T10:00:00.000Z",
    }], [duplicateImpact, duplicateImpact])).rejects.toThrow()
    const forecasts = await repository.listWeatherForecastsForPort("port-shekou")
    expect(forecasts).toEqual([expect.objectContaining({ id: "wf-old" })])
    native.close()
  })
})
