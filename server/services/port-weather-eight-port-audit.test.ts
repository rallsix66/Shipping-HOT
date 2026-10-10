import NativeDatabase from "better-sqlite3"
import { createDatabase } from "db0"
import { describe, expect, it } from "vitest"
import { portDirectoryBaseline } from "@shared/port-directory"
import { ShippingRepository, initShippingTables } from "#/database/shipping"
import { getPortWeatherPanel } from "#/services/port-weather-panel"

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

describe("eight-port forecast meta audit", () => {
  it("documents VNSGN marine gap when waves missing but wind present", async () => {
    const { database, native } = createNativeDatabase()
    await initShippingTables(database, "mock")
    const repository = new ShippingRepository(database, "mock")
    const now = new Date("2026-08-15T12:00:00.000Z")
    const vnsgn = portDirectoryBaseline.find(row => row.unlocode === "VNSGN")!
    await repository.replaceWeatherPortBatch(vnsgn.shippingPortId, [{
      id: "wf-vnsgn-hourly",
      portId: vnsgn.shippingPortId,
      unlocode: "VNSGN",
      forecastAt: "2026-08-15T13:00:00.000Z",
      horizon: "hourly",
      windGustKmh: 28,
      sourceId: "open-meteo-marine",
      fetchedAt: now.toISOString(),
    }], [])
    const panel = await getPortWeatherPanel(repository, vnsgn.shippingPortId, [], "test", "alerts", { now })
    expect(panel.forecastMeta.actualCoverage.hourlyReturned).toBe(1)
    expect(panel.forecastMeta.missingCounts.wave).toBe(1)
    expect(panel.forecastMeta.marineCoverageNote).toContain("胡志明市")
    native.close()
  })
})
