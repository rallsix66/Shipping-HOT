import NativeDatabase from "better-sqlite3"
import { createDatabase } from "db0"
import { describe, expect, it } from "vitest"
import type { VoyageRecord } from "@shared/voyage"
import { initShippingTables } from "#/database/shipping"
import { VoyageRepository } from "#/database/voyages"
import { RuntimeRepository } from "#/database/runtime-jobs"
import type { VoyageProvider } from "#/providers/voyage/contracts"
import { createVoyageSyncJob } from "#/runtime/voyage-sync-job"
import { BackgroundRuntime } from "#/runtime/background-runtime"

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
}

async function seedWatchlist(database: ReturnType<typeof createNativeDatabase>["database"]) {
  await database.prepare(`
    INSERT INTO vessel_metadata (id, name, imo, mmsi, source, fetched_at, source_type, data)
    VALUES ('vessel-1', 'TEST VESSEL', '9162423', '413393620', 'test', '2026-08-24T00:00:00.000Z', 'mock', '{}')
  `).run()
  await database.prepare("INSERT INTO vessel_watchlist (vessel_id, watched_at, ais_enabled) VALUES ('vessel-1', '2026-08-24T00:00:00.000Z', 1)").run()
}

function provider(run: VoyageProvider["getVoyages"]): VoyageProvider {
  return { providerId: "mock-voyage", getVoyages: run }
}

describe("voyage sync job", () => {
  it("persists successful Provider output and healthy runtime state", async () => {
    const { database, native } = createNativeDatabase()
    await initShippingTables(database, "mock")
    await seedWatchlist(database)
    let requested: readonly { vesselId: string, imo?: string, mmsi?: string }[] = []
    const runtime = new BackgroundRuntime(new RuntimeRepository(database))
    runtime.register(createVoyageSyncJob({
      database,
      dataMode: "mock",
      provider: provider(async (vessels) => {
        requested = vessels
        return [record]
      }),
      intervalMs: 60 * 60 * 1000,
    }))
    await runtime.start()
    await expect(runtime.runNow("voyage-sync")).resolves.toMatchObject({ status: "success", recordsRead: 1, recordsWritten: 1 })
    expect(requested).toEqual([{ vesselId: "vessel-1", imo: "9162423", mmsi: "413393620" }])
    expect(await new RuntimeRepository(database).getProviderRuntime("mock-voyage", "voyage_sync")).toMatchObject({ status: "healthy" })
    runtime.stop()
    native.close()
  })

  it("ignores Provider records outside the requested watchlist vessels", async () => {
    const { database, native } = createNativeDatabase()
    await initShippingTables(database, "mock")
    await seedWatchlist(database)
    const runtime = new BackgroundRuntime(new RuntimeRepository(database))
    runtime.register(createVoyageSyncJob({
      database,
      dataMode: "mock",
      provider: provider(async () => [
        record,
        { ...record, id: "voyage-vessel-9-001", vesselId: "vessel-9", mmsi: "999999999" },
      ]),
      intervalMs: 60 * 60 * 1000,
    }))
    await runtime.start()
    await expect(runtime.runNow("voyage-sync")).resolves.toMatchObject({ status: "success", recordsRead: 2, recordsWritten: 1 })
    expect(await new VoyageRepository(database, "mock").getLatestVoyage("vessel-9")).toBeUndefined()
    expect(await new VoyageRepository(database, "mock").getLatestVoyage("vessel-1")).toMatchObject({ vesselId: "vessel-1" })
    runtime.stop()
    native.close()
  })

  it("computes runtime sourceUpdatedAt from accepted records only", async () => {
    const { database, native } = createNativeDatabase()
    await initShippingTables(database, "mock")
    await seedWatchlist(database)
    const runtime = new BackgroundRuntime(new RuntimeRepository(database))
    runtime.register(createVoyageSyncJob({
      database,
      dataMode: "mock",
      provider: provider(async () => [
        { ...record, lastUpdatedAt: "2026-08-25T10:00:00.000Z", timestamp: "2026-08-25T10:00:00.000Z" },
        { ...record, id: "voyage-vessel-9-001", vesselId: "vessel-9", mmsi: "999999999", lastUpdatedAt: "2026-08-26T00:00:00.000Z", timestamp: "2026-08-26T00:00:00.000Z" },
      ]),
      intervalMs: 60 * 60 * 1000,
    }))
    await runtime.start()
    await expect(runtime.runNow("voyage-sync")).resolves.toMatchObject({
      status: "success",
      recordsRead: 2,
      recordsWritten: 1,
      sourceUpdatedAt: "2026-08-25T10:00:00.000Z",
    })
    expect(await new RuntimeRepository(database).getProviderRuntime("mock-voyage", "voyage_sync"))
      .toMatchObject({ lastSourceUpdatedAt: "2026-08-25T10:00:00.000Z" })
    runtime.stop()
    native.close()
  })

  it("keeps the previous runtime sourceUpdatedAt when no record is accepted", async () => {
    const { database, native } = createNativeDatabase()
    await initShippingTables(database, "mock")
    await seedWatchlist(database)
    const initial: VoyageRecord[] = [
      { ...record, lastUpdatedAt: "2026-08-25T10:00:00.000Z", timestamp: "2026-08-25T10:00:00.000Z" },
    ]
    let next: VoyageRecord[] = initial
    const runtime = new BackgroundRuntime(new RuntimeRepository(database))
    runtime.register(createVoyageSyncJob({
      database,
      dataMode: "mock",
      provider: provider(async () => next),
      intervalMs: 60 * 60 * 1000,
    }))
    await runtime.start()
    await expect(runtime.runNow("voyage-sync")).resolves.toMatchObject({
      status: "success",
      sourceUpdatedAt: "2026-08-25T10:00:00.000Z",
    })

    next = [
      { ...record, lastUpdatedAt: "2026-08-24T00:00:00.000Z", timestamp: "2026-08-24T00:00:00.000Z" },
      { ...record, id: "voyage-vessel-9-001", vesselId: "vessel-9", mmsi: "999999999", lastUpdatedAt: "2026-08-26T00:00:00.000Z", timestamp: "2026-08-26T00:00:00.000Z" },
    ]
    await expect(runtime.runNow("voyage-sync")).resolves.toMatchObject({
      status: "success",
      recordsRead: 2,
      recordsWritten: 0,
      sourceUpdatedAt: undefined,
    })
    expect(await new RuntimeRepository(database).getProviderRuntime("mock-voyage", "voyage_sync"))
      .toMatchObject({ status: "healthy", lastSourceUpdatedAt: "2026-08-25T10:00:00.000Z" })
    runtime.stop()
    native.close()
  })

  it("records Provider failure in sync_runs and provider_runtime", async () => {
    const { database, native } = createNativeDatabase()
    await initShippingTables(database, "mock")
    await seedWatchlist(database)
    const runtime = new BackgroundRuntime(new RuntimeRepository(database))
    runtime.register(createVoyageSyncJob({
      database,
      dataMode: "mock",
      provider: provider(async () => {
        throw new Error("voyage_provider_failed")
      }),
      intervalMs: 60 * 60 * 1000,
    }))
    await runtime.start()
    await expect(runtime.runNow("voyage-sync")).resolves.toMatchObject({ status: "failed" })
    expect(await new RuntimeRepository(database).getProviderRuntime("mock-voyage", "voyage_sync")).toMatchObject({ status: "failed", consecutiveFailures: 1 })
    expect((await new RuntimeRepository(database).listSyncRuns("mock-voyage"))[0]).toMatchObject({ status: "failed", errorCode: "job_failed" })
    runtime.stop()
    native.close()
  })
})
