import NativeDatabase from "better-sqlite3"
import { createDatabase } from "db0"
import { describe, expect, it } from "vitest"
import type { FeedItem, Port } from "@shared/shipping"
import { createMockSnapshot } from "@shared/shipping-fixtures"
import { createWeatherAlertSyncJob } from "./weather-alert-sync-job"
import { ShippingRepository, initShippingTables } from "#/database/shipping"
import { ProviderError } from "#/providers/contracts"
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

function realPort(): Port {
  const port = createMockSnapshot().ports[0]
  return {
    ...port,
    provenance: { sourceType: "official", dataNature: "reported", sourceId: "unlocode", verified: true },
  }
}

function alertItem(overrides: Partial<FeedItem> = {}): FeedItem {
  return {
    id: "tmd-alert-1",
    sourceId: "tmd",
    category: "weather",
    type: "weather_warning_official",
    title: "Heavy rain near Laem Chabang",
    summary: "Heavy rain warning",
    sourceUrl: "https://www.tmd.go.th/en/api/xml/CAP",
    publishedAt: "2026-09-01T00:00:00.000Z",
    publicationTimeKnown: true,
    eventEligibility: true,
    severity: "warning",
    relatedPortIds: ["port-shekou"],
    relatedVesselIds: [],
    relatedVoyageIds: [],
    updatedAt: "2026-09-01T00:00:00.000Z",
    sourceUpdatedAt: "2026-09-01T00:00:00.000Z",
    fetchedAt: "2026-09-01T00:00:00.000Z",
    stale: false,
    sourceStatus: "healthy",
    provenance: { sourceType: "official", dataNature: "reported", sourceId: "tmd", sourceUrl: "https://www.tmd.go.th/en/service/rss", verified: true },
    ...overrides,
  }
}

describe("official weather alert sync job", () => {
  it("treats a valid empty response as a successful zero-record run", async () => {
    const { database, native } = createNativeDatabase()
    await initShippingTables(database, "real")
    await new ShippingRepository(database, "real").seed([], [realPort()], [], [], [], createMockSnapshot().settings)
    const job = createWeatherAlertSyncJob({
      database,
      dataMode: "real",
      sourceId: "tmd",
      provider: { providerId: "tmd", getFeedItems: async () => [] },
      intervalMs: 15 * 60 * 1000,
      now: () => new Date("2026-09-01T00:10:00.000Z"),
    })

    await expect(job.run()).resolves.toEqual({ status: "success", recordsRead: 0, recordsWritten: 0, sourceUpdatedAt: undefined })
    expect(await new ShippingRepository(database, "real").listFeedItems({ view: "all" })).toEqual([])
    native.close()
  })

  it("persists official feed data and Runtime health across the normal Runtime path", async () => {
    const { database, native } = createNativeDatabase()
    await initShippingTables(database, "real")
    await new ShippingRepository(database, "real").seed([], [realPort()], [], [], [], createMockSnapshot().settings)
    const job = createWeatherAlertSyncJob({
      database,
      dataMode: "real",
      sourceId: "tmd",
      provider: { providerId: "tmd", getFeedItems: async () => [alertItem()] },
      intervalMs: 15 * 60 * 1000,
      now: () => new Date("2026-09-01T00:10:00.000Z"),
    })
    const runtimeRepository = new RuntimeRepository(database)
    const runtime = new BackgroundRuntime(runtimeRepository)
    runtime.register(job)
    await runtime.start()
    await expect(runtime.runNow(job.id)).resolves.toMatchObject({ status: "success", recordsRead: 1, recordsWritten: 1, sourceUpdatedAt: "2026-09-01T00:00:00.000Z" })
    expect(await runtimeRepository.getProviderRuntime("tmd", "weather_alerts")).toMatchObject({ status: "healthy", lastSuccessAt: expect.any(String), lastSourceUpdatedAt: "2026-09-01T00:00:00.000Z" })
    expect(await runtimeRepository.listSyncRuns("tmd")).toEqual([expect.objectContaining({ status: "success", recordsRead: 1, recordsWritten: 1 })])
    expect(await new ShippingRepository(database, "real").listFeedItems({ view: "all" })).toEqual([expect.objectContaining({ id: "tmd-alert-1", provenance: expect.objectContaining({ sourceId: "tmd" }) })])
    runtime.stop()
    native.close()
  })

  it("preserves the canonical failure when no last-known alert exists", async () => {
    const { database, native } = createNativeDatabase()
    await initShippingTables(database, "real")
    const job = createWeatherAlertSyncJob({
      database,
      dataMode: "real",
      sourceId: "tmd",
      provider: {
        providerId: "tmd",
        getFeedItems: async () => {
          throw new ProviderError("provider_contract_changed", "TMD warning structure changed")
        },
      },
      intervalMs: 15 * 60 * 1000,
    })
    const runtime = new BackgroundRuntime(new RuntimeRepository(database))
    runtime.register(job)
    await runtime.start()
    await expect(runtime.runNow(job.id)).resolves.toMatchObject({ status: "failed", errorCode: "provider_contract_changed" })
    expect(await new RuntimeRepository(database).getProviderRuntime("tmd", "weather_alerts")).toMatchObject({ status: "failed", errorCode: "provider_contract_changed", lastSuccessAt: undefined })
    expect(await new RuntimeRepository(database).listSyncRuns("tmd")).toEqual([expect.objectContaining({ status: "failed", errorCode: "provider_contract_changed" })])
    runtime.stop()
    native.close()
  })

  it("returns failed with stale last-known data without archiving it", async () => {
    const { database, native } = createNativeDatabase()
    await initShippingTables(database, "real")
    const repository = new ShippingRepository(database, "real")
    await repository.seed([], [realPort()], [], [alertItem()], [], createMockSnapshot().settings)
    const job = createWeatherAlertSyncJob({
      database,
      dataMode: "real",
      sourceId: "tmd",
      provider: {
        providerId: "tmd",
        getFeedItems: async (lastKnown = []) => lastKnown.map(item => ({ ...item, stale: true, sourceStatus: "failed" as const, errorCode: "rate_limited", error: "TMD rate limited" })),
      },
      intervalMs: 15 * 60 * 1000,
    })
    await expect(job.run()).resolves.toMatchObject({ status: "failed", recordsRead: 1, recordsWritten: 1, errorCode: "rate_limited" })
    expect(await repository.listFeedItems({ view: "current" })).toEqual([expect.objectContaining({ id: "tmd-alert-1", sourceStatus: "failed", errorCode: "rate_limited" })])
    native.close()
  })
})
