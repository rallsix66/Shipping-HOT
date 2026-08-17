import { describe, expect, it } from "vitest"
import { type CalendarEvent, calendarCountries, calendarLeadDays } from "@shared/calendar"
import { calendarAttribution, calendarProvenances, calendarProviderSourceIds, calendarificCoverageStatus, configureCalendarProviders, createCalendarificProvider, createCompositeCalendarProvider, createMockCalendarEvents, filterCalendarEventsForMode, mergeCalendarSources, normalizeCalendarificPayload, officialHolidaySources, sanitizeCalendarError } from "./calendar"

describe("calendar providers", () => {
  it("keeps Calendarific mode and returns unknown coverage when its key is missing", async () => {
    const configured = configureCalendarProviders({ SHIPPING_CALENDAR_PROVIDER: "calendarific" })
    expect(configured.modes.calendar).toBe("calendarific")
    const result = await configured.provider.getEvents({ year: 2026, countries: ["TH"] })
    expect(result.events).toEqual([])
    expect(result.coverage).toEqual([expect.objectContaining({ sourceId: "calendarific", status: "unknown", error: "CALENDARIFIC_API_KEY missing" })])
  })

  it("keeps Mock Calendar records out of real mode inputs", () => {
    const configured = configureCalendarProviders({ SHIPPING_CALENDAR_PROVIDER: "calendarific" })
    expect(configured.modes.calendar).toBe("calendarific")
    expect(configured.provider).not.toBeUndefined()
    expect(filterCalendarEventsForMode(createMockCalendarEvents(2026), configured.modes.calendar)).toEqual([])
  })

  it("returns configured Calendar provenance source IDs instead of composite option keys", () => {
    expect(configureCalendarProviders({}).modes).toEqual({ calendar: "mock", calendarSourceIds: [calendarProviderSourceIds.mock] })
    expect(configureCalendarProviders({ SHIPPING_CALENDAR_PROVIDER: "calendarific", CALENDARIFIC_API_KEY: "test-key" }).modes).toEqual({ calendar: "calendarific", calendarSourceIds: [calendarProviderSourceIds.calendarific, calendarProviderSourceIds.official, calendarProviderSourceIds.manual] })
    expect(configureCalendarProviders({ SHIPPING_CALENDAR_PROVIDER: "calendarific" }).modes).toEqual({ calendar: "calendarific", calendarSourceIds: [calendarProviderSourceIds.calendarific] })
    expect(configureCalendarProviders({ SHIPPING_CALENDAR_PROVIDER: "official" }).modes).toEqual({ calendar: "official", calendarSourceIds: [calendarProviderSourceIds.official, calendarProviderSourceIds.manual] })
    expect(configureCalendarProviders({ SHIPPING_CALENDAR_PROVIDER: "manual" }).modes).toEqual({ calendar: "manual", calendarSourceIds: [calendarProviderSourceIds.manual] })
  })

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

  it("keeps Calendarific API keys server-side and does not overclaim empty coverage", async () => {
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
    expect(result.coverage).toMatchObject([{ countryCode: "TH", status: "unknown" }])
    expect(calendarificCoverageStatus({ response: { holidays: [{ name: "Holiday", date: { iso: "2026-01-01" } }] } }, 1)).toBe("partial")
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

  it("selects official evidence over Calendarific for the same holiday", () => {
    const [thirdParty] = normalizeCalendarificPayload({ response: { holidays: [{ name: "National Day", date: { iso: "2026-08-17" }, type: ["national"] }] } }, "ID", 2026, "2026-08-15T00:00:00.000Z")
    const official = { ...thirdParty, id: "official-national-day", sourceId: "official-holiday-source", sourceKind: "official" as const, verified: true, provenance: calendarProvenances.official }
    const [merged] = mergeCalendarSources([thirdParty], [official], [])
    expect(merged).toMatchObject({ sourceKind: "official", sourceId: "official-holiday-source", verified: true })
    expect(merged.evidence?.map(item => item.provenance.sourceId)).toEqual(expect.arrayContaining(["calendarific", "official-holiday-source"]))
  })

  it("allows a Manual Override to change business impact without replacing official facts", () => {
    const [official] = normalizeCalendarificPayload({ response: { holidays: [{ name: "National Day", date: { iso: "2026-08-17" }, type: ["national"] }] } }, "ID", 2026, "2026-08-15T00:00:00.000Z")
    const manual: CalendarEvent = { ...official, id: "manual-impact", sourceId: "manual-holiday", sourceKind: "user", businessImpact: "critical", provenance: calendarProvenances.manual, operator: "ops", note: "Customer cut-off" }
    const [merged] = mergeCalendarSources([], [{ ...official, sourceId: "official-holiday-source", sourceKind: "official", provenance: calendarProvenances.official, verified: true }], [manual])
    expect(merged).toMatchObject({ sourceKind: "user", date: "2026-08-17", type: "public_holiday", isPublicHoliday: true, businessImpact: "critical", note: "Customer cut-off", conflictFlag: undefined })
    expect(merged.evidence?.map(item => item.provenance.sourceId)).toEqual(expect.arrayContaining(["official-holiday-source", "manual-holiday"]))
  })

  it("records a conflict when a Manual Override changes the event type", () => {
    const [official] = normalizeCalendarificPayload({ response: { holidays: [{ name: "National Day", date: { iso: "2026-08-17" }, type: ["national"] }] } }, "ID", 2026, "2026-08-15T00:00:00.000Z")
    const manual: CalendarEvent = { ...official, id: "manual-type", sourceId: "manual-holiday", sourceKind: "user", type: "government_special", provenance: calendarProvenances.manual, conflictReason: "Government notice changes the holiday classification", conflictOperator: "ops@example.com" }
    const [merged] = mergeCalendarSources([], [{ ...official, sourceId: "official-holiday-source", sourceKind: "official", provenance: calendarProvenances.official, verified: true }], [manual])
    expect(merged).toMatchObject({ sourceKind: "user", type: "government_special", conflictFlag: true, conflictReason: "Government notice changes the holiday classification", conflictOperator: "ops@example.com" })
    expect(merged.evidence?.map(item => item.provenance.sourceId)).toEqual(expect.arrayContaining(["official-holiday-source", "manual-holiday"]))
  })

  it("combines Calendarific, Official and Manual providers", async () => {
    const event = createMockCalendarEvents(2026, "2026-08-15T00:00:00.000Z")[0]
    const provider = createCompositeCalendarProvider({
      calendarific: { getEvents: async () => ({ events: [event], coverage: [{ countryCode: "TH", year: 2026, status: "partial", sourceId: "calendarific" }], fetchedAt: "2026-08-15T00:00:00.000Z" }) },
      official: { getEvents: async () => ({ events: [{ ...event, sourceId: "official-holiday-source", sourceKind: "official", verified: true, provenance: calendarProvenances.official }], coverage: [{ countryCode: "TH", year: 2026, status: "partial", sourceId: "official-holiday-source" }], fetchedAt: "2026-08-15T00:00:00.000Z" }) },
      manual: { getEvents: async () => ({ events: [], coverage: [{ countryCode: "TH", year: 2026, status: "unknown", sourceId: "manual-holiday" }], fetchedAt: "2026-08-15T00:00:00.000Z" }) },
    })
    const result = await provider.getEvents({ year: 2026, countries: ["TH"] })
    expect(result.events).toHaveLength(2)
    expect(result.coverage.map(item => item.sourceId)).toEqual(["calendarific", "official-holiday-source", "manual-holiday"])
  })

  it("shows Calendarific attribution only when the source is active or present", () => {
    expect(calendarAttribution({ provider: "mock", events: createMockCalendarEvents(2026) })).toBeUndefined()
    expect(calendarAttribution({ provider: "calendarific" })).toBe("Powered by Calendarific")
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
