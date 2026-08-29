import NativeDatabase from "better-sqlite3"
import { createDatabase } from "db0"
import { afterEach, describe, expect, it, vi } from "vitest"
import { initShippingTables } from "#/database/shipping"
import { AisPositionRepository } from "#/database/ais-positions"

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

describe("latest AIS position API", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.doUnmock("#/providers/ais")
    vi.resetModules()
  })

  it("reads the persisted latest position without invoking a Provider", async () => {
    const { database, native } = createNativeDatabase()
    const previousDataMode = process.env.SHIPPING_DATA_MODE
    const providerCalls = vi.fn()
    try {
      process.env.SHIPPING_DATA_MODE = "real"
      await initShippingTables(database, "real")
      await new AisPositionRepository(database, "real").savePositions([{
        mmsi: "413393620",
        latitude: 22.48,
        longitude: 113.91,
        timestamp: "2026-08-29T10:00:00.000Z",
        source: "aisstream",
        sourceType: "real",
      }], [{ vesselId: "vessel-real", mmsi: "413393620" }])
      vi.stubGlobal("defineEventHandler", (handler: unknown) => handler)
      vi.stubGlobal("useDatabase", () => database)
      vi.doMock("#/providers/ais", () => ({ createAisTrackingProviderForDatabase: providerCalls }))
      const { default: positionHandler } = await import("../api/shipping/vessels/[id]/position.get")
      const result = await positionHandler({ context: { params: { id: "vessel-real" } } } as never)
      expect(result).toMatchObject({ vesselId: "vessel-real", mmsi: "413393620", latitude: 22.48, longitude: 113.91, source: "aisstream", sourceType: "real" })
      expect(providerCalls).not.toHaveBeenCalled()
    } finally {
      if (previousDataMode === undefined) delete process.env.SHIPPING_DATA_MODE
      else process.env.SHIPPING_DATA_MODE = previousDataMode
      native.close()
    }
  })
})
