import { createHash } from "node:crypto"
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it, vi } from "vitest"
import type { IntelRepository } from "#/database/intel"
import { initShippingTables } from "#/database/shipping"
import { collectIntelSource, sourcePolicy } from "#/intel/collect"
import { assertSupportedConfig } from "#/intel/sources/config-keys"
import { htmlIndexCandidates } from "#/intel/sources/html-index-candidates"
import { mofcomHtml } from "#/intel/sources/__fixtures__/mofcom-policy-synthetic"
import {
  MOFCOM_CN_T01_HTTPS_ALIAS,
  MOFCOM_CN_T01_HTTP_IDENTITY,
  WEB_LIST_DUPLICATE_CONFLICT,
  allowed,
  fromHtml,
  resolveMetadataUrlAlias,
} from "#/intel/sources/web-list"
import { open } from "#/intel/__fixtures__/isolated-db"
import { secureFetchArticle } from "#/services/article-fetch-security"

const seed = htmlIndexCandidates.find(s => s.catalogId === "CN-T01")!
const config = seed.webList!
const policy = sourcePolicy(seed)
const now = new Date("2026-10-26T03:20:00.000Z")
const LIST_PATH = ".tmp/cn-t01-item8-https-20261026/private/list-response-after-save-20261020.bin"
const LIST_SHA = "ab5e3780d9988fe7032458a05ad00adf4f6e66bb891aaaed385f8e2f515d340f"
const TITLE8 = "商务部 科技部公告2026年第48号 就修订《中国禁止出口限制出口技术目录》公开征求意见并对相关技术出口实施临时登记管理"

function twinMarkup(href: string, title = TITLE8, day = "2026-10-16") {
  return `<section class="channel-con"><h2>Latest policy</h2><ul class="policy-list"><li><a href="${href}" title="${title}">${title}</a><span>${day}</span></li></ul></section>`
}

