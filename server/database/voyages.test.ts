import { mkdtempSync, rmSync } from "node:fs"
import { join } from "node:path"
import NativeDatabase from "better-sqlite3"
import { createDatabase } from "db0"
import { describe, expect, it } from "vitest"
import type { VoyageRecord } from "@shared/voyage"
import { initShippingTables } from "#/database/shipping"
import { VoyageRepository } from "#/database/voyages"

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

function voyage(overrides: Partial<VoyageRecord> = {}): VoyageRecord {
  return {
    id: "voyage-vessel-1-001",
    vesselId: "vessel-1",
    imo: "9162423",
    mmsi: "413393620",
    originPortId: "CNSHK",
    destinationPortId: "PHMNL",
    voyageNumber: "V001",
    status: "in_transit",
    eta: "2026-09-01T00:00:00.000Z",
    etd: "2026-08-24T00:00:00.000Z",
    source: "mock-voyage",
    sourceType: "mock",
    timestamp: "2026-08-24T00:00:00.000Z",
    lastUpdatedAt: "2026-08-24T00:00:00.000Z",
    ...overrides,
  }
}

describe("voyage repository", () => {
  it("preserves ETA history and returns the latest voyage", async () => {
    const { database, native } = createNativeDatabase()
    await initShippingTables(database, "mock")
    const repository = new VoyageRepository(database, "mock")
    await repository.saveVoyages([voyage()])
    await repository.saveVoyages([voyage({
      eta: "2026-09-03T00:00:00.000Z",
      timestamp: "2026-08-25T00:00:00.000Z",
      lastUpdatedAt: "2026-08-25T00:00:00.000Z",
    })])
    expect(native.prepare("SELECT baseline_eta, latest_eta, delay_minutes FROM voyages WHERE id = ?").get("voyage-vessel-1-001")).toEqual({
      baseline_eta: "2026-09-01T00:00:00.000Z",
      latest_eta: "2026-09-03T00:00:00.000Z",
      delay_minutes: 2880,
    })
    const stored = JSON.parse(String((native.prepare("SELECT data FROM voyages WHERE id = ?").get("voyage-vessel-1-001") as { data: string }).data)) as Record<string, unknown>
    expect(stored).toMatchObject({
      baselineEta: "2026-09-01T00:00:00.000Z",
      latestEta: "2026-09-03T00:00:00.000Z",
      delayMinutes: 2880,
    })
    expect(await repository.getLatestVoyage("vessel-1")).toMatchObject({ eta: "2026-09-03T00:00:00.000Z" })
    expect(await repository.listEtaHistory("voyage-vessel-1-001")).toMatchObject([
      { eta: "2026-09-01T00:00:00.000Z" },
      { eta: "2026-09-03T00:00:00.000Z" },
    ])
    expect(native.prepare("SELECT COUNT(*) AS count FROM voyage_eta_history").get()).toEqual({ count: 2 })
    native.close()
  })

  it("rejects records whose vesselId was not requested", async () => {
    const { database, native } = createNativeDatabase()
    await initShippingTables(database, "mock")
    const repository = new VoyageRepository(database, "mock")
    const result = await repository.saveVoyages([
      voyage(),
      voyage({ id: "voyage-vessel-9-001", vesselId: "vessel-9", mmsi: "999999999" }),
    ], "2026-08-24T00:00:00.000Z", { requestedVesselIds: ["vessel-1"] })
    expect(result).toMatchObject({ written: 1, rejectedVesselIds: 1, historyWritten: 1 })
    expect(await repository.getLatestVoyage("vessel-9")).toBeUndefined()
    expect(native.prepare("SELECT COUNT(*) AS count FROM voyages").get()).toEqual({ count: 1 })
    expect(await repository.getLatestVoyage("vessel-1")).toMatchObject({ vesselId: "vessel-1" })
    native.close()
  })

  it("does not let an older timestamp overwrite the latest voyage", async () => {
    const { database, native } = createNativeDatabase()
    await initShippingTables(database, "mock")
    const repository = new VoyageRepository(database, "mock")
    await repository.saveVoyages([voyage({
      eta: "2026-09-03T00:00:00.000Z",
      status: "departed",
      lastUpdatedAt: "2026-08-25T12:00:00.000Z",
      timestamp: "2026-08-25T12:00:00.000Z",
    })])
    const result = await repository.saveVoyages([voyage()], "2026-08-26T00:00:00.000Z")
    expect(result).toMatchObject({ written: 0, staleSkipped: 1, historyWritten: 0 })
    expect(await repository.getLatestVoyage("vessel-1")).toMatchObject({
      eta: "2026-09-03T00:00:00.000Z",
      status: "departed",
      lastUpdatedAt: "2026-08-25T12:00:00.000Z",
    })
    expect(native.prepare("SELECT COUNT(*) AS count FROM voyage_eta_history").get()).toEqual({ count: 1 })
    expect(await repository.listEtaHistory("voyage-vessel-1-001")).toMatchObject([
      { eta: "2026-09-03T00:00:00.000Z" },
    ])
    native.close()
  })

  it("persists voyage and ETA history across a native restart", async () => {
    const root = mkdtempSync("shipping-hot-voyage-")
    const path = join(root, "voyage.sqlite3")
    try {
      const first = createNativeDatabase(path)
      await initShippingTables(first.database, "mock")
      await new VoyageRepository(first.database, "mock").saveVoyages([voyage()])
      first.native.close()

      const second = createNativeDatabase(path)
      await initShippingTables(second.database, "mock")
      expect(await new VoyageRepository(second.database, "mock").getLatestVoyage("vessel-1")).toMatchObject({
        id: "voyage-vessel-1-001",
        eta: "2026-09-01T00:00:00.000Z",
      })
      expect(await new VoyageRepository(second.database, "mock").listEtaHistory("voyage-vessel-1-001")).toHaveLength(1)
      second.native.close()
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
