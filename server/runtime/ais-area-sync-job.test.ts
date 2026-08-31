import NativeDatabase from "better-sqlite3"
import { createDatabase } from "db0"
import { describe, expect, it } from "vitest"
import type { AisDerivedPortMetric } from "@shared/ais-area"
import { mockPorts } from "@shared/shipping-fixtures"
import type { Port } from "@shared/shipping"
import { ShippingRepository, initShippingTables } from "#/database/shipping"
import type { AisAreaProvider } from "#/providers/aisstream-area"
import { createAisAreaSyncJob } from "#/runtime/ais-area-sync-job"
import { BackgroundRuntime } from "#/runtime/background-runtime"
import { RuntimeRepository } from "#/database/runtime-jobs"

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

const realPort: Port = {
  ...mockPorts[0],
  source_type: "real",
  provenance: { sourceType: "third_party", dataNature: "reported", sourceId: "test-port", verified: false },
  stale: false,
  sourceStatus: "healthy",
  fetchedAt: "2026-08-31T00:00:00.000Z",
  updatedAt: "2026-08-31T00:00:00.000Z",
}

const secondRealPort: Port = {
  ...mockPorts[1],
  source_type: "real",
  provenance: { sourceType: "third_party", dataNature: "reported", sourceId: "test-port", verified: false },
  stale: false,
  sourceStatus: "healthy",
  fetchedAt: "2026-08-31T00:00:00.000Z",
  updatedAt: "2026-08-31T00:00:00.000Z",
}

function metric(overrides: Partial<AisDerivedPortMetric> = {}): AisDerivedPortMetric {
  return {
    portId: realPort.id,
    sampleSize: 1,
    activeVesselCount: 1,
    anchoredCount: 1,
    mooredCount: 0,
    lowSpeedCount: 1,
    stationaryRatio: 1,
    ambiguousSampleCount: 0,
    trend: "unknown",
    consecutiveRisingWindows: 0,
    bbox: { south: 22, west: 113, north: 23, east: 114 },
    boundarySource: "configured_heuristic",
    coverage: "insufficient_samples",
    lowSpeedThresholdKnots: 1,
    minimumSampleSize: 5,
    updatedAt: "2026-08-31T00:00:00.000Z",
    sourceUpdatedAt: "2026-08-31T00:00:00.000Z",
    fetchedAt: "2026-08-31T00:00:01.000Z",
    stale: false,
    sourceStatus: "healthy",
    provenance: { sourceType: "third_party", dataNature: "derived", sourceId: "aisstream-area", verified: false },
    ...overrides,
  }
}

function provider(run: AisAreaProvider["getPortMetrics"]): AisAreaProvider {
  return { providerId: "aisstream-area", getPortMetrics: run, close: () => undefined }
}

async function setup(watched = true, includeSecondPort = false) {
  const { database, native } = createNativeDatabase()
  await initShippingTables(database, "real")
  const repository = new ShippingRepository(database, "real")
  await repository.upsertPort(realPort)
  if (watched) await repository.updateWatch("port", realPort.id, true)
  if (includeSecondPort) {
    await repository.upsertPort(secondRealPort)
    if (watched) await repository.updateWatch("port", secondRealPort.id, true)
  }
  return { database, native, repository }
}

