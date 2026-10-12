// Adapted behaviours from AIHOT@44578fa tests/web-list-date.test.ts and tests/sources.test.ts (MIT).
// Strict date semantics deliberately replace upstream midnight/default-offset/Date.parse guesses.
import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import type { ArticleSourcePolicy } from "@shared/article"
import { type WebListConfig, assertSupportedConfig } from "./config-keys"
import { allowed, fromHtml, parseLooseDate } from "./web-list"
import { secureFetchArticle } from "#/services/article-fetch-security"

const config: WebListConfig = { listSelector: "#notices", itemSelector: "li", linkSelector: "a", publishedAtSelector: "time", dateOrder: "dmy", publishedAtUtcOffset: "+07:00", dateRuleBasis: "Synthetic fixture rule: D/M/Y and configured UTC+07; not a live-source validation" }
const base = "https://www.nchmf.gov.vn/list"
const policy: ArticleSourcePolicy = { sourceId: "test", status: "allowed", fetchAllowed: true, persistence: "disallowed", allowedHosts: ["www.nchmf.gov.vn"], allowedContentTypes: ["text/html"] }
const html = readFileSync("server/intel/sources/__fixtures__/web-list-dates.html", "utf8")

describe("web_list dates adapted from upstream", () => {
  it.each(["2026-09-26 10:00", "2026-09-26T10:00:00", "2026/09/26 10:00", "2026年9月26日 10:00"])("dates %s using explicit source configuration, not the host clock", (raw) => {
    expect(parseLooseDate(raw, { ...config, publishedAtUtcOffset: "+08:00" })).toMatchObject({ publishedAt: "2026-09-26T02:00:00.000Z", timezone: "configured", raw, basis: config.dateRuleBasis })
    expect(parseLooseDate(raw, { ...config, publishedAtUtcOffset: "-07:00" }).publishedAt).toBe("2026-09-26T17:00:00.000Z")
  })
  it("keeps explicit offsets and milliseconds", () => {
    expect(parseLooseDate("2026-09-26T10:00:00Z", config)).toMatchObject({ publishedAt: "2026-09-26T10:00:00.000Z", timezone: "explicit" })
    expect(parseLooseDate("2026-09-26T10:00:00.123+09:00", config).publishedAt).toBe("2026-09-26T01:00:00.123Z")
  })
  it("preserves date-only precision and missing timezone without inventing an instant", () => {
    for (const raw of ["2026-09-26", "2026/09/26", "2026年9月26日"]) expect(parseLooseDate(raw, config)).toMatchObject({ localDate: "2026-09-26", precision: "day", publishedAt: null })
    expect(parseLooseDate("2026-09-26 10:00", { ...config, publishedAtUtcOffset: undefined })).toMatchObject({ precision: "minute", timezone: "missing", publishedAt: null })
  })
  it("requires an explicit D/M order and Buddhist marker or calendar configuration", () => {
    expect(parseLooseDate("12/10/2026 09:30", { ...config, dateOrder: undefined })).toMatchObject({ publishedAt: null, rule: "date_order_missing" })
    expect(parseLooseDate("12/10/2569 09:30", { ...config, calendar: "buddhist" })).toMatchObject({ publishedAt: "2026-10-12T02:30:00.000Z", calendar: "buddhist" })
    expect(parseLooseDate("2569/10/12 09:30", config).publishedAt).toBeNull()
  })
  it.each(["", "yesterday", "Sept 26th, 2026", "Published 2026-10-12", "2026-02-30", "2025-02-29", "2026-13-01", "2026-10-12T24:00Z", "2026-10-12T09:61Z", "2026-10-12T09:30+14:01", "2026-10-12 unexpected"])("does not guess %s", raw => expect(parseLooseDate(raw, config).publishedAt).toBeNull())
})

