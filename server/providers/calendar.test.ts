import { describe, expect, it } from "vitest"
import { type CalendarEvent, calendarCountries, calendarLeadDays } from "@shared/calendar"
import { calendarProvenances, createCalendarificProvider, createMockCalendarEvents, mergeCalendarSources, normalizeCalendarificPayload, officialHolidaySources, sanitizeCalendarError } from "./calendar"

describe("calendar providers", () => {
  it("normalizes Calendarific public, religious and observance records", () => {
    const events = normalizeCalendarificPayload({ response: { holidays: [
      { name: "National Day", date: { iso: "2026-08-17" }, type: ["national"] },
      { name: "Vesak", date: { iso: "2026-05-31" }, type: ["religious"] },
      { name: "Mother's Day", date: { iso: "2026-08-09" }, type: ["observance"] },
    ] } }, "ID", 2026, "2026-08-15T00:00:00.000Z")
    expect(events).toHaveLength(3)
    expect(events[0]).toMatchObject({ countryCode: "ID", type: "public_holiday", isPublicHoliday: true, businessImpact: "medium", sourceId: "calendarific", sourceKind: "third_party", verified: false, sourceUrl: "https://calendarific.com/holidays/2026/ID", provenance: { ...calendarProvenances.calendarific, sourceUrl: "https://calendarific.com/holidays/2026/ID" } })
    expect(events[1]).toMatchObject({ type: "religious", isPublicHoliday: false })
    expect(events[2]).toMatchObject({ type: "observance", isPublicHoliday: false, businessImpact: "low" })
  })

  it("keeps Calendarific API keys server-side and sanitizes failures", async () => {
    let requestedUrl = ""
    const provider = createCalendarificProvider({
      apiKey: "secret-calendarific-key",
      now: () => new Date("2026-08-15T00:00:00.000Z"),
      fetcher: async (url) => {
        requestedUrl = url
        return { ok: true, status: 200, json: async () => ({ response: { holidays: [] } }) }
      },
    })
    const result = await provider.getEvents({ year: 2026, countries: ["TH"] })
    expect(requestedUrl).toContain("api_key=secret-calendarific-key")
    expect(result.events).toEqual([])
    expect(result.coverage).toMatchObject([{ countryCode: "TH", status: "complete" }])
    expect(sanitizeCalendarError(new Error("https://calendarific.com/api/v2/holidays?api_key=secret-calendarific-key&country=TH"))).toBe("https://calendarific.com/api/v2/holidays?api_key=***&country=TH")
  })

  it("covers the five-country official source registry without pretending unsupported live formats are complete", () => {
    expect(Object.keys(officialHolidaySources).sort()).toEqual(["ID", "MY", "PH", "TH", "VN"])
    expect(Object.keys(calendarCountries).sort()).toEqual(["ID", "MY", "PH", "TH", "VN"])
  })

  it("preserves official facts and records a Manual Override conflict", () => {
    const [official] = normalizeCalendarificPayload({ response: { holidays: [{ name: "National Day", date: { iso: "2026-08-17" }, type: ["national"] }] } }, "ID", 2026, "2026-08-15T00:00:00.000Z")
    const manual: CalendarEvent = {
      ...official,
      id: "manual-national-day",
      date: "2026-08-18",
      sourceId: "manual-holiday",
      sourceKind: "user",
      sourceUrl: "https://example.com/manual/calendar",
      verified: true,
      businessImpact: "high",
      provenance: calendarProvenances.manual,
      conflictReason: "业务确认采用临时调整日期",
    }
    const merged = mergeCalendarSources([], [{ ...official, sourceKind: "official", sourceId: "official-holiday-source", verified: true, provenance: calendarProvenances.official }], [manual])
    expect(merged[0]).toMatchObject({ sourceKind: "user", sourceId: "manual-holiday", date: "2026-08-18", conflictFlag: true, conflictingSourceIds: ["official-holiday-source"] })
  })

  it("provides deterministic Mock coverage and lead windows", () => {
    const events = createMockCalendarEvents(2026, "2026-08-15T00:00:00.000Z")
    expect(events).toHaveLength(10)
    expect(new Set(events.map(event => event.countryCode))).toEqual(new Set(["TH", "ID", "MY", "PH", "VN"]))
    expect(calendarLeadDays({ ...events[0], businessImpact: "medium" })).toEqual([7])
    expect(calendarLeadDays({ ...events[0], businessImpact: "high" })).toEqual([14, 3])
    expect(calendarLeadDays({ ...events[0], type: "government_special" })).toEqual([0])
  })

  it("keeps Mock events in the source-priority merge", () => {
    const [mockEvent] = createMockCalendarEvents(2026, "2026-08-15T00:00:00.000Z")
    expect(mergeCalendarSources([mockEvent], [], [])).toEqual([mockEvent])
  })
})