describe("cN-T01 exact HTTP<->HTTPS metadata alias (dots 1792984344.944339)", () => {
  it("keeps the candidate metadata-only, default-off, and requires explicit rule + HTTPS prefixes", () => {
    expect(seed).toMatchObject({ id: "intel:cn-t01", enabled: false, persistence: "disallowed" })
    expect(config.metadataLinkRule).toBe("mofcom_art_http_https_twin")
    expect(config.allowUrlPrefixes).toEqual(["https://www.mofcom.gov.cn/zcfb"])
    assertSupportedConfig(config)
    expect(() => assertSupportedConfig({ ...config, metadataLinkRule: "mofcom_art_http_https_twin", allowUrlPrefixes: undefined })).toThrow(/allowUrlPrefixes/)
    expect(() => assertSupportedConfig({ ...config, metadataLinkRule: "mofcom_art_http_https_twin", allowUrlPrefixes: [] })).toThrow(/allowUrlPrefixes/)
    expect(() => assertSupportedConfig({ ...config, metadataLinkRule: "any_http" as never })).toThrow()
  })

  it("admits the exact HTTP identity with HTTPS alias provenance, without rewriting other rows", () => {
    const entries = fromHtml(twinMarkup(MOFCOM_CN_T01_HTTP_IDENTITY), seed.url, config, policy)
    expect(entries).toHaveLength(1)
    expect(entries[0].canonicalUrl).toBe(MOFCOM_CN_T01_HTTP_IDENTITY)
    expect(entries[0].url).toBe(MOFCOM_CN_T01_HTTPS_ALIAS)
    expect(entries[0]).toMatchObject({ title: TITLE8, publishedAt: undefined, bodyText: "" })
    expect(entries[0].dateEvidence).toMatchObject({ raw: "2026-10-16", localDate: "2026-10-16", precision: "day", timezone: "missing", publishedAt: null })
  })

  it("maps the exact HTTPS twin to the same HTTP identity (no second row)", () => {
    const html = `<section class="channel-con"><h2>Latest policy</h2><ul class="policy-list">
      <li><a href="${MOFCOM_CN_T01_HTTP_IDENTITY}" title="${TITLE8}">${TITLE8}</a><span>2026-10-16</span></li>
      <li><a href="${MOFCOM_CN_T01_HTTPS_ALIAS}" title="${TITLE8}">${TITLE8}</a><span>2026-10-16</span></li>
    </ul></section>`
    const entries = fromHtml(html, seed.url, config, policy)
    expect(entries).toHaveLength(1)
    expect(entries[0].canonicalUrl).toBe(MOFCOM_CN_T01_HTTP_IDENTITY)
    expect(entries[0].url).toBe(MOFCOM_CN_T01_HTTPS_ALIAS)
  })

  it("still rejects title/date conflicts after alias merge", () => {
    const conflictTitle = `<section class="channel-con"><h2>Latest policy</h2><ul class="policy-list">
      <li><a href="${MOFCOM_CN_T01_HTTP_IDENTITY}" title="${TITLE8}">${TITLE8}</a><span>2026-10-16</span></li>
      <li><a href="${MOFCOM_CN_T01_HTTPS_ALIAS}" title="Different title">Different title</a><span>2026-10-16</span></li>
    </ul></section>`
    const conflictDate = `<section class="channel-con"><h2>Latest policy</h2><ul class="policy-list">
      <li><a href="${MOFCOM_CN_T01_HTTP_IDENTITY}" title="${TITLE8}">${TITLE8}</a><span>2026-10-16</span></li>
      <li><a href="${MOFCOM_CN_T01_HTTPS_ALIAS}" title="${TITLE8}">${TITLE8}</a><span>2026-10-17</span></li>
    </ul></section>`
    expect(() => fromHtml(conflictTitle, seed.url, config, policy)).toThrow(WEB_LIST_DUPLICATE_CONFLICT)
    expect(() => fromHtml(conflictDate, seed.url, config, policy)).toThrow(WEB_LIST_DUPLICATE_CONFLICT)
  })

  it("does not privilege other HTTP, interpretation links, wrong source/mode, unselected rules, or query/hash/port/credential/encoding variants", () => {
    const otherHttp = "http://www.mofcom.gov.cn/zcfb/dwmygl/art/synthetic/three.html"
    expect(resolveMetadataUrlAlias(otherHttp, config, policy)).toBeUndefined()
    expect(allowed(otherHttp, config, policy)).toBe(false)
    expect(fromHtml(mofcomHtml, seed.url, config, policy).map(e => e.canonicalUrl)).toEqual([
      "https://www.mofcom.gov.cn/zcfb/zc/art/synthetic/one.html",
      "https://www.mofcom.gov.cn/zcfb/zc/art/synthetic/two.html",
    ])

    expect(allowed(MOFCOM_CN_T01_HTTP_IDENTITY, { ...config, metadataLinkRule: undefined }, policy)).toBe(false)
    expect(allowed(MOFCOM_CN_T01_HTTP_IDENTITY, config, { ...policy, sourceId: "intel:other" })).toBe(false)
    expect(allowed(MOFCOM_CN_T01_HTTP_IDENTITY, config, { ...policy, persistence: "full" })).toBe(false)

    const noAlias = [
      `${MOFCOM_CN_T01_HTTP_IDENTITY}?x=1`,
      `${MOFCOM_CN_T01_HTTP_IDENTITY}#frag`,
      `${MOFCOM_CN_T01_HTTPS_ALIAS}#frag`,
      "http://user:pass@www.mofcom.gov.cn/zcfb/dwmygl/art/2026/art_61446ab4beee4f63973d4d0ab3097648.html",
      "http://www.mofcom.gov.cn:8080/zcfb/dwmygl/art/2026/art_61446ab4beee4f63973d4d0ab3097648.html",
      "http://www.mofcom.gov.cn/zcfb/dwmygl/art/2026/art_61446ab4beee4f63973d4d0ab3097648.html/",
      "http://www.mofcom.gov.cn/zcjd/art/2026/art_61446ab4beee4f63973d4d0ab3097648.html",
      "https://www.mofcom.gov.cn/zcjd/art/2026/art_61446ab4beee4f63973d4d0ab3097648.html",
    ]
    for (const url of noAlias) expect(resolveMetadataUrlAlias(url, config, policy), url).toBeUndefined()
    // Non-exact HTTP (and credential/port/query/hash/trailing-slash variants) stay disallowed.
    for (const url of noAlias.filter(u => u.startsWith("http:") || u.includes("/zcjd/"))) {
      expect(allowed(url, config, policy), url).toBe(false)
    }
  })

  it("never turns the alias into HTTP body fetch or HTTPS downgrade permission", async () => {
    const lookup = vi.fn(async () => [{ address: "93.184.216.34", family: 4 as const }])
    const transport = vi.fn(async () => ({ status: 302, headers: { location: MOFCOM_CN_T01_HTTP_IDENTITY }, body: new Uint8Array() }))
    expect(await secureFetchArticle(MOFCOM_CN_T01_HTTP_IDENTITY, { policy, lookup, transport })).toMatchObject({ ok: false, code: "http_not_allowed" })
    expect(lookup).not.toHaveBeenCalled()
    expect(transport).not.toHaveBeenCalled()
    expect(await secureFetchArticle(seed.url, { policy, lookup, transport })).toMatchObject({ ok: false, code: "https_downgrade" })
  })

  it("replays the unmodified original 20318B list through fromHtml -> collector -> native SQLite -> repeat -> reopen", async () => {
    const bytes = readFileSync(LIST_PATH)
    expect(bytes.length).toBe(20318)
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(LIST_SHA)
    const html = bytes.toString("utf8")
    // Byte-for-byte unmodified original; product alias admits item 8 with HTTP identity.
    const parsed = fromHtml(html, seed.url, config, policy)
    expect(parsed).toHaveLength(8)
    const item8 = parsed.find(e => e.canonicalUrl === MOFCOM_CN_T01_HTTP_IDENTITY)!
    expect(item8.url).toBe(MOFCOM_CN_T01_HTTPS_ALIAS)
    expect(item8.dateEvidence.localDate).toBe("2026-10-16")
    expect(item8.title).toBe(TITLE8)
    const httpsSeven = parsed.filter(e => e.canonicalUrl.startsWith("https:")).length
    expect(httpsSeven).toBe(7)

    mkdirSync(".tmp", { recursive: true })
    const dir = mkdtempSync(".tmp/cn-t01-alias-replay-")
    const file = join(dir, "replay.sqlite3")
    const db = open(file)
    await initShippingTables(db.database, "mock")
    await db.repository.upsertSource(seed, now.toISOString())
    const deps = {
      lookup: vi.fn(async () => [{ address: "93.184.216.34", family: 4 as const }]),
      transport: vi.fn(async () => ({ status: 200, headers: { "content-type": "text/html; charset=utf-8" }, body: html })),
    }
    let before: Awaited<ReturnType<IntelRepository["listItems"]>>
    let versions: unknown[]
    try {
      expect(await collectIntelSource(db.repository, seed, deps, now)).toMatchObject({ status: "ok_items", itemsSeen: 8, itemsNew: 8, itemsRevised: 0 })
      before = await db.repository.listItems(seed.id)
      expect(before).toHaveLength(8)
      expect(before.some(i => i.canonicalUrl === MOFCOM_CN_T01_HTTP_IDENTITY)).toBe(true)
      expect(before.filter(i => i.canonicalUrl.startsWith("https:")).length).toBe(7)
      versions = []
      for (const item of before) {
        const saved = await db.repository.listVersions(item.id)
        expect(saved).toHaveLength(1)
        expect(saved[0]).toMatchObject({ contentScope: "metadata_only", extractorVersion: "intel-web-list-v1" })
        expect(saved[0].dateEvidence).toMatchObject({ precision: "day", timezone: "missing", publishedAt: null })
        versions.push(saved)
      }
      expect(await collectIntelSource(db.repository, seed, deps, now)).toMatchObject({ status: "ok_items", itemsSeen: 8, itemsNew: 0, itemsRevised: 0 })
      expect(await db.repository.listItems(seed.id)).toEqual(before)
    } finally {
      db.native.close()
    }
    const reopened = open(file)
    try {
      expect(await reopened.repository.listItems(seed.id)).toEqual(before!)
      for (let i = 0; i < before!.length; i++) expect(await reopened.repository.listVersions(before![i].id)).toEqual(versions![i])
      writeFileSync(join(dir, "summary.json"), JSON.stringify({
        listSha256: LIST_SHA,
        listBytes: 20318,
        items: before!.map(i => i.canonicalUrl).sort(),
        item8: MOFCOM_CN_T01_HTTP_IDENTITY,
        alias: MOFCOM_CN_T01_HTTPS_ALIAS,
        second: { itemsNew: 0, itemsRevised: 0 },
      }, null, 2))
    } finally {
      reopened.native.close()
    }
  })
})
