import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { type CalendarEvent, calendarEventLegacyId } from "./calendar"
import { detectShippingEvents, isCalendarOperationallyRelevant, isFreshEventEvidence } from "./shipping-engine"
import { createMockSnapshot } from "./shipping-fixtures"
import { filterEventsForOperationalContext } from "./shipping"
import { applyFeedFreshnessPolicy, rankHotItems } from "./shipping-rules"

function calendarEventForSource(sourceId: "official-holiday-source" | "manual-holiday"): CalendarEvent {
  const official = sourceId === "official-holiday-source"
  return {
    id: `calendar:TH:2026-08-22:source-test:public_holiday:${sourceId}`,
    countryCode: "TH",
    name: official ? "Official source holiday" : "Manual source holiday",
    date: "2026-08-22",
    type: "public_holiday",
    isPublicHoliday: true,
    businessImpact: "medium",
    sourceId,
    sourceKind: official ? "official" : "user",
    verified: official,
    lastCheckedAt: "2026-08-15T00:00:00.000Z",
    updatedAt: "2026-08-15T00:00:00.000Z",
    fetchedAt: "2026-08-15T00:00:00.000Z",
    stale: false,
    sourceStatus: "healthy",
    provenance: { sourceType: official ? "official" : "user", dataNature: "reported", sourceId },
  }
}

