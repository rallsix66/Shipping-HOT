import { describe, expect, it } from "vitest"
import { createMockSnapshot } from "./shipping-fixtures"
import { detectShippingEvents, isCalendarOperationallyRelevant, isFreshEventEvidence } from "./shipping-engine"
import type { CalendarEvent } from "./calendar"

describe("shipping-engine", () => {
  it("detects port congestion and feed events from the mock snapshot", () => {
    const snapshot = createMockSnapshot()
    const events = detectShippingEvents(snapshot.ports, snapshot.feedItems, snapshot.settings, [], new Date().toISOString())
    expect(events.map(event => event.type)).toEqual(expect.arrayContaining(["port_congestion", "port_disruption"]))
  })

  it("reconciles active port events across runs", () => {
    const snapshot = createMockSnapshot()
    const first = detectShippingEvents(snapshot.ports, snapshot.feedItems, snapshot.settings, [], "2026-01-01T03:00:00.000Z")
    const medium = {
      ...snapshot,
      ports: snapshot.ports.map(port => port.id === "port-shekou" ? { ...port, congestionLevel: "medium" as const } : port),
    }
    const next = detectShippingEvents(medium.ports, medium.feedItems, medium.settings, first, "2026-01-01T04:00:00.000Z")
    expect(next.find(event => event.type === "port_congestion" && event.portId === "port-shekou")).toMatchObject({ status: "resolved" })
  })

  it("ignores stale ports for new congestion events", () => {
    const snapshot = createMockSnapshot()
    const stalePort = { ...snapshot.ports[0], stale: true, sourceStatus: "degraded" as const }
    expect(detectShippingEvents([stalePort], [], snapshot.settings, [], "2026-01-01T03:00:00.000Z")).toEqual([])
  })

  it("marks feed events as fresh evidence only when healthy", () => {
    const feed = { ...createMockSnapshot().feedItems[0], stale: true, sourceStatus: "failed" as const }
    expect(isFreshEventEvidence(feed)).toBe(false)
  })

  it("creates calendar reminder events for national holidays", () => {
    const snapshot = createMockSnapshot()
    const calendarEvent: CalendarEvent = {
      id: "calendar-th-2026-01-01",
      countryCode: "TH",
      date: "2026-01-01",
      name: "New Year",
      type: "public_holiday",
      isPublicHoliday: true,
      businessImpact: "high",
      sourceId: "mock-calendar",
      sourceKind: "mock",
      verified: false,
      updatedAt: "2026-08-15T00:00:00.000Z",
      lastCheckedAt: "2026-08-15T00:00:00.000Z",
      stale: false,
      sourceStatus: "healthy",
    }
    const events = detectShippingEvents([], [], snapshot.settings, [], "2025-12-20T00:00:00.000Z", [calendarEvent])
    expect(events.some(event => event.type === "calendar_reminder")).toBe(true)
    expect(isCalendarOperationallyRelevant(calendarEvent)).toBe(true)
  })
})
