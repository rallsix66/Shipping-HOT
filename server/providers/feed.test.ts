import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { createMockSnapshot, mockPorts } from "@shared/shipping-fixtures"
import { detectShippingEvents } from "@shared/shipping-engine"
import { rankHotItems } from "@shared/shipping-rules"
import { FEED_FETCH_MAX_BYTES, type FeedFetchDeps, classifyFeedItem, createPublicFeedProvider, dedupeFeedItems, feedListFetchPolicy, filterFeedLastKnownForMode, parseFeedHtml, parseFeedRss, shippingFeedSources } from "./feed"
import type { ResolvedAddress } from "#/services/article-fetch-security"

const rssSource = shippingFeedSources.find(source => source.id === "the-loadstar")!
const officialSource = shippingFeedSources.find(source => source.id === "shekou-official")!

const PUBLIC_ADDRESS: ResolvedAddress = { address: "93.184.216.34", family: 4 }
const LOADSTAR_RSS = "<rss><channel><item><title>Loadstar update</title><link>https://theloadstar.com/story/1</link><pubDate>Tue, 18 Aug 2026 00:00:00 GMT</pubDate></item></channel></rss>"
interface Reply {
  status: number
  body?: string
  contentType?: string
  headers?: Record<string, string>
}
/** Offline Feed fetch: injected lookup/transport for secureFetchArticle; records hops; never opens a socket. */
function feedFetch(handler: (url: string, signal?: AbortSignal) => Reply | Promise<Reply>, resolve: (host: string) => ResolvedAddress[] = () => [PUBLIC_ADDRESS]) {
  const hops: string[] = []
  const lookups: string[] = []
  const deps: FeedFetchDeps = {
    lookup: async (host) => {
      lookups.push(host)
      return resolve(host)
    },
    transport: async (url, _addresses, options) => {
      hops.push(url.toString())
      const reply = await handler(url.toString(), options.signal)
      if (reply.body && reply.body.length > options.maxBytes) throw new Error("body_too_large")
      return { status: reply.status, headers: { "content-type": reply.contentType ?? (url.hostname.includes("portshekou") ? "text/html; charset=utf-8" : "application/rss+xml; charset=utf-8"), ...reply.headers }, body: reply.body ?? "" }
    },
  }
  return { deps, hops, lookups }
}
const rss = (body = LOADSTAR_RSS): Reply => ({ status: 200, body })
const never = (signal?: AbortSignal) => new Promise<never>((_, reject) => signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true }))

