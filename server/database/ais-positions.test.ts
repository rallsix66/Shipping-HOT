import NativeDatabase from "better-sqlite3"
import { createDatabase } from "db0"
import { describe, expect, it } from "vitest"
import { initShippingTables } from "#/database/shipping"
import { AisPositionRepository } from "#/database/ais-positions"

function createNativeDatabase(path = ":memory:") {
  const native = new NativeDatabase(path)
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

const target = { vesselId: "vessel-1", mmsi: "413393620" }
const position = {
  mmsi: target.mmsi,
  latitude: 22.48,
  longitude: 113.91,
  speed: 12.3,
  course: 91,
  heading: 90,
  navigationStatus: "under_way",
  timestamp: "2026-08-24T00:00:00.000Z",
  source: "mock-ais",
  sourceType: "mock" as const,
}

describe("ais position repository", () => {
  it("keeps history and returns the latest position with stale state", async () => {
    const { database, native } = createNativeDatabase()
    await initShippingTables(database, "mock")
    const repository = new AisPositionRepository(database, "mock")
    await repository.savePositions([position, { ...position, timestamp: "2026-08-24T00:01:00.000Z", latitude: 22.49 }], [target])
    expect(native.prepare("SELECT COUNT(*) AS count FROM ais_positions").get()).toEqual({ count: 2 })
    expect(await repository.getLatestPosition(target.vesselId, new Date("2026-08-24T00:02:00.000Z"))).toMatchObject({ latitude: 22.49, stale: false })
    expect(await repository.getLatestPosition(target.vesselId, new Date("2026-08-24T01:00:00.000Z"))).toMatchObject({ stale: true })
    native.close()
  })

  it("discards unknown MMSI and invalid coordinates without creating a vessel", async () => {
    const { database, native } = createNativeDatabase()
    await initShippingTables(database, "mock")
    const repository = new AisPositionRepository(database, "mock")
    const result = await repository.savePositions([
      { ...position, mmsi: "999999999" },
      { ...position, latitude: 91 },
    ], [target])
    expect(result).toMatchObject({ written: 0, unknownVesselCount: 1, invalidCoordinateCount: 1 })
    expect(native.prepare("SELECT COUNT(*) AS count FROM ais_positions").get()).toEqual({ count: 0 })
    expect(native.prepare("SELECT COUNT(*) AS count FROM vessel_metadata").get()).toEqual({ count: 0 })
    native.close()
  })

  it("rejects Mock positions in Real Mode", async () => {
    const { database, native } = createNativeDatabase()
    await initShippingTables(database, "real")
    const repository = new AisPositionRepository(database, "real")
    await expect(repository.savePositions([position], [target])).rejects.toThrow("mock_position_not_allowed_in_real_mode")
    expect(native.prepare("SELECT COUNT(*) AS count FROM ais_positions").get()).toEqual({ count: 0 })
    native.close()
  })
})