describe("ais area sync job", () => {
  it("skips without watched ports and never calls the provider", async () => {
    const { database, native } = await setup(false)
    let calls = 0
    const runtime = new BackgroundRuntime(new RuntimeRepository(database))
    runtime.register(createAisAreaSyncJob({ database, dataMode: "real", provider: provider(async () => {
      calls++
      return []
    }), intervalMs: 60_000 }))
    await runtime.start()
    await expect(runtime.runNow("ais-area-sync")).resolves.toMatchObject({ status: "skipped", errorCode: "no_eligible_ais_area_ports" })
    expect(calls).toBe(0)
    expect(await new RuntimeRepository(database).getProviderRuntime("aisstream-area", "ais_area")).toMatchObject({ status: "never_succeeded" })
    runtime.stop()
    native.close()
  })

  it("skips a watched port with zero observations without success timestamps", async () => {
    const { database, native } = await setup()
    const runtime = new BackgroundRuntime(new RuntimeRepository(database))
    runtime.register(createAisAreaSyncJob({ database, dataMode: "real", provider: provider(async () => [metric({ sampleSize: 0, activeVesselCount: 0, coverage: "no_observation", sourceUpdatedAt: undefined, updatedAt: undefined, sourceStatus: "never_succeeded", error: "no_observation" })]), intervalMs: 60_000 }))
    await runtime.start()
    await expect(runtime.runNow("ais-area-sync")).resolves.toMatchObject({ status: "skipped", errorCode: "no_ais_area_observation" })
    expect(await new RuntimeRepository(database).getProviderRuntime("aisstream-area", "ais_area")).toMatchObject({ status: "never_succeeded", lastSuccessAt: undefined, lastSourceUpdatedAt: undefined })
    expect(await new ShippingRepository(database, "real").listAisPortMetrics()).toHaveLength(1)
    runtime.stop()
    native.close()
  })

  it("skips one stale observation metric without treating it as Provider failure", async () => {
    const { database, native } = await setup()
    const stale = metric({ sampleSize: 5, coverage: "stale", stale: true, sourceStatus: "degraded", error: "AIS area observations stale", errorCode: undefined })
    const runtime = new BackgroundRuntime(new RuntimeRepository(database))
    runtime.register(createAisAreaSyncJob({ database, dataMode: "real", provider: provider(async () => [stale]), intervalMs: 60_000 }))
    await runtime.start()
    await expect(runtime.runNow("ais-area-sync")).resolves.toMatchObject({ status: "skipped", recordsRead: 0, recordsWritten: 1, errorCode: "no_ais_area_observation" })
    expect(await new RuntimeRepository(database).getProviderRuntime("aisstream-area", "ais_area")).toMatchObject({ status: "never_succeeded", errorCode: "no_ais_area_observation" })
    runtime.stop()
    native.close()
  })

  it("skips all stale metrics while preserving historical Runtime timestamps and health", async () => {
    const { database, native } = await setup(true, true)
    const healthyMetrics = [
      metric({ sourceUpdatedAt: "2026-08-31T00:01:00.000Z" }),
      metric({ portId: secondRealPort.id, sourceUpdatedAt: "2026-08-31T00:02:00.000Z" }),
    ]
    const staleMetrics = healthyMetrics.map(value => ({ ...value, coverage: "stale" as const, stale: true, sourceStatus: "degraded" as const, error: "AIS area observations stale", errorCode: undefined }))
    let staleOnly = false
    const runtimeRepository = new RuntimeRepository(database)
    const runtime = new BackgroundRuntime(runtimeRepository)
    runtime.register(createAisAreaSyncJob({ database, dataMode: "real", provider: provider(async () => staleOnly ? staleMetrics : healthyMetrics), intervalMs: 60_000 }))
    await runtime.start()
    await expect(runtime.runNow("ais-area-sync")).resolves.toMatchObject({ status: "success", recordsRead: 2, recordsWritten: 2, sourceUpdatedAt: "2026-08-31T00:02:00.000Z" })
    const before = await runtimeRepository.getProviderRuntime("aisstream-area", "ais_area")
    staleOnly = true
    await expect(runtime.runNow("ais-area-sync")).resolves.toMatchObject({ status: "skipped", recordsRead: 0, recordsWritten: 2, errorCode: "no_ais_area_observation" })
    const after = await runtimeRepository.getProviderRuntime("aisstream-area", "ais_area")
    expect(after).toMatchObject({ status: "healthy", lastSuccessAt: before?.lastSuccessAt, lastSourceUpdatedAt: before?.lastSourceUpdatedAt, errorCode: "no_ais_area_observation" })
    runtime.stop()
    native.close()
  })

  it("succeeds when one port is usable and another has only stale observations", async () => {
    const { database, native } = await setup(true, true)
    const usable = metric({ sampleSize: 5, activeVesselCount: 5, coverage: "usable", sourceUpdatedAt: "2026-08-31T00:05:00.000Z" })
    const stale = metric({ portId: secondRealPort.id, sampleSize: 5, coverage: "stale", stale: true, sourceStatus: "degraded", error: "AIS area observations stale", errorCode: undefined, sourceUpdatedAt: "2026-08-31T00:10:00.000Z" })
    const runtime = new BackgroundRuntime(new RuntimeRepository(database))
    runtime.register(createAisAreaSyncJob({ database, dataMode: "real", provider: provider(async () => [usable, stale]), intervalMs: 60_000 }))
    await runtime.start()
    await expect(runtime.runNow("ais-area-sync")).resolves.toMatchObject({ status: "success", recordsRead: 5, recordsWritten: 2, sourceUpdatedAt: "2026-08-31T00:05:00.000Z" })
    const persisted = await new ShippingRepository(database, "real").listAisPortMetrics()
    expect(persisted).toEqual(expect.arrayContaining([
      expect.objectContaining({ portId: realPort.id, coverage: "usable", sourceStatus: "healthy" }),
      expect.objectContaining({ portId: secondRealPort.id, coverage: "stale", sourceStatus: "degraded" }),
    ]))
    expect(persisted.find(metric => metric.portId === secondRealPort.id)?.errorCode).toBeUndefined()
    runtime.stop()
    native.close()
  })

  it("counts only current insufficient samples when another port is stale", async () => {
    const { database, native } = await setup(true, true)
    const insufficient = metric({ sampleSize: 2, activeVesselCount: 2, coverage: "insufficient_samples", sourceUpdatedAt: "2026-08-31T00:05:00.000Z" })
    const stale = metric({ portId: secondRealPort.id, sampleSize: 5, coverage: "stale", stale: true, sourceStatus: "degraded", error: "AIS area observations stale", errorCode: undefined, sourceUpdatedAt: "2026-08-31T00:10:00.000Z" })
    const runtime = new BackgroundRuntime(new RuntimeRepository(database))
    runtime.register(createAisAreaSyncJob({ database, dataMode: "real", provider: provider(async () => [insufficient, stale]), intervalMs: 60_000 }))
    await runtime.start()
    await expect(runtime.runNow("ais-area-sync")).resolves.toMatchObject({ status: "success", recordsRead: 2, recordsWritten: 2, sourceUpdatedAt: "2026-08-31T00:05:00.000Z" })
    runtime.stop()
    native.close()
  })

  it("persists insufficient real samples as an observation success", async () => {
    const { database, native } = await setup()
    const runtime = new BackgroundRuntime(new RuntimeRepository(database))
    runtime.register(createAisAreaSyncJob({ database, dataMode: "real", provider: provider(async () => [metric()]), intervalMs: 60_000 }))
    await runtime.start()
    await expect(runtime.runNow("ais-area-sync")).resolves.toMatchObject({ status: "success", recordsRead: 1, recordsWritten: 1, sourceUpdatedAt: "2026-08-31T00:00:00.000Z" })
    expect(await new ShippingRepository(database, "real").listAisPortMetrics()).toMatchObject([{ coverage: "insufficient_samples", sourceStatus: "healthy", stale: false }])
    expect(await new RuntimeRepository(database).getProviderRuntime("aisstream-area", "ais_area")).toMatchObject({ status: "healthy", lastSourceUpdatedAt: "2026-08-31T00:00:00.000Z" })
    runtime.stop()
    native.close()
  })

  it("persists usable samples and reports the newest trusted source timestamp", async () => {
    const { database, native } = await setup()
    const usable = metric({ sampleSize: 5, activeVesselCount: 5, coverage: "usable", sourceUpdatedAt: "2026-08-31T00:05:00.000Z", updatedAt: "2026-08-31T00:05:00.000Z" })
    const runtime = new BackgroundRuntime(new RuntimeRepository(database))
    runtime.register(createAisAreaSyncJob({ database, dataMode: "real", provider: provider(async () => [usable]), intervalMs: 60_000 }))
    await runtime.start()
    await expect(runtime.runNow("ais-area-sync")).resolves.toMatchObject({ status: "success", recordsRead: 5, recordsWritten: 1, sourceUpdatedAt: "2026-08-31T00:05:00.000Z" })
    expect(await new ShippingRepository(database, "real").listAisPortMetrics()).toMatchObject([{ coverage: "usable", sampleSize: 5 }])
    expect((await new RuntimeRepository(database).listSyncRuns("aisstream-area"))[0]).toMatchObject({ capability: "ais_area", status: "success", recordsWritten: 1 })
    runtime.stop()
    native.close()
  })

  it("writes stale last-known metrics and fails the job after provider failure", async () => {
    const { database, native } = await setup()
    const healthy = metric({ sampleSize: 5, activeVesselCount: 5, coverage: "usable" })
    const stale = metric({ sampleSize: 5, activeVesselCount: 5, coverage: "stale", stale: true, sourceStatus: "failed", error: "aisstream_unavailable", errorCode: "provider_unavailable" })
    let failed = false
    const runtime = new BackgroundRuntime(new RuntimeRepository(database))
    runtime.register(createAisAreaSyncJob({ database, dataMode: "real", provider: provider(async () => failed ? [stale] : [healthy]), intervalMs: 60_000 }))
    await runtime.start()
    await expect(runtime.runNow("ais-area-sync")).resolves.toMatchObject({ status: "success" })
    failed = true
    await expect(runtime.runNow("ais-area-sync")).resolves.toMatchObject({ status: "failed", errorCode: "provider_unavailable", recordsRead: 0, recordsWritten: 1 })
    expect(await new ShippingRepository(database, "real").listAisPortMetrics()).toMatchObject([{ coverage: "stale", sourceStatus: "failed", stale: true }])
    expect(await new RuntimeRepository(database).getProviderRuntime("aisstream-area", "ais_area")).toMatchObject({ status: "degraded", errorCode: "provider_unavailable" })
    runtime.stop()
    native.close()
  })

  it("rejects Mock metrics in Real Mode through the existing lineage guard", async () => {
    const { database, native } = await setup()
    const runtime = new BackgroundRuntime(new RuntimeRepository(database))
    runtime.register(createAisAreaSyncJob({ database, dataMode: "real", provider: provider(async () => [metric({ provenance: { sourceType: "mock", dataNature: "derived", sourceId: "mock-ais-area" } })]), intervalMs: 60_000 }))
    await runtime.start()
    await expect(runtime.runNow("ais-area-sync")).resolves.toMatchObject({ status: "failed" })
    expect(await new RuntimeRepository(database).getProviderRuntime("aisstream-area", "ais_area")).toMatchObject({ status: "failed" })
    runtime.stop()
    native.close()
  })
})
