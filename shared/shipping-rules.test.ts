import { describe, expect, it } from "vitest"
import { calculateDelayMinutes, freshnessState, mergeProviderVessel, mergeProviderVoyage, rankHotItems, reconcileEvent, statusDurationMinutes, updateVesselStatus, validateShippingSettings } from "./shipping-rules"
import { createMockSnapshot, mockEvents, mockVessels } from "./shipping-fixtures"

describe("Shipping HOT deterministic rules", () => {
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

  it("preserves voyage baselines while refreshing latest ETA and delay", () => {
    const voyage = createMockSnapshot().voyages[0]
    const refreshed = mergeProviderVoyage(voyage, { ...voyage, baselineEta: "2099-01-01T00:00:00.000Z", latestEta: "2026-01-01T04:00:00.000Z" })
    expect(refreshed.baselineEta).toBe(voyage.baselineEta)
    expect(refreshed.latestEta).toBe("2026-01-01T04:00:00.000Z")
    expect(refreshed.delayMinutes).toBe(calculateDelayMinutes(voyage.baselineEta, "2026-01-01T04:00:00.000Z"))
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
})
