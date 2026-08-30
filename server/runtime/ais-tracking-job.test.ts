import NativeDatabase from "better-sqlite3"
import { createDatabase } from "db0"
import { describe, expect, it } from "vitest"
import { AisPositionRepository } from "#/database/ais-positions"
import { initShippingTables } from "#/database/shipping"
import { RuntimeRepository } from "#/database/runtime-jobs"
import { AIS_TRACKING_CAPABILITY, type AisPosition, type AisTrackingProvider, type AisTrackingVessel } from "#/providers/ais/contracts"
import { ProviderError } from "#/providers/contracts"
import { createAisTrackingJob } from "#/runtime/ais-tracking-job"
import { BackgroundRuntime } from "#/runtime/background-runtime"
import { readAisLatestPosition } from "#/services/ais-position-read"

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
           ('vessel-without-mmsi', 'WITHOUT MMSI', NULL, 'test', '2026-08-24T00:00:00.000Z', 'mock', '{}'),
           ('vessel-with-invalid-mmsi', 'INVALID MMSI', '123', 'test', '2026-08-24T00:00:00.000Z', 'mock', '{}')
  `).run()
  await database.prepare(`
    INSERT INTO vessel_watchlist (vessel_id, watched_at, ais_enabled)
    VALUES ('vessel-with-mmsi', '2026-08-24T00:00:00.000Z', 1), ('vessel-without-mmsi', '2026-08-24T00:00:00.000Z', 1), ('vessel-with-invalid-mmsi', '2026-08-24T00:00:00.000Z', 1)
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
  it("skips without eligible targets and does not count as Provider success or failure", async () => {
    const { database, native } = createNativeDatabase()
    await initShippingTables(database, "real")
    let calls = 0
    const runtime = new BackgroundRuntime(new RuntimeRepository(database))
    runtime.register(createAisTrackingJob({
      database,
      dataMode: "real",
      provider: provider(async () => {
        calls++
        return []
      }),
      intervalMs: 60 * 60 * 1000,
    }))
    await runtime.start()
    await expect(runtime.runNow("ais-tracking")).resolves.toMatchObject({
      status: "skipped",
      recordsRead: 0,
      recordsWritten: 0,
      errorCode: "no_eligible_ais_targets",
      errorMessage: "No eligible watched vessel with valid MMSI",
    })
    expect(calls).toBe(0)
    expect(await new RuntimeRepository(database).getProviderRuntime("aisstream", AIS_TRACKING_CAPABILITY)).toMatchObject({
      status: "never_succeeded",
      lastSuccessAt: undefined,
      errorCode: "no_eligible_ais_targets",
    })
    expect((await new RuntimeRepository(database).listSyncRuns("aisstream"))[0]).toMatchObject({ status: "skipped", errorCode: "no_eligible_ais_targets" })
    expect(native.prepare("SELECT request_count, success_count, failure_count FROM provider_usage WHERE provider_id = 'aisstream' AND capability = 'ais_tracking'").get()).toEqual({ request_count: 1, success_count: 0, failure_count: 0 })
    runtime.stop()
    native.close()
  })

  it("preserves a previous success when a later run has no eligible targets", async () => {
    const { database, native } = createNativeDatabase()
    await initShippingTables(database, "mock")
    await database.prepare(`
      INSERT INTO vessel_metadata (id, name, mmsi, source, fetched_at, source_type, data)
      VALUES ('vessel-real', 'REAL VESSEL', '413393620', 'aisstream', '2026-08-24T00:00:00.000Z', 'real', '{}')
    `).run()
    await database.prepare("INSERT INTO vessel_watchlist (vessel_id, watched_at, ais_enabled) VALUES ('vessel-real', '2026-08-24T00:00:00.000Z', 1)").run()
    let calls = 0
    const runtime = new BackgroundRuntime(new RuntimeRepository(database))
    runtime.register(createAisTrackingJob({
      database,
      dataMode: "mock",
      provider: provider(async () => {
        calls++
        return [validPosition]
      }),
      intervalMs: 60 * 60 * 1000,
    }))
    await runtime.start()
    await expect(runtime.runNow("ais-tracking")).resolves.toMatchObject({ status: "success" })
    const success = await new RuntimeRepository(database).getProviderRuntime("aisstream", AIS_TRACKING_CAPABILITY)
    await database.prepare("DELETE FROM vessel_watchlist").run()
    await expect(runtime.runNow("ais-tracking")).resolves.toMatchObject({ status: "skipped", errorCode: "no_eligible_ais_targets" })
    expect(calls).toBe(1)
    expect(await new RuntimeRepository(database).getProviderRuntime("aisstream", AIS_TRACKING_CAPABILITY)).toMatchObject({ status: "healthy", lastSuccessAt: success?.lastSuccessAt, errorCode: "no_eligible_ais_targets" })
    expect(native.prepare("SELECT request_count, success_count, failure_count FROM provider_usage WHERE provider_id = 'aisstream' AND capability = 'ais_tracking'").get()).toEqual({ request_count: 2, success_count: 1, failure_count: 0 })
    runtime.stop()
    native.close()
  })

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
      throw new ProviderError("provider_timeout", "aisstream_timeout")
    }), intervalMs: 60 * 60 * 1000 }))
    await runtime.start()
    await expect(runtime.runNow("ais-tracking")).resolves.toMatchObject({ status: "failed", errorCode: "provider_timeout" })
    expect(await new RuntimeRepository(database).getProviderRuntime("aisstream", AIS_TRACKING_CAPABILITY)).toMatchObject({ status: "failed", errorCode: "provider_timeout", consecutiveFailures: 1 })
    expect((await new RuntimeRepository(database).listSyncRuns("aisstream"))[0]).toMatchObject({ status: "failed", errorCode: "provider_timeout" })
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
    let currentTime = new Date("2026-08-24T00:00:00.000Z")
    let calls = 0
    const now = () => new Date(currentTime)
    const runtime = new BackgroundRuntime(new RuntimeRepository(database))
    runtime.register(createAisTrackingJob({
      database,
      dataMode: "real",
      provider: provider(async () => {
        calls++
        if (calls === 1) return [{ ...validPosition, timestamp: "2026-08-24T00:00:00.000Z" }]
        throw new ProviderError("provider_timeout", "aisstream_timeout")
      }),
      intervalMs: 60 * 60 * 1000,
      now,
    }))
    await runtime.start()
    await expect(runtime.runNow("ais-tracking")).resolves.toMatchObject({ status: "success", recordsWritten: 1 })
    currentTime = new Date("2026-08-24T00:01:00.000Z")
    await expect(runtime.runNow("ais-tracking")).resolves.toMatchObject({ status: "failed", errorCode: "provider_timeout" })
    const runtimeRepository = new RuntimeRepository(database)
    expect(await runtimeRepository.getProviderRuntime("aisstream", AIS_TRACKING_CAPABILITY)).toMatchObject({ status: "degraded", errorCode: "provider_timeout", consecutiveFailures: 1 })
    expect((await runtimeRepository.listSyncRuns("aisstream"))[0]).toMatchObject({ status: "failed", errorCode: "provider_timeout" })
    expect(await readAisLatestPosition({ database, dataMode: "real", vesselId: "vessel-real", now: new Date("2026-08-24T00:01:00.000Z") })).toMatchObject({ timestamp: "2026-08-24T00:00:00.000Z", latitude: 22.48, source: "aisstream", sourceType: "real", stale: false, sourceStatus: "degraded", errorCode: "provider_timeout" })
    expect(await readAisLatestPosition({ database, dataMode: "real", vesselId: "vessel-real", now: new Date("2026-08-24T00:16:00.000Z") })).toMatchObject({ timestamp: "2026-08-24T00:00:00.000Z", sourceType: "real", stale: true, sourceStatus: "degraded", errorCode: "provider_timeout" })
    expect(native.prepare("SELECT COUNT(*) AS count FROM ais_positions WHERE source_type = 'mock'").get()).toEqual({ count: 0 })
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
