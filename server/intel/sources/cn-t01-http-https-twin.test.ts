import { createHash } from "node:crypto"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
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
import { open, openReadonly } from "#/intel/__fixtures__/isolated-db"
import { secureFetchArticle } from "#/services/article-fetch-security"

const seed = htmlIndexCandidates.find(s => s.catalogId === "CN-T01")!
const config = seed.webList!
const policy = sourcePolicy(seed)
const now = new Date("2026-10-26T03:20:00.000Z")
const LIST_PATH = ".tmp/cn-t01-item8-https-20261026/private/list-response-after-save-20261020.bin"
const LIST_SHA = "ab5e3780d9988fe7032458a05ad00adf4f6e66bb891aaaed385f8e2f515d340f"
const TITLE8 = "商务部 科技部公告2026年第48号 就修订《中国禁止出口限制出口技术目录》公开征求意见并对相关技术出口实施临时登记管理"
const ORIGINAL_DATE_RULE_BASIS = "CN-T01 complete 20318-byte same-product HTTPS HTML saved 2026-10-20: Latest policy ul.policy-list has eight own title/link/span YYYY-MM-DD rows. Seven relative HTTPS identities retained; one original HTTP policy and its interpretation link excluded by existing policy. Displayed day only, publication role/clock/timezone unknown; no protocol rewrite or detail fetch."

/**
 * Strict local qualification: CN_T01_STRICT_PRIVATE_REPLAY=1 makes missing raw FAIL
 * instead of skip (PAGASA pattern). Ordinary CI/dev path uses explicit skip when raw is absent.
 */
const STRICT_PRIVATE_REPLAY = process.env.CN_T01_STRICT_PRIVATE_REPLAY === "1"

type PrivateListLoad =
  | { ok: true, bytes: Uint8Array, html: string, sha256: string }
  | { ok: false, reason: "missing_raw" | "hash_mismatch", detail: string }

function loadPrivateListOriginal(): PrivateListLoad {
  if (!existsSync(LIST_PATH)) {
    return { ok: false, reason: "missing_raw", detail: `missing gitignored private original at ${LIST_PATH}` }
  }
  const bytes = readFileSync(LIST_PATH)
  const sha256 = createHash("sha256").update(bytes).digest("hex")
  if (bytes.length !== 20318 || sha256 !== LIST_SHA) {
    return {
      ok: false,
      reason: "hash_mismatch",
      detail: `expected 20318B/${LIST_SHA}, got ${bytes.length}B/${sha256}`,
    }
  }
  return { ok: true, bytes, html: bytes.toString("utf8"), sha256 }
}

const privateList = loadPrivateListOriginal()

function twinMarkup(href: string, title = TITLE8, day = "2026-10-16") {
  return `<section class="channel-con"><h2>Latest policy</h2><ul class="policy-list"><li><a href="${href}" title="${title}">${title}</a><span>${day}</span></li></ul></section>`
}