describe("web_list HTML and config boundaries", () => {
  it("accepts bytes decoded by the existing secure fetch without opening a socket", async () => {
    const response = await secureFetchArticle(base, { policy, lookup: async () => [{ address: "93.184.216.34", family: 4 }], transport: async () => ({ status: 200, headers: { "content-type": "text/html; charset=utf-8" }, body: new TextEncoder().encode(html) }) })
    expect(response.ok).toBe(true)
    if (!response.ok) throw new Error(response.code)
    expect(fromHtml(response.body, response.finalUrl, config, policy)[0]).toMatchObject({ title: "港口通知：年月日日期", publishedAt: "2026-10-12T02:30:00.000Z" })
  })
  it("replays the existing NCHMF HTML archive with explicit fixture-only date rules", () => {
    const archive = readFileSync("docs/evidence/nchmf-integration-2026-10-10/raw/index.html", "utf8")
    const entries = fromHtml(archive, base, { ...config, listSelector: "#left-col > .ct-news-nb-block > ul.list-news", titleAttribute: "alt", publishedAtSelector: "label", dateRuleBasis: "Offline NCHMF 2026-10-10 archive: configured D/M/Y and UTC+07, timezone not present in list text" }, policy)
    expect(entries).toHaveLength(5)
    expect(entries[0]).toMatchObject({ title: "TIN CẢNH BÁO LŨ QUÉT SẠT LỞ ĐẤT, SỤT LÚN ĐẤT DO MƯA LŨ HOẶC DÒNG CHẢY TRÊN KHU VỰC CÁC TỈNH/THÀNH PHỐ TỪ NGHỆ AN ĐẾN QUẢNG NGÃI", publishedAt: "2026-10-10T09:27:01.000Z", dateEvidence: { raw: "(10/10/2026 16:27:01)", timezone: "configured", rule: "configured_dmy" } })
    expect(entries[0].canonicalUrl).toBe("https://www.nchmf.gov.vn/kttv/vi-VN/1/tin-canh-bao-lu-quet-sat-lo-dat-sut-lun-dat-do-mua-lu-hoac-dong-chay-tren-khu-vuc-cac-tinh-thanh-pho-tu-nghe-an-den-quang-ngai-post54549.html")
    expect(entries.every(entry => entry.title && entry.canonicalUrl && entry.publishedAt)).toBe(true)
  })
  it("reads a complete HTML fixture with title, canonical URL, raw date and rule provenance", () => {
    const items = fromHtml(html, base, config, policy)
    expect(items).toHaveLength(7)
    expect(items[0]).toMatchObject({ title: "港口通知：年月日日期", canonicalUrl: "https://www.nchmf.gov.vn/notices/cn", publishedAt: "2026-10-12T02:30:00.000Z", dateEvidence: { rule: "chinese_ymd", timezone: "configured", basis: config.dateRuleBasis } })
    expect(items[1]).toMatchObject({ publishedAt: items[0].publishedAt, dateEvidence: { calendar: "buddhist" } })
    expect(items[2]).toMatchObject({ publishedAt: items[0].publishedAt, dateEvidence: { rule: "configured_dmy" } })
    expect(items[3].publishedAt).toBe("2026-10-12T02:30:12.123Z")
    expect(items.slice(4).map(item => item.publishedAt)).toEqual([undefined, undefined, undefined])
  })
  it("distinguishes an explicit empty list from redesign, login page and missing titles", () => {
    expect(fromHtml("<ul id=\"notices\"><p class=\"empty\">No notices</p></ul>", base, { ...config, emptySelector: ".empty" }, policy)).toEqual([])
    for (const broken of ["<html>Login</html>", "<ul id=\"notices\"></ul>", "<ul id=\"notices\"><li><a href=\"/notices/1\"></a></li></ul>"]) expect(() => fromHtml(broken, base, config, policy)).toThrow(/web_list_/)
  })
  it("retains upstream listing-anchor exclusion and deduplication with canonical URLs", () => {
    const markup = "<ul id=\"notices\"><li><a href=\"/list#paper\">Paper</a></li><li><a href=\"/notices/1?utm_source=x\">Notice one</a></li><li><a href=\"/notices/1#top\">Duplicate</a></li></ul>"
    expect(fromHtml(markup, base, config, policy).map(item => item.title)).toEqual(["Notice one"])
  })
  it("does not widen host/protocol/credential rules through prefix config", () => {
    for (const link of ["https://www.nchmf.gov.vn.evil.test/notices/1", "http://www.nchmf.gov.vn/notices/1", "https://user:pass@www.nchmf.gov.vn/notices/1", "https://www.nchmf.gov.vn:9443/notices/1"]) expect(allowed(link, config, policy)).toBe(false)
    expect(allowed("https://127.0.0.1/notices/1", config, { ...policy, allowedHosts: ["127.0.0.1"] })).toBe(false)
    const filtered = { ...config, allowUrlPrefixes: ["https://www.nchmf.gov.vn/notices"], denyUrlPrefixes: ["https://www.nchmf.gov.vn/notices/private"] }
    expect(allowed("https://www.nchmf.gov.vn/notices/private/1", filtered, policy)).toBe(false)
    expect(allowed("https://www.nchmf.gov.vn/noticesevil/1", filtered, policy)).toBe(false)
    expect(allowed("https://www.nchmf.gov.vn/notices/public/1", filtered, policy)).toBe(true)
  })
  it.each([{ adapter: "mimo_home" }, { parseMode: "markdown" }, { detail: {} }, { publishedAtRegex: ".*" }, { fetchPublicContent: true }, { headers: {} }, { dateOrder: ["dmy"] }, { publishedAtUtcOffset: "+15:00" }, { itemSelector: "[" }, { allowUrlPrefixes: ["javascript:alert(1)"] }])("refuses unsupported or malformed configuration %j", extra => expect(() => assertSupportedConfig({ ...config, ...extra })).toThrow())
})
