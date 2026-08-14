import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { detectShippingEvents } from "./shipping-engine"
import { createMockSnapshot } from "./shipping-fixtures"

describe("Shipping HOT event engine", () => {
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
    const firstAnchored = first.find(event => event.dedupeKey === "vessel_anchored:vessel-ever-glory")!
    const secondAnchored = second.find(event => event.dedupeKey === "vessel_anchored:vessel-ever-glory")!
    expect(secondAnchored.id).toBe(firstAnchored.id)
    expect(secondAnchored.firstDetectedAt).toBe(firstAnchored.firstDetectedAt)
  })

  it("reconciles active, resolved and reopened events", () => {
    const snapshot = createMockSnapshot()
    const now = "2026-01-01T03:00:00.000Z"
    const first = detectShippingEvents(snapshot.vessels, snapshot.ports, snapshot.voyages, snapshot.feedItems, snapshot.settings, [], now)
    const withoutAnchored = { ...snapshot, vessels: snapshot.vessels.map(v => v.id === "vessel-ever-glory" ? { ...v, navigationStatus: "under_way" as const } : v) }
    const resolved = detectShippingEvents(withoutAnchored.vessels, withoutAnchored.ports, withoutAnchored.voyages, withoutAnchored.feedItems, withoutAnchored.settings, first, "2026-01-01T04:00:00.000Z")
    const resolvedAnchored = resolved.find(event => event.dedupeKey === "vessel_anchored:vessel-ever-glory")!
    expect(resolvedAnchored.status).toBe("resolved")
    expect(resolvedAnchored.resolvedAt).toBe("2026-01-01T04:00:00.000Z")
    const reopened = detectShippingEvents(snapshot.vessels, snapshot.ports, snapshot.voyages, snapshot.feedItems, snapshot.settings, resolved, "2026-01-01T05:00:00.000Z")
    const reopenedAnchored = reopened.find(event => event.dedupeKey === "vessel_anchored:vessel-ever-glory")!
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
    const anchored = next.find(event => event.dedupeKey === "vessel_anchored:vessel-ever-glory")!
    expect(anchored.severity).toBe("critical")
    expect(anchored.evidenceJson).toMatchObject({ durationMinutes: 480 })
  })

  it("uses congestion levels at or above the configured threshold", () => {
    const snapshot = createMockSnapshot()
    const medium = { ...snapshot, settings: { ...snapshot.settings, eventThresholds: { ...snapshot.settings.eventThresholds, congestionLevel: "medium" as const } } }
    const events = detectShippingEvents(medium.vessels, medium.ports, medium.voyages, medium.feedItems, medium.settings, [], "2026-01-01T03:00:00.000Z")
    expect(events.filter(event => event.type === "port_congestion").map(event => event.portId)).toEqual(expect.arrayContaining(["port-shekou", "port-yantian"]))
  })
})
