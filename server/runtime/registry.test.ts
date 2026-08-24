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
  it("registers AIS and Voyage jobs without Feed, Calendar or Translation jobs", async () => {
    const { database, native } = createNativeDatabase()
    await initShippingTables(database, "mock")
    const jobs = getDefaultRuntimeJobs({ database, dataMode: "mock", aisProvider, voyageProvider })
    expect(jobs.map(job => [job.id, job.capability])).toEqual([
      ["ais-tracking", "ais_tracking"],
      ["voyage-sync", "voyage_sync"],
    ])
    native.close()
  })
})
