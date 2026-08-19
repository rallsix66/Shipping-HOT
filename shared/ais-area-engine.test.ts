import { describe, expect, it } from "vitest"
import { createMockSnapshot, mockPorts } from "./shipping-fixtures"
import type { AisDerivedPortMetric } from "./ais-area"
import { filterEventsForOperationalContext, sourceAllowedForProviderModes } from "./shipping"
import { detectShippingEvents } from "./shipping-engine"
import { rankHotItems } from "./shipping-rules"

function metric(overrides: Partial<AisDerivedPortMetric> = {}): AisDerivedPortMetric {
  return {
    portId: "port-shekou",
    sampleSize: 5,
    activeVesselCount: 5,
    anchoredCount: 4,
    mooredCount: 0,
    lowSpeedCount: 4,
    stationaryRatio: 0.8,
    ambiguousSampleCount: 0,
    trend: "rising",
    consecutiveRisingWindows: 3,
    observationWindow: { startAt: "2026-08-19T00:00:00.000Z", endAt: "2026-08-19T00:10:00.000Z" },
    bbox: { south: 22, west: 113, north: 23, east: 114 },
    boundarySource: "configured_heuristic",
    coverage: "usable",
    lowSpeedThresholdKnots: 1,
    minimumSampleSize: 5,
    updatedAt: "2026-08-19T00:10:00.000Z",
    sourceUpdatedAt: "2026-08-19T00:10:00.000Z",
    fetchedAt: "2026-08-19T00:11:00.000Z",
    stale: false,
    sourceStatus: "healthy",
    provenance: { sourceType: "third_party", dataNature: "derived", sourceId: "aisstream-area" },
    trendProvenance: { sourceType: "third_party", dataNature: "estimated", sourceId: "aisstream-area" },
    ...overrides,
  }
}

describe("aIS area Event and HOT boundary", () => {
  const settings = createMockSnapshot().settings
  const context = { modes: { vessel: "aisstream", port: "portcast", aisArea: "aisstream" as const }, activeSourceIds: new Set(["aisstream-area", "portcast-public"]) }

  it("requires usable sample, watched port and three rising windows", () => {
    const port = { ...mockPorts[0], provenance: { sourceType: "third_party" as const, dataNature: "derived" as const, sourceId: "portcast-public" } }
    const event = detectShippingEvents([], [port], [], [], settings, [], "2026-08-19T00:11:00.000Z", [], [metric()])
    expect(event).toEqual(expect.arrayContaining([expect.objectContaining({ type: "ais_port_congestion_trend", severity: "warning", portId: port.id, provenance: expect.objectContaining({ dataNature: "estimated", sourceId: "aisstream-area" }) })]))
    const hot = rankHotItems(event, [port], [], [], [], new Date("2026-08-19T00:11:00.000Z"), context)
    expect(hot).toEqual(expect.arrayContaining([expect.objectContaining({ eventId: event.find(item => item.type === "ais_port_congestion_trend")?.id, severity: "warning" })]))

    const insufficient = detectShippingEvents([], [port], [], [], settings, [], "2026-08-19T00:11:00.000Z", [], [metric({ coverage: "insufficient_samples", sampleSize: 4, consecutiveRisingWindows: 9 })])
    expect(insufficient.some(item => item.type === "ais_port_congestion_trend")).toBe(false)
  })

  it("keeps a same-source active Event stale on area failure without resolving it", () => {
    const port = { ...mockPorts[0], provenance: { sourceType: "third_party" as const, dataNature: "derived" as const, sourceId: "portcast-public" } }
    const first = detectShippingEvents([], [port], [], [], settings, [], "2026-08-19T00:11:00.000Z", [], [metric()])
    const stale = detectShippingEvents([], [port], [], [], settings, first, "2026-08-19T00:20:00.000Z", [], [metric({ stale: true, sourceStatus: "failed", coverage: "stale", error: "AIS area timeout" })])
    expect(stale.find(item => item.type === "ais_port_congestion_trend")).toMatchObject({ status: "active", stale: true, sourceStatus: "failed", error: "AIS area timeout" })
  })

  it("removes area history from the current view when the mode is off", () => {
    const event = detectShippingEvents([], [mockPorts[0]], [], [], settings, [], "2026-08-19T00:11:00.000Z", [], [metric()])
    expect(sourceAllowedForProviderModes("aisstream-area", { aisArea: "aisstream" })).toBe(true)
    expect(sourceAllowedForProviderModes("aisstream-area", { aisArea: "off" })).toBe(false)
    expect(filterEventsForOperationalContext(event, { modes: { aisArea: "off" }, activeSourceIds: new Set() })).toEqual([])
  })

  it("does not put an area Event in HOT when its current watched port entity is absent", () => {
    const event = detectShippingEvents([], [mockPorts[0]], [], [], settings, [], "2026-08-19T00:11:00.000Z", [], [metric()])
    expect(rankHotItems(event, [], [], [], [], new Date("2026-08-19T00:11:00.000Z"), context)).toEqual([])
  })
})
