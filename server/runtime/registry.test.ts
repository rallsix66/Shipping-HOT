import NativeDatabase from "better-sqlite3"
import { createDatabase } from "db0"
import { describe, expect, it } from "vitest"
import { initShippingTables } from "#/database/shipping"
import type { AisTrackingProvider } from "#/providers/ais/contracts"
import type { VoyageProvider } from "#/providers/voyage/contracts"
import { getDefaultRuntimeJobs } from "#/runtime/registry"

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

const aisProvider: AisTrackingProvider = {
  providerId: "mock",
  subscribe: async () => undefined,
  unsubscribe: async () => undefined,
  getLatestPositions: async () => [],
}

const voyageProvider: VoyageProvider = {
  providerId: "mock-voyage",
  getVoyages: async () => [],
}

describe("runtime registry", () => {
  it("registers AIS, Voyage, Feed, and Calendar jobs without Translation jobs", async () => {
    const { database, native } = createNativeDatabase()
    await initShippingTables(database, "mock")
    const jobs = getDefaultRuntimeJobs({ database, dataMode: "mock", aisProvider, voyageProvider })
    expect(jobs.map(job => [job.id, job.capability])).toEqual([
      ["ais-tracking", "ais_tracking"],
      ["voyage-sync", "voyage_sync"],
      ["feed-sync:mock-port-notice", "feed_sync"],
      ["calendar-sync", "calendar_sync"],
      ["port-sync", "port_intelligence"],
      ["weather-sync", "weather_sync"],
    ])
    native.close()
  })

  it("uses the existing vessel provider setting as the AIS provider alias", async () => {
    const { database, native } = createNativeDatabase()
    await initShippingTables(database, "real")
    const previousAis = process.env.SHIPPING_AIS_PROVIDER
    const previousVessel = process.env.SHIPPING_VESSEL_PROVIDER
    try {
      delete process.env.SHIPPING_AIS_PROVIDER
      process.env.SHIPPING_VESSEL_PROVIDER = "aisstream"
      const jobs = getDefaultRuntimeJobs({ database, dataMode: "real", voyageProvider })
      expect(jobs.find(job => job.id === "ais-tracking")).toMatchObject({ providerId: "aisstream", enabled: true })
    } finally {
      if (previousAis === undefined) delete process.env.SHIPPING_AIS_PROVIDER
      else process.env.SHIPPING_AIS_PROVIDER = previousAis
      if (previousVessel === undefined) delete process.env.SHIPPING_VESSEL_PROVIDER
      else process.env.SHIPPING_VESSEL_PROVIDER = previousVessel
      native.close()
    }
  })
})
