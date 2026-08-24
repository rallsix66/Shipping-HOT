import NativeDatabase from "better-sqlite3"
import { createDatabase } from "db0"
import { describe, expect, it } from "vitest"
import { AisPositionRepository } from "#/database/ais-positions"
import { initShippingTables } from "#/database/shipping"
import { RuntimeRepository } from "#/database/runtime-jobs"
import type { AisPosition, AisTrackingProvider, AisTrackingVessel } from "#/providers/ais/contracts"
import { createAisTrackingJob } from "#/runtime/ais-tracking-job"
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

async function seedWatchlist(database: ReturnType<typeof createNativeDatabase>["database"]) {
  await database.prepare(`
    INSERT INTO vessel_metadata (id, name, mmsi, source, fetched_at, source_type, data)
    VALUES ('vessel-with-mmsi', 'WITH MMSI', '413393620', 'test', '2026-08-24T00:00:00.000Z', 'mock', '{}'),
           ('vessel-without-mmsi', 'WITHOUT MMSI', NULL, 'test', '2026-08-24T00:00:00.000Z', 'mock', '{}')
  `).run()
  await database.prepare(`
    INSERT INTO vessel_watchlist (vessel_id, watched_at, ais_enabled)
    VALUES ('vessel-with-mmsi', '2026-08-24T00:00:00.000Z', 1), ('vessel-without-mmsi', '2026-08-24T00:00:00.000Z', 1)
  `).run()
}

function provider(run: (vessels: readonly AisTrackingVessel[]) => Promise<readonly AisPosition[]>): AisTrackingProvider {
  return { providerId: "aisstream", subscribe: async () => undefined, unsubscribe: async () => undefined, getLatestPositions: run }
}

const validPosition: AisPosition = {
  mmsi: "413393620",
  latitude: 22.48,
  longitude: 113.91,
  timestamp: "2026-08-24T00:01:00.000Z",
  source: "aisstream",
  sourceType: "real",
}

describe("ais tracking job", () => {
  it("filters watchlist to ais_enabled entries with MMSI and persists healthy runtime state", async () => {
    const { database, native } = createNativeDatabase()
    await initShippingTables(database, "mock")
    await seedWatchlist(database)
    let requested: readonly AisTrackingVessel[] = []
    const aisProvider = provider(async (vessels) => {
      requested = vessels
      return [validPosition]
    })
    const runtime = new BackgroundRuntime(new RuntimeRepository(database))
    runtime.register(createAisTrackingJob({ database, dataMode: "mock", provider: aisProvider, intervalMs: 60 * 60 * 1000 }))
    await runtime.start()
    await expect(runtime.runNow("ais-tracking")).resolves.toMatchObject({ status: "success", recordsRead: 1, recordsWritten: 1 })
    expect(requested).toEqual([{ vesselId: "vessel-with-mmsi", mmsi: "413393620" }])
    expect(await new RuntimeRepository(database).getProviderRuntime("aisstream", "ais_tracking")).toMatchObject({ status: "healthy" })
    expect(await new AisPositionRepository(database, "mock").getLatestPosition("vessel-with-mmsi")).toMatchObject({ source: "aisstream" })
    runtime.stop()
    native.close()
  })

  it("records Provider failure in sync_runs and provider_runtime without writing positions", async () => {
    const { database, native } = createNativeDatabase()
    await initShippingTables(database, "real")
    await database.prepare(`
      INSERT INTO vessel_metadata (id, name, mmsi, source, fetched_at, source_type, data)
      VALUES ('vessel-real', 'REAL VESSEL', '413393620', 'aisstream', '2026-08-24T00:00:00.000Z', 'real', '{}')
    `).run()
    await database.prepare("INSERT INTO vessel_watchlist (vessel_id, watched_at, ais_enabled) VALUES ('vessel-real', '2026-08-24T00:00:00.000Z', 1)").run()
    const runtime = new BackgroundRuntime(new RuntimeRepository(database))
    runtime.register(createAisTrackingJob({ database, dataMode: "real", provider: provider(async () => {
      throw new Error("ais_timeout")
    }), intervalMs: 60 * 60 * 1000 }))
    await runtime.start()
    await expect(runtime.runNow("ais-tracking")).resolves.toMatchObject({ status: "failed" })
    expect(await new RuntimeRepository(database).getProviderRuntime("aisstream", "ais_tracking")).toMatchObject({ status: "failed", consecutiveFailures: 1 })
    expect((await new RuntimeRepository(database).listSyncRuns("aisstream"))[0]).toMatchObject({ status: "failed", errorCode: "job_failed" })
    expect(native.prepare("SELECT COUNT(*) AS count FROM ais_positions").get()).toEqual({ count: 0 })
    runtime.stop()
    native.close()
  })

  it("keeps the last-known position when the next Provider call fails", async () => {
    const { database, native } = createNativeDatabase()
    await initShippingTables(database, "real")
    await database.prepare(`
      INSERT INTO vessel_metadata (id, name, mmsi, source, fetched_at, source_type, data)
      VALUES ('vessel-real', 'REAL VESSEL', '413393620', 'aisstream', '2026-08-24T00:00:00.000Z', 'real', '{}')
    `).run()
    await database.prepare("INSERT INTO vessel_watchlist (vessel_id, watched_at, ais_enabled) VALUES ('vessel-real', '2026-08-24T00:00:00.000Z', 1)").run()
    const positions = new AisPositionRepository(database, "real")
    await positions.savePositions([{ ...validPosition, timestamp: "2026-08-24T00:00:00.000Z" }], [{ vesselId: "vessel-real", mmsi: "413393620" }])
    const runtime = new BackgroundRuntime(new RuntimeRepository(database))
    runtime.register(createAisTrackingJob({ database, dataMode: "real", provider: provider(async () => {
      throw new Error("ais_timeout")
    }), intervalMs: 60 * 60 * 1000 }))
    await runtime.start()
    await expect(runtime.runNow("ais-tracking")).resolves.toMatchObject({ status: "failed" })
    expect(await positions.getLatestPosition("vessel-real", new Date("2026-08-24T00:01:00.000Z"))).toMatchObject({ timestamp: "2026-08-24T00:00:00.000Z", latitude: 22.48 })
    runtime.stop()
    native.close()
  })

  it("does not execute the Provider twice when runNow overlaps", async () => {
    const { database, native } = createNativeDatabase()
    await initShippingTables(database, "mock")
    await seedWatchlist(database)
    let calls = 0
    let release!: () => void
    const waiting = new Promise<void>((resolve) => {
      release = resolve
    })
    const runtime = new BackgroundRuntime(new RuntimeRepository(database))
    runtime.register(createAisTrackingJob({
      database,
      dataMode: "mock",
      provider: provider(async () => {
        calls++
        await waiting
        return [validPosition]
      }),
      intervalMs: 60 * 60 * 1000,
    }))
    await runtime.start()
    const first = runtime.runNow("ais-tracking")
    await new Promise(resolve => setTimeout(resolve, 0))
    const second = runtime.runNow("ais-tracking")
    release()
    await expect(first).resolves.toMatchObject({ status: "success" })
    await expect(second).resolves.toMatchObject({ status: "skipped", errorCode: "job_running" })
    expect(calls).toBe(1)
    runtime.stop()
    native.close()
  })
})
