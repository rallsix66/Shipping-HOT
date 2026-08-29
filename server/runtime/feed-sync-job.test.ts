import NativeDatabase from "better-sqlite3"
import { createDatabase } from "db0"
import { describe, expect, it, vi } from "vitest"
import { createMockSnapshot } from "@shared/shipping-fixtures"
import type { FeedItem } from "@shared/shipping"
import { createFeedSyncJob } from "./feed-sync-job"
import { ShippingRepository, initShippingTables } from "#/database/shipping"
import type { FeedProvider } from "#/providers/feed"
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

function item(overrides: Partial<FeedItem> = {}): FeedItem {
  return {
    id: "feed-runtime-new",
    sourceId: "the-loadstar",
    category: "shipping_news",
    type: "shipping_news",
    title: "Runtime feed update",
    summary: "Runtime feed update",
    sourceUrl: "https://theloadstar.com/runtime-update",
    canonicalUrl: "https://theloadstar.com/runtime-update",
    publishedAt: "2026-08-14T00:00:00.000Z",
    publicationTimeKnown: true,
    eventEligibility: false,
    severity: "info",
    relatedPortIds: [],
    relatedVesselIds: [],
    relatedVoyageIds: [],
    tags: ["third_party", "shipping_news"],
    updatedAt: "2026-08-14T00:00:00.000Z",
    sourceUpdatedAt: "2026-08-14T00:00:00.000Z",
    fetchedAt: "2026-08-15T00:00:00.000Z",
    stale: false,
    sourceStatus: "healthy",
    provenance: { sourceType: "third_party", dataNature: "reported", sourceId: "the-loadstar" },
    ...overrides,
  }
}

describe("feed sync job", () => {
  it("persists one source, archives its disappearance, and leaves other sources isolated", async () => {
    const { database, native } = createNativeDatabase()
    await initShippingTables(database, "mock")
    const repository = new ShippingRepository(database, "mock")
    const snapshot = createMockSnapshot()
    await repository.seed(snapshot.vessels, snapshot.ports, snapshot.voyages, [], snapshot.events, snapshot.settings)
    await repository.upsertFeedItem(item({ id: "feed-runtime-old", title: "Old runtime update", sourceUrl: "https://theloadstar.com/runtime-old" }))
    await repository.upsertFeedItem(item({ id: "feed-runtime-other", sourceId: "other-source", title: "Other source item", sourceUrl: "https://example.test/other" }))

    const provider: FeedProvider = { providerId: "the-loadstar", getFeedItems: vi.fn(async () => [item()]) }
    const job = createFeedSyncJob({
      database,
      dataMode: "mock",
      provider,
      source: { id: "the-loadstar", name: "The Loadstar" },
      intervalMs: 60_000,
      now: () => new Date("2026-08-15T00:00:00.000Z"),
    })

    await expect(job.run()).resolves.toMatchObject({ status: "success", recordsRead: 1, recordsWritten: 2 })
    expect(provider.getFeedItems).toHaveBeenCalledWith(expect.arrayContaining([expect.objectContaining({ id: "feed-runtime-old" })]), expect.any(Array))
    expect((await repository.listFeedItems({ now: new Date("2026-08-15T00:00:00.000Z") })).map(feed => feed.id)).toEqual(expect.arrayContaining(["feed-runtime-new", "feed-runtime-other"]))
    expect((await repository.listFeedItems({ now: new Date("2026-08-15T00:00:00.000Z") })).map(feed => feed.id)).toHaveLength(2)
    expect((await repository.listFeedItems({ view: "history" })).map(feed => feed.id)).toEqual(["feed-runtime-old"])
    expect((await repository.listFeedHistory({ query: "runtime", limit: 20 })).map(record => record.item.id)).toEqual(expect.arrayContaining(["feed-runtime-old", "feed-runtime-new"]))
    native.close()
  })

  it("isolates a source failure from a healthy source and records both Runtime outcomes", async () => {
    const { database, native } = createNativeDatabase()
    await initShippingTables(database, "mock")
    const runtime = new BackgroundRuntime(new RuntimeRepository(database), { now: () => new Date("2026-08-15T00:00:00.000Z") })
    const failedProvider: FeedProvider = { providerId: "failed-source", getFeedItems: vi.fn(async () => {
      throw new Error("source unavailable")
    }) }
    const healthyProvider: FeedProvider = { providerId: "healthy-source", getFeedItems: vi.fn(async () => []) }
    runtime.register(createFeedSyncJob({ database, dataMode: "mock", provider: failedProvider, source: { id: "failed-source", name: "Failed source" }, intervalMs: 60_000 }))
    runtime.register(createFeedSyncJob({ database, dataMode: "mock", provider: healthyProvider, source: { id: "healthy-source", name: "Healthy source" }, intervalMs: 60_000 }))
    await runtime.start()
    const [failed, healthy] = await Promise.all([runtime.runNow("feed-sync:failed-source"), runtime.runNow("feed-sync:healthy-source")])
    runtime.stop()

    expect(failed).toMatchObject({ status: "failed", errorCode: "job_failed" })
    expect(healthy).toMatchObject({ status: "success" })
    expect(await new RuntimeRepository(database).listSyncRuns("failed-source")).toEqual([expect.objectContaining({ status: "failed", errorMessage: "source unavailable" })])
    expect(await new RuntimeRepository(database).listSyncRuns("healthy-source")).toEqual([expect.objectContaining({ status: "success" })])
    expect(native.prepare("SELECT provider_id, capability, request_count, success_count, failure_count FROM provider_usage ORDER BY provider_id").all()).toEqual([
      { provider_id: "failed-source", capability: "feed_sync", request_count: 1, success_count: 0, failure_count: 1 },
      { provider_id: "healthy-source", capability: "feed_sync", request_count: 1, success_count: 1, failure_count: 0 },
    ])
    native.close()
  })

  it("passes a same-source historical last-known item back to the Provider after failure", async () => {
    const { database, native } = createNativeDatabase()
    await initShippingTables(database, "mock")
    const repository = new ShippingRepository(database, "mock")
    const snapshot = createMockSnapshot()
    await repository.seed(snapshot.vessels, snapshot.ports, snapshot.voyages, [], snapshot.events, snapshot.settings)
    const historical = item({
      id: "feed-runtime-historical",
      publishedAt: "2026-08-01T00:00:00.000Z",
      fetchedAt: "2026-08-01T00:00:00.000Z",
    })
    await repository.upsertFeedItem(historical)
    const provider: FeedProvider = {
      providerId: "the-loadstar",
      getFeedItems: vi.fn(async (lastKnown: FeedItem[] = []) => lastKnown.map(previous => ({ ...previous, fetchedAt: "2026-08-15T00:00:00.000Z", stale: true, sourceStatus: "failed" as const, error: "source unavailable" }))),
    }
    const job = createFeedSyncJob({
      database,
      dataMode: "mock",
      provider,
      source: { id: "the-loadstar", name: "The Loadstar" },
      intervalMs: 60_000,
      now: () => new Date("2026-08-15T00:00:00.000Z"),
    })

    await expect(job.run()).resolves.toMatchObject({ status: "failed", recordsRead: 1 })
    expect(provider.getFeedItems).toHaveBeenCalledWith([expect.objectContaining({ id: historical.id })], expect.any(Array))
    native.close()
  })
})
