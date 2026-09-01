import NativeDatabase from "better-sqlite3"
import { createDatabase } from "db0"
import { describe, expect, it } from "vitest"
import { initShippingTables } from "#/database/shipping"
import type { AisTrackingProvider } from "#/providers/ais/contracts"
import type { AisAreaProvider } from "#/providers/aisstream-area"
import type { VoyageProvider } from "#/providers/voyage/contracts"
import { createVoyageProviderForDatabase } from "#/providers/voyage"
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

const aisAreaProvider: AisAreaProvider = {
  providerId: "aisstream-area",
  getPortMetrics: async () => [],
  close: () => undefined,
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

  it("selects the real VesselAPI Voyage provider without falling back to Mock", async () => {
    const { database, native } = createNativeDatabase()
    await initShippingTables(database, "real")
    const previous = {
      provider: process.env.SHIPPING_VOYAGE_PROVIDER,
      key: process.env.VESSELAPI_API_KEY,
    }
    try {
      process.env.SHIPPING_VOYAGE_PROVIDER = "vesselapi"
      delete process.env.VESSELAPI_API_KEY
      const jobs = getDefaultRuntimeJobs({ database, dataMode: "real", aisProvider })
      expect(jobs.find(job => job.id === "voyage-sync")).toMatchObject({ providerId: "vesselapi", enabled: true })
      const provider = createVoyageProviderForDatabase(database, {
        providerId: "vesselapi",
        dataMode: "real",
        secretStore: {
          get: async () => undefined,
          set: async () => undefined,
          delete: async () => undefined,
          has: async () => false,
          source: async () => "missing",
        },
      })
      await expect(provider.getVoyages([{ vesselId: "vessel-1", imo: "9162423" }])).rejects.toMatchObject({ code: "auth_failed" })
      expect(provider.providerId).toBe("vesselapi")
    } finally {
      if (previous.provider === undefined) delete process.env.SHIPPING_VOYAGE_PROVIDER
      else process.env.SHIPPING_VOYAGE_PROVIDER = previous.provider
      if (previous.key === undefined) delete process.env.VESSELAPI_API_KEY
      else process.env.VESSELAPI_API_KEY = previous.key
      native.close()
    }
  })

  it("keeps Mock Voyage selected in Mock Mode", async () => {
    const { database, native } = createNativeDatabase()
    await initShippingTables(database, "mock")
    const previous = process.env.SHIPPING_VOYAGE_PROVIDER
    try {
      process.env.SHIPPING_VOYAGE_PROVIDER = "mock"
      expect(getDefaultRuntimeJobs({ database, dataMode: "mock", aisProvider }).find(job => job.id === "voyage-sync")).toMatchObject({ providerId: "mock-voyage", enabled: true })
    } finally {
      if (previous === undefined) delete process.env.SHIPPING_VOYAGE_PROVIDER
      else process.env.SHIPPING_VOYAGE_PROVIDER = previous
      native.close()
    }
  })

  it("uses the existing vessel provider setting as the AIS provider alias", async () => {
    const { database, native } = createNativeDatabase()
    await initShippingTables(database, "real")
    const previousAis = process.env.SHIPPING_AIS_PROVIDER
    const previousVessel = process.env.SHIPPING_VESSEL_PROVIDER
    const previousStreaming = process.env.SHIPPING_AIS_STREAMING_ENABLED
    try {
      delete process.env.SHIPPING_AIS_PROVIDER
      process.env.SHIPPING_VESSEL_PROVIDER = "aisstream"
      process.env.SHIPPING_AIS_STREAMING_ENABLED = "false"
      const jobs = getDefaultRuntimeJobs({ database, dataMode: "real", voyageProvider })
      expect(jobs.find(job => job.id === "ais-tracking")).toMatchObject({ providerId: "aisstream", enabled: true })
    } finally {
      if (previousAis === undefined) delete process.env.SHIPPING_AIS_PROVIDER
      else process.env.SHIPPING_AIS_PROVIDER = previousAis
      if (previousVessel === undefined) delete process.env.SHIPPING_VESSEL_PROVIDER
      else process.env.SHIPPING_VESSEL_PROVIDER = previousVessel
      if (previousStreaming === undefined) delete process.env.SHIPPING_AIS_STREAMING_ENABLED
      else process.env.SHIPPING_AIS_STREAMING_ENABLED = previousStreaming
      native.close()
    }
  })

  it("omits the bounded AIS job when continuous streaming is enabled", async () => {
    const { database, native } = createNativeDatabase()
    await initShippingTables(database, "real")
    const previous = {
      dataMode: process.env.SHIPPING_DATA_MODE,
      aisProvider: process.env.SHIPPING_AIS_PROVIDER,
      streaming: process.env.SHIPPING_AIS_STREAMING_ENABLED,
      runtime: process.env.SHIPPING_RUNTIME_ENABLED,
    }
    try {
      process.env.SHIPPING_DATA_MODE = "real"
      process.env.SHIPPING_AIS_PROVIDER = "aisstream"
      process.env.SHIPPING_AIS_STREAMING_ENABLED = "true"
      process.env.SHIPPING_RUNTIME_ENABLED = "true"
      const jobs = getDefaultRuntimeJobs({ database, dataMode: "real", voyageProvider })
      expect(jobs.some(job => job.id === "ais-tracking")).toBe(false)
      expect(jobs.some(job => job.id === "voyage-sync")).toBe(true)
    } finally {
      if (previous.dataMode === undefined) delete process.env.SHIPPING_DATA_MODE
      else process.env.SHIPPING_DATA_MODE = previous.dataMode
      if (previous.aisProvider === undefined) delete process.env.SHIPPING_AIS_PROVIDER
      else process.env.SHIPPING_AIS_PROVIDER = previous.aisProvider
      if (previous.streaming === undefined) delete process.env.SHIPPING_AIS_STREAMING_ENABLED
      else process.env.SHIPPING_AIS_STREAMING_ENABLED = previous.streaming
      if (previous.runtime === undefined) delete process.env.SHIPPING_RUNTIME_ENABLED
      else process.env.SHIPPING_RUNTIME_ENABLED = previous.runtime
      native.close()
    }
  })

  it("retains the bounded AIS job when continuous streaming is disabled", async () => {
    const { database, native } = createNativeDatabase()
    await initShippingTables(database, "real")
    const previous = {
      aisProvider: process.env.SHIPPING_AIS_PROVIDER,
      streaming: process.env.SHIPPING_AIS_STREAMING_ENABLED,
      runtime: process.env.SHIPPING_RUNTIME_ENABLED,
    }
    try {
      process.env.SHIPPING_AIS_PROVIDER = "aisstream"
      process.env.SHIPPING_AIS_STREAMING_ENABLED = "false"
      process.env.SHIPPING_RUNTIME_ENABLED = "true"
      const jobs = getDefaultRuntimeJobs({ database, dataMode: "real", voyageProvider })
      expect(jobs.find(job => job.id === "ais-tracking")).toMatchObject({ providerId: "aisstream", intervalMs: 15 * 60 * 1000 })
    } finally {
      if (previous.aisProvider === undefined) delete process.env.SHIPPING_AIS_PROVIDER
      else process.env.SHIPPING_AIS_PROVIDER = previous.aisProvider
      if (previous.streaming === undefined) delete process.env.SHIPPING_AIS_STREAMING_ENABLED
      else process.env.SHIPPING_AIS_STREAMING_ENABLED = previous.streaming
      if (previous.runtime === undefined) delete process.env.SHIPPING_RUNTIME_ENABLED
      else process.env.SHIPPING_RUNTIME_ENABLED = previous.runtime
      native.close()
    }
  })

  it("registers exactly one AIS Area job for the explicit Real Area provider", async () => {
    const { database, native } = createNativeDatabase()
    await initShippingTables(database, "real")
    const previous = {
      area: process.env.SHIPPING_AIS_AREA_PROVIDER,
      interval: process.env.SHIPPING_AIS_AREA_INTERVAL_MINUTES,
    }
    try {
      process.env.SHIPPING_AIS_AREA_PROVIDER = "aisstream"
      process.env.SHIPPING_AIS_AREA_INTERVAL_MINUTES = "1"
      const jobs = getDefaultRuntimeJobs({ database, dataMode: "real", aisAreaProvider, voyageProvider })
      expect(jobs.filter(job => job.id === "ais-area-sync")).toHaveLength(1)
      expect(jobs.find(job => job.id === "ais-area-sync")).toMatchObject({ providerId: "aisstream-area", capability: "ais_area", intervalMs: 60_000 })
    } finally {
      if (previous.area === undefined) delete process.env.SHIPPING_AIS_AREA_PROVIDER
      else process.env.SHIPPING_AIS_AREA_PROVIDER = previous.area
      if (previous.interval === undefined) delete process.env.SHIPPING_AIS_AREA_INTERVAL_MINUTES
      else process.env.SHIPPING_AIS_AREA_INTERVAL_MINUTES = previous.interval
      native.close()
    }
  })

  it("omits AIS Area when the provider is off and clamps invalid Area cadence", async () => {
    const { database, native } = createNativeDatabase()
    await initShippingTables(database, "real")
    const previous = {
      area: process.env.SHIPPING_AIS_AREA_PROVIDER,
      interval: process.env.SHIPPING_AIS_AREA_INTERVAL_MINUTES,
    }
    try {
      process.env.SHIPPING_AIS_AREA_PROVIDER = "off"
      expect(getDefaultRuntimeJobs({ database, dataMode: "real", aisAreaProvider, voyageProvider }).some(job => job.id === "ais-area-sync")).toBe(false)
      process.env.SHIPPING_AIS_AREA_PROVIDER = "aisstream"
      process.env.SHIPPING_AIS_AREA_INTERVAL_MINUTES = "0"
      expect(getDefaultRuntimeJobs({ database, dataMode: "real", aisAreaProvider, voyageProvider }).find(job => job.id === "ais-area-sync")).toMatchObject({ intervalMs: 60_000 })
    } finally {
      if (previous.area === undefined) delete process.env.SHIPPING_AIS_AREA_PROVIDER
      else process.env.SHIPPING_AIS_AREA_PROVIDER = previous.area
      if (previous.interval === undefined) delete process.env.SHIPPING_AIS_AREA_INTERVAL_MINUTES
      else process.env.SHIPPING_AIS_AREA_INTERVAL_MINUTES = previous.interval
      native.close()
    }
  })

  it("registers one independent official alert job per active verified source", async () => {
    const { database, native } = createNativeDatabase()
    await initShippingTables(database, "real")
    const previous = {
      dataMode: process.env.SHIPPING_DATA_MODE,
      alerts: process.env.SHIPPING_WEATHER_ALERT_PROVIDER,
      interval: process.env.SHIPPING_WEATHER_ALERT_INTERVAL_MINUTES,
    }
    try {
      process.env.SHIPPING_DATA_MODE = "real"
      process.env.SHIPPING_WEATHER_ALERT_PROVIDER = "public"
      process.env.SHIPPING_WEATHER_ALERT_INTERVAL_MINUTES = "not-a-number"
      const jobs = getDefaultRuntimeJobs({ database, dataMode: "real", aisProvider, voyageProvider })
      expect(jobs.filter(job => job.capability === "weather_alerts")).toEqual([
        expect.objectContaining({ id: "weather-alert-sync:tmd", providerId: "tmd", intervalMs: 15 * 60 * 1000, enabled: true }),
        expect.objectContaining({ id: "weather-alert-sync:bmkg", providerId: "bmkg", intervalMs: 15 * 60 * 1000, enabled: true }),
      ])
    } finally {
      if (previous.dataMode === undefined) delete process.env.SHIPPING_DATA_MODE
      else process.env.SHIPPING_DATA_MODE = previous.dataMode
      if (previous.alerts === undefined) delete process.env.SHIPPING_WEATHER_ALERT_PROVIDER
      else process.env.SHIPPING_WEATHER_ALERT_PROVIDER = previous.alerts
      if (previous.interval === undefined) delete process.env.SHIPPING_WEATHER_ALERT_INTERVAL_MINUTES
      else process.env.SHIPPING_WEATHER_ALERT_INTERVAL_MINUTES = previous.interval
      native.close()
    }
  })

  it("does not register official alert jobs in off or Mock mode", async () => {
    const { database, native } = createNativeDatabase()
    await initShippingTables(database, "mock")
    const previous = {
      dataMode: process.env.SHIPPING_DATA_MODE,
      alerts: process.env.SHIPPING_WEATHER_ALERT_PROVIDER,
    }
    try {
      process.env.SHIPPING_DATA_MODE = "mock"
      process.env.SHIPPING_WEATHER_ALERT_PROVIDER = "public"
      expect(getDefaultRuntimeJobs({ database, dataMode: "mock", aisProvider, voyageProvider }).some(job => job.capability === "weather_alerts")).toBe(false)
      process.env.SHIPPING_DATA_MODE = "real"
      process.env.SHIPPING_WEATHER_ALERT_PROVIDER = "off"
      expect(getDefaultRuntimeJobs({ database, dataMode: "real", aisProvider, voyageProvider }).some(job => job.capability === "weather_alerts")).toBe(false)
    } finally {
      if (previous.dataMode === undefined) delete process.env.SHIPPING_DATA_MODE
      else process.env.SHIPPING_DATA_MODE = previous.dataMode
      if (previous.alerts === undefined) delete process.env.SHIPPING_WEATHER_ALERT_PROVIDER
      else process.env.SHIPPING_WEATHER_ALERT_PROVIDER = previous.alerts
      native.close()
    }
  })
})
