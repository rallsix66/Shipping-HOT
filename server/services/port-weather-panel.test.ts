import NativeDatabase from "better-sqlite3"
import { createDatabase } from "db0"
import { describe, expect, it } from "vitest"
import type { PortWeatherImpactRow } from "@shared/shipping"
import { getPortWeatherPanel } from "./port-weather-panel"
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

describe("port weather panel", () => {
  it("ranks recent critical above far-future watch when >48 impacts exist", async () => {
    const { database, native } = createNativeDatabase()
    await initShippingTables(database, "mock")
    const repository = new ShippingRepository(database, "mock")
    const now = new Date("2026-08-15T12:00:00.000Z")
    const forecasts = [{
      id: "wf-1",
      portId: "port-shekou",
      forecastAt: "2026-08-15T13:00:00.000Z",
      horizon: "hourly" as const,
      windGustKmh: 20,
      sourceId: "open-meteo-marine",
      fetchedAt: now.toISOString(),
    }]
    const impacts: PortWeatherImpactRow[] = []
    for (let index = 0; index < 55; index += 1) {
      impacts.push({
        id: `wi-watch-${index}`,
        portId: "port-shekou",
        validFrom: new Date(now.getTime() + (48 + index) * 60 * 60 * 1000).toISOString(),
        validUntil: new Date(now.getTime() + (48 + index) * 60 * 60 * 1000).toISOString(),
        ruleId: "WR-S01",
        severity: "watch",
        status: "potential",
        provenance: "system",
        summaryZh: "远期 watch",
        inputValues: {},
        computedAt: now.toISOString(),
      })
    }
    impacts.push({
      id: "wi-critical-near",
      portId: "port-shekou",
      validFrom: "2026-08-15T13:00:00.000Z",
      validUntil: "2026-08-15T13:00:00.000Z",
      ruleId: "WR-S03",
      severity: "critical",
      status: "potential",
      provenance: "system",
      summaryZh: "近期 critical",
      inputValues: {},
      computedAt: now.toISOString(),
    })
    await repository.replaceWeatherPortBatch("port-shekou", forecasts, impacts)
    const panel = await getPortWeatherPanel(repository, "port-shekou", [], "test", "alerts", { now })
    expect(panel.impactMeta.totalMatched).toBeGreaterThan(48)
    expect(panel.impactMeta.truncated).toBe(true)
    expect(panel.impacts[0]?.severity).toBe("critical")
    expect(panel.impacts[0]?.summaryZh).toContain("critical")
    native.close()
  })
})