describe("cN-T01 exact HTTP<->HTTPS metadata alias (dots 1792985451.804939 fixes)", () => {
  it("keeps the candidate metadata-only, default-off, original dateRuleBasis, and requires explicit rule + HTTPS prefixes", () => {
    expect(seed).toMatchObject({ id: "intel:cn-t01", enabled: false, persistence: "disallowed" })
    expect(config.metadataLinkRule).toBe("mofcom_art_http_https_twin")
    expect(config.dateRuleBasis).toBe(ORIGINAL_DATE_RULE_BASIS)
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
    expect(entries[0].dateEvidence).toMatchObject({
      raw: "2026-10-16",
      localDate: "2026-10-16",
      precision: "day",
      timezone: "missing",
      publishedAt: null,
      basis: ORIGINAL_DATE_RULE_BASIS,
    })
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
    // HTTP identity is never granted via allowed() — only via exact original-href alias in fromHtml.
    expect(allowed(MOFCOM_CN_T01_HTTP_IDENTITY, config, policy)).toBe(false)
    expect(fromHtml(mofcomHtml, seed.url, config, policy).map(e => e.canonicalUrl)).toEqual([
      "https://www.mofcom.gov.cn/zcfb/zc/art/synthetic/one.html",
      "https://www.mofcom.gov.cn/zcfb/zc/art/synthetic/two.html",
    ])

    expect(allowed(MOFCOM_CN_T01_HTTP_IDENTITY, { ...config, metadataLinkRule: undefined }, policy)).toBe(false)
    expect(resolveMetadataUrlAlias(MOFCOM_CN_T01_HTTP_IDENTITY, { ...config, metadataLinkRule: undefined }, policy)).toBeUndefined()
    expect(resolveMetadataUrlAlias(MOFCOM_CN_T01_HTTP_IDENTITY, config, { ...policy, sourceId: "intel:other" })).toBeUndefined()
    expect(resolveMetadataUrlAlias(MOFCOM_CN_T01_HTTP_IDENTITY, config, { ...policy, persistence: "full" })).toBeUndefined()

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
    for (const url of noAlias.filter(u => u.startsWith("http:") || u.includes("/zcjd/"))) {
      expect(allowed(url, config, policy), url).toBe(false)
    }
  })

  it("fromHtml end-to-end: normalized-looking variants do NOT gain alias privilege on original href literal", () => {
    // These would collapse onto the twin under new URL()/exactHrefKey, but must NOT get alias privilege.
    const httpNegatives = [
      "http://www.mofcom.gov.cn:80/zcfb/dwmygl/art/2026/art_61446ab4beee4f63973d4d0ab3097648.html",
      "http://www.mofcom.gov.cn/zcfb/dwmygl/art/2026/./art_61446ab4beee4f63973d4d0ab3097648.html",
      "http://www.mofcom.gov.cn/zcfb/dwmygl/art/2026/%2e/art_61446ab4beee4f63973d4d0ab3097648.html",
      "http://www.mofcom.gov.cn/zcfb/dwmygl/art/2026/art_61446ab4beee4f63973d4d0ab3097648.html?",
      "http://www.mofcom.gov.cn/zcfb/dwmygl/art/2026/art_61446ab4beee4f63973d4d0ab3097648.html#",
    ]
    for (const href of httpNegatives) {
      expect(resolveMetadataUrlAlias(href, config, policy), href).toBeUndefined()
      // Unmatched HTTP must not regain exception via canonicalize/allowed.
      expect(() => fromHtml(twinMarkup(href), seed.url, config, policy), href).toThrow(/web_list_no_allowed_items/)
    }
    const httpsNegatives = [
      "https://www.mofcom.gov.cn:443/zcfb/dwmygl/art/2026/art_61446ab4beee4f63973d4d0ab3097648.html",
      "https://www.mofcom.gov.cn/zcfb/dwmygl/art/2026/./art_61446ab4beee4f63973d4d0ab3097648.html",
      "https://www.mofcom.gov.cn/zcfb/dwmygl/art/2026/art_61446ab4beee4f63973d4d0ab3097648.html?",
      "https://www.mofcom.gov.cn/zcfb/dwmygl/art/2026/art_61446ab4beee4f63973d4d0ab3097648.html#",
    ]
    for (const href of httpsNegatives) {
      expect(resolveMetadataUrlAlias(href, config, policy), href).toBeUndefined()
      // Ordinary HTTPS rules may still admit a normalized HTTPS identity — but never the HTTP twin identity.
      const entries = fromHtml(twinMarkup(href), seed.url, config, policy)
      expect(entries.some(e => e.canonicalUrl === MOFCOM_CN_T01_HTTP_IDENTITY), href).toBe(false)
      expect(entries.every(e => e.canonicalUrl.startsWith("https:")), href).toBe(true)
    }
    // Mixed list: good relative HTTPS + :80 HTTP variant → only the HTTPS row; no HTTP identity mapping.
    const mixed = `<section class="channel-con"><h2>Latest policy</h2><ul class="policy-list">
      <li><a href="/zcfb/zc/art/synthetic/one.html" title="One">One</a><span>2026-10-01</span></li>
      <li><a href="http://www.mofcom.gov.cn:80/zcfb/dwmygl/art/2026/art_61446ab4beee4f63973d4d0ab3097648.html" title="${TITLE8}">${TITLE8}</a><span>2026-10-16</span></li>
    </ul></section>`
    const entries = fromHtml(mixed, seed.url, config, policy)
    expect(entries).toHaveLength(1)
    expect(entries[0].canonicalUrl).toBe("https://www.mofcom.gov.cn/zcfb/zc/art/synthetic/one.html")
    expect(entries.some(e => e.canonicalUrl === MOFCOM_CN_T01_HTTP_IDENTITY)).toBe(false)
  })

  it("never turns the alias into HTTP body fetch or HTTPS downgrade permission", async () => {
    const lookup = vi.fn(async () => [{ address: "93.184.216.34", family: 4 as const }])
    const transport = vi.fn(async () => ({ status: 302, headers: { location: MOFCOM_CN_T01_HTTP_IDENTITY }, body: new Uint8Array() }))
    expect(await secureFetchArticle(MOFCOM_CN_T01_HTTP_IDENTITY, { policy, lookup, transport })).toMatchObject({ ok: false, code: "http_not_allowed" })
    expect(lookup).not.toHaveBeenCalled()
    expect(transport).not.toHaveBeenCalled()
    expect(await secureFetchArticle(seed.url, { policy, lookup, transport })).toMatchObject({ ok: false, code: "https_downgrade" })
  })
})

