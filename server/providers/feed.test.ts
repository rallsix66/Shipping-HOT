import { describe, expect, it } from "vitest"
import { createMockSnapshot, mockPorts } from "@shared/shipping-fixtures"
import { detectShippingEvents } from "@shared/shipping-engine"
import { rankHotItems } from "@shared/shipping-rules"
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

  it("does not schedule a failed-live source with the public Feed", async () => {
    const maritime = shippingFeedSources.find(source => source.id === "maritime-executive")!
    expect(maritime).toMatchObject({ enabled: false, status: "failed_live" })
    const requested: string[] = []
    const provider = createPublicFeedProvider({
      sources: [maritime, rssSource],
      fetcher: async (url) => {
        requested.push(url)
        return { ok: true, status: 200, text: async () => "<rss><channel><item><title>Loadstar update</title><link>https://theloadstar.com/story/1</link><pubDate>Tue, 18 Aug 2026 00:00:00 GMT</pubDate></item></channel></rss>" }
      },
    })
    await provider.getFeedItems([], mockPorts)
    expect(requested).toEqual([rssSource.url])
  })

  it("times out one public source without delaying the other sources", async () => {
    const maritime = { ...shippingFeedSources.find(source => source.id === "maritime-executive")!, enabled: true, status: "enabled" as const }
    const [previous] = parseFeedRss(`<rss><channel><item><title>Maritime old warning</title><link>https://maritime-executive.com/story/old</link><pubDate>Tue, 18 Aug 2026 00:00:00 GMT</pubDate></item></channel></rss>`, maritime, mockPorts, "2026-08-18T00:00:00.000Z")
    let timeoutSignal: AbortSignal | undefined
    const provider = createPublicFeedProvider({
      sources: [maritime, rssSource],
      timeoutMs: 10,
      fetcher: async (url, init) => url === maritime.url
        ? new Promise<never>((_, reject) => {
          timeoutSignal = init?.signal
          init?.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true })
        })
        : { ok: true, status: 200, text: async () => "<rss><channel><item><title>Loadstar update</title><link>https://theloadstar.com/story/1</link><pubDate>Tue, 18 Aug 2026 00:00:00 GMT</pubDate></item></channel></rss>" },
    })
    const items = await provider.getFeedItems([previous], mockPorts)
    expect(timeoutSignal).toBeDefined()
    expect(timeoutSignal?.aborted).toBe(true)
    expect(items.some(item => item.sourceId === rssSource.id)).toBe(true)
    expect(items.find(item => item.id === previous.id)).toMatchObject({ stale: true, sourceStatus: "failed", error: "The Maritime Executive request timed out after 10ms" })
  })

  it("aborts a source whose response body stalls and returns no placeholder without previous", async () => {
    let bodySignal: AbortSignal | undefined
    const provider = createPublicFeedProvider({
      sources: [rssSource],
      timeoutMs: 10,
      fetcher: async (_url, init) => {
        bodySignal = init?.signal
        return { ok: true, status: 200, text: () => new Promise<string>((_, reject) => init?.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true })) }
      },
    })
    await expect(provider.getFeedItems([], mockPorts)).resolves.toEqual([])
    expect(bodySignal).toBeDefined()
    expect(bodySignal?.aborted).toBe(true)
  })

  it("can surface a source failure with no last-known item for isolated Runtime handling", async () => {
    const provider = createPublicFeedProvider({
      sources: [rssSource],
      throwOnSourceFailureWithoutLastKnown: true,
      fetcher: async () => {
        throw new Error("source unavailable")
      },
    })
    await expect(provider.getFeedItems([], mockPorts)).rejects.toThrow("source unavailable")
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
      <ul><li><article><a href="/ywgg/2026/08/14/gate-closure">Shekou terminal gate closure advisory</a><time>2026-08-14</time><p>Gate operations will suspend during maintenance.</p></article></li></ul>
    `, officialSource, mockPorts, "2026-08-15T00:00:00.000Z")
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({
      sourceId: "shekou-official",
      sourceUrl: "https://www.portshekou.com/ywgg/2026/08/14/gate-closure",
      severity: "critical",
      hotReason: "官方港口高影响公告",
      provenance: { sourceType: "official", verified: true },
    })
  })

  it("uses the Shekou /ywgg/ selector and excludes company, navigation, and footer noise", () => {
    const items = parseFeedHtml(`
      <nav><a href="/ywgg/">业务公告</a><a href="/gsxw/company-news">Company news headline</a></nav>
      <main class="news-list">
        <ul><li class="news-item"><a href="/ywgg/2026/08/16/gate-closure">Shekou terminal gate closure advisory</a><span>2026-08-16</span></li></ul>
      </main>
      <footer><a href="/ywgg/contact">联系我们与网站导航</a></footer>
    `, officialSource, mockPorts, "2026-08-18T00:00:00.000Z")
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({
      sourceUrl: "https://www.portshekou.com/ywgg/2026/08/16/gate-closure",
      publishedAt: "2026-08-16T00:00:00.000Z",
      publicationTimeKnown: true,
      eventEligibility: true,
      severity: "critical",
      relatedPortIds: ["port-shekou"],
    })
    expect(items.some(item => item.title.includes("Company"))).toBe(false)
  })

  it("keeps Shekou notices with unknown dates out of event eligibility", () => {
    const [item] = parseFeedHtml(`<section><a href="/ywgg/notice-without-date">Shekou terminal operational advisory</a></section>`, officialSource, mockPorts, "2026-08-18T00:00:00.000Z")
    expect(item).toMatchObject({ publishedAt: "", publicationTimeKnown: false, eventEligibility: false, fetchedAt: "2026-08-18T00:00:00.000Z" })
    expect(item.updatedAt).toBeUndefined()
  })

  it("carries a dated Shekou operational warning through Event and HOT", () => {
    const [item] = parseFeedHtml(`<article><a href="/ywgg/2026/08/16/gate-closure">Shekou terminal gate closure advisory</a><time>2026-08-16</time></article>`, officialSource, mockPorts, "2026-08-18T00:00:00.000Z")
    const snapshot = createMockSnapshot()
    const events = detectShippingEvents([], [], [], [item], snapshot.settings, [], "2026-08-18T00:00:00.000Z")
    const event = events.find(candidate => candidate.feedItemId === item.id)
    expect(event).toMatchObject({ type: "port_notice", severity: "critical", status: "active" })
    expect(rankHotItems(events, [], [], [], [item]).some(hot => hot.kind === "event" && hot.eventId === event?.id)).toBe(true)
  })

  it("deduplicates reposts and prefers an official source", () => {
    const [thirdParty] = parseFeedRss(`<rss><channel><item><title>Shekou terminal closure advisory</title><link>https://news.example.com/story</link><pubDate>2026-08-15T00:00:00Z</pubDate></item></channel></rss>`, rssSource, mockPorts, "2026-08-15T00:00:00.000Z")
    const [official] = parseFeedHtml(`<article><a href="https://www.portshekou.com/ywgg/story">Shekou terminal closure advisory</a><time>2026-08-15</time></article>`, officialSource, mockPorts, "2026-08-15T00:00:00.000Z")
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
        : { ok: true, status: 200, text: async () => `<article><a href="/ywgg/notice">Routine terminal notice</a><time>2026-08-15</time></article>` },
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
