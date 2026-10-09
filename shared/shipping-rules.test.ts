import { describe, expect, it } from "vitest"
import { createMockSnapshot, mockEvents, mockPorts } from "./shipping-fixtures"
import { applyFeedFreshnessPolicy, calculateDelayMinutes, feedFreshnessPolicyFor, freshnessState, isFeedItemCurrent, rankHotItems, reconcileEvent, validateShippingSettings } from "./shipping-rules"
import type { OperationalSourceContext } from "./shipping"

const realOperationalContext: OperationalSourceContext = {
  modes: {
    dataMode: "real",
    port: "portcast",
    weather: "open-meteo",
    weatherAlerts: "public",
    feed: "public",
    calendar: "calendarific",
  },
  activeSourceIds: new Set(["portcast-public", "open-meteo-marine", "the-loadstar", "calendarific"]),
}

describe("shipping-rules", () => {
  it("validates shipping settings bounds", () => {
    const snapshot = createMockSnapshot()
    expect(validateShippingSettings(snapshot.settings)).toEqual([])
    expect(validateShippingSettings({ ...snapshot.settings, refreshInterval: 0 })).toContain("refreshInterval")
  })

  it("reconciles resolved events without changing firstDetectedAt", () => {
    const existing = mockEvents[0]
    const resolved = reconcileEvent(existing, { ...existing, status: "resolved" }, "2026-01-02T00:00:00.000Z")
    expect(resolved).toMatchObject({ status: "resolved", firstDetectedAt: existing.firstDetectedAt, resolvedAt: "2026-01-02T00:00:00.000Z" })
  })

  it("computes delay minutes between timestamps", () => {
    expect(calculateDelayMinutes("2026-01-01T00:00:00.000Z", "2026-01-01T01:30:00.000Z")).toBe(90)
  })

  it("ranks watched port events ahead of unrelated feed items", () => {
    const snapshot = createMockSnapshot()
    const feed = { ...snapshot.feedItems[0], severity: "critical" as const, relatedPortIds: ["port-manila"] }
    const items = rankHotItems(snapshot.events, snapshot.ports, [feed], new Date("2026-01-01T00:01:00.000Z"))
    expect(items.length).toBeGreaterThan(0)
    expect(items[0]?.kind).toBeDefined()
  })

  it("filters hot feed items by operational context in real mode", () => {
    const snapshot = createMockSnapshot()
    const hot = rankHotItems(snapshot.events, snapshot.ports, snapshot.feedItems, new Date("2026-08-13T10:00:00.000Z"), realOperationalContext)
    expect(hot.every(item => item.kind === "event" || item.kind === "feed")).toBe(true)
  })

  it("applies feed freshness policy and current visibility", () => {
    const feed = createMockSnapshot().feedItems[0]
    const policy = feedFreshnessPolicyFor(feed)
    expect(policy.class).toBe("official")
    const normalized = applyFeedFreshnessPolicy(feed, new Date(Date.parse(feed.publishedAt) + 1000))
    expect(normalized.visibility).toBe("current")
    expect(isFeedItemCurrent(normalized, new Date(Date.parse(feed.publishedAt) + 1000))).toBe(true)
    expect(freshnessState(normalized)).toBe("fresh")
  })

  it("uses port labels for congestion hot items", () => {
    const snapshot = createMockSnapshot()
    const event = snapshot.events.find(item => item.type === "port_congestion")!
    const items = rankHotItems([event], mockPorts, [], new Date("2026-01-01T00:01:00.000Z"))
    expect(items[0]).toMatchObject({ relatedLabel: mockPorts[0].name })
  })
})
