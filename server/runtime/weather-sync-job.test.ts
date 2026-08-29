import NativeDatabase from "better-sqlite3"
import { createDatabase } from "db0"
import { describe, expect, it } from "vitest"
import { createMockSnapshot } from "@shared/shipping-fixtures"
import type { FeedItem } from "@shared/shipping"
import { createWeatherSyncJob } from "./weather-sync-job"
import { ShippingRepository, initShippingTables } from "#/database/shipping"
import { MockWeatherProvider } from "#/providers/shipping"

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

function weatherItem(overrides: Partial<FeedItem> = {}): FeedItem {
  return {
    id: "mock-weather-runtime",
    sourceId: "mock-weather",
    category: "weather",
    type: "weather_risk",
    title: "Mock weather runtime",
    summary: "Mock weather runtime",
    sourceUrl: "https://example.test/mock-weather",
    publishedAt: "2026-08-29T00:00:00.000Z",
    publicationTimeKnown: true,
    eventEligibility: false,
    severity: "warning",
    relatedPortIds: ["port-shekou"],
    relatedVesselIds: [],
    relatedVoyageIds: [],
    updatedAt: "2026-08-29T00:00:00.000Z",
    sourceUpdatedAt: "2026-08-29T00:00:00.000Z",
    fetchedAt: "2026-08-29T00:00:00.000Z",
    stale: false,
    sourceStatus: "healthy",
    provenance: { sourceType: "mock", dataNature: "forecast", sourceId: "mock-weather" },
    ...overrides,
  }
}

async function seedPorts(database: Parameters<typeof initShippingTables>[0]) {
  const snapshot = createMockSnapshot()
  await new ShippingRepository(database, "mock").seed([], snapshot.ports, [], [], [], snapshot.settings)
}

describe("weather sync job", () => {
  it("uses the Weather provider identity and reports successful writes", async () => {
    const { database, native } = createNativeDatabase()
    await initShippingTables(database, "mock")
    await seedPorts(database)
    const sourceUpdatedAt = "2026-08-29T00:00:00.000Z"
    const provider = { providerId: "mock-weather", getFeedItems: async () => [weatherItem({ sourceUpdatedAt })] }
    const job = createWeatherSyncJob({ database, dataMode: "mock", provider, intervalMs: 60_000, now: () => new Date(sourceUpdatedAt) })
    const result = await job.run()
    expect(job.providerId).toBe("mock-weather")
    expect(result).toMatchObject({ status: "success", recordsRead: 1, recordsWritten: 1, sourceUpdatedAt })
    expect((await new ShippingRepository(database, "mock").listFeedItems({ view: "all" }))).toEqual([expect.objectContaining({ sourceId: "mock-weather" })])
    native.close()
  })

  it("keeps provider failure identity and last-known weather data", async () => {
    const { database, native } = createNativeDatabase()
    await initShippingTables(database, "mock")
    await seedPorts(database)
    const repository = new ShippingRepository(database, "mock")
    await repository.upsertFeedItem(weatherItem())
    const provider = {
      providerId: "mock-weather",
      getFeedItems: async (_ports: unknown[] = [], lastKnown: FeedItem[] = []) => lastKnown.map(item => ({ ...item, stale: true, sourceStatus: "failed" as const, error: "Weather rate limited", errorCode: "rate_limited" })),
    }
    const job = createWeatherSyncJob({ database, dataMode: "mock", provider, intervalMs: 60_000, now: () => new Date("2026-08-29T01:00:00.000Z") })
    const result = await job.run()
    expect(job.providerId).toBe("mock-weather")
    expect(result).toMatchObject({ status: "failed", recordsRead: 1, recordsWritten: 1, errorCode: "rate_limited" })
    native.close()
  })

  it("exposes the built-in Mock Weather identity", () => {
    expect(MockWeatherProvider.providerId).toBe("mock-weather")
  })
})
