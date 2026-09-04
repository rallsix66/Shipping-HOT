import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createMockSnapshot } from "@shared/shipping-fixtures"
import type { HotItem } from "@shared/shipping"

const rankHotItems = vi.fn()
const getShippingSnapshot = vi.fn()
const mapFeedItemsForDisplay = vi.fn()
const calendarAttribution = vi.fn()

async function loadHandler() {
  vi.doMock("@shared/shipping-rules", () => ({ rankHotItems }))
  vi.doMock("#/shipping-store", () => ({ getShippingSnapshot }))
  vi.doMock("#/services/feed-translation-display", async () => {
    const actual = await vi.importActual<typeof import("#/services/feed-translation-display")>("#/services/feed-translation-display")
    return { ...actual, mapFeedItemsForDisplay }
  })
  vi.doMock("#/providers/shipping", () => ({
    operationalSourceContext: { modes: { dataMode: "mock" }, activeSourceIds: new Set() },
    providerModes: {},
    realProviders: {},
  }))
  vi.doMock("#/providers/calendar", () => ({ calendarAttribution }))
  vi.stubGlobal("defineEventHandler", (handler: unknown) => handler)
  vi.stubGlobal("useDatabase", () => ({ database: "read-only-test" }))
  const module = await import("./index.get")
  return module.default as unknown as () => Promise<Record<string, unknown>>
}

function hot(kind: HotItem["kind"], id: string, title: string, summary: string): HotItem {
  return {
    id,
    kind,
    title,
    summary,
    severity: kind === "event" ? "critical" : "warning",
    freshness: "fresh",
    sourceStatus: "healthy",
    occurredAt: "2026-09-04T00:00:00.000Z",
    ...(kind === "event" ? { eventId: id } : { feedItemId: "feed-hot" }),
  }
}

describe("/api/shipping Home HOT display boundary", () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    calendarAttribution.mockReturnValue(undefined)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.doUnmock("@shared/shipping-rules")
    vi.doUnmock("#/shipping-store")
    vi.doUnmock("#/services/feed-translation-display")
    vi.doUnmock("#/providers/shipping")
    vi.doUnmock("#/providers/calendar")
    vi.resetModules()
  })

  it("uses cached Feed display text for Feed HOT while keeping Event HOT original", async () => {
    const snapshot = createMockSnapshot()
    const feed = { ...snapshot.feedItems[0], id: "feed-hot", title: "English feed title", summary: "English feed summary" }
    const displayFeed = { ...feed, displayTitle: "中文 Feed 标题", displaySummary: "中文 Feed 摘要", translation: { title: "translated" as const, summary: "translated" as const } }
    const originalHot = [
      hot("feed", "hot-feed", feed.title, feed.summary),
      hot("event", "hot-event", "事件原文标题", "事件原文摘要"),
    ]
    const apiSnapshot = { ...snapshot, events: [], feedItems: [feed], calendarEvents: [] }
    getShippingSnapshot.mockResolvedValue(apiSnapshot)
    rankHotItems.mockReturnValue(originalHot)
    mapFeedItemsForDisplay.mockResolvedValue([displayFeed])

    const handler = await loadHandler()
    const result = await handler()

    expect(rankHotItems).toHaveBeenCalledWith(apiSnapshot.events, apiSnapshot.ports, apiSnapshot.vessels, apiSnapshot.voyages, apiSnapshot.feedItems, expect.any(Date), expect.anything())
    expect(mapFeedItemsForDisplay).toHaveBeenCalledTimes(1)
    expect(mapFeedItemsForDisplay).toHaveBeenCalledWith(expect.anything(), apiSnapshot.feedItems, apiSnapshot.settings.translation)
    expect(result.hot).toEqual([
      { ...originalHot[0], title: "中文 Feed 标题", summary: "中文 Feed 摘要" },
      originalHot[1],
    ])
    expect(result.feedItems).toEqual([displayFeed])
  })

  it("keeps original-fact HOT order and severity after display enrichment", async () => {
    const snapshot = createMockSnapshot()
    const feed = { ...snapshot.feedItems[0], id: "feed-hot", title: "Original", summary: "Original summary" }
    const first = hot("feed", "hot-first", feed.title, feed.summary)
    const second = { ...hot("feed", "hot-second", "Second", "Second summary"), severity: "critical" as const }
    const apiSnapshot = { ...snapshot, events: [], feedItems: [feed], calendarEvents: [] }
    getShippingSnapshot.mockResolvedValue(apiSnapshot)
    rankHotItems.mockReturnValue([second, first])
    mapFeedItemsForDisplay.mockResolvedValue([{ ...feed, displayTitle: "短中文", displaySummary: "短摘要", translation: { title: "translated" as const, summary: "translated" as const } }])

    const handler = await loadHandler()
    const result = await handler()

    expect((result.hot as HotItem[]).map(item => item.id)).toEqual(["hot-second", "hot-first"])
    expect((result.hot as HotItem[]).map(item => item.severity)).toEqual(["critical", "warning"])
  })
})
