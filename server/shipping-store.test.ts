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

  it("retains last-known facts when coverage is partial or unknown", () => {
    for (const status of ["partial", "unknown"] as const) {
      const existing = [holiday("calendarific")]
      const result = reconcileCalendarEvents(existing, [], [coverage("calendarific", status)], 2026)
      expect(result.events).toHaveLength(1)
      expect(result.events[0].id).toBe(existing[0].id)
      expect(result.removedIds).toEqual([])
    }
  })

  it("replaces matching source facts while preserving other source facts", () => {
    const other = { ...holiday("official-th"), name: "Royal event", id: "calendar:TH:2026-04-13:Royal event:public_holiday:official-th" }
    const existing = [holiday("calendarific"), other]
    const official = { ...holiday("official-th"), date: "2026-04-14", id: "calendar:TH:2026-04-14:Songkran:public_holiday:official-th" }
    const result = reconcileCalendarEvents(existing, [official], [coverage("official-th", "partial")], 2026)
    expect(result.events.map(event => event.id)).toEqual(expect.arrayContaining([other.id, official.id]))
    expect(result.events).toHaveLength(2)
  })
})
