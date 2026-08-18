import { describe, expect, it } from "vitest"
import type { CalendarCoverage, CalendarEvent } from "@shared/calendar"
import { reconcileCalendarEvents } from "./shipping-store"

function holiday(sourceId: string, date = "2026-04-13"): CalendarEvent {
  return {
    id: `calendar:TH:${date}:Songkran:public_holiday:${sourceId}`,
    countryCode: "TH",
    name: "Songkran",
    date,
    type: "public_holiday",
    isPublicHoliday: true,
    businessImpact: "high",
    sourceId,
    sourceKind: sourceId === "calendarific" ? "third_party" : "official",
    sourceUrl: `https://example.test/${sourceId}`,
    verified: sourceId === "official-th",
    lastCheckedAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    fetchedAt: "2026-01-01T00:00:00.000Z",
    stale: false,
    sourceStatus: "healthy",
    provenance: { sourceType: sourceId === "calendarific" ? "third_party" : "official", dataNature: "reported", sourceId },
  }
}

function coverage(sourceId: string, status: CalendarCoverage["status"]): CalendarCoverage {
  return { countryCode: "TH", year: 2026, sourceId, status, lastCheckedAt: "2026-01-01T00:00:00.000Z" }
}

describe("calendar source-scoped reconciliation", () => {
  it("removes a stale source fact only after complete coverage", () => {
    const existing = [holiday("calendarific")]
    const result = reconcileCalendarEvents(existing, [], [coverage("calendarific", "complete")], 2026)
    expect(result.events).toEqual([])
    expect(result.removedIds).toEqual([existing[0].id])
  })

  it("retains last-known facts as stale degraded/failed evidence when coverage is partial or unknown", () => {
    for (const [status, expectedStatus, expectedError] of [["partial", "degraded", "partial_coverage_last_known"], ["unknown", "failed", "Calendarific timeout"]] as const) {
      const existing = [holiday("calendarific")]
      const result = reconcileCalendarEvents(existing, [], [{ ...coverage("calendarific", status), error: status === "unknown" ? expectedError : undefined }], 2026)
      expect(result.events).toHaveLength(1)
      expect(result.events[0]).toMatchObject({ id: existing[0].id, stale: true, sourceStatus: expectedStatus, error: expectedError })
      expect(result.removedIds).toEqual([])
    }
  })

  it("restores a retained fact to fresh healthy state when the provider recovers", () => {
    const stale = { ...holiday("calendarific"), stale: true, sourceStatus: "failed" as const, error: "Calendarific timeout" }
    const incoming = { ...holiday("calendarific"), lastCheckedAt: "2026-01-02T00:00:00.000Z", fetchedAt: "2026-01-02T00:00:00.000Z", updatedAt: "2026-01-02T00:00:00.000Z" }
    const result = reconcileCalendarEvents([stale], [incoming], [coverage("calendarific", "unknown")], 2026)
    expect(result.events).toHaveLength(1)
    expect(result.events[0]).toMatchObject({ id: incoming.id, stale: false, sourceStatus: "healthy", fetchedAt: incoming.fetchedAt, lastCheckedAt: incoming.lastCheckedAt })
    expect(result.events[0]).not.toHaveProperty("error")
  })

  it("does not merge same-name facts from different dates while preserving other source facts", () => {
    const other = { ...holiday("official-th"), name: "Royal event", id: "calendar:TH:2026-04-13:Royal event:public_holiday:official-th" }
    const existing = [holiday("calendarific"), other]
    const official = { ...holiday("official-th"), date: "2026-04-14", id: "calendar:TH:2026-04-14:Songkran:public_holiday:official-th" }
    const result = reconcileCalendarEvents(existing, [official], [coverage("official-th", "partial")], 2026)
    expect(result.events.map(event => event.id)).toEqual(expect.arrayContaining([other.id, official.id]))
    expect(result.events).toHaveLength(3)
    expect(result.events.find(event => event.sourceId === "calendarific")).toMatchObject({ date: "2026-04-13" })
  })
})
