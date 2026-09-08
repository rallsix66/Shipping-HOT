import NativeDatabase from "better-sqlite3"
import { createDatabase } from "db0"
import { describe, expect, it } from "vitest"
import type { CalendarCountryCode, CalendarEvent } from "@shared/calendar"
import { CALENDAR_SYNC_CAPABILITY, createCalendarSyncJob } from "./calendar-sync-job"
import { BackgroundRuntime } from "./background-runtime"
import type { CalendarProvider } from "#/providers/calendar"
import { RuntimeRepository } from "#/database/runtime-jobs"
import { ShippingRepository, initShippingTables } from "#/database/shipping"

const countries: CalendarCountryCode[] = ["CN", "TH"]
const TEST_NOW = new Date("2030-09-01T00:00:00.000Z")
const TEST_YEAR = TEST_NOW.getUTCFullYear()
const TEST_NEXT_YEAR = TEST_YEAR + 1
const TEST_FETCHED_AT = TEST_NOW.toISOString()
const TEST_CACHED_AT = "2030-08-29T00:00:00.000Z"
const TEST_PREVIOUS_SUCCESS_AT = "2030-08-20T00:00:00.000Z"
const TEST_PREVIOUS_SOURCE_UPDATED_AT = "2030-08-20T00:05:00.000Z"
const TEST_PREVIOUS_FAILURE_AT = "2030-08-25T00:00:00.000Z"
const TEST_NEXT_SYNC_AT = "2030-09-02T00:00:00.000Z"

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

