import { describe, expect, it } from "vitest"
import { detectShippingEvents } from "./shipping-engine"
import { createMockSnapshot } from "./shipping-fixtures"

describe("Shipping HOT event engine", () => {
  it("detects anchored, delay, congestion and feed signals", () => {
    const snapshot = createMockSnapshot()
    const events = detectShippingEvents(snapshot.vessels, snapshot.ports, snapshot.voyages, snapshot.feedItems, snapshot.settings, [], new Date().toISOString())
    expect(events.map(event => event.type)).toEqual(expect.arrayContaining(["vessel_anchored", "voyage_delay", "port_congestion", "port_disruption"]))
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
})