describe("shipping HOT event engine", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("detects anchored, delay, congestion and feed signals", () => {
    const snapshot = createMockSnapshot()
    const events = detectShippingEvents(snapshot.vessels, snapshot.ports, snapshot.voyages, snapshot.feedItems, snapshot.settings, [], new Date().toISOString())
    expect(events.map(event => event.type)).toEqual(expect.arrayContaining(["vessel_anchored", "voyage_delay", "port_congestion", "port_disruption"]))
  })

  it("excludes superseded VesselAPI episodes and resolves their old delay event", () => {
    const snapshot = createMockSnapshot()
    const firstEpisode = {
      ...snapshot.voyages[0],
      id: "vesselapi:vessel-1:destination:PHMNL:episode:20260901T100000000Z",
      vesselId: "vessel-1",
      baselineEta: "2026-09-03T00:00:00.000Z",
      latestEta: "2026-09-04T00:00:00.000Z",
      delayMinutes: 1440,
      episodeState: "current" as const,
      provenance: { sourceType: "third_party" as const, dataNature: "planned" as const, sourceId: "vesselapi" },
      sourceStatus: "healthy" as const,
      stale: false,
    }
    const secondEpisode = {
      ...firstEpisode,
      id: "vesselapi:vessel-1:destination:SGSIN:episode:20260902T100000000Z",
      baselineEta: "2026-09-08T00:00:00.000Z",
      latestEta: "2026-09-08T00:00:00.000Z",
      delayMinutes: 0,
      episodeState: "current" as const,
    }
    const returnedEpisode = {
      ...firstEpisode,
      id: "vesselapi:vessel-1:destination:PHMNL:episode:20261018T100000000Z",
      baselineEta: "2026-10-20T00:00:00.000Z",
      latestEta: "2026-10-20T00:00:00.000Z",
      delayMinutes: 0,
      episodeState: "current" as const,
    }
    const initial = detectShippingEvents([], [], [firstEpisode], [], snapshot.settings, [], "2026-09-05T00:00:00.000Z")
    expect(initial).toHaveLength(1)
    expect(initial[0]).toMatchObject({ type: "voyage_delay", voyageId: firstEpisode.id })

    const superseded = detectShippingEvents([], [], [
      { ...firstEpisode, episodeState: "superseded" as const },
      secondEpisode,
      returnedEpisode,
    ], [], snapshot.settings, initial, "2026-10-19T00:00:00.000Z")
    expect(superseded.find(event => event.voyageId === firstEpisode.id)).toMatchObject({ status: "resolved" })
    expect(superseded.filter(event => event.type === "voyage_delay" && event.status === "active")).toEqual([])

    const currentDelay = detectShippingEvents([], [], [
      { ...firstEpisode, episodeState: "superseded" as const },
      secondEpisode,
      { ...returnedEpisode, latestEta: "2026-10-21T00:00:00.000Z", delayMinutes: 1440 },
    ], [], snapshot.settings, superseded, "2026-10-20T00:00:00.000Z")
    const currentEvent = currentDelay.find(event => event.type === "voyage_delay" && event.status === "active")
    expect(currentEvent).toMatchObject({ voyageId: returnedEpisode.id })
    expect(currentEvent?.dedupeKey).not.toBe(initial[0].dedupeKey)
  })

  it("keeps derived Event provenance and the underlying evidence source", () => {
    const snapshot = createMockSnapshot()
    const feedItems = snapshot.feedItems.map(item => item.sourceId === "mock-weather" ? { ...item, severity: "warning" as const } : item)
    const events = detectShippingEvents(snapshot.vessels, snapshot.ports, snapshot.voyages, feedItems, snapshot.settings, [], "2026-01-01T03:00:00.000Z")
    const weatherEvent = events.find(event => event.type === "weather_warning")
    expect(weatherEvent).toMatchObject({
      provenance: { sourceType: "mock", dataNature: "derived", sourceId: "mock-weather" },
      evidence: [{ provenance: { sourceType: "mock", dataNature: "forecast", sourceId: "mock-weather" } }],
    })
  })

  it("keeps a stable event identity across refreshes", () => {
    const snapshot = createMockSnapshot()
    const first = detectShippingEvents(snapshot.vessels, snapshot.ports, snapshot.voyages, snapshot.feedItems, snapshot.settings, [], new Date().toISOString())
    const second = detectShippingEvents(snapshot.vessels, snapshot.ports, snapshot.voyages, snapshot.feedItems, snapshot.settings, first, new Date().toISOString())
    const firstAnchored = first.find(event => event.dedupeKey === "vessel_anchored:vessel-ever-glory:mock-vessel")!
    const secondAnchored = second.find(event => event.dedupeKey === "vessel_anchored:vessel-ever-glory:mock-vessel")!
    expect(secondAnchored.id).toBe(firstAnchored.id)
    expect(secondAnchored.firstDetectedAt).toBe(firstAnchored.firstDetectedAt)
  })

  it("scopes identical logical vessel conditions by evidence source", () => {
    const snapshot = createMockSnapshot()
    const mockEvents = detectShippingEvents(snapshot.vessels, [], [], [], snapshot.settings, [], "2026-01-01T03:00:00.000Z")
    const aisVessel = {
      ...snapshot.vessels[0],
      provenance: { sourceType: "third_party" as const, dataNature: "observed" as const, sourceId: "aisstream" },
      statusChangedAt: "2026-01-01T00:00:00.000Z",
      sourceUpdatedAt: "2026-01-01T00:00:00.000Z",
    }
    const aisEvents = detectShippingEvents([aisVessel], [], [], [], snapshot.settings, [], "2026-01-01T03:00:00.000Z")
    const mockEvent = mockEvents.find(event => event.type === "vessel_anchored")!
    const aisEvent = aisEvents.find(event => event.type === "vessel_anchored")!
    expect(mockEvent.dedupeKey).toBe("vessel_anchored:vessel-ever-glory:mock-vessel")
    expect(aisEvent.dedupeKey).toBe("vessel_anchored:vessel-ever-glory:aisstream")
    expect(mockEvent.id).not.toBe(aisEvent.id)
    const allMockEvents = detectShippingEvents(snapshot.vessels, snapshot.ports, snapshot.voyages, snapshot.feedItems, snapshot.settings, [], "2026-01-01T03:00:00.000Z")
    expect(allMockEvents.find(event => event.type === "port_congestion")?.dedupeKey).toBe("port_congestion:port-shekou:mock-port")
    expect(allMockEvents.find(event => event.type === "voyage_delay")?.dedupeKey).toBe("voyage_delay:voyage-eg-061:mock-schedule")
  })

  it("reconciles active, resolved and reopened events", () => {
    const snapshot = createMockSnapshot()
    const now = "2026-01-01T03:00:00.000Z"
    const first = detectShippingEvents(snapshot.vessels, snapshot.ports, snapshot.voyages, snapshot.feedItems, snapshot.settings, [], now)
    const withoutAnchored = { ...snapshot, vessels: snapshot.vessels.map(v => v.id === "vessel-ever-glory" ? { ...v, navigationStatus: "under_way" as const } : v) }
    const resolved = detectShippingEvents(withoutAnchored.vessels, withoutAnchored.ports, withoutAnchored.voyages, withoutAnchored.feedItems, withoutAnchored.settings, first, "2026-01-01T04:00:00.000Z")
    const resolvedAnchored = resolved.find(event => event.dedupeKey === "vessel_anchored:vessel-ever-glory:mock-vessel")!
    expect(resolvedAnchored.status).toBe("resolved")
    expect(resolvedAnchored.resolvedAt).toBe("2026-01-01T04:00:00.000Z")
    const reopened = detectShippingEvents(snapshot.vessels, snapshot.ports, snapshot.voyages, snapshot.feedItems, snapshot.settings, resolved, "2026-01-01T05:00:00.000Z")
    const reopenedAnchored = reopened.find(event => event.dedupeKey === "vessel_anchored:vessel-ever-glory:mock-vessel")!
    expect(reopenedAnchored.id).toBe(resolvedAnchored.id)
    expect(reopenedAnchored.status).toBe("active")
    expect(reopenedAnchored.resolvedAt).toBeUndefined()
    expect(reopenedAnchored.firstDetectedAt).toBe(resolvedAnchored.firstDetectedAt)
  })

  it("updates severity and evidence during reconciliation", () => {
    const snapshot = createMockSnapshot()
    const first = detectShippingEvents(snapshot.vessels, snapshot.ports, snapshot.voyages, snapshot.feedItems, snapshot.settings, [], "2026-01-01T03:00:00.000Z")
    const changed = { ...snapshot, vessels: snapshot.vessels.map(v => v.id === "vessel-ever-glory" ? { ...v, statusChangedAt: "2025-12-31T20:00:00.000Z" } : v) }
    const next = detectShippingEvents(changed.vessels, changed.ports, changed.voyages, changed.feedItems, changed.settings, first, "2026-01-01T04:00:00.000Z")
    const anchored = next.find(event => event.dedupeKey === "vessel_anchored:vessel-ever-glory:mock-vessel")!
    expect(anchored.severity).toBe("critical")
    expect(anchored.evidenceJson).toMatchObject({ durationMinutes: 480 })
  })

  it("uses congestion levels at or above the configured threshold", () => {
    const snapshot = createMockSnapshot()
    const medium = { ...snapshot, settings: { ...snapshot.settings, eventThresholds: { ...snapshot.settings.eventThresholds, congestionLevel: "medium" as const } } }
    const events = detectShippingEvents(medium.vessels, medium.ports, medium.voyages, medium.feedItems, medium.settings, [], "2026-01-01T03:00:00.000Z")
    expect(events.filter(event => event.type === "port_congestion").map(event => event.portId)).toEqual(expect.arrayContaining(["port-shekou", "port-yantian"]))
  })

  it("does not treat unknown Portcast dynamic fields as zero or invent them in events", () => {
    const snapshot = createMockSnapshot()
    const port = { ...snapshot.ports[0], congestionLevel: "high" as const, waitingVessels: undefined, waitingHours: undefined, containerWaitingVessels: undefined, operationalStatus: undefined, provenance: { sourceType: "third_party" as const, dataNature: "derived" as const, sourceId: "portcast-public" }, sourceStatus: "healthy" as const, stale: false }
    const events = detectShippingEvents(snapshot.vessels, [port], [], [], snapshot.settings, [], "2026-01-01T03:00:00.000Z")
    const portEvent = events.find(event => event.type === "port_congestion")
    expect(portEvent).toMatchObject({ type: "port_congestion", summary: "等待船舶暂无数据，等待时长暂无数据" })
    expect(portEvent?.summary).not.toContain("undefined")
  })

  it("requires healthy and non-stale evidence before creating an Event", () => {
    const snapshot = createMockSnapshot()
    const stalePort = { ...snapshot.ports[0], stale: true, sourceStatus: "failed" as const, error: "Portcast unavailable" }
    expect(isFreshEventEvidence(stalePort)).toBe(false)
    const events = detectShippingEvents([], [stalePort], [], [], snapshot.settings, [], "2026-01-01T03:00:00.000Z")
    expect(events).toEqual([])
  })

  it("keeps an active Event stale without upgrading, refreshing evidence or resolving it after failure", () => {
    const snapshot = createMockSnapshot()
    const freshPort = snapshot.ports[0]
    const initial = detectShippingEvents([], [freshPort], [], [], snapshot.settings, [], "2026-01-01T03:00:00.000Z")
    const portEvent = initial.find(event => event.type === "port_congestion")!
    const failedPort = { ...freshPort, stale: true, sourceStatus: "failed" as const, error: "Portcast outage", fetchedAt: "2026-01-01T04:00:00.000Z" }
    const next = detectShippingEvents([], [failedPort], [], [], snapshot.settings, [portEvent], "2026-01-01T04:00:00.000Z")
    const preserved = next.find(event => event.id === portEvent.id)!
    expect(preserved).toMatchObject({ status: "active", severity: "warning", stale: true, sourceStatus: "failed", error: "Portcast outage", fetchedAt: "2026-01-01T04:00:00.000Z" })
    expect(preserved.lastDetectedAt).toBe(portEvent.lastDetectedAt)
    expect(preserved.provenance).toEqual(portEvent.provenance)
    expect(preserved.evidence).toEqual(portEvent.evidence)
    expect(preserved.resolvedAt).toBeUndefined()
  })

  it("resolves only when fresh evidence confirms the condition is gone", () => {
    const snapshot = createMockSnapshot()
    const freshPort = snapshot.ports[0]
    const initial = detectShippingEvents([], [freshPort], [], [], snapshot.settings, [], "2026-01-01T03:00:00.000Z")
    const portEvent = initial.find(event => event.type === "port_congestion")!
    const recoveredPort = { ...freshPort, congestionLevel: "low" as const, stale: false, sourceStatus: "healthy" as const, fetchedAt: "2026-01-01T04:00:00.000Z" }
    const next = detectShippingEvents([], [recoveredPort], [], [], snapshot.settings, [portEvent], "2026-01-01T04:00:00.000Z")
    const resolved = next.find(event => event.id === portEvent.id)!
    expect(resolved.status).toBe("resolved")
    expect(resolved.resolvedAt).toBe("2026-01-01T04:00:00.000Z")
    expect(resolved.lastDetectedAt).toBe(portEvent.lastDetectedAt)
    expect(resolved.sourceStatus).toBe("healthy")
    expect(resolved.stale).toBe(false)
  })

  it("preserves Feed reported provenance when the Feed item is surfaced directly in HOT", () => {
    const snapshot = createMockSnapshot()
    const feed = { ...snapshot.feedItems[0], severity: "warning" as const }
    const [item] = rankHotItems([], [], [], [], [feed])
    expect(item.provenance).toMatchObject({ sourceType: "mock", dataNature: "reported", sourceId: "mock-port-notice" })
  })

  it("resolves expired Feed Events and removes them from HOT", () => {
    const snapshot = createMockSnapshot()
    const feed = {
      ...snapshot.feedItems[0],
      severity: "warning" as const,
      publishedAt: "2026-01-01T00:00:00.000Z",
      currentUntil: "2026-01-02T00:00:00.000Z",
      visibility: "current" as const,
      publicationTimeKnown: true,
      eventEligibility: true,
      stale: false,
      sourceStatus: "healthy" as const,
    }
    const initial = detectShippingEvents([], [], [], [feed], snapshot.settings, [], "2026-01-01T03:00:00.000Z")
    const feedEvent = initial.find(event => event.feedItemId === feed.id)!
    expect(feedEvent).toMatchObject({ status: "active", expiresAt: "2026-01-02T00:00:00.000Z" })

    const expired = { ...feed, visibility: "history" as const, stale: true, eventEligibility: false }
    const next = detectShippingEvents([], [], [], [expired], snapshot.settings, [feedEvent], "2026-01-02T03:00:00.000Z")
    expect(next.find(event => event.id === feedEvent.id)).toMatchObject({ status: "resolved", error: "feed_item_expired" })
    expect(rankHotItems(next, [], [], [], [expired], new Date("2026-01-02T03:00:00.000Z"))).toEqual([])
  })

  it("keeps invalid Feed dates out of Event and HOT", () => {
    const snapshot = createMockSnapshot()
    const invalid = applyFeedFreshnessPolicy({
      ...snapshot.feedItems[0],
      severity: "warning",
      publishedAt: "2026-01-01T00:00:00.000Z",
      effectiveAt: "not-a-date",
    }, new Date("2026-01-01T03:00:00.000Z"))
    expect(invalid).toMatchObject({ visibility: "quarantine", eventEligibility: false })
    expect(detectShippingEvents([], [], [], [invalid], snapshot.settings, [], "2026-01-01T03:00:00.000Z")).toEqual([])
    expect(rankHotItems([], [], [], [], [invalid], new Date("2026-01-01T03:00:00.000Z"))).toEqual([])
  })

  it("creates deduplicated Calendar reminders and keeps them stale on provider failure", () => {
    const snapshot = createMockSnapshot()
    const calendarEvent: CalendarEvent = {
      id: "calendar:TH:2026-08-22:songkran:public_holiday",
      countryCode: "TH",
      name: "Songkran",
      date: "2026-08-22",
      type: "public_holiday",
      isPublicHoliday: true,
      businessImpact: "medium",
      sourceId: "calendarific",
      sourceKind: "third_party",
      sourceUrl: "https://calendarific.com/holidays/2026/TH",
      verified: false,
      lastCheckedAt: "2026-08-15T00:00:00.000Z",
      updatedAt: "2026-08-15T00:00:00.000Z",
      fetchedAt: "2026-08-15T00:00:00.000Z",
      stale: false,
      sourceStatus: "healthy",
      provenance: { sourceType: "third_party", dataNature: "reported", sourceId: "calendarific" },
    }
    const initial = detectShippingEvents([], [], [], [], snapshot.settings, [], "2026-08-15T00:00:00.000Z", [calendarEvent])
    expect(initial).toHaveLength(1)
    expect(initial[0]).toMatchObject({ type: "calendar_reminder", calendarEventId: calendarEvent.id, dedupeKey: `calendar:${calendarEvent.id}:7` })
    const repeated = detectShippingEvents([], [], [], [], snapshot.settings, initial, "2026-08-15T01:00:00.000Z", [calendarEvent])
    expect(repeated).toHaveLength(1)
    expect(repeated[0].id).toBe(initial[0].id)
    const stale = { ...calendarEvent, stale: true, sourceStatus: "failed" as const, error: "Calendarific unavailable" }
    const retained = detectShippingEvents([], [], [], [], snapshot.settings, initial, "2026-08-15T02:00:00.000Z", [stale])
    expect(retained[0]).toMatchObject({ status: "active", stale: true, sourceStatus: "failed", error: "Calendarific unavailable" })
    expect(retained[0].lastDetectedAt).toBe(initial[0].lastDetectedAt)
  })

  it("announces a newly discovered government special holiday immediately and deduplicates it", () => {
    const snapshot = createMockSnapshot()
    const calendarEvent: CalendarEvent = {
      id: "calendar:TH:2026-01-03:emergency-port-holiday:government_special",
      countryCode: "TH",
      name: "Emergency port holiday",
      date: "2026-01-03",
      type: "government_special",
      isPublicHoliday: true,
      businessImpact: "high",
      sourceId: "official-th",
      sourceKind: "official",
      sourceUrl: "https://example.gov/holiday",
      verified: true,
      lastCheckedAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      fetchedAt: "2026-01-01T00:00:00.000Z",
      stale: false,
      sourceStatus: "healthy",
      provenance: { sourceType: "official", dataNature: "reported", sourceId: "official-th" },
    }
    const initial = detectShippingEvents([], [], [], [], snapshot.settings, [], "2026-01-01T00:00:00.000Z", [calendarEvent])
    expect(initial).toHaveLength(1)
    expect(initial[0]).toMatchObject({
      type: "calendar_announcement",
      calendarEventId: calendarEvent.id,
      dedupeKey: `calendar:${calendarEvent.id}:announced`,
      severity: "warning",
    })
    const repeated = detectShippingEvents([], [], [], [], snapshot.settings, initial, "2026-01-01T01:00:00.000Z", [calendarEvent])
    expect(repeated).toHaveLength(1)
    expect(repeated[0].id).toBe(initial[0].id)
  })

  it("keeps local Calendar facts visible but out of national Event/HOT", () => {
    const snapshot = createMockSnapshot()
    const national = calendarEventForSource("official-holiday-source")
    const local = { ...national, id: "calendar:TH:2026-08-22:local:public_holiday:official-holiday-source", name: "Local holiday", scope: "subdivision" as const, subdivisionCode: "th-10" }
    expect(isCalendarOperationallyRelevant(national)).toBe(true)
    expect(isCalendarOperationallyRelevant(local)).toBe(false)
    const nationalEvents = detectShippingEvents([], [], [], [], snapshot.settings, [], "2026-08-15T00:00:00.000Z", [national])
    expect(nationalEvents).toHaveLength(1)
    const historicalLocalEvent = nationalEvents.map(event => ({ ...event, calendarEventId: local.id }))
    expect(detectShippingEvents([], [], [], [], snapshot.settings, historicalLocalEvent, "2026-08-15T00:00:00.000Z", [local])).toEqual([])
    const localEvents = detectShippingEvents([], [], [], [], snapshot.settings, [], "2026-08-15T00:00:00.000Z", [local])
    expect(localEvents).toEqual([])
    expect(rankHotItems(localEvents, [], [], [], [], new Date("2026-08-15T00:00:00.000Z"))).toEqual([])
  })

  it("quarantines unsupported Calendarific facts and migrates legacy local Events without resolving them", () => {
    const snapshot = createMockSnapshot()
    const unknown = {
      ...calendarEventForSource("official-holiday-source"),
      id: "calendar:TH:2026-08-20:future-label:commercial:calendarific",
      name: "Future label",
      type: "commercial" as const,
      businessImpact: "low" as const,
      scope: "unknown" as const,
      sourceId: "calendarific",
      sourceKind: "third_party" as const,
      provenance: { sourceType: "third_party" as const, dataNature: "reported" as const, sourceId: "calendarific" },
    }
    expect(isCalendarOperationallyRelevant(unknown)).toBe(false)
    const unknownEvents = detectShippingEvents([], [], [], [], snapshot.settings, [], "2026-08-15T00:00:00.000Z", [unknown])
    expect(unknownEvents).toEqual([])
    expect(rankHotItems(unknownEvents, [], [], [], [], new Date("2026-08-15T00:00:00.000Z"))).toEqual([])

    const scoped = {
      ...unknown,
      id: "calendar:TH:2026-08-22:local-founders:public_holiday:subdivision:th-10:calendarific",
      name: "Local Founders",
      type: "public_holiday" as const,
      businessImpact: "medium" as const,
      scope: "subdivision" as const,
      subdivisionCode: "th-10",
      subdivisionCodes: ["th-10"],
    }
    const legacy = { ...scoped, id: calendarEventLegacyId(scoped, "calendarific"), scope: undefined, subdivisionCode: undefined, subdivisionCodes: undefined, scopeLabel: undefined }
    const historical = detectShippingEvents([], [], [], [], snapshot.settings, [], "2026-08-15T00:00:00.000Z", [legacy])
    expect(historical).toHaveLength(1)
    expect(historical[0].status).toBe("active")
    const current = detectShippingEvents([], [], [], [], snapshot.settings, historical, "2026-08-15T00:00:00.000Z", [scoped])
    expect(current).toEqual([])
    expect(historical[0].resolvedAt).toBeUndefined()
  })

  it("keeps official and manual Calendar events through the full Event/HOT path only for active provenance sources", () => {
    const snapshot = createMockSnapshot()
    for (const [mode, sourceId] of [["official", "official-holiday-source"], ["manual", "manual-holiday"]] as const) {
      const calendarEvent = calendarEventForSource(sourceId)
      const events = detectShippingEvents([], [], [], [], snapshot.settings, [], "2026-08-15T00:00:00.000Z", [calendarEvent])
      const context = { modes: { calendar: mode }, activeSourceIds: new Set([sourceId]) }
      const currentEvents = filterEventsForOperationalContext(events, context)
      const hot = rankHotItems(currentEvents, [], [], [], [], new Date("2026-08-15T00:00:00.000Z"), context)
      expect(currentEvents).toHaveLength(1)
      expect(currentEvents[0].provenance?.sourceId).toBe(sourceId)
      expect(hot).toEqual(expect.arrayContaining([expect.objectContaining({ kind: "event", eventId: currentEvents[0].id })]))

      const calendarificContext = { modes: { calendar: "calendarific" }, activeSourceIds: new Set(["calendarific"]) }
      expect(filterEventsForOperationalContext(events, calendarificContext)).toEqual([])
    }
  })

  it("does not let a Calendarific no-key context surface Mock Calendar Event/HOT data", () => {
    const snapshot = createMockSnapshot()
    const mockEvent = {
      ...calendarEventForSource("manual-holiday"),
      id: "calendar:TH:2026-08-22:mock-source:public_holiday",
      sourceId: "mock-calendar",
      sourceKind: "mock" as const,
      verified: false,
      provenance: { sourceType: "mock" as const, dataNature: "reported" as const, sourceId: "mock-calendar" },
    }
    const events = detectShippingEvents([], [], [], [], snapshot.settings, [], "2026-08-15T00:00:00.000Z", [mockEvent])
    const context = { modes: { calendar: "calendarific" }, activeSourceIds: new Set(["calendarific"]) }
    const currentEvents = filterEventsForOperationalContext(events, context)
    expect(currentEvents).toEqual([])
    expect(rankHotItems(currentEvents, [], [], [], [], new Date("2026-08-15T00:00:00.000Z"), context)).toEqual([])
  })

  it("keeps a same-source AIS Event stale and active when the next observation fails", () => {
    const snapshot = createMockSnapshot()
    const aisVessel = {
      ...snapshot.vessels[0],
      provenance: { sourceType: "third_party" as const, dataNature: "observed" as const, sourceId: "aisstream" },
      statusChangedAt: "2026-01-01T00:00:00.000Z",
      sourceUpdatedAt: "2026-01-01T00:00:00.000Z",
    }
    const initial = detectShippingEvents([aisVessel], [], [], [], snapshot.settings, [], "2026-01-01T03:00:00.000Z")
    const failedVessel = { ...aisVessel, stale: true, sourceStatus: "failed" as const, error: "AIS timeout", fetchedAt: "2026-01-01T04:00:00.000Z" }
    const next = detectShippingEvents([failedVessel], [], [], [], snapshot.settings, initial, "2026-01-01T04:00:00.000Z")
    expect(next[0]).toMatchObject({ status: "active", stale: true, sourceStatus: "failed", error: "AIS timeout", provenance: { sourceId: "aisstream" } })
    expect(next[0].resolvedAt).toBeUndefined()
  })
})