describe("cN-T01 private original gate (PAGASA skip vs strict)", () => {
  it.skipIf(!STRICT_PRIVATE_REPLAY)("strict mode requires private original + matching hash evidence (no synthetic substitute)", () => {
    expect(privateList.ok, privateList.ok ? undefined : privateList.detail).toBe(true)
  })

  it.skipIf(STRICT_PRIVATE_REPLAY || privateList.ok)("non-strict path explicitly skips when private raw is absent (not false PASS)", () => {
    expect(privateList.ok).toBe(false)
    if (privateList.ok) throw new Error("unreachable: skipIf should have skipped")
    expect(privateList.reason).toBe("missing_raw")
  })
})

describe("cN-T01 unmodified original full-chain + upgrade-db + true readonly", () => {
  it.skipIf(!privateList.ok)("replays unmodified 20318B list; upgrade-db 7->8 then 0/0; true readonly reopen", async () => {
    if (!privateList.ok) throw new Error("unreachable: skipIf should have skipped")
    const html = privateList.html
    expect(privateList.bytes.length).toBe(20318)
    expect(privateList.sha256).toBe(LIST_SHA)

    const parsed = fromHtml(html, seed.url, config, policy)
    expect(parsed).toHaveLength(8)
    const item8 = parsed.find(e => e.canonicalUrl === MOFCOM_CN_T01_HTTP_IDENTITY)!
    expect(item8.url).toBe(MOFCOM_CN_T01_HTTPS_ALIAS)
    expect(item8.dateEvidence.localDate).toBe("2026-10-16")
    expect(item8.dateEvidence.basis).toBe(ORIGINAL_DATE_RULE_BASIS)
    expect(item8.title).toBe(TITLE8)
    expect(parsed.filter(e => e.canonicalUrl.startsWith("https:")).length).toBe(7)

    mkdirSync(".tmp", { recursive: true })
    const dir = mkdtempSync(".tmp/cn-t01-alias-replay-")
    const file = join(dir, "replay.sqlite3")

    // --- Pre-fix 7-item state: same original dateRuleBasis, HTTP twin + interpretation rows removed ---
    // (Simulates an existing DB that only ever saw the 7 HTTPS identities before the alias fix.)
    // Drop the two HTTP anchors so only the 7 relative HTTPS rows remain (placeholders must NOT match allowUrlPrefixes).
    const htmlPre7 = html
      .replace(`href="${MOFCOM_CN_T01_HTTP_IDENTITY}"`, "href=\"https://example.invalid/excluded-http-twin\"")
      .replace(/href="http:\/\/www\.mofcom\.gov\.cn\/zcjd\/[^"]+"/, "href=\"https://example.invalid/excluded-interpretation\"")
    expect(fromHtml(htmlPre7, seed.url, config, policy)).toHaveLength(7)

    const db = open(file)
    await initShippingTables(db.database, "mock")
    await db.repository.upsertSource(seed, now.toISOString())
    const depsPre = {
      lookup: vi.fn(async () => [{ address: "93.184.216.34", family: 4 as const }]),
      transport: vi.fn(async () => ({ status: 200, headers: { "content-type": "text/html; charset=utf-8" }, body: htmlPre7 })),
    }
    expect(await collectIntelSource(db.repository, seed, depsPre, now)).toMatchObject({
      status: "ok_items",
      itemsSeen: 7,
      itemsNew: 7,
      itemsRevised: 0,
    })
    const pre7 = await db.repository.listItems(seed.id)
    expect(pre7).toHaveLength(7)
    expect(pre7.every(i => i.canonicalUrl.startsWith("https:"))).toBe(true)
    const preVersions: Awaited<ReturnType<IntelRepository["listVersions"]>>[] = []
    const preKeys = pre7.map(i => i.canonicalUrl).sort()
    for (const item of pre7) {
      const saved = await db.repository.listVersions(item.id)
      expect(saved).toHaveLength(1)
      expect(saved[0].dateEvidence).toMatchObject({ basis: ORIGINAL_DATE_RULE_BASIS, precision: "day" })
      preVersions.push(saved)
    }
    db.native.close()

    // --- Upgrade to fixed code (rule on, same dateRuleBasis): only item 8 added ---
    const depsFull = {
      lookup: vi.fn(async () => [{ address: "93.184.216.34", family: 4 as const }]),
      transport: vi.fn(async () => ({ status: 200, headers: { "content-type": "text/html; charset=utf-8" }, body: html })),
    }
    const upgraded = open(file)
    await upgraded.repository.upsertSource(seed, now.toISOString())
    expect(await collectIntelSource(upgraded.repository, seed, depsFull, now)).toMatchObject({
      status: "ok_items",
      itemsSeen: 8,
      itemsNew: 1,
      itemsRevised: 0,
    })
    const after8 = await upgraded.repository.listItems(seed.id)
    expect(after8).toHaveLength(8)
    expect(after8.some(i => i.canonicalUrl === MOFCOM_CN_T01_HTTP_IDENTITY)).toBe(true)
    const afterHttps = after8.filter(i => i.canonicalUrl.startsWith("https:"))
    expect(afterHttps).toHaveLength(7)
    expect(afterHttps.map(i => i.canonicalUrl).sort()).toEqual(preKeys)
    for (let i = 0; i < pre7.length; i++) {
      const matched = after8.find(x => x.canonicalUrl === pre7[i].canonicalUrl)!
      expect(matched.id).toBe(pre7[i].id)
      const vers = await upgraded.repository.listVersions(matched.id)
      expect(vers).toEqual(preVersions[i])
    }
    const item8Row = after8.find(i => i.canonicalUrl === MOFCOM_CN_T01_HTTP_IDENTITY)!
    const item8Vers = await upgraded.repository.listVersions(item8Row.id)
    expect(item8Vers).toHaveLength(1)
    expect(item8Vers[0]).toMatchObject({ contentScope: "metadata_only", extractorVersion: "intel-web-list-v1" })
    expect(item8Vers[0].dateEvidence).toMatchObject({ basis: ORIGINAL_DATE_RULE_BASIS, localDate: "2026-10-16" })

    // --- Second run: 0 new / 0 revise ---
    expect(await collectIntelSource(upgraded.repository, seed, depsFull, now)).toMatchObject({
      status: "ok_items",
      itemsSeen: 8,
      itemsNew: 0,
      itemsRevised: 0,
    })
    expect(await upgraded.repository.listItems(seed.id)).toEqual(after8)
    upgraded.native.close()

    // --- True readonly reopen ---
    const ro = openReadonly(file)
    expect(ro.readonly).toBe(true)
    expect(ro.fileMustExist).toBe(true)
    expect(ro.queryOnly).toBe(true)
    expect(Number((ro.native.prepare("PRAGMA query_only").get() as { query_only: number }).query_only)).toBe(1)
    expect(() => ro.native.exec("CREATE TABLE __should_fail (id INTEGER)")).toThrow()
    expect(await ro.repository.listItems(seed.id)).toEqual(after8)
    for (const item of after8) {
      const vers = await ro.repository.listVersions(item.id)
      expect(vers).toHaveLength(1)
    }
    writeFileSync(join(dir, "summary.json"), JSON.stringify({
      listSha256: LIST_SHA,
      listBytes: 20318,
      dateRuleBasis: ORIGINAL_DATE_RULE_BASIS,
      preFixItems: 7,
      postFixItems: 8,
      itemsNewOnUpgrade: 1,
      itemsRevisedOnUpgrade: 0,
      second: { itemsNew: 0, itemsRevised: 0 },
      item8: MOFCOM_CN_T01_HTTP_IDENTITY,
      alias: MOFCOM_CN_T01_HTTPS_ALIAS,
      readonlyReopen: { readonly: true, fileMustExist: true, queryOnly: true },
      priorRwReopenEvidence: "as-was: earlier alias round used open() without readonly; annotated not rewritten",
    }, null, 2))
    ro.native.close()
  })
})