describe("shipping feed provider", () => {
  it("does not use Mock Feed records as public last-known data", async () => {
    const mock = { id: "mock-feed", sourceId: "mock-port-notice", category: "port_notice" as const, type: "port_notice", title: "Mock notice", summary: "Mock", sourceUrl: "https://example.com/mock", publishedAt: "2026-08-14T00:00:00.000Z", relatedPortIds: [], relatedVesselIds: [], severity: "warning" as const, stale: false, sourceStatus: "healthy" as const }
    expect(filterFeedLastKnownForMode([mock], "public")).toEqual([])
    const provider = createPublicFeedProvider({
      sources: [rssSource],
      fetch: feedFetch(() => {
        throw new Error("feed unavailable")
      }).deps,
    })
    expect(provider.providerId).toBe("the-loadstar")
    expect(await provider.getFeedItems([mock], mockPorts)).toEqual([])
  })

  it("does not schedule a failed-live source with the public Feed", async () => {
    const maritime = shippingFeedSources.find(source => source.id === "maritime-executive")!
    expect(maritime).toMatchObject({ enabled: false, status: "failed_live" })
    const net = feedFetch(() => rss())
    const provider = createPublicFeedProvider({ sources: [maritime, rssSource], fetch: net.deps })
    await provider.getFeedItems([], mockPorts)
    expect(net.hops).toEqual([rssSource.url])
  })

  it("times out one public source without delaying the other sources", async () => {
    const maritime = { ...shippingFeedSources.find(source => source.id === "maritime-executive")!, enabled: true, status: "enabled" as const }
    const [previous] = parseFeedRss(`<rss><channel><item><title>Maritime old warning</title><link>https://maritime-executive.com/story/old</link><pubDate>Tue, 18 Aug 2026 00:00:00 GMT</pubDate></item></channel></rss>`, maritime, mockPorts, "2026-08-18T00:00:00.000Z")
    let timeoutSignal: AbortSignal | undefined
    const provider = createPublicFeedProvider({
      sources: [maritime, rssSource],
      timeoutMs: 10,
      fetch: feedFetch((url, signal) => {
        if (url !== maritime.url) return rss()
        timeoutSignal = signal
        return never(signal)
      }).deps,
    })
    const items = await provider.getFeedItems([previous], mockPorts)
    expect(timeoutSignal).toBeDefined()
    expect(timeoutSignal?.aborted).toBe(true)
    expect(items.some(item => item.sourceId === rssSource.id)).toBe(true)
    expect(items.find(item => item.id === previous.id)).toMatchObject({ stale: true, sourceStatus: "failed", error: "The Maritime Executive request timed out after 10ms", errorCode: "provider_timeout" })
  })

  it("aborts a source whose response stalls and returns no placeholder without previous", async () => {
    let bodySignal: AbortSignal | undefined
    const provider = createPublicFeedProvider({
      sources: [rssSource],
      timeoutMs: 10,
      fetch: feedFetch((_url, signal) => {
        bodySignal = signal
        return never(signal)
      }).deps,
    })
    await expect(provider.getFeedItems([], mockPorts)).resolves.toEqual([])
    expect(bodySignal).toBeDefined()
    expect(bodySignal?.aborted).toBe(true)
  })

  it("can surface a source failure with no last-known item for isolated Runtime handling", async () => {
    const provider = createPublicFeedProvider({
      sources: [rssSource],
      throwOnSourceFailureWithoutLastKnown: true,
      fetch: feedFetch(() => {
        throw new Error("source unavailable")
      }).deps,
    })
    await expect(provider.getFeedItems([], mockPorts)).rejects.toThrow("source unavailable")
  })

  it("maps public-feed HTTP failures to the provider failure taxonomy", async () => {
    const cases: Array<[number, string]> = [
      [401, "auth_failed"],
      [403, "provider_forbidden"],
      [429, "rate_limited"],
      [503, "provider_unavailable"],
      [504, "provider_timeout"],
    ]
    for (const [status, code] of cases) {
      const provider = createPublicFeedProvider({
        sources: [rssSource],
        throwOnSourceFailureWithoutLastKnown: true,
        fetch: feedFetch(() => ({ status })).deps,
      })
      await expect(provider.getFeedItems([], mockPorts)).rejects.toMatchObject({ code })
    }
  })
})