describe("calendar sync job", () => {
  it("syncs all requested countries through the Runtime boundary", async () => {
    const syncYears: number[] = []
    const sync = async (year: number) => {
      syncYears.push(year)
      return {
        events: [{ id: `calendar:CN:${year}-10-01`, countryCode: "CN", name: "National Day", date: `${year}-10-01` } as never],
        coverage: countries.map(countryCode => ({ countryCode, year, status: "partial" as const, sourceId: "calendarific", lastCheckedAt: TEST_FETCHED_AT })),
        fetchedAt: TEST_FETCHED_AT,
      }
    }
    const job = createCalendarSyncJob({
      database: {} as never,
      dataMode: "real",
      providerId: "calendarific",
      intervalMs: 86_400_000,
      countries,
      year: () => TEST_YEAR,
      now: () => TEST_NOW,
      sync,
    })

    await expect(job.run()).resolves.toMatchObject({ status: "success", recordsRead: 2, recordsWritten: 2, sourceUpdatedAt: TEST_FETCHED_AT })
    expect(syncYears).toEqual([TEST_YEAR, TEST_NEXT_YEAR])
  })

  it("returns a failed Runtime result when a country has no reliable coverage", async () => {
    const syncYears: number[] = []
    const job = createCalendarSyncJob({
      database: {} as never,
      dataMode: "real",
      providerId: "calendarific",
      intervalMs: 86_400_000,
      countries,
      year: () => TEST_YEAR,
      now: () => TEST_NOW,
      sync: async (year) => {
        syncYears.push(year)
        return {
          events: [],
          coverage: [
            { countryCode: "CN", year, status: "unknown" as const, sourceId: "calendarific", error: "provider_unavailable" },
            { countryCode: "TH", year, status: "unknown" as const, sourceId: "calendarific", error: "provider_unavailable" },
          ],
          fetchedAt: TEST_FETCHED_AT,
        }
      },
    })

    await expect(job.run()).resolves.toMatchObject({ status: "failed", errorCode: "calendar_coverage_failed", recordsRead: 0, errorMessage: `4 calendar country/year sync(s) failed: CN/${TEST_YEAR}, TH/${TEST_YEAR}, CN/${TEST_NEXT_YEAR}, TH/${TEST_NEXT_YEAR}` })
    expect(syncYears).toEqual([TEST_YEAR, TEST_NEXT_YEAR])
  })

  it("keeps fresh current-year cache and forces the uncovered next-year check", async () => {
    const syncYears: number[] = []
    const syncCountries: CalendarCountryCode[][] = []
    const database = {
      prepare: (sql: string) => ({
        get: async () => sql.startsWith("SELECT data FROM settings")
          ? { data: JSON.stringify({ calendarSync: countries.map(countryCode => ({ countryCode, year: TEST_YEAR, status: "partial", sourceId: "calendarific", lastCheckedAt: TEST_CACHED_AT })) }) }
          : undefined,
      }),
    } as never
    const job = createCalendarSyncJob({
      database,
      dataMode: "real",
      providerId: "calendarific",
      intervalMs: 86_400_000,
      countries,
      year: () => TEST_YEAR,
      now: () => TEST_NOW,
      sync: async (year, requestedCountries) => {
        syncYears.push(year)
        syncCountries.push([...requestedCountries])
        return {
          events: [{ id: `calendar:CN:${TEST_NEXT_YEAR}-10-01`, countryCode: "CN", name: "National Day", date: `${TEST_NEXT_YEAR}-10-01` } as never],
          coverage: requestedCountries.map(countryCode => ({ countryCode, year, status: "partial" as const, sourceId: "calendarific" })),
          fetchedAt: TEST_FETCHED_AT,
        }
      },
    })

    await expect(job.run()).resolves.toMatchObject({ status: "success", recordsRead: 1 })
    expect(syncYears).toEqual([TEST_NEXT_YEAR])
    expect(syncCountries).toEqual([countries])
  })

  it("continues the next-year check when one year fails", async () => {
    const syncYears: number[] = []
    const job = createCalendarSyncJob({
      database: {} as never,
      dataMode: "real",
      providerId: "calendarific",
      intervalMs: 86_400_000,
      countries,
      year: () => TEST_YEAR,
      now: () => TEST_NOW,
      sync: async (year) => {
        syncYears.push(year)
        if (year === TEST_NEXT_YEAR) throw new Error("next year unavailable")
        return {
          events: [{ id: `calendar:CN:${TEST_YEAR}-10-01`, countryCode: "CN", name: "National Day", date: `${TEST_YEAR}-10-01` } as never],
          coverage: countries.map(countryCode => ({ countryCode, year, status: "partial" as const, sourceId: "calendarific" })),
          fetchedAt: TEST_FETCHED_AT,
        }
      },
    })

    await expect(job.run()).resolves.toMatchObject({ status: "failed", recordsRead: 1, recordsWritten: 1, errorCode: "provider_unavailable" })
    expect(syncYears).toEqual([TEST_YEAR, TEST_NEXT_YEAR])
  })

  it("aggregates final coverage through the default Provider-to-Repository path", async () => {
    const { database, native } = createNativeDatabase()
    try {
      await initShippingTables(database, "real")
      const repository = new ShippingRepository(database, "real")
      const settings = await repository.getSettings()
      if (!settings) throw new Error("settings_missing")
      await repository.saveSettings({
        ...settings,
        calendarSync: countries.map(countryCode => ({
          countryCode,
          year: TEST_NEXT_YEAR,
          status: "unknown" as const,
          sourceId: "calendarific",
          lastCheckedAt: TEST_FETCHED_AT,
          error: "old_next_year_failure",
          errorCode: "provider_unavailable",
        })),
      })

      const provider: CalendarProvider = {
        providerId: "calendarific",
        getEvents: async query => ({
          events: [],
          coverage: query.countries.map(countryCode => ({
            countryCode,
            year: query.year,
            status: "partial" as const,
            sourceId: "calendarific",
            lastCheckedAt: TEST_FETCHED_AT,
          })),
          fetchedAt: TEST_FETCHED_AT,
        }),
      }
      const job = createCalendarSyncJob({
        database,
        dataMode: "real",
        provider,
        intervalMs: 86_400_000,
        countries,
        year: () => TEST_YEAR,
        now: () => TEST_NOW,
      })

      await expect(job.run()).resolves.toMatchObject({ status: "success", recordsRead: 0, recordsWritten: 0 })
      const persistedCoverage = (await repository.getSettings())?.calendarSync ?? []
      expect(persistedCoverage).toHaveLength(countries.length * 2)
      expect(persistedCoverage.filter(item => item.year === TEST_NEXT_YEAR).every(item => !item.error)).toBe(true)
      expect(persistedCoverage).toEqual(expect.arrayContaining([
        ...countries.flatMap(countryCode => [
          expect.objectContaining({ countryCode, year: TEST_YEAR, status: "partial", sourceId: "calendarific" }),
          expect.objectContaining({ countryCode, year: TEST_NEXT_YEAR, status: "partial", sourceId: "calendarific" }),
        ]),
      ]))
    } finally {
      native.close()
    }
  })

  it("counts only the records returned by each year through the default Provider path", async () => {
    const { database, native } = createNativeDatabase()
    const shippingRepository = new ShippingRepository(database, "real")
    const runtimeRepository = new RuntimeRepository(database)
    const runtime = new BackgroundRuntime(runtimeRepository, { now: () => TEST_NOW })
    let providerCalls = 0
    try {
      await initShippingTables(database, "real")
      await shippingRepository.upsertCalendarEvent(calendarRecord("CN", TEST_YEAR - 1, 1))
      await shippingRepository.upsertCalendarEvent(calendarRecord("MY", TEST_YEAR - 1, 2))

      const provider: CalendarProvider = {
        providerId: "calendarific",
        getEvents: async (query) => {
          providerCalls += 1
          const count = query.year === TEST_YEAR ? 2 : 3
          return {
            events: Array.from({ length: count }, (_, index) => calendarRecord("CN", query.year, index + 1)),
            coverage: query.countries.map(countryCode => ({
              countryCode,
              year: query.year,
              status: "partial" as const,
              sourceId: "calendarific",
              lastCheckedAt: TEST_FETCHED_AT,
            })),
            fetchedAt: TEST_FETCHED_AT,
          }
        },
      }
      runtime.register(createCalendarSyncJob({
        database,
        dataMode: "real",
        provider,
        intervalMs: 60 * 60 * 1000,
        countries,
        year: () => TEST_YEAR,
        now: () => TEST_NOW,
      }))
      await runtime.start()

      await expect(runtime.runNow("calendar-sync")).resolves.toMatchObject({
        status: "success",
        recordsRead: 5,
        recordsWritten: 5,
        sourceUpdatedAt: TEST_FETCHED_AT,
      })
      expect(providerCalls).toBe(2)
      expect(await shippingRepository.listCalendarEvents()).toHaveLength(7)
      expect((await runtimeRepository.listSyncRuns("calendarific"))[0]).toMatchObject({ recordsRead: 5, recordsWritten: 5 })
      expect((await runtimeRepository.findLatestProviderUsage({ providerId: "calendarific", capability: CALENDAR_SYNC_CAPABILITY }))).toMatchObject({ requestCount: 1, recordsCount: 5 })
    } finally {
      runtime.stop()
      native.close()
    }
  })

  it("skips a fully fresh two-year cache without advancing Runtime evidence", async () => {
    const { database, native } = createNativeDatabase()
    const shippingRepository = new ShippingRepository(database, "real")
    const runtimeRepository = new RuntimeRepository(database)
    const runtime = new BackgroundRuntime(runtimeRepository, { now: () => TEST_NOW })
    let providerCalls = 0
    try {
      await initShippingTables(database, "real")
      const settings = await shippingRepository.getSettings()
      if (!settings) throw new Error("settings_missing")
      await shippingRepository.saveSettings({
        ...settings,
        calendarSync: countries.flatMap(countryCode => calendarSyncCoverage(countryCode)),
      })
      await runtimeRepository.updateProviderRuntime({
        providerId: "calendarific",
        capability: CALENDAR_SYNC_CAPABILITY,
        status: "degraded",
        lastRequestAt: TEST_PREVIOUS_FAILURE_AT,
        lastSuccessAt: TEST_PREVIOUS_SUCCESS_AT,
        lastFailureAt: TEST_PREVIOUS_FAILURE_AT,
        lastSourceUpdatedAt: TEST_PREVIOUS_SOURCE_UPDATED_AT,
        nextSyncAt: TEST_NEXT_SYNC_AT,
        consecutiveFailures: 2,
        errorCode: "provider_timeout",
        errorMessage: "previous provider failure",
        updatedAt: TEST_PREVIOUS_FAILURE_AT,
      })

      const provider: CalendarProvider = {
        providerId: "calendarific",
        getEvents: async () => {
          providerCalls++
          throw new Error("provider_must_not_be_called")
        },
      }
      runtime.register(createCalendarSyncJob({
        database,
        dataMode: "real",
        provider,
        intervalMs: 60 * 60 * 1000,
        countries,
        year: () => TEST_YEAR,
        now: () => TEST_NOW,
      }))
      await runtime.start()

      const result = await runtime.runNow("calendar-sync")
      expect(result).toMatchObject({ status: "skipped", recordsRead: 0, recordsWritten: 0, errorCode: "calendar_cache_fresh" })
      expect(result).not.toHaveProperty("sourceUpdatedAt")
      expect(providerCalls).toBe(0)
      expect(await runtimeRepository.getProviderRuntime("calendarific", CALENDAR_SYNC_CAPABILITY)).toMatchObject({
        status: "degraded",
        lastSuccessAt: TEST_PREVIOUS_SUCCESS_AT,
        lastFailureAt: TEST_PREVIOUS_FAILURE_AT,
        lastSourceUpdatedAt: TEST_PREVIOUS_SOURCE_UPDATED_AT,
        consecutiveFailures: 2,
        errorCode: "provider_timeout",
        errorMessage: "previous provider failure",
      })
      expect((await runtimeRepository.listSyncRuns("calendarific"))[0]).toMatchObject({
        capability: CALENDAR_SYNC_CAPABILITY,
        status: "skipped",
        recordsRead: 0,
        recordsWritten: 0,
        errorCode: "calendar_cache_fresh",
      })
    } finally {
      runtime.stop()
      native.close()
    }
  })

  it("syncs only the uncached year when the other year is fresh", async () => {
    const { database, native } = createNativeDatabase()
    const shippingRepository = new ShippingRepository(database, "real")
    const runtime = new BackgroundRuntime(new RuntimeRepository(database), { now: () => TEST_NOW })
    const syncYears: number[] = []
    try {
      await initShippingTables(database, "real")
      const settings = await shippingRepository.getSettings()
      if (!settings) throw new Error("settings_missing")
      await shippingRepository.saveSettings({
        ...settings,
        calendarSync: countries.map(countryCode => ({
          countryCode,
          year: TEST_YEAR,
          status: "partial" as const,
          sourceId: "calendarific",
          lastCheckedAt: TEST_CACHED_AT,
        })),
      })

      const provider: CalendarProvider = {
        providerId: "calendarific",
        getEvents: async (query) => {
          syncYears.push(query.year)
          return {
            events: Array.from({ length: 3 }, (_, index) => calendarRecord("CN", query.year, index + 1)),
            coverage: query.countries.map(countryCode => ({
              countryCode,
              year: query.year,
              status: "partial" as const,
              sourceId: "calendarific",
              lastCheckedAt: TEST_FETCHED_AT,
            })),
            fetchedAt: TEST_FETCHED_AT,
          }
        },
      }
      runtime.register(createCalendarSyncJob({
        database,
        dataMode: "real",
        provider,
        intervalMs: 60 * 60 * 1000,
        countries,
        year: () => TEST_YEAR,
        now: () => TEST_NOW,
      }))
      await runtime.start()

      await expect(runtime.runNow("calendar-sync")).resolves.toMatchObject({ status: "success", recordsRead: 3, recordsWritten: 3, sourceUpdatedAt: TEST_FETCHED_AT })
      expect(syncYears).toEqual([TEST_NEXT_YEAR])
      expect(await shippingRepository.getSettings()).toMatchObject({
        calendarSync: expect.arrayContaining([
          ...countries.map(countryCode => expect.objectContaining({ countryCode, year: TEST_YEAR, lastCheckedAt: TEST_CACHED_AT })),
          ...countries.map(countryCode => expect.objectContaining({ countryCode, year: TEST_NEXT_YEAR, lastCheckedAt: TEST_FETCHED_AT })),
        ]),
      })
    } finally {
      runtime.stop()
      native.close()
    }
  })

  it("reports actual Calendar sync failure and retains failure coverage", async () => {
    const { database, native } = createNativeDatabase()
    const shippingRepository = new ShippingRepository(database, "real")
    const runtimeRepository = new RuntimeRepository(database)
    const runtime = new BackgroundRuntime(runtimeRepository, { now: () => TEST_NOW })
    let providerCalls = 0
    try {
      await initShippingTables(database, "real")
      const provider: CalendarProvider = {
        providerId: "calendarific",
        getEvents: async () => {
          providerCalls++
          throw new Error("calendar provider unavailable")
        },
      }
      runtime.register(createCalendarSyncJob({
        database,
        dataMode: "real",
        provider,
        intervalMs: 60 * 60 * 1000,
        countries,
        year: () => TEST_YEAR,
        now: () => TEST_NOW,
      }))
      await runtime.start()

      await expect(runtime.runNow("calendar-sync")).resolves.toMatchObject({ status: "failed", errorCode: "provider_unavailable", recordsRead: 0, recordsWritten: 0 })
      expect(providerCalls).toBe(2)
      expect((await shippingRepository.getSettings())?.calendarSync).toEqual(expect.arrayContaining([
        ...countries.flatMap(countryCode => [TEST_YEAR, TEST_NEXT_YEAR].map(year => expect.objectContaining({ countryCode, year, status: "unknown", errorCode: "provider_unavailable" }))),
      ]))
      expect(await runtimeRepository.getProviderRuntime("calendarific", CALENDAR_SYNC_CAPABILITY)).toMatchObject({ status: "failed", errorCode: "provider_unavailable", consecutiveFailures: 1 })
      expect((await runtimeRepository.listSyncRuns("calendarific"))[0]).toMatchObject({ status: "failed", recordsRead: 0, recordsWritten: 0, errorCode: "provider_unavailable" })
    } finally {
      runtime.stop()
      native.close()
    }
  })
})

function calendarSyncCoverage(countryCode: CalendarCountryCode) {
  return [TEST_YEAR, TEST_NEXT_YEAR].map(year => ({
    countryCode,
    year,
    status: "partial" as const,
    sourceId: "calendarific",
    lastCheckedAt: TEST_CACHED_AT,
  }))
}

function calendarRecord(countryCode: CalendarCountryCode, year: number, index: number): CalendarEvent {
  const date = `${year}-10-${String(index).padStart(2, "0")}`
  return {
    id: `calendar:${countryCode}:${date}:provider-record-${index}:public_holiday:calendarific`,
    countryCode,
    name: `Provider record ${index}`,
    date,
    type: "public_holiday",
    isPublicHoliday: true,
    businessImpact: "medium",
    sourceId: "calendarific",
    sourceKind: "third_party",
    sourceUrl: "https://calendarific.com/",
    verified: false,
    lastCheckedAt: TEST_FETCHED_AT,
    updatedAt: TEST_FETCHED_AT,
    fetchedAt: TEST_FETCHED_AT,
    stale: false,
    sourceStatus: "healthy",
    provenance: { sourceType: "third_party", dataNature: "reported", sourceId: "calendarific", verified: false },
  }
}
