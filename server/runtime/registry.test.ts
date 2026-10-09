import NativeDatabase from "better-sqlite3"
import { createDatabase } from "db0"
import { afterEach, describe, expect, it } from "vitest"
import { initShippingTables } from "#/database/shipping"
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

describe("runtime registry", () => {
  afterEach(() => {
    delete process.env.SHIPPING_FEED_PROVIDER
    delete process.env.SHIPPING_WEATHER_ALERT_PROVIDER
  })

  it("registers port, weather, calendar and mock feed jobs in development mode", async () => {
    const { database, native } = createNativeDatabase()
    await initShippingTables(database, "mock")
    const jobs = getDefaultRuntimeJobs({ database, dataMode: "mock" })
    expect(jobs.map(job => job.id)).toEqual(expect.arrayContaining([
      "feed-sync:mock-port-notice",
      "calendar-sync",
      "port-sync",
      "weather-sync",
      "translation-sync",
    ]))
    expect(jobs.some(job => job.id.startsWith("feed-sync:"))).toBe(true)
    native.close()
  })

  it("omits mock feed jobs when real public feed is configured", async () => {
    const { database, native } = createNativeDatabase()
    await initShippingTables(database, "real")
    process.env.SHIPPING_FEED_PROVIDER = "public"
    const jobs = getDefaultRuntimeJobs({ database, dataMode: "real" })
    expect(jobs.some(job => job.id === "feed-sync:mock-port-notice")).toBe(false)
    expect(jobs.some(job => job.id.startsWith("feed-sync:"))).toBe(true)
    native.close()
  })
})
