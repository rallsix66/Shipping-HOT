import { describe, expect, it } from "vitest"
import { type ShippingFeedSource, parseFeedEntries, parseFeedRss } from "#/providers/feed"

// R2 first slice: feed.ts is the single RSS/Atom/RDF parser. Gaps found against AIHOT@44578fa rss.ts:
// RDF root, Atom multi-link (rel=alternate), dc:date, content:encoded.
const ATOM = `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><title>t</title>
<entry><title>Atom entry</title><link rel="self" href="https://example.org/self/1"/><link rel="alternate" href="https://example.org/a/1?utm_source=x"/>
<id>tag:example.org,2026:1</id><updated>2026-10-11T02:00:00Z</updated><published>2026-10-11T01:00:00Z</published><content type="html">&lt;p&gt;Body&lt;/p&gt;</content></entry></feed>`
const RDF = `<?xml version="1.0"?><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns="http://purl.org/rss/1.0/" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:content="http://purl.org/rss/1.0/modules/content/">
<channel rdf:about="https://example.org/"><title>t</title></channel>
<item rdf:about="https://example.org/r/1"><title>RDF entry</title><link>https://example.org/r/1</link><dc:date>2026-10-10T03:00:00+07:00</dc:date><description>short</description><content:encoded>&lt;p&gt;Full RDF body&lt;/p&gt;</content:encoded></item></rdf:RDF>`
const RSS = `<?xml version="1.0"?><rss version="2.0"><channel><title>t</title><item><title>RSS entry</title><link>https://example.org/s/1</link><pubDate>Sat, 10 Oct 2026 12:32:29 +0700</pubDate><description>d</description></item></channel></rss>`

const source: ShippingFeedSource = { id: "test", name: "test", url: "https://example.org/feed", sourceUrl: "https://example.org/", format: "rss", sourceKind: "official", category: "port_notice", enabled: true }

describe("feed.ts single parser: RSS / Atom / RDF", () => {
  it.each([
    ["rss", RSS, "RSS entry", "https://example.org/s/1", "2026-10-10T05:32:29.000Z"],
    ["atom", ATOM, "Atom entry", "https://example.org/a/1", "2026-10-11T01:00:00.000Z"],
    ["rdf", RDF, "RDF entry", "https://example.org/r/1", "2026-10-09T20:00:00.000Z"],
  ])("%s", (format, xml, title, url, publishedAt) => {
    const parsed = parseFeedEntries(xml, "https://example.org/feed")
    expect(parsed.format).toBe(format)
    expect(parsed.entries[0]).toMatchObject({ title, url, canonicalUrl: url, publishedAt })
  })

  it("prefers content:encoded / Atom content for the body text", () => {
    expect(parseFeedEntries(RDF, "https://example.org/feed").entries[0].bodyText).toBe("Full RDF body")
    expect(parseFeedEntries(ATOM, "https://example.org/feed").entries[0].bodyText).toBe("Body")
  })

  it("existing parseFeedRss call site now also accepts RDF and Atom alternate links", () => {
    expect(parseFeedRss(RDF, source)[0]).toMatchObject({ title: "RDF entry", canonicalUrl: "https://example.org/r/1" })
    expect(parseFeedRss(ATOM, source)[0]).toMatchObject({ title: "Atom entry", canonicalUrl: "https://example.org/a/1" })
  })

  it("still rejects a document that is not a feed", () => {
    expect(() => parseFeedEntries("<html></html>", "https://example.org/feed")).toThrow()
  })
})
