import { describe, expect, it } from "vitest"
import { mockPorts } from "@shared/shipping-fixtures"
import { classifyFeedItem, createPublicFeedProvider, dedupeFeedItems, filterFeedLastKnownForMode, parseFeedHtml, parseFeedRss, shippingFeedSources } from "./feed"

const rssSource = shippingFeedSources.find(source => source.id === "the-loadstar")!
const officialSource = shippingFeedSources.find(source => source.id === "shekou-official")!

describe("shipping feed provider", () => {
  it("does not use Mock Feed records as public last-known data", async () => {
    const mock = { id: "mock-feed", sourceId: "mock-port-notice", category: "port_notice" as const, type: "port_notice", title: "Mock notice", summary: "Mock", sourceUrl: "https://example.com/mock", publishedAt: "2026-08-14T00:00:00.000Z", relatedPortIds: [], relatedVesselIds: [], relatedVoyageIds: [], severity: "warning" as const, stale: false, sourceStatus: "healthy" as const }
    expect(filterFeedLastKnownForMode([mock], "public")).toEqual([])
    const provider = createPublicFeedProvider({
      sources: [rssSource],
      fetcher: async () => {
        throw new Error("feed unavailable")
      },
    })
    expect(await provider.getFeedItems([mock], mockPorts)).toEqual([])
  })

  it("normalizes RSS entries and attaches source and port provenance", () => {
    const [item] = parseFeedRss(`
      <rss><channel>
        <item>
          <title>Shekou port congestion prompts blank sailing warning</title>
          <description><![CDATA[Operators warn of gate delay and congestion.]]></description>
          <link>https://theloadstar.com/story?id=1&amp;utm_source=feed</link>
          <pubDate>Fri, 14 Aug 2026 08:00:00 GMT</pubDate>
        </item>
      </channel></rss>
    `, rssSource, mockPorts, "2026-08-15T00:00:00.000Z")
    expect(item).toMatchObject({
      sourceId: "the-loadstar",
      category: "shipping_news",
      sourceUrl: "https://theloadstar.com/story?id=1",
      canonicalUrl: "https://theloadstar.com/story?id=1",
      publishedAt: "2026-08-14T08:00:00.000Z",
      severity: "warning",
      relatedPortIds: ["port-shekou"],
      provenance: { sourceType: "third_party", dataNature: "reported", sourceId: "the-loadstar" },
    })
  })

  it("parses official HTML notices without treating ordinary navigation links as news", () => {
    const items = parseFeedHtml(`
      <nav><a href="/">首页</a><a href="/contact">联系我们</a></nav>
      <ul><li><article><a href="/news/2026/08/14/gate-closure">Shekou terminal gate closure advisory</a><time>2026-08-14</time><p>Gate operations will suspend during maintenance.</p></article></li></ul>
    `, officialSource, mockPorts, "2026-08-15T00:00:00.000Z")
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({
      sourceId: "shekou-official",
      sourceUrl: "https://www.portshekou.com/news/2026/08/14/gate-closure",
      severity: "critical",
      hotReason: "官方港口高影响公告",
      provenance: { sourceType: "official", verified: true },
    })
  })

  it("deduplicates reposts and prefers an official source", () => {
    const [thirdParty] = parseFeedRss(`<rss><channel><item><title>Shekou terminal closure advisory</title><link>https://news.example.com/story</link><pubDate>2026-08-15T00:00:00Z</pubDate></item></channel></rss>`, rssSource, mockPorts, "2026-08-15T00:00:00.000Z")
    const [official] = parseFeedHtml(`<article><a href="https://www.portshekou.com/story">Shekou terminal closure advisory</a><time>2026-08-15</time></article>`, officialSource, mockPorts, "2026-08-15T00:00:00.000Z")
    const deduped = dedupeFeedItems([{ ...thirdParty, title: official.title }, official])
    expect(deduped).toHaveLength(1)
    expect(deduped[0].provenance?.sourceType).toBe("official")
  })

  it("isolates source failures and keeps last-known items stale", async () => {
    const [previous] = parseFeedRss(`<rss><channel><item><title>Port congestion update</title><link>https://theloadstar.com/story/old</link><pubDate>2026-08-14T00:00:00Z</pubDate></item></channel></rss>`, rssSource, mockPorts, "2026-08-14T00:00:00.000Z")
    const provider = createPublicFeedProvider({
      now: () => new Date("2026-08-15T00:00:00.000Z"),
      sources: [rssSource, { ...officialSource, enabled: true }],
      fetcher: async url => url.includes("loadstar")
        ? { ok: false, status: 503, text: async () => "" }
        : { ok: true, status: 200, text: async () => `<article><a href="/notice">Routine terminal notice</a><time>2026-08-15</time></article>` },
    })
    const items = await provider.getFeedItems([previous], mockPorts)
    expect(items.find(item => item.id === previous.id)).toMatchObject({ stale: true, sourceStatus: "failed", updatedAt: previous.updatedAt, publishedAt: previous.publishedAt })
    expect(items.some(item => item.sourceId === "shekou-official")).toBe(true)
  })

  it("keeps malformed or missing publication time unknown instead of using fetchedAt", () => {
    const [missing] = parseFeedRss(`<rss><channel><item><title>Port notice without a date</title><link>https://theloadstar.com/story/undated</link></item></channel></rss>`, rssSource, mockPorts, "2026-08-15T00:00:00.000Z")
    const [malformed] = parseFeedRss(`<rss><channel><item><title>Port notice with a malformed date</title><link>https://theloadstar.com/story/malformed</link><pubDate>not-a-date</pubDate></item></channel></rss>`, rssSource, mockPorts, "2026-08-15T00:00:00.000Z")
    expect(missing).toMatchObject({ publishedAt: "", publicationTimeKnown: false, eventEligibility: false })
    expect(malformed).toMatchObject({ publishedAt: "", publicationTimeKnown: false, eventEligibility: false })
    expect(missing.updatedAt).toBeUndefined()
    expect(dedupeFeedItems([missing, malformed]).at(0)?.publishedAt).toBe("")
  })

  it("classifies Chinese operational terms without English word-boundary matching", () => {
    expect(classifyFeedItem("蛇口港因台风临时封港", "", officialSource, mockPorts).severity).toBe("critical")
    expect(classifyFeedItem("盐田港部分闸口暂停作业", "", officialSource, mockPorts).severity).toBe("warning")
    expect(classifyFeedItem("港区当前出现严重拥堵", "", officialSource, mockPorts).severity).toBe("warning")
    expect(["warning", "watch"]).toContain(classifyFeedItem("预计部分航次延误", "", officialSource, mockPorts).severity)
    expect(classifyFeedItem("今日港口举行安全培训", "", officialSource, mockPorts).severity).toBe("info")
  })
})
