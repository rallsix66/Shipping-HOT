import NativeDatabase from "better-sqlite3"
import { createDatabase } from "db0"
import { afterEach, describe, expect, it, vi } from "vitest"
import { initShippingTables } from "#/database/shipping"
import type { AisAreaProvider } from "#/providers/aisstream-area"
import { createAisAreaSyncJob } from "#/runtime/ais-area-sync-job"
import { bootstrapBackgroundRuntime, getAisAreaProvider, shutdownBackgroundRuntime } from "#/runtime/bootstrap"

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

function areaProvider(close: () => void): AisAreaProvider {
  return { providerId: "aisstream-area", getPortMetrics: async () => [], close }
}

const environmentNames = ["SHIPPING_DATA_MODE", "SHIPPING_AIS_AREA_PROVIDER", "SHIPPING_AIS_PROVIDER", "SHIPPING_AIS_STREAMING_ENABLED", "SHIPPING_RUNTIME_ENABLED"]
const previousEnvironment = new Map(environmentNames.map(name => [name, process.env[name]]))

afterEach(async () => {
  await shutdownBackgroundRuntime()
  for (const name of environmentNames) {
    const value = previousEnvironment.get(name)
    if (value === undefined) delete process.env[name]
    else process.env[name] = value
  }
})

describe("background runtime bootstrap AIS Area ownership", () => {
  it("creates one Area provider across repeated bootstrap calls and closes it on shutdown", async () => {
    const { database, native } = createNativeDatabase()
    await initShippingTables(database, "real")
    process.env.SHIPPING_DATA_MODE = "real"
    process.env.SHIPPING_AIS_AREA_PROVIDER = "aisstream"
    process.env.SHIPPING_AIS_PROVIDER = "aisstream"
    process.env.SHIPPING_AIS_STREAMING_ENABLED = "false"
    const close = vi.fn()
    const provider = areaProvider(close)
    const job = createAisAreaSyncJob({ database, dataMode: "real", provider, intervalMs: 60_000 })
    const first = await bootstrapBackgroundRuntime({ database, jobs: [job], aisAreaProvider: provider, enabled: true })
    const second = await bootstrapBackgroundRuntime({ database, jobs: [job], aisAreaProvider: areaProvider(close), enabled: true })
    expect(second).toBe(first)
    expect(getAisAreaProvider()).toBe(provider)
    await shutdownBackgroundRuntime()
    expect(close).toHaveBeenCalledTimes(1)
    native.close()
  })

  it("closes the Area provider when bootstrap fails", async () => {
    const { database, native } = createNativeDatabase()
    await initShippingTables(database, "real")
    process.env.SHIPPING_DATA_MODE = "real"
    process.env.SHIPPING_AIS_AREA_PROVIDER = "aisstream"
    process.env.SHIPPING_AIS_PROVIDER = "aisstream"
    process.env.SHIPPING_AIS_STREAMING_ENABLED = "true"
    process.env.SHIPPING_RUNTIME_ENABLED = "true"
    const close = vi.fn()
    const provider = areaProvider(close)
    const tracker = {
      start: async () => {
        throw new Error("tracker_start_failed")
      },
      stop: vi.fn(),
    } as never
    await expect(bootstrapBackgroundRuntime({ database, jobs: [], aisAreaProvider: provider, aisLiveTracker: tracker, enabled: true })).rejects.toThrow("tracker_start_failed")
    expect(close).toHaveBeenCalledTimes(1)
    native.close()
  })
})