describe("feed list requests go through article-fetch-security (offline lookup/transport)", () => {
  const previousItems = () => parseFeedRss(`<rss><channel><item><title>Port congestion update</title><link>https://theloadstar.com/story/old</link><pubDate>2026-08-14T00:00:00Z</pubDate></item></channel></rss>`, rssSource, mockPorts, "2026-08-14T00:00:00.000Z")
  const run = async (net: ReturnType<typeof feedFetch>, previous = previousItems(), timeoutMs?: number) => {
    const provider = createPublicFeedProvider({ sources: [rssSource], fetch: net.deps, timeoutMs, now: () => new Date("2026-08-15T00:00:00.000Z") })
    return provider.getFeedItems(previous, mockPorts)
  }
  const expectBlocked = (items: Awaited<ReturnType<typeof run>>, previous: ReturnType<typeof previousItems>, code: string, errorCode = "provider_unavailable") => {
    expect(items).toHaveLength(previous.length)
    expect(items[0]).toMatchObject({ id: previous[0]!.id, stale: true, sourceStatus: "failed", errorCode })
    expect(String(items[0]!.error)).toContain(code)
  }

  it("normal response: validated host, DNS checked, accept header for feeds, parsed by feed.ts", async () => {
    let accept: string | undefined
    const net = feedFetch(() => rss())
    const transport = net.deps.transport!
    net.deps.transport = async (url, addresses, options) => {
      accept = options.headers.accept
      expect(addresses).toEqual([PUBLIC_ADDRESS])
      expect(options.maxBytes).toBe(FEED_FETCH_MAX_BYTES)
      return transport(url, addresses, options)
    }
    const items = await run(net, [])
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ sourceId: rssSource.id, title: "Loadstar update" })
    expect(items[0]!.sourceStatus).not.toBe("failed")
    expect(net.lookups).toEqual(["theloadstar.com"])
    expect(accept).toContain("application/rss+xml")
    expect(feedListFetchPolicy(rssSource).allowedHosts).toEqual(["theloadstar.com"])
    expect(feedListFetchPolicy(officialSource)).toMatchObject({ allowedHosts: ["www.portshekou.com"], allowedContentTypes: ["text/html"] })
  })

  it("private network: a list host resolving to a private address is never requested", async () => {
    for (const address of ["10.0.0.5", "127.0.0.1", "169.254.169.254", "192.168.1.1"]) {
      const net = feedFetch(() => rss(), () => [{ address, family: 4 }])
      const previous = previousItems()
      expectBlocked(await run(net, previous), previous, "blocked_address")
      expect(net.hops).toEqual([])
    }
    const v6 = feedFetch(() => rss(), () => [PUBLIC_ADDRESS, { address: "::1", family: 6 }])
    expectBlocked(await run(v6, previousItems()), previousItems(), "blocked_address")
    expect(v6.hops).toEqual([])
  })

  it("redirect to a private network: the next hop is re-resolved and blocked before any request", async () => {
    const net = feedFetch(url => url === rssSource.url ? { status: 302, headers: { location: "https://theloadstar.com/internal-feed" } } : rss(), host => host === "theloadstar.com" && net.lookups.length > 1 ? [{ address: "10.1.2.3", family: 4 }] : [PUBLIC_ADDRESS])
    const previous = previousItems()
    expectBlocked(await run(net, previous), previous, "blocked_address")
    expect(net.hops).toEqual([rssSource.url])
    expect(net.lookups).toEqual(["theloadstar.com", "theloadstar.com"])
  })

  it("non-whitelisted host: a redirect to another host (even a subdomain) fails without a request", async () => {
    for (const location of ["https://evil.example/feed", "https://www.theloadstar.com/feed/", "https://cdn.theloadstar.com/feed/"]) {
      const net = feedFetch(url => url === rssSource.url ? { status: 301, headers: { location } } : rss())
      const previous = previousItems()
      expectBlocked(await run(net, previous), previous, "host_not_allowed")
      expect(net.hops).toEqual([rssSource.url])
    }
  })

  it("hTTPS downgrade: an https to http redirect is refused", async () => {
    const net = feedFetch(url => url === rssSource.url ? { status: 302, headers: { location: "http://theloadstar.com/feed/" } } : rss())
    const previous = previousItems()
    expectBlocked(await run(net, previous), previous, "https_downgrade")
    expect(net.hops).toEqual([rssSource.url])
  })

  it("oversized response: a body over the Feed limit is refused and last-known items are kept", async () => {
    const huge = `<rss><channel>${"<item><title>x</title></item>".repeat(Math.ceil(FEED_FETCH_MAX_BYTES / 26) + 10)}</channel></rss>`
    const net = feedFetch(() => rss(huge))
    const previous = previousItems()
    expectBlocked(await run(net, previous), previous, "body_too_large")
  })

  it("timeout: keeps the existing provider_timeout semantics and last-known items", async () => {
    const net = feedFetch((_url, signal) => never(signal))
    const previous = previousItems()
    const items = await run(net, previous, 10)
    expect(items[0]).toMatchObject({ id: previous[0]!.id, stale: true, sourceStatus: "failed", errorCode: "provider_timeout", error: "The Loadstar request timed out after 10ms" })
  })

  it("unexpected content type is a contract change, not parsed", async () => {
    const net = feedFetch(() => ({ status: 200, body: "{}", contentType: "application/json" }))
    const previous = previousItems()
    expectBlocked(await run(net, previous), previous, "content_type_unsupported", "provider_contract_changed")
  })

  it("feed.ts no longer exposes a plain fetcher option or a global fetch fallback", () => {
    const source = readFileSync("server/providers/feed.ts", "utf8")
    expect(source).not.toMatch(/globalThis\.fetch|\bfetcher\b|FeedFetcher/)
    expect(source).toContain("secureFetchArticle(source.url")
  })
})

describe("shipping feed parsing", () => {
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
    const events = detectShippingEvents([], [item], snapshot.settings, [], "2026-08-18T00:00:00.000Z")
    const event = events.find(candidate => candidate.feedItemId === item.id)
    expect(event).toMatchObject({ type: "port_notice", severity: "critical", status: "active" })
    expect(rankHotItems(events, [], [item], new Date("2026-08-18T00:00:00.000Z")).some(hot => hot.kind === "event" && hot.eventId === event?.id)).toBe(true)
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
      fetch: feedFetch(url => url.includes("loadstar")
        ? { status: 503 }
        : { status: 200, body: `<article><a href="/ywgg/notice">Routine terminal notice</a><time>2026-08-15</time></article>` }).deps,
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
