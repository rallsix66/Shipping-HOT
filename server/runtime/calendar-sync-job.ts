import type { CalendarCountryCode, CalendarProviderResult } from "@shared/calendar"
import { calendarCountries } from "@shared/calendar"
import type { Database } from "db0"
import type { ShippingDataMode } from "#/database/runtime"
import type { RuntimeJob } from "#/runtime/background-runtime"
import { ShippingRepository } from "#/database/shipping"
import { defaultShippingSettings } from "#/database/runtime"
import { reconcileCalendarEvents } from "#/shipping-store"
import type { CalendarProvider } from "#/providers/calendar"

export const CALENDAR_SYNC_CAPABILITY = "calendar_sync" as const

export interface CalendarSyncJobOptions {
  database: Database
  dataMode: ShippingDataMode
  providerId: string
  provider?: CalendarProvider
  intervalMs: number
  enabled?: boolean
  now?: () => Date
  countries?: readonly CalendarCountryCode[]
  year?: () => number
  sync?: (year: number, countries: readonly CalendarCountryCode[]) => Promise<CalendarProviderResult>
}

/** Calendar refresh belongs to Runtime; the Calendar page remains read-only. */
export function createCalendarSyncJob(options: CalendarSyncJobOptions): RuntimeJob {
  const countries = options.countries ?? Object.keys(calendarCountries) as CalendarCountryCode[]
  const now = options.now ?? (() => new Date())
  const repository = new ShippingRepository(options.database, options.dataMode)
  const sync = options.sync ?? (async (year, requestedCountries) => {
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
    return { ...result, events: reconciled.events, coverage }
  })
  return {
    id: "calendar-sync",
    providerId: options.providerId,
    capability: CALENDAR_SYNC_CAPABILITY,
    intervalMs: options.intervalMs,
    enabled: options.enabled ?? true,
    run: async () => {
      const year = options.year?.() ?? now().getUTCFullYear()
      const result = await sync(year, countries)
      const failed = result.coverage.filter(item => item.sourceId === options.providerId && (item.status === "unknown" || item.error))
      return {
        status: failed.length ? "failed" : "success",
        recordsRead: result.events.length,
        recordsWritten: result.events.length,
        sourceUpdatedAt: result.fetchedAt,
        errorCode: failed.length ? "calendar_coverage_failed" : undefined,
        errorMessage: failed.length ? `${failed.length} calendar country sync(s) failed` : undefined,
      }
    },
  }
}
