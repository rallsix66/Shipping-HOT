import { describe, expect, it } from "vitest"
import type { CalendarCountryCode } from "@shared/calendar"
import { createCalendarSyncJob } from "./calendar-sync-job"

const countries: CalendarCountryCode[] = ["CN", "TH"]

describe("calendar sync job", () => {
  it("syncs all requested countries through the Runtime boundary", async () => {
    const sync = async () => ({
      events: [{ id: "calendar:CN:2026-10-01", countryCode: "CN", name: "National Day", date: "2026-10-01" } as never],
      coverage: countries.map(countryCode => ({ countryCode, year: 2026, status: "partial" as const, sourceId: "calendarific", lastCheckedAt: "2026-08-29T00:00:00.000Z" })),
      fetchedAt: "2026-08-29T00:00:00.000Z",
    })
    const job = createCalendarSyncJob({
      database: {} as never,
      dataMode: "real",
      providerId: "calendarific",
      intervalMs: 86_400_000,
      countries,
      year: () => 2026,
      sync,
    })

    await expect(job.run()).resolves.toMatchObject({ status: "success", recordsRead: 1, recordsWritten: 1, sourceUpdatedAt: "2026-08-29T00:00:00.000Z" })
    expect(sync).toBeDefined()
  })

  it("returns a failed Runtime result when a country has no reliable coverage", async () => {
    const job = createCalendarSyncJob({
      database: {} as never,
      dataMode: "real",
      providerId: "calendarific",
      intervalMs: 86_400_000,
      countries,
      sync: async () => ({
        events: [],
        coverage: [
          { countryCode: "CN", year: 2026, status: "unknown" as const, sourceId: "calendarific", error: "provider_unavailable" },
          { countryCode: "TH", year: 2026, status: "unknown" as const, sourceId: "calendarific", error: "provider_unavailable" },
        ],
        fetchedAt: "2026-08-29T00:00:00.000Z",
      }),
    })

    await expect(job.run()).resolves.toMatchObject({ status: "failed", errorCode: "calendar_coverage_failed", recordsRead: 0 })
  })
})
