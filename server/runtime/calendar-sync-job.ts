import type { CalendarCountryCode, CalendarCoverage, CalendarProviderResult } from "@shared/calendar"
import { calendarCountries } from "@shared/calendar"
import type { Database } from "db0"
import type { ShippingDataMode } from "#/database/runtime"
import type { RuntimeJob } from "#/runtime/background-runtime"
import { ShippingRepository } from "#/database/shipping"
import { defaultShippingSettings } from "#/database/runtime"
import { reconcileCalendarEvents } from "#/shipping-store"
import { type CalendarProvider, sanitizeCalendarError } from "#/providers/calendar"

export const CALENDAR_SYNC_CAPABILITY = "calendar_sync" as const
export const CALENDAR_COVERAGE_TTL_MS = 7 * 24 * 60 * 60 * 1000

export interface CalendarSyncJobOptions {
  database: Database
  dataMode: ShippingDataMode
  providerId?: string
  /** Provenance source IDs whose coverage must all be fresh before cache-only skip. */
  sourceIds?: readonly string[]
  provider?: CalendarProvider
  intervalMs: number
  enabled?: boolean
  now?: () => Date
  countries?: readonly CalendarCountryCode[]
  year?: () => number
  coverageTtlMs?: number
  sync?: (year: number, countries: readonly CalendarCountryCode[]) => Promise<CalendarProviderResult>
}

interface CalendarYearSyncResult extends CalendarProviderResult {
  /** Counts for this year only; `events` may be a retained full business snapshot. */
  syncRecordsRead?: number
  syncRecordsWritten?: number
}

export function calendarSyncYears(currentYear: number): [number, number] {
  return [currentYear, currentYear + 1]
}

function failedCalendarYearResult(year: number, countries: readonly CalendarCountryCode[], sourceId: string, error: unknown, fetchedAt: string): CalendarProviderResult {
  return {
    events: [],
    coverage: countries.map(countryCode => ({
      countryCode,
      year,
      status: "unknown" as const,
      sourceId,
      lastCheckedAt: fetchedAt,
      error: sanitizeCalendarError(error),
      errorCode: "provider_unavailable",
    })),
    fetchedAt,
  }
}

function ensureCalendarYearCoverage(result: CalendarProviderResult, year: number, countries: readonly CalendarCountryCode[], sourceId: string, fallbackFetchedAt: string): CalendarProviderResult {
  const fetchedAt = result.fetchedAt || fallbackFetchedAt
  const coveredCountries = new Set(result.coverage.filter(item => item.year === year).map(item => item.countryCode))
  const missing = countries
    .filter(countryCode => !coveredCountries.has(countryCode))
    .map(countryCode => ({
      countryCode,
      year,
      status: "unknown" as const,
      sourceId,
      lastCheckedAt: fetchedAt,
      error: "calendar_coverage_missing",
      errorCode: "calendar_coverage_missing",
    }))
  return { ...result, fetchedAt, coverage: [...result.coverage, ...missing] }
}

function calendarCoverageKey(item: CalendarCoverage): string {
  return `${item.countryCode}/${item.year}/${item.sourceId}`
}

function aggregateCalendarSyncResults(results: readonly CalendarYearSyncResult[], fallbackFetchedAt: string): CalendarYearSyncResult {
  const coverage = new Map<string, CalendarCoverage>()
  for (const result of results) {
    for (const item of result.coverage) coverage.set(calendarCoverageKey(item), item)
  }
  return {
    events: results.flatMap(item => item.events),
    coverage: [...coverage.values()],
    fetchedAt: results.map(item => item.fetchedAt).sort().at(-1) ?? fallbackFetchedAt,
    syncRecordsRead: results.reduce((total, item) => total + (item.syncRecordsRead ?? item.events.length), 0),
    syncRecordsWritten: results.reduce((total, item) => total + (item.syncRecordsWritten ?? item.events.length), 0),
  }
}

async function countriesDueForSync(repository: ShippingRepository, year: number, countries: readonly CalendarCountryCode[], sourceIds: readonly string[], nowMs: number, ttlMs: number): Promise<CalendarCountryCode[]> {
  try {
    const settings = await repository.getSettings()
    const coverage = settings?.calendarSync ?? []
    return countries.filter((countryCode) => {
      return sourceIds.some((sourceId) => {
        const row = coverage
          .filter(item => item.countryCode === countryCode && item.year === year && item.sourceId === sourceId)
          .sort((a, b) => (b.lastCheckedAt ?? "").localeCompare(a.lastCheckedAt ?? ""))
          .at(0)
        if (!row || row.error || row.status === "unknown" || !row.lastCheckedAt) return true
        const checkedAt = Date.parse(row.lastCheckedAt)
        return !Number.isFinite(checkedAt) || checkedAt < nowMs - ttlMs
      })
    })
  } catch {
    // If the read-side cache check is unavailable, attempt the sync and let its
    // normal Repository failure/coverage policy report the result.
    return [...countries]
  }
}

