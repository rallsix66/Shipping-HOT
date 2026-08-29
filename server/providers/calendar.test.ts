import { describe, expect, it } from "vitest"
import { type CalendarEvent, calendarCountries, calendarEventId, calendarEventKey, calendarEventLegacyId, calendarLeadDays } from "@shared/calendar"
import { calendarAttribution, calendarProvenances, calendarProviderSourceIds, calendarificCoverageStatus, configureCalendarProviders, createCalendarificProvider, createCompositeCalendarProvider, createMockCalendarEvents, filterCalendarEventsForMode, mergeCalendarSources, normalizeCalendarificPayload, normalizeCalendarificPayloadWithStats, officialHolidaySources, sanitizeCalendarError } from "./calendar"

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

  it("normalizes Calendarific live type labels such as National holiday and Common local holiday", () => {
    const events = normalizeCalendarificPayload({ response: { holidays: [
      { name: "National Day", date: { iso: "2026-08-17" }, type: ["National holiday"] },
      { name: "Local Holiday", date: { iso: "2026-08-18" }, type: ["Common local holiday"] },
    ] } }, "TH", 2026, "2026-08-15T00:00:00.000Z")
    expect(events).toMatchObject([
      { type: "public_holiday", isPublicHoliday: true, scope: "national" },
      { type: "public_holiday", isPublicHoliday: true, scope: "unknown" },
    ])
  })

  it("treats Public, Federal and Bank holiday labels as national public holidays", () => {
    const events = normalizeCalendarificPayload({ response: { holidays: [
      { name: "Public Day", date: { iso: "2026-08-17" }, type: ["Public holiday"] },
      { name: "Federal Day", date: { iso: "2026-08-18" }, type: ["Federal holiday"] },
      { name: "Bank Day", date: { iso: "2026-08-19" }, type: ["Bank holiday"] },
    ] } }, "TH", 2026, "2026-08-15T00:00:00.000Z")
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "Public Day", type: "public_holiday", isPublicHoliday: true, scope: "national" }),
      expect.objectContaining({ name: "Federal Day", type: "public_holiday", isPublicHoliday: true, scope: "national" }),
      expect.objectContaining({ name: "Bank Day", type: "public_holiday", isPublicHoliday: true, scope: "national" }),
    ]))
  })

  it("quarantines an unsupported Calendarific type as low-impact unknown scope", () => {
    const result = normalizeCalendarificPayloadWithStats({ response: { holidays: [
      { name: "Future Label Day", date: { iso: "2026-08-20" }, type: ["Some future Calendarific label"] },
    ] } }, "TH", 2026, "2026-08-15T00:00:00.000Z")
    const [event] = result.events
    expect(event).toMatchObject({ type: "commercial", scope: "unknown", isPublicHoliday: false, businessImpact: "low" })
    expect(result.stats).toMatchObject({ unsupportedTypeCount: 1, unsupportedTypeLabels: ["some future calendarific label"], unknownScopeCount: 1, operationalEligibleCount: 0 })
    expect(calendarEventLegacyId(event, "calendarific")).not.toBe(event.id)
  })

  it("preserves local subdivision evidence and does not merge same-day facts from different subdivisions", () => {
    const events = normalizeCalendarificPayload({ response: { holidays: [
      { name: "Local Founders Day", date: { iso: "2026-03-19" }, type: ["Local holiday"], locations: "KTN", states: [{ iso: "my-03", name: "Kelantan" }] },
      { name: "Local Founders Day", date: { iso: "2026-03-19" }, type: ["Local holiday"], locations: "TRG", states: [{ iso: "my-11", name: "Terengganu" }] },
      { name: "Local Unknown Day", date: { iso: "2026-03-20" }, type: ["Common local holiday"], locations: "All", states: "All" },
    ] } }, "MY", 2026, "2026-08-15T00:00:00.000Z")
    expect(events).toHaveLength(3)
    expect(events[0]).toMatchObject({ scope: "subdivision", subdivisionCode: "my-03", subdivisionCodes: ["my-03"], scopeLabel: "KTN, Kelantan" })
    expect(events[1]).toMatchObject({ scope: "subdivision", subdivisionCode: "my-11", subdivisionCodes: ["my-11"], scopeLabel: "TRG, Terengganu" })
    expect(events[2]).toMatchObject({ scope: "unknown", subdivisionCode: undefined, subdivisionCodes: undefined })
  })

  it("keeps exact duplicates separate from type-normalization collisions", () => {
    const result = normalizeCalendarificPayloadWithStats({ response: { holidays: [
      { name: "Founders Day", date: { iso: "2026-08-17" }, type: ["National holiday"] },
      { name: "Founders Day", date: { iso: "2026-08-17" }, type: ["National holiday"] },
      { name: "Founders Day", date: { iso: "2026-08-17" }, type: ["national"] },
      { name: "Founders Day", date: { iso: "2026-08-17" }, type: ["Local holiday"], states: [{ iso: "my-05", name: "Negeri Sembilan" }] },
      { name: "Founders Day", date: { iso: "2026-08-17" }, type: ["Local holiday"], states: [{ iso: "my-11", name: "Terengganu" }] },
    ] } }, "MY", 2026, "2026-08-15T00:00:00.000Z")
    expect(result.events).toHaveLength(3)
    expect(result.stats).toMatchObject({ rawCount: 5, normalizedCandidateCount: 5, uniqueCount: 3, exactDuplicateSameFactCount: 1, sameFactAfterTypeNormalizationCount: 1, semanticCollisionCount: 1, scopeFilteredOperationalRecords: 2 })
  })

  it("deduplicates identical Calendarific facts without merging different dates", () => {
    const events = normalizeCalendarificPayload({ response: { holidays: [
      { name: "Hari Raya Haji (Day 2)", date: { iso: "2026-05-28" }, type: ["Common local holiday"] },
      { name: "Hari Raya Haji (Day 2)", date: { iso: "2026-05-28" }, type: ["Common local holiday"] },
      { name: "Hari Raya Haji (Day 2)", date: { iso: "2026-05-29" }, type: ["Common local holiday"] },
    ] } }, "MY", 2026, "2026-08-15T00:00:00.000Z")
    expect(events).toHaveLength(2)
    expect(new Set(events.map(event => event.date))).toEqual(new Set(["2026-05-28", "2026-05-29"]))
  })

  it("keeps existing national Calendar IDs stable while scoping local IDs", () => {
    const national = { countryCode: "TH" as const, name: "National Day", date: "2026-08-17", type: "public_holiday" as const }
    expect(calendarEventKey(national)).toBe("TH:2026-08-17:national day:public_holiday")
    expect(calendarEventKey({ ...national, scope: "national" })).toBe(calendarEventKey(national))
    expect(calendarEventId(national, "calendarific")).toBe("calendar:TH:2026-08-17:national day:public_holiday:calendarific")
    expect(calendarEventKey({ ...national, scope: "subdivision", subdivisionCode: "my-05" })).toContain(":subdivision:my-05")
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

  it("covers the six-country official source registry without pretending unsupported live formats are complete", () => {
    expect(Object.keys(officialHolidaySources).sort()).toEqual(["CN", "ID", "MY", "PH", "TH", "VN"])
    expect(Object.keys(calendarCountries).sort()).toEqual(["CN", "ID", "MY", "PH", "TH", "VN"])
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
    expect(events).toHaveLength(12)
    expect(new Set(events.map(event => event.countryCode))).toEqual(new Set(["CN", "TH", "ID", "MY", "PH", "VN"]))
    expect(calendarLeadDays({ ...events[0], businessImpact: "medium" })).toEqual([7])
    expect(calendarLeadDays({ ...events[0], businessImpact: "high" })).toEqual([14, 3])
    expect(calendarLeadDays({ ...events[0], type: "government_special" })).toEqual([0])
  })

  it("keeps Mock events in the source-priority merge", () => {
    const [mockEvent] = createMockCalendarEvents(2026, "2026-08-15T00:00:00.000Z")
    expect(mergeCalendarSources([mockEvent], [], [])).toEqual([mockEvent])
  })
})
