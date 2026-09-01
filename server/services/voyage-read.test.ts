import NativeDatabase from "better-sqlite3"
import { createDatabase } from "db0"
import { describe, expect, it, vi } from "vitest"
import type { VoyageRecord } from "@shared/voyage"
import { initShippingTables } from "#/database/shipping"
import { VoyageRepository } from "#/database/voyages"
import { readLatestVoyage } from "#/services/voyage-read"

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

const record: VoyageRecord = {
  id: "voyage-api-1",
  vesselId: "vessel-api-1",
  imo: "9162423",
  mmsi: "413393620",
  originPortId: "CNSHK",
  destinationPortId: "PHMNL",
  voyageNumber: "API-001",
  status: "planned",
  eta: "2026-09-01T00:00:00.000Z",
  source: "mock-voyage",
  sourceType: "mock",
  timestamp: "2026-08-24T00:00:00.000Z",
  lastUpdatedAt: "2026-08-24T00:00:00.000Z",
}

describe("voyage read API boundary", () => {
  it("reads the latest voyage from SQLite without a Provider call", async () => {
    const { database, native } = createNativeDatabase()
    await initShippingTables(database, "mock")
    await new VoyageRepository(database, "mock").saveVoyages([record])
    const result = await readLatestVoyage(database, "mock", "vessel-api-1")
    expect(result).toMatchObject({ id: "voyage-api-1", eta: "2026-09-01T00:00:00.000Z" })
    native.close()
  })

  it("reads a persisted real ETA observation with unknown fields without invoking a Provider", async () => {
    const { database, native } = createNativeDatabase()
    await initShippingTables(database, "real")
    const real = {
      ...record,
      id: "vesselapi:vessel-api-1:eta:2026-08-31T10:00:00.000Z",
      originPortId: undefined,
      voyageNumber: undefined,
      status: "unknown" as const,
      etd: undefined,
      source: "vesselapi",
      sourceType: "real" as const,
      timestamp: "2026-08-31T10:00:00.000Z",
      lastUpdatedAt: "2026-08-31T10:00:00.000Z",
    }
    await new VoyageRepository(database, "real").saveVoyages([real])
    const fetchSpy = vi.spyOn(globalThis, "fetch")
    const before = (native.prepare("SELECT total_changes() AS changes").get() as { changes: number }).changes
    await expect(readLatestVoyage(database, "real", "vessel-api-1")).resolves.toMatchObject({
      id: real.id,
      originPortId: undefined,
      voyageNumber: undefined,
      destinationPortId: "PHMNL",
      source: "vesselapi",
    })
    const after = (native.prepare("SELECT total_changes() AS changes").get() as { changes: number }).changes
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(after).toBe(before)
    fetchSpy.mockRestore()
    native.close()
  })
})
