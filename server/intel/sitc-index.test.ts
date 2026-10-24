import net from "node:net"
import dns from "node:dns/promises"
import { describe, expect, it, vi } from "vitest"
import { htmlIndexCandidates } from "./sources/html-index-candidates"
import { intelSourceSeeds } from "./sources"
import { assertSupportedConfig } from "./sources/config-keys"
import { allowed, fromHtml, parseLooseDate } from "./sources/web-list"
import { SITC_SYNTHETIC } from "./sources/__fixtures__/public-index-synthetic"
import { collectIntelSource, sourcePolicy } from "./collect"
import { open } from "./__fixtures__/isolated-db"
import { initShippingTables } from "#/database/shipping"
import { secureFetchArticle } from "#/services/article-fetch-security"

const seed = htmlIndexCandidates.find(s => s.catalogId === "XX-K03")!
const config = seed.webList!
const policy = sourcePolicy(seed)
const NOW = new Date("2026-10-15T06:32:48.737Z")

describe("explicit SITC metadata identity and source day", () => {
  it("is default-off, metadata-only and separate from active sources and fetch policy", () => {
    expect(seed).toMatchObject({ id: "intel:xx-k03", url: "https://www.sitc.com/en/list.asp?classid=44", enabled: false, persistence: "disallowed", allowedHosts: ["www.sitc.com"] })
    expect(intelSourceSeeds.some(s => s.catalogId === "XX-K03")).toBe(false)
    expect(policy.allowHttp).toBeUndefined()
    assertSupportedConfig(config)
  })
  it("preserves original HTTP protocol and business IDs while excluding navigation/image/details", () => {
    const entries = fromHtml(SITC_SYNTHETIC, seed.url, config, policy)
    expect(entries.map(e => [e.title, e.canonicalUrl])).toEqual([
      ["Synthetic SITC notice one", "http://www.sitc.com/en/show.asp?id=0001"],
      ["Synthetic SITC leap notice", "http://www.sitc.com/en/show.asp?id=0002"],
    ])
    expect(entries.every(e => e.bodyText === "" && e.publishedAt === undefined)).toBe(true)
    expect(entries[0].dateEvidence).toMatchObject({ raw: "发布日期: 2026.09.20", rule: "configured_sitc_publication_day", localDate: "2026-09-20", precision: "day", timezone: "missing", utcOffset: null, publishedAt: null })
    expect(entries[1].dateEvidence.localDate).toBe("2000-02-29")
  })
  it("still rejects HTTP without explicit rule, matching source ID and metadata-only permission", () => {
    const url = "http://www.sitc.com/en/show.asp?id=1"
    expect(allowed(url, { ...config, metadataLinkRule: undefined }, policy)).toBe(false)
    expect(allowed(url, config, { ...policy, sourceId: "another-source" })).toBe(false)
    for (const persistence of ["full", "excerpt_only"] as const) expect(allowed(url, config, { ...policy, persistence })).toBe(false)
    expect(allowed(url, config, { ...policy, allowedHosts: ["other.test"] })).toBe(false)
    expect(allowed(url, { ...config, allowUrlPrefixes: ["https://www.sitc.com/en/show.asp"] }, policy)).toBe(false)
  })
  it.each([
    "http://sitc.com/en/show.asp?id=1",
    "http://www.sitc.com.evil.test/en/show.asp?id=1",
    "http://other.test/en/show.asp?id=1",
    "http://www.sitc.com/en/other.asp?id=1",
    "http://www.sitc.com/en/show.asp/extra?id=1",
    "http://www.sitc.com/en/show.asp/?id=1",
    "http://user:pass@www.sitc.com/en/show.asp?id=1",
    "http://www.sitc.com:443/en/show.asp?id=1",
    "http://www.sitc.com:8080/en/show.asp?id=1",
    "https://www.sitc.com:80/en/show.asp?id=1",
    "https://www.sitc.com:9443/en/show.asp?id=1",
    "ftp://www.sitc.com/en/show.asp?id=1",
    "javascript:alert(1)",
    "http://www.sitc.com/en/show.asp",
    "http://www.sitc.com/en/show.asp?id=1&id=2",
    "http://www.sitc.com/en/show.asp?id=1&redirect=other",
    "http://www.sitc.com/en/show.asp?id=not-numeric",
  ])("rejects outside the fixed metadata identity %s", (url) => {
    expect(allowed(url, config, { ...policy, allowedHosts: ["www.sitc.com", "sitc.com", "other.test", "www.sitc.com.evil.test"] })).toBe(false)
    expect(() => fromHtml(SITC_SYNTHETIC.replaceAll(/http:\/\/www\.sitc\.com\/en\/show\.asp\?id=\d+/g, url), seed.url, config, policy)).toThrow(/web_list_/)
  })
  it("does not accept prefix/config overrides or a configured timezone for this day grammar", () => {
    for (const extra of [{ metadataLinkRule: "any_http" }, { allowUrlPrefixes: [] }, { denyUrlPrefixes: [] }, { publishedAtUtcOffset: "+08:00" }, { calendar: "buddhist" }]) expect(() => assertSupportedConfig({ ...config, ...extra })).toThrow()
    expect(parseLooseDate("发布日期: 2026.09.20", { ...config, dateFormat: undefined }).localDate).toBeNull()
    expect(parseLooseDate("发布日期: 2026.09.20", { ...config, publishedAtUtcOffset: "+08:00" })).toMatchObject({ localDate: "2026-09-20", timezone: "missing", utcOffset: null, publishedAt: null })
  })
  it.each(["发布日期: 2025.02.29", "发布日期: 1900.02.29", "发布日期: 2026.04.31", "发布日期: 2026.00.01", "发布日期: 2026.13.01", "发布日期: 2026.09.00", "发布日期: 2026.09.31", "发布日期: 2569.09.20", "发布日期: 2026.9.20", "发布日期：2026.09.20", "2026.09.20", "Published: 2026.09.20", "prefix 发布日期: 2026.09.20", "发布日期: 2026.09.20 trailing", "发布日期: 2026.09.20 10:00", "(发布日期: 2026.09.20)"])("keeps wrong date unknown %s", (raw) => {
    expect(parseLooseDate(raw, config)).toMatchObject({ raw, localDate: null, publishedAt: null, utcOffset: null, timezone: "missing", precision: "unknown" })
    const entries = fromHtml(SITC_SYNTHETIC.replace("发布日期:</span> 2026.09.20", `${raw}</span>`), seed.url, config, policy)
    expect(entries[0].dateEvidence.localDate).toBeNull()
    expect(entries[0].publishedAt).toBeUndefined()
  })
  it("never turns metadata permission into HTTP body access or HTTPS downgrade permission", async () => {
    const lookup = vi.fn(async () => [{ address: "93.184.216.34", family: 4 as const }])
    const transport = vi.fn(async () => ({ status: 302, headers: { location: "http://www.sitc.com/en/show.asp?id=1" }, body: new Uint8Array() }))
    expect(await secureFetchArticle("http://www.sitc.com/en/show.asp?id=1", { policy, lookup, transport })).toMatchObject({ ok: false, code: "http_not_allowed" })
    expect(lookup).not.toHaveBeenCalled()
    expect(transport).not.toHaveBeenCalled()
    expect(await secureFetchArticle(seed.url, { policy, lookup, transport })).toMatchObject({ ok: false, code: "https_downgrade" })
    expect(transport).toHaveBeenCalledTimes(1)
  })
  it("collects/repeats synthetic metadata with no detail fetch, network or body persistence", async () => {
    let tcp = 0
    let realDns = 0
    let fetch = 0
    const tcpGuard = vi.spyOn(net.Socket.prototype, "connect").mockImplementation(() => {
      tcp++
      throw new Error("network forbidden")
    })
    const dnsGuard = vi.spyOn(dns, "lookup").mockImplementation(async () => {
      realDns++
      throw new Error("DNS forbidden")
    })
    vi.stubGlobal("fetch", () => {
      fetch++
      throw new Error("fetch forbidden")
    })
    const state = open()
    const transport = vi.fn(async (url: URL) => {
      expect(url.href).toBe(seed.url)
      expect(url.protocol).toBe("https:")
      return { status: 200, headers: { "content-type": "text/html; charset=utf-8" }, body: new TextEncoder().encode(SITC_SYNTHETIC) }
    })
    try {
      await initShippingTables(state.database, "mock")
      await state.repository.upsertSource(seed, NOW.toISOString())
      const usage = state.native.prepare("SELECT * FROM provider_usage ORDER BY rowid").all()
      const deps = { lookup: async () => [{ address: "93.184.216.34", family: 4 as const }], transport }
      expect(await collectIntelSource(state.repository, seed, deps, NOW)).toMatchObject({ status: "ok_items", itemsSeen: 2, itemsNew: 2, itemsRevised: 0 })
      expect(await collectIntelSource(state.repository, seed, deps, new Date(NOW.getTime() + 1000))).toMatchObject({ status: "ok_items", itemsNew: 0, itemsRevised: 0 })
      expect(transport).toHaveBeenCalledTimes(2)
      const items = await state.repository.listItems(seed.id)
      expect(items).toHaveLength(2)
      for (const item of items) {
        expect(item.canonicalUrl).toMatch(/^http:\/\/www\.sitc\.com\/en\/show\.asp\?id=000[12]$/)
        expect(item.publishedAt).toBeNull()
        const versions = await state.repository.listVersions(item.id)
        expect(versions).toHaveLength(1)
        expect(versions[0]).toMatchObject({ contentScope: "metadata_only", sourcePublishedAt: null, dateEvidence: { timezone: "missing", publishedAt: null, utcOffset: null, precision: "day" } })
        expect(await state.repository.readVersionBlocks(versions[0].id)).toEqual([expect.objectContaining({ type: "title", text: item.title })])
      }
      expect(state.native.prepare("SELECT * FROM provider_usage ORDER BY rowid").all()).toEqual(usage)
      expect(tcp + realDns + fetch).toBe(0)
    } finally {
      state.native.close()
      tcpGuard.mockRestore()
      dnsGuard.mockRestore()
      vi.unstubAllGlobals()
    }
  })
})