/** Calendar refresh belongs to Runtime; the Calendar page remains read-only. */
export function createCalendarSyncJob(options: CalendarSyncJobOptions): RuntimeJob {
  const countries = options.countries ?? Object.keys(calendarCountries) as CalendarCountryCode[]
  const now = options.now ?? (() => new Date())
  const repository = new ShippingRepository(options.database, options.dataMode)
  const providerId = options.provider?.providerId ?? options.providerId ?? "unavailable"
  const configuredSourceIds = options.sourceIds ?? options.provider?.cacheRequiredSourceIds
  const sourceIds = [...new Set(configuredSourceIds === undefined ? [providerId] : configuredSourceIds)]
  const sync: (year: number, requestedCountries: readonly CalendarCountryCode[]) => Promise<CalendarYearSyncResult> = options.sync
    ? async (year, requestedCountries) => options.sync!(year, requestedCountries)
    : async (year, requestedCountries) => {
      if (!options.provider) throw new Error("calendar_provider_missing")
      const result = await options.provider.getEvents({ year, countries: [...requestedCountries] })
      const existing = await repository.listCalendarEvents()
      const reconciled = reconcileCalendarEvents(existing, result.events, result.coverage, year)
      if (reconciled.removedIds.length) await repository.deleteCalendarEvents(reconciled.removedIds)
      for (const event of reconciled.events) await repository.upsertCalendarEvent(event)
      const settings = await repository.getSettings() ?? structuredClone(defaultShippingSettings)
      const previousCoverage = settings.calendarSync ?? []
      const coverage = [...previousCoverage.filter(item => !(requestedCountries.includes(item.countryCode) && item.year === year)), ...result.coverage]
      await repository.saveSettings({ ...settings, calendarSync: coverage })
      return {
        ...result,
        events: reconciled.events,
        coverage,
        syncRecordsRead: result.events.length,
        syncRecordsWritten: result.events.length,
      }
    }
  return {
    id: "calendar-sync",
    providerId,
    capability: CALENDAR_SYNC_CAPABILITY,
    intervalMs: options.intervalMs,
    enabled: options.enabled ?? true,
    run: async () => {
      const runAt = now()
      const currentYear = options.year?.() ?? runAt.getUTCFullYear()
      const coverageTtlMs = options.coverageTtlMs ?? CALENDAR_COVERAGE_TTL_MS
      const results: CalendarYearSyncResult[] = []
      for (const year of calendarSyncYears(currentYear)) {
        const countriesToSync = await countriesDueForSync(repository, year, countries, sourceIds, runAt.getTime(), coverageTtlMs)
        if (!countriesToSync.length) continue
        const fetchedAt = runAt.toISOString()
        try {
          results.push(ensureCalendarYearCoverage(await sync(year, countriesToSync), year, countriesToSync, providerId, fetchedAt))
        } catch (error) {
          const failed = failedCalendarYearResult(year, countriesToSync, providerId, error, fetchedAt)
          results.push(failed)
          try {
            const settings = await repository.getSettings() ?? structuredClone(defaultShippingSettings)
            const previousCoverage = settings.calendarSync ?? []
            await repository.saveSettings({
              ...settings,
              calendarSync: [...previousCoverage.filter(item => !(countriesToSync.includes(item.countryCode) && item.year === year && item.sourceId === providerId)), ...failed.coverage],
            })
          } catch {
            // The Runtime result remains the source of failure evidence if the failure row cannot be persisted.
          }
        }
      }
      if (!results.length) {
        return {
          status: "skipped",
          recordsRead: 0,
          recordsWritten: 0,
          errorCode: "calendar_cache_fresh",
          preserveRuntimeEvidence: true,
        }
      }
      const result = aggregateCalendarSyncResults(results, runAt.toISOString())
      const failed = result.coverage.filter(item => Boolean(item.error) || (item.sourceId === providerId && item.status === "unknown"))
      const failedYears = [...new Set(failed.map(item => `${item.countryCode}/${item.year}`))]
      return {
        status: failed.length ? "failed" : "success",
        recordsRead: result.syncRecordsRead ?? 0,
        recordsWritten: result.syncRecordsWritten ?? 0,
        sourceUpdatedAt: result.fetchedAt,
        errorCode: failed[0]?.errorCode ?? (failed.length ? "calendar_coverage_failed" : undefined),
        errorMessage: failed.length ? `${failed.length} calendar country/year sync(s) failed: ${failedYears.join(", ")}` : undefined,
      }
    },
  }
}
