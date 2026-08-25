import { describe, expect, it } from "vitest"
import { createMockSnapshot } from "./shipping-fixtures"
import { detectShippingEvents } from "./shipping-engine"
import { rankHotItems } from "./shipping-rules"

describe("shipping feed HOT boundary", () => {
  it("surfaces explicit operational impact with one feed dedupe key and reason", () => {
    const snapshot = createMockSnapshot()
    const feed = { ...snapshot.feedItems[0], severity: "warning" as const, hotReason: "官方运营公告", publishedAt: "2026-08-14T00:00:00.000Z", stale: false, sourceStatus: "healthy" as const }
    const events = detectShippingEvents([], [], [], [feed], snapshot.settings, [], "2026-08-15T00:00:00.000Z")
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ dedupeKey: `feed:${feed.id}`, feedItemId: feed.id, evidenceJson: { category: feed.category, hotReason: "官方运营公告" } })
    expect(rankHotItems([], [], [], [], [feed])[0]).toMatchObject({ kind: "feed", feedItemId: feed.id, hotReason: "官方运营公告" })
  })

  it("does not create a HOT event from stale feed evidence", () => {
    const snapshot = createMockSnapshot()
    const feed = { ...snapshot.feedItems[0], severity: "critical" as const, stale: true, sourceStatus: "failed" as const }
    expect(detectShippingEvents([], [], [], [feed], snapshot.settings, [], "2026-08-15T00:00:00.000Z")).toEqual([])
  })
})
