import NativeDatabase from "better-sqlite3"
import { createDatabase } from "db0"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { CalendarEvent } from "@shared/calendar"
import { ShippingRepository, initShippingTables } from "#/database/shipping"
import { calendarProvenances, createCompositeCalendarProvider, createManualHolidayProvider, createOfficialHolidayProvider } from "#/providers/calendar"
import type { AisTrackingProvider } from "#/providers/ais/contracts"
import type { AisAreaProvider } from "#/providers/aisstream-area"
import type { VoyageProvider } from "#/providers/voyage/contracts"
import { createVoyageProviderForDatabase } from "#/providers/voyage"
import { getDefaultRuntimeJobs } from "#/runtime/registry"
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
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.resetModules()
  })

  it("cache-skips a second production Calendarific composite run when placeholder sources are empty", async () => {
    const { database, native } = createNativeDatabase()
    const previous = {
      dataMode: process.env.SHIPPING_DATA_MODE,
      calendar: process.env.SHIPPING_CALENDAR_PROVIDER,
      key: process.env.CALENDARIFIC_API_KEY,
    }
    let calendarificCalls = 0
    try {
      vi.useFakeTimers()
      vi.setSystemTime(new Date("2030-09-01T00:00:00.000Z"))
      process.env.SHIPPING_DATA_MODE = "real"
      process.env.SHIPPING_CALENDAR_PROVIDER = "calendarific"
      process.env.CALENDARIFIC_API_KEY = "fake-calendarific-key"
      vi.stubGlobal("fetch", async (input: string | URL) => {
        const url = new URL(String(input))
        calendarificCalls++
        const country = url.searchParams.get("country") ?? "CN"
        const year = Number(url.searchParams.get("year"))
        return {
          ok: true,
          status: 200,
          json: async () => ({ response: { coverage: "partial", holidays: [{ name: `${country} Holiday`, date: { iso: `${year}-01-01` }, type: ["National holiday"] }] } }),
        }
      })
      vi.resetModules()
      const [{ getDefaultRuntimeJobs: getConfiguredRuntimeJobs }, { initShippingTables: initConfiguredTables }, { configureCalendarProviders }] = await Promise.all([
        import("#/runtime/registry"),
        import("#/database/shipping"),
        import("#/providers/calendar"),
      ])
      await initConfiguredTables(database, "real")
      const calendarConfiguration = configureCalendarProviders({
        SHIPPING_DATA_MODE: "real",
        SHIPPING_CALENDAR_PROVIDER: "calendarific",
        CALENDARIFIC_API_KEY: "fake-calendarific-key",
      })
      expect(calendarConfiguration.modes.calendarSourceIds).toEqual(["calendarific", "official-holiday-source", "manual-holiday"])
      expect(calendarConfiguration.provider.cacheRequiredSourceIds).toEqual(["calendarific"])
      const calendarJob = getConfiguredRuntimeJobs({ database, dataMode: "real", aisProvider, voyageProvider, calendarProvider: calendarConfiguration.provider, now: () => new Date("2030-09-01T00:00:00.000Z") })
        .find(job => job.id === "calendar-sync")
      if (!calendarJob) throw new Error("calendar_job_missing")
      const runtime = new BackgroundRuntime(new RuntimeRepository(database), { now: () => new Date("2030-09-01T00:00:00.000Z") })
      const runtimeRepository = new RuntimeRepository(database)
      runtime.register(calendarJob)
      await runtime.start()

      await expect(runtime.runNow("calendar-sync")).resolves.toMatchObject({ status: "success", recordsRead: 12, recordsWritten: 12 })
      expect(calendarificCalls).toBe(12)
      const firstRuntime = await runtimeRepository.getProviderRuntime("calendarific", "calendar_sync")
      await expect(runtime.runNow("calendar-sync")).resolves.toMatchObject({ status: "skipped", errorCode: "calendar_cache_fresh", recordsRead: 0, recordsWritten: 0 })
      expect(calendarificCalls).toBe(12)
      expect(await runtimeRepository.getProviderRuntime("calendarific", "calendar_sync")).toMatchObject({
        status: firstRuntime?.status,
        lastSuccessAt: firstRuntime?.lastSuccessAt,
        lastFailureAt: firstRuntime?.lastFailureAt,
        lastSourceUpdatedAt: firstRuntime?.lastSourceUpdatedAt,
        consecutiveFailures: firstRuntime?.consecutiveFailures,
      })
      expect(await runtimeRepository.findLatestProviderUsage({ providerId: "calendarific", capability: "calendar_sync" })).toMatchObject({ requestCount: 2, recordsCount: 12 })
      runtime.stop()
    } finally {
      if (previous.dataMode === undefined) delete process.env.SHIPPING_DATA_MODE
      else process.env.SHIPPING_DATA_MODE = previous.dataMode
      if (previous.calendar === undefined) delete process.env.SHIPPING_CALENDAR_PROVIDER
      else process.env.SHIPPING_CALENDAR_PROVIDER = previous.calendar
      if (previous.key === undefined) delete process.env.CALENDARIFIC_API_KEY
      else process.env.CALENDARIFIC_API_KEY = previous.key
      native.close()
    }
  })

  it("requires configured official/manual datasets while allowing each repaired coverage state to cache", async () => {
    const { database, native } = createNativeDatabase()
    const now = new Date("2030-09-01T00:00:00.000Z")
    const years = [2030, 2031]
    const countryCodes = ["CN", "TH", "ID", "MY", "PH", "VN"] as const
    const eventsFor = (sourceId: "official-holiday-source" | "manual-holiday", sourceKind: "official" | "user", provenance: typeof calendarProvenances.official | typeof calendarProvenances.manual): CalendarEvent[] => years.flatMap(year => countryCodes.map(countryCode => ({
      id: `${sourceId}:${countryCode}:${year}`,
      countryCode,
      name: `${countryCode} configured holiday`,
      date: `${year}-01-01`,
      type: sourceKind === "user" ? "company_custom" : "public_holiday",
      isPublicHoliday: sourceKind === "official",
      businessImpact: "medium",
      sourceId,
      sourceKind,
      verified: true,
      lastCheckedAt: now.toISOString(),
      updatedAt: now.toISOString(),
      fetchedAt: now.toISOString(),
      stale: false,
      sourceStatus: "healthy",
      provenance,
      source_type: "real",
    })))
    const official = createOfficialHolidayProvider({ events: eventsFor("official-holiday-source", "official", calendarProvenances.official), now: () => now })
    const manual = createManualHolidayProvider({ events: eventsFor("manual-holiday", "user", calendarProvenances.manual), now: () => now })
    const composite = createCompositeCalendarProvider({ official, manual })
    let compositeCalls = 0
    const provider = {
      ...composite,
      getEvents: async (...args: Parameters<typeof composite.getEvents>) => {
        compositeCalls++
        return composite.getEvents(...args)
      },
    }
    const runtime = new BackgroundRuntime(new RuntimeRepository(database), { now: () => now })
    try {
      await initShippingTables(database, "real")
      const calendarJob = getDefaultRuntimeJobs({ database, dataMode: "real", aisProvider, voyageProvider, calendarProvider: provider, now: () => now }).find(job => job.id === "calendar-sync")
      if (!calendarJob) throw new Error("calendar_job_missing")
      runtime.register(calendarJob)
      await runtime.start()
      await expect(runtime.runNow("calendar-sync")).resolves.toMatchObject({ status: "success", recordsRead: 24, recordsWritten: 24 })
      expect(compositeCalls).toBe(2)
      await expect(runtime.runNow("calendar-sync")).resolves.toMatchObject({ status: "skipped", errorCode: "calendar_cache_fresh" })
      expect(compositeCalls).toBe(2)

      const repository = new ShippingRepository(database, "real")
      for (const state of ["missing", "stale", "failed"] as const) {
        const settings = await repository.getSettings()
        if (!settings) throw new Error("settings_missing")
        const calendarSync = settings.calendarSync ?? []
        const target = calendarSync.find(item => item.countryCode === "CN" && item.year === 2030 && item.sourceId === "manual-holiday")
        if (!target) throw new Error("manual_coverage_missing")
        const remaining = calendarSync.filter(item => item !== target)
        await repository.saveSettings({
          ...settings,
          calendarSync: state === "missing"
            ? remaining
            : [...remaining, {
                ...target,
                lastCheckedAt: state === "stale" ? "2030-08-01T00:00:00.000Z" : target.lastCheckedAt,
                ...(state === "failed" ? { error: "manual_failed", errorCode: "provider_unavailable" } : { error: undefined, errorCode: undefined }),
              }],
        })
        const callsBeforeRepair = compositeCalls
        await expect(runtime.runNow("calendar-sync")).resolves.toMatchObject({ status: "success", recordsRead: 2, recordsWritten: 2 })
        expect(compositeCalls).toBe(callsBeforeRepair + 1)
        await expect(runtime.runNow("calendar-sync")).resolves.toMatchObject({ status: "skipped", errorCode: "calendar_cache_fresh" })
      }
    } finally {
      runtime.stop()
      native.close()
    }
  })

  it("cache-skips the actual official placeholder composition without requiring empty sources", async () => {
    const { database, native } = createNativeDatabase()
    let providerCalls = 0
    try {
      const { configureCalendarProviders } = await import("#/providers/calendar")
      const configured = configureCalendarProviders({ SHIPPING_DATA_MODE: "real", SHIPPING_CALENDAR_PROVIDER: "official" })
      expect(configured.modes.calendarSourceIds).toEqual(["official-holiday-source", "manual-holiday"])
      expect(configured.provider.cacheRequiredSourceIds).toEqual([])
      const provider = {
        ...configured.provider,
        getEvents: async (...args: Parameters<typeof configured.provider.getEvents>) => {
          providerCalls++
          return configured.provider.getEvents(...args)
        },
      }
      await initShippingTables(database, "real")
      const job = getDefaultRuntimeJobs({ database, dataMode: "real", aisProvider, voyageProvider, calendarProvider: provider, now: () => new Date("2030-09-01T00:00:00.000Z") }).find(item => item.id === "calendar-sync")
      if (!job) throw new Error("calendar_job_missing")
      await expect(job.run()).resolves.toMatchObject({ status: "skipped", errorCode: "calendar_cache_fresh", recordsRead: 0, recordsWritten: 0 })
      expect(providerCalls).toBe(0)
    } finally {
      native.close()
    }
  })

  it("registers Translation alongside AIS, Voyage, Feed, and Calendar jobs in Mock Mode", async () => {
    const { database, native } = createNativeDatabase()
    await initShippingTables(database, "mock")
    const jobs = getDefaultRuntimeJobs({ database, dataMode: "mock", aisProvider, voyageProvider })
    expect(jobs.map(job => [job.id, job.capability])).toEqual([
      ["ais-tracking", "ais_tracking"],
      ["voyage-sync", "voyage_sync"],
      ["feed-sync:mock-port-notice", "feed_sync"],
      ["translation-sync", "translation"],
      ["calendar-sync", "calendar_sync"],
      ["port-sync", "port_intelligence"],
      ["weather-sync", "weather_sync"],
    ])
    native.close()
  })

  it("registers only the fixed server-side DeepSeek Translation Runtime in Real Mode", async () => {
    const { database, native } = createNativeDatabase()
    await initShippingTables(database, "real")
    const jobs = getDefaultRuntimeJobs({ database, dataMode: "real", aisProvider, voyageProvider })
    expect(jobs.find(job => job.id === "translation-sync")).toMatchObject({
      providerId: "deepseek",
      capability: "translation",
      intervalMs: 60_000,
      enabled: true,
      usageAlreadyRecorded: true,
    })
    expect(jobs.filter(job => job.id === "translation-sync")).toHaveLength(1)
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

  it("forces Mock Voyage isolation for a dangerous vesselapi env in Mock Mode", async () => {
    const { database, native } = createNativeDatabase()
    await initShippingTables(database, "mock")
    const previous = process.env.SHIPPING_VOYAGE_PROVIDER
    try {
      process.env.SHIPPING_VOYAGE_PROVIDER = "vesselapi"
      const jobs = getDefaultRuntimeJobs({ database, dataMode: "mock", aisProvider })
      expect(jobs.find(job => job.id === "voyage-sync")).toMatchObject({ providerId: "mock-voyage", enabled: true })
      const provider = createVoyageProviderForDatabase(database, { providerId: "vesselapi", dataMode: "mock" })
      await expect(provider.getVoyages([{ vesselId: "vessel-1", imo: "9162423" }])).rejects.toMatchObject({
        code: "provider_unavailable",
        message: "real_voyage_provider_not_allowed_in_mock_mode",
      })
    } finally {
      if (previous === undefined) delete process.env.SHIPPING_VOYAGE_PROVIDER
      else process.env.SHIPPING_VOYAGE_PROVIDER = previous
      native.close()
    }
  })

  it("forces Mock AIS isolation for a real vessel provider env in Mock Mode", async () => {
    const { database, native } = createNativeDatabase()
    await initShippingTables(database, "mock")
    const previousAis = process.env.SHIPPING_AIS_PROVIDER
    const previousVessel = process.env.SHIPPING_VESSEL_PROVIDER
    const previousStreaming = process.env.SHIPPING_AIS_STREAMING_ENABLED
    try {
      delete process.env.SHIPPING_AIS_PROVIDER
      process.env.SHIPPING_VESSEL_PROVIDER = "aisstream"
      process.env.SHIPPING_AIS_STREAMING_ENABLED = "false"
      const jobs = getDefaultRuntimeJobs({ database, dataMode: "mock" })
      expect(jobs.find(job => job.id === "ais-tracking")).toMatchObject({ providerId: "mock", enabled: true })
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
