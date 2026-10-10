import { readFileSync } from "node:fs"
import { join } from "node:path"
import NativeDatabase from "better-sqlite3"
import { createDatabase } from "db0"
import { describe, expect, it } from "vitest"
import { portDirectoryBaseline } from "@shared/port-directory"
import { ShippingRepository, initShippingTables } from "#/database/shipping"
import { syncJmaTropicalCyclones } from "#/providers/jma-tropical-cyclone"
import { getTropicalCyclonePanel } from "#/services/tropical-cyclone-panel"

const fixtureDir = join(process.cwd(), "server/fixtures/jma")

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

const ports = portDirectoryBaseline.map(row => ({
  portId: row.shippingPortId,
  unlocode: row.unlocode,
  latitude: row.latitude,
  longitude: row.longitude,
}))

describe("tropical cyclone sync chain", () => {
  it("retains SQLite rows and panel data when list fetch fails after a success", async () => {
    const { database, native } = createNativeDatabase()
    await initShippingTables(database, "mock")
    const repository = new ShippingRepository(database, "mock")
    const cyclone = {
      id: "tc-jma-TC2634",
      basin: "NW_PACIFIC",
      jmaId: "TC2634",
      nameEn: "Koguma",
      current: { lat: 22.52, lon: 114.35, at: "2026-08-15T09:00:00.000Z" },
      trackHistory: [{ lat: 22.0, lon: 118.0 }],
      forecast: [{ lat: 22.8, lon: 113.9, at: "2026-08-16T00:00:00.000Z" }],
      rawForecastJson: [],
    }
    await repository.applyJmaTropicalCycloneSync({
      cyclones: [cyclone],
      outcome: "ok",
      fetchedAt: "2026-08-15T10:00:00.000Z",
      listConfirmedEmpty: false,
      failedTcIds: [],
      parseErrorCount: 0,
    }, ports)
    await repository.applyJmaTropicalCycloneSync({
      outcome: "failed",
      fetchedAt: "2026-08-15T11:00:00.000Z",
      errorCode: "provider_unavailable",
      errorMessage: "HTTP 503",
    }, ports)
    const panel = await getTropicalCyclonePanel(repository, { now: new Date("2026-08-15T11:30:00.000Z") })
    expect(panel.sync.outcome).toBe("failed")
    expect(panel.sync.lastFullSuccessAt).toBe("2026-08-15T10:00:00.000Z")
    expect(panel.cyclones.length).toBeGreaterThan(0)
    expect(panel.cyclones[0]?.trackHistory.length).toBeGreaterThan(0)
    native.close()
  })

  it("does not treat all-detail failure as ok_empty", async () => {
    const list = readFileSync(join(fixtureDir, "targetTc-multi.json"), "utf8")
    const result = await syncJmaTropicalCyclones(async (url) => {
      if (url.includes("targetTc")) return new Response(list, { status: 200 })
      return new Response("{}", { status: 404 })
    }, new Date("2026-08-15T12:00:00.000Z"))
    expect(result.outcome).toBe("partial")
    if (result.outcome !== "failed") {
      expect(result.cyclones).toHaveLength(0)
      expect(result.failedTcIds.length).toBeGreaterThan(0)
    }
  })
})
