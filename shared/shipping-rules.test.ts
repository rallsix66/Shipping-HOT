import { describe, expect, it } from "vitest"
import { filterEventsForOperationalContext, filterEventsForProviderModes, sourceAllowedForOperationalContext } from "./shipping"
import { calculateDelayMinutes, freshnessState, mergeProviderVessel, mergeProviderVoyage, rankHotItems, reconcileEvent, statusDurationMinutes, updateVesselStatus, validateShippingSettings } from "./shipping-rules"
import { createMockSnapshot, mockEvents, mockVessels } from "./shipping-fixtures"

const realProviderModes = {
  dataMode: "real",
  vessel: "aisstream",
  port: "portcast",
  schedule: "unavailable",
  weather: "open-meteo",
  weatherAlerts: "off",
  feed: "public",
  calendar: "calendarific",
} as const

const realOperationalContext = {
  modes: realProviderModes,
  activeSourceIds: new Set(["aisstream", "portcast-public", "open-meteo-marine", "the-loadstar", "maritime-executive", "shekou-official", "calendarific"]),
}

describe("shipping HOT deterministic rules", () => {
  it("calculates ETA delay and keeps unknown values unknown", () => {
    expect(calculateDelayMinutes("2026-01-01T00:00:00.000Z", "2026-01-01T02:00:00.000Z")).toBe(120)
    expect(calculateDelayMinutes(undefined, "2026-01-01T02:00:00.000Z")).toBeUndefined()
  })

  it("updates statusChangedAt only when navigation status changes", () => {
    const vessel = mockVessels[0]
    const same = updateVesselStatus(vessel, { navigationStatus: vessel.navigationStatus }, "2026-01-01T00:00:00.000Z")
    const changed = updateVesselStatus(vessel, { navigationStatus: "under_way" }, "2026-01-01T00:00:00.000Z")
    expect(same.statusChangedAt).toBe(vessel.statusChangedAt)
    expect(changed.statusChangedAt).toBe("2026-01-01T00:00:00.000Z")
  })

  it("keeps local vessel status ownership across provider refreshes", () => {
    const vessel = mockVessels[0]
    const same = mergeProviderVessel(vessel, { ...vessel, statusChangedAt: "2099-01-01T00:00:00.000Z" }, "2026-01-01T00:00:00.000Z")
    const changed = mergeProviderVessel(vessel, { ...vessel, navigationStatus: "under_way", statusChangedAt: "2099-01-01T00:00:00.000Z" }, "2026-01-01T00:00:00.000Z")
    expect(same.statusChangedAt).toBe(vessel.statusChangedAt)
    expect(changed.statusChangedAt).toBe("2026-01-01T00:00:00.000Z")
  })

  it("does not merge Mock vessel dynamics into an AIS provider vessel", () => {
    const previous = mockVessels[0]
    const provider: typeof previous = {
      id: previous.id,
      name: "AIS EVER GLORY",
      imo: previous.imo,
      mmsi: previous.mmsi,
      isWatched: previous.isWatched,
      latitude: 22.5,
      longitude: 114.5,
      speed: 4,
      course: 180,
      navigationStatus: "anchored",
      statusChangedAt: "2026-08-13T09:00:00.000Z",
      updatedAt: "2026-08-13T09:00:00.000Z",
      sourceUpdatedAt: "2026-08-13T09:00:00.000Z",
      fetchedAt: "2026-08-13T09:00:00.000Z",
      stale: false,
      sourceStatus: "healthy",
      provenance: { sourceType: "third_party", dataNature: "observed", sourceId: "aisstream" },
    }
    const merged = mergeProviderVessel(previous, provider, "2026-08-13T09:01:00.000Z")
    expect(merged).toMatchObject({ provenance: { sourceId: "aisstream" }, latitude: 22.5, longitude: 114.5, statusChangedAt: "2026-08-13T09:00:00.000Z", isWatched: previous.isWatched })
    expect(merged).not.toHaveProperty("destination")
    expect(merged).not.toHaveProperty("eta")
    expect(merged).not.toHaveProperty("carrier")
    expect(merged).not.toHaveProperty("shipType")
  })

  it("retains same-source AIS status history without accepting a cross-source Mock timestamp", () => {
    const ais = { ...mockVessels[0], provenance: { sourceType: "third_party" as const, dataNature: "observed" as const, sourceId: "aisstream" }, statusChangedAt: "2026-08-13T09:00:00.000Z" }
    const next = { ...ais, statusChangedAt: "2026-08-13T10:00:00.000Z" }
    expect(mergeProviderVessel(ais, next).statusChangedAt).toBe("2026-08-13T10:00:00.000Z")
    expect(mergeProviderVessel(mockVessels[0], { ...next, provenance: { sourceType: "third_party" as const, dataNature: "observed" as const, sourceId: "aisstream" } }).statusChangedAt).toBe("2026-08-13T10:00:00.000Z")
  })

  it("preserves voyage baselines while refreshing latest ETA and delay", () => {
    const voyage = createMockSnapshot().voyages[0]
    const refreshed = mergeProviderVoyage(voyage, { ...voyage, baselineEta: "2099-01-01T00:00:00.000Z", latestEta: "2026-01-01T04:00:00.000Z" })
    expect(refreshed.baselineEta).toBe(voyage.baselineEta)
    expect(refreshed.latestEta).toBe("2026-01-01T04:00:00.000Z")
    expect(refreshed.delayMinutes).toBe(calculateDelayMinutes(voyage.baselineEta, "2026-01-01T04:00:00.000Z"))
  })

  it("creates an ETA baseline from the first available provider latest ETA", () => {
    const voyage = { ...createMockSnapshot().voyages[0], baselineEta: undefined, baselineEtaSource: undefined, latestEta: undefined, latestEtaSource: undefined }
    const refreshed = mergeProviderVoyage(voyage, { ...voyage, latestEta: "2026-08-20T10:00:00.000Z", latestEtaSource: "provider-eta" })
    expect(refreshed.baselineEta).toBe("2026-08-20T10:00:00.000Z")
    expect(refreshed.baselineEtaSource).toBe("provider-eta")
    expect(refreshed.delayMinutes).toBe(0)
  })

  it("keeps the ETA baseline source paired with the provider baseline ETA", () => {
    const voyage = { ...createMockSnapshot().voyages[0], baselineEta: undefined, baselineEtaSource: undefined }
    const refreshed = mergeProviderVoyage(voyage, {
      ...voyage,
      baselineEta: "2026-08-20T10:00:00.000Z",
      baselineEtaSource: "baseline-source",
      latestEta: "2026-08-20T12:00:00.000Z",
      latestEtaSource: "latest-source",
    })
    expect(refreshed.baselineEta).toBe("2026-08-20T10:00:00.000Z")
    expect(refreshed.baselineEtaSource).toBe("baseline-source")
  })

  it("keeps the first ETA baseline when a later provider ETA changes", () => {
    const voyage = { ...createMockSnapshot().voyages[0], baselineEta: undefined, baselineEtaSource: undefined, latestEta: undefined, latestEtaSource: undefined }
    const first = mergeProviderVoyage(voyage, { ...voyage, latestEta: "2026-08-20T10:00:00.000Z", latestEtaSource: "provider-eta" })
    const second = mergeProviderVoyage(first, { ...first, baselineEta: undefined, latestEta: "2026-08-20T16:00:00.000Z", latestEtaSource: "provider-eta-2" })
    expect(second.baselineEta).toBe("2026-08-20T10:00:00.000Z")
    expect(second.latestEta).toBe("2026-08-20T16:00:00.000Z")
    expect(second.delayMinutes).toBe(360)
  })

  it("creates an ETD baseline from the first available provider latest ETD", () => {
    const voyage = { ...createMockSnapshot().voyages[0], baselineEtd: undefined, baselineEtdSource: undefined, latestEtd: undefined, latestEtdSource: undefined }
    const refreshed = mergeProviderVoyage(voyage, { ...voyage, latestEtd: "2026-08-20T08:00:00.000Z", latestEtdSource: "provider-etd" })
    expect(refreshed.baselineEtd).toBe("2026-08-20T08:00:00.000Z")
    expect(refreshed.baselineEtdSource).toBe("provider-etd")
  })

  it("keeps the ETD baseline source paired with the provider baseline ETD", () => {
    const voyage = { ...createMockSnapshot().voyages[0], baselineEtd: undefined, baselineEtdSource: undefined }
    const refreshed = mergeProviderVoyage(voyage, {
      ...voyage,
      baselineEtd: "2026-08-20T06:00:00.000Z",
      baselineEtdSource: "baseline-source",
      latestEtd: "2026-08-20T08:00:00.000Z",
      latestEtdSource: "latest-source",
    })
    expect(refreshed.baselineEtd).toBe("2026-08-20T06:00:00.000Z")
    expect(refreshed.baselineEtdSource).toBe("baseline-source")
  })

  it("preserves an existing ETA baseline and source against provider replacements", () => {
    const voyage = createMockSnapshot().voyages[0]
    const refreshed = mergeProviderVoyage(voyage, {
      ...voyage,
      baselineEta: "2099-01-01T00:00:00.000Z",
      baselineEtaSource: "new-baseline-source",
      latestEta: "2026-01-01T04:00:00.000Z",
      latestEtaSource: "new-latest-source",
    })
    expect(refreshed.baselineEta).toBe(voyage.baselineEta)
    expect(refreshed.baselineEtaSource).toBe(voyage.baselineEtaSource)
  })

  it("does not invent a voyage baseline when provider times are absent", () => {
    const voyage = { ...createMockSnapshot().voyages[0], baselineEta: undefined, baselineEtaSource: undefined, latestEta: undefined, latestEtaSource: "orphan-source", delayMinutes: undefined }
    const refreshed = mergeProviderVoyage(voyage, { ...voyage })
    expect(refreshed.baselineEta).toBeUndefined()
    expect(refreshed.baselineEtaSource).toBeUndefined()
    expect(refreshed.delayMinutes).toBeUndefined()
  })

  it("calculates anchored duration from statusChangedAt", () => {
    expect(statusDurationMinutes({ statusChangedAt: "2026-01-01T00:00:00.000Z" }, new Date("2026-01-01T02:00:00.000Z"))).toBe(120)
  })

  it("deduplicates recurring events and resolves them explicitly", () => {
    const event = mockEvents[0]
    const { id: _id, firstDetectedAt: _first, lastDetectedAt: _last, resolvedAt: _resolved, ...incoming } = event
    const update = reconcileEvent(event, { ...incoming, status: "active" }, "2026-01-01T03:00:00.000Z")
    expect(update.id).toBe(event.id)
    expect(update.firstDetectedAt).toBe(event.firstDetectedAt)
    expect(update.lastDetectedAt).toBe("2026-01-01T03:00:00.000Z")
    const { id: _updateId, firstDetectedAt: _updateFirst, lastDetectedAt: _updateLast, resolvedAt: _updateResolved, ...resolvedIncoming } = update
    const resolved = reconcileEvent(update, { ...resolvedIncoming, status: "resolved" }, "2026-01-01T04:00:00.000Z")
    expect(resolved.status).toBe("resolved")
    expect(resolved.resolvedAt).toBe("2026-01-01T04:00:00.000Z")
  })

  it("ranks severity, watched relevance, freshness and recency in order", () => {
    const snapshot = createMockSnapshot()
    const items = rankHotItems(snapshot.events, snapshot.ports, snapshot.vessels, snapshot.voyages, [
      { ...snapshot.feedItems[0], id: "feed-watched", severity: "warning", publishedAt: "2026-01-01T00:00:00.000Z", relatedPortIds: ["port-shekou"] },
      { ...snapshot.feedItems[0], id: "feed-unrelated", severity: "warning", publishedAt: "2026-01-01T01:00:00.000Z", relatedPortIds: [] },
    ], new Date("2026-01-01T02:00:00.000Z"))
    expect(items[0].severity).toBe("critical")
    const sameSeverity = items.filter(item => item.severity === "warning")
    expect(sameSeverity.findIndex(item => item.feedItemId === "feed-watched")).toBeLessThan(sameSeverity.findIndex(item => item.feedItemId === "feed-unrelated"))
  })

  it("validates settings bounds", () => {
    const settings = createMockSnapshot().settings
    expect(validateShippingSettings(settings)).toEqual([])
    expect(validateShippingSettings({ ...settings, refreshInterval: 0 })).toEqual(["refreshInterval"])
  })

  it("does not treat disabled, degraded or failed data as fresh", () => {
    expect(freshnessState({ stale: false, sourceStatus: "healthy" })).toBe("fresh")
    expect(freshnessState({ stale: false, sourceStatus: "disabled" })).toBe("stale")
    expect(freshnessState({ stale: false, sourceStatus: "degraded" })).toBe("stale")
    expect(freshnessState({ stale: false, sourceStatus: "failed" })).toBe("stale")
    expect(freshnessState({ stale: false, sourceStatus: "never_succeeded" })).toBe("unknown")
  })

  it("uses related entity freshness for Event HOT items", () => {
    const snapshot = createMockSnapshot()
    const failedVessel = { ...snapshot.vessels[0], stale: true, sourceStatus: "failed" as const }
    const event = { ...snapshot.events[0], vesselId: failedVessel.id, sourceStatus: "healthy" as const, lastDetectedAt: "2026-01-01T00:00:00.000Z" }
    const items = rankHotItems([event], snapshot.ports, [failedVessel], snapshot.voyages, [], new Date("2026-01-01T00:01:00.000Z"))
    expect(items[0].freshness).toBe("stale")
    expect(items[0].sourceStatus).toBe("failed")
  })

  it("does not show a FeedItem twice when its active Event exists", () => {
    const snapshot = createMockSnapshot()
    const feed = snapshot.feedItems[0]
    const event = { ...snapshot.events[0], id: "event-feed", type: feed.type, feedItemId: feed.id, dedupeKey: `feed:${feed.id}`, severity: feed.severity, title: feed.title, summary: feed.summary }
    const items = rankHotItems([event], snapshot.ports, snapshot.vessels, snapshot.voyages, [feed])
    expect(items.filter(item => item.feedItemId === feed.id || item.eventId === event.id)).toHaveLength(1)
  })

  it("requires fresh healthy evidence for direct Feed HOT items", () => {
    const snapshot = createMockSnapshot()
    const base = snapshot.feedItems[0]
    const hot = (feed: typeof base) => rankHotItems([], snapshot.ports, snapshot.vessels, snapshot.voyages, [feed]).filter(item => item.kind === "feed")
    expect(hot({ ...base, id: "failed-warning", severity: "warning", stale: true, sourceStatus: "failed", eventEligibility: true, publicationTimeKnown: true })).toEqual([])
    expect(hot({ ...base, id: "degraded-critical", severity: "critical", stale: true, sourceStatus: "degraded", eventEligibility: true, publicationTimeKnown: true })).toEqual([])
    expect(hot({ ...base, id: "fresh-warning", severity: "warning", stale: false, sourceStatus: "healthy", eventEligibility: true, publicationTimeKnown: true })).toHaveLength(1)
    expect(hot({ ...base, id: "missing-warning", severity: "warning", stale: true, sourceStatus: "degraded", eventEligibility: false, publicationTimeKnown: true, weather: { riskSource: "official", alertState: "unknown" } })).toEqual([])
  })

  it("excludes incompatible historical Mock Events and Feed HOT items from real Provider mode", () => {
    const snapshot = createMockSnapshot()
    const hot = rankHotItems(snapshot.events, snapshot.ports, snapshot.vessels, snapshot.voyages, snapshot.feedItems, new Date("2026-08-13T10:00:00.000Z"), realOperationalContext)
    expect(filterEventsForProviderModes(snapshot.events, realProviderModes)).toEqual([])
    expect(hot).toEqual([])
  })

  it("filters switched Mock vessel, port, weather, feed and calendar sources by their mode", () => {
    const snapshot = createMockSnapshot()
    const switched = [
      { ...snapshot.events[0], id: "mock-vessel-event", provenance: { sourceType: "mock" as const, dataNature: "derived" as const, sourceId: "mock-vessel" } },
      { ...snapshot.events[2], id: "mock-port-event", provenance: { sourceType: "mock" as const, dataNature: "derived" as const, sourceId: "mock-port" } },
      { ...snapshot.events[0], id: "mock-weather-event", type: "weather_risk", feedItemId: "feed-weather-south-china", vesselId: undefined, portId: "port-yantian", provenance: { sourceType: "mock" as const, dataNature: "derived" as const, sourceId: "mock-weather" } },
      { ...snapshot.events[0], id: "mock-feed-event", type: "port_disruption", feedItemId: "feed-shekou-window", vesselId: undefined, portId: "port-shekou", provenance: { sourceType: "mock" as const, dataNature: "derived" as const, sourceId: "mock-port-notice" } },
      { ...snapshot.events[0], id: "mock-calendar-event", type: "calendar_reminder", vesselId: undefined, portId: undefined, calendarEventId: "calendar:TH:2026-01-01:mock", provenance: { sourceType: "mock" as const, dataNature: "derived" as const, sourceId: "mock-calendar" } },
    ]
    expect(filterEventsForProviderModes(switched, realProviderModes)).toEqual([])
  })

  it("excludes Mock schedule events in Real Mode along with every other Mock source", () => {
    const snapshot = createMockSnapshot()
    const scheduleEvent = { ...snapshot.events[1], provenance: { sourceType: "mock" as const, dataNature: "derived" as const, sourceId: "mock-schedule" } }
    expect(filterEventsForProviderModes([snapshot.events[0], scheduleEvent], realProviderModes)).toEqual([])
    expect(filterEventsForProviderModes([{ ...snapshot.events[0], provenance: { sourceType: "mock" as const, dataNature: "derived" as const, sourceId: "mock-vessel" } }], realProviderModes)).toEqual([])
  })

  it("requires active registry membership in addition to Provider mode", () => {
    const publicWithoutJma = { modes: { ...realProviderModes, weatherAlerts: "public" }, activeSourceIds: new Set<string>() }
    const publicVerifiedJma = { modes: { ...realProviderModes, weatherAlerts: "public" }, activeSourceIds: new Set(["jma"]) }
    const experimentalPendingJma = { modes: { ...realProviderModes, weatherAlerts: "experimental" }, activeSourceIds: new Set(["jma"]) }
    expect(sourceAllowedForOperationalContext("jma", publicWithoutJma)).toBe(false)
    expect(sourceAllowedForOperationalContext("jma", publicVerifiedJma)).toBe(true)
    expect(sourceAllowedForOperationalContext("jma", experimentalPendingJma)).toBe(true)
    expect(sourceAllowedForOperationalContext("laem-chabang-official", { modes: { ...realProviderModes, feed: "public" }, activeSourceIds: new Set(["laem-chabang-official"]) })).toBe(true)
    expect(sourceAllowedForOperationalContext("laem-chabang-official", { modes: { ...realProviderModes, feed: "public" }, activeSourceIds: new Set() })).toBe(false)
  })

  it("keeps legacy unscoped entity Events in history but out of operational input", () => {
    const snapshot = createMockSnapshot()
    const legacy = { ...snapshot.events[0], dedupeKey: "vessel_anchored:vessel-ever-glory", id: "event-vessel_anchored:vessel-ever-glory", provenance: { sourceType: "mock" as const, dataNature: "derived" as const, sourceId: "mock-vessel" } }
    const mockContext = { modes: { ...realProviderModes, vessel: "mock" }, activeSourceIds: new Set(["mock-vessel", "mock-port", "mock-schedule", "mock-weather", "mock-port-notice", "mock-calendar"]) }
    expect(filterEventsForOperationalContext([legacy], mockContext)).toEqual([])
    expect(filterEventsForProviderModes([legacy], { ...realProviderModes, vessel: "mock" })).toEqual([])
  })
})
