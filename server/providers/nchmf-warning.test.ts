import { readFileSync } from "node:fs"
import { join } from "node:path"
import NativeDatabase from "better-sqlite3"
import { createDatabase } from "db0"
import { describe, expect, it } from "vitest"
import type { FeedItem } from "@shared/shipping"
import { createMockSnapshot } from "@shared/shipping-fixtures"
import { NCHMF_LIST_URL, NCHMF_MAX_ARTICLES, NCHMF_NO_MATCH_ZH, type NchmfRunReport, classifyNchmfTitle, collectNchmfNotices, isPinnedNchmfListUrl, nchmfArticlePostId, parseNchmfArticle, parseNchmfList } from "./nchmf-warning"
import { activeOfficialWeatherAlertSourceIds, createOfficialWeatherAlertProvider, officialWeatherAlertSources, weatherAlertProvenance } from "./weather-alerts"
import { ShippingRepository, initShippingTables } from "#/database/shipping"
import { createWeatherAlertSyncJob } from "#/runtime/weather-alert-sync-job"
import { evaluateOfficialAlertImpactRules } from "#/services/official-alert-impact"

/**
 * VN-W01 NCHMF limited integration (dots review 2026-10-10 17:14). Fixtures = the raw pages fetched 2026-10-10
 * 17:07 UTC+8 (docs/evidence/nchmf-warning-2026-10-10/raw, session tokens and a third-party widget key redacted).
 */
const DIR = join(process.cwd(), "server/providers/__fixtures__/nchmf-2026-10-10")
const raw = (name: string) => readFileSync(join(DIR, `${name}.html`), "utf8")
const INDEX = raw("index")
const FETCHED = "2026-10-10T09:10:00.000Z"
const vn = officialWeatherAlertSources.find(source => source.id === "nchmf")!
const ctx = { id: vn.id, listUrl: vn.sourceUrl, provenance: weatherAlertProvenance(vn) }
const BASE = "https://www.nchmf.gov.vn/kttv/vi-VN/1/"
const pages: Record<string, string> = {
  54353: raw("post54353"),
  54492: raw("post54492"),
  54547: raw("post54547"),
}

type Init = { redirect?: "error" | "manual" | "follow" } | undefined
function siteFetcher(override: (url: string) => { ok: boolean, status: number, body: string, redirected?: boolean, url?: string } | undefined = () => undefined) {
  const calls: { url: string, init: Init }[] = []
  const fetcher = async (url: string, init?: Init) => {
    calls.push({ url, init })
    const o = override(url)
    if (o) return { ok: o.ok, status: o.status, redirected: o.redirected, url: o.url ?? url, text: async () => o.body }
    if (url === NCHMF_LIST_URL) return { ok: true, status: 200, url, text: async () => INDEX }
    const id = nchmfArticlePostId(url)
    // Unknown posts behave like the real site: HTTP 200 with an empty article shell.
    const body = (id && pages[id]) || raw("missing")
    return { ok: true, status: 200, url, text: async () => body }
  }
  return { calls, fetcher }
}

function listHtml(items: { href: string, title: string, label?: string }[], heading = "Tin cảnh báo thiên tai") {
  return `<html><body><h4>${heading}</h4><div class="ct-news-nb-block"><ul class="uk-list list-news">${items.map(i => `<li><a href="${i.href}">${i.title}<label>(${i.label ?? "10/10/2026"})</label></a></li>`).join("")}</ul></div></body></html>`
}

describe("vN-W01 fetch bounds", () => {
  it("source is pinned, default off, only under the existing experimental switch", () => {
    expect(vn).toMatchObject({ url: NCHMF_LIST_URL, format: "html_notice_list", countryCode: "VN", enabled: false, liveStatus: "experimental" })
    expect(activeOfficialWeatherAlertSourceIds().has("nchmf")).toBe(false)
    expect(activeOfficialWeatherAlertSourceIds({ allowPending: true }).has("nchmf")).toBe(true)
    expect(isPinnedNchmfListUrl(NCHMF_LIST_URL)).toBe(true)
    for (const bad of ["http://www.nchmf.gov.vn/kttv/vi-VN/1/index.html", "https://www.nchmf.gov.vn/kttv/vi-VN/1/index.html?x=1", "https://u:p@www.nchmf.gov.vn/kttv/vi-VN/1/index.html", "https://nchmf.gov.vn/kttv/vi-VN/1/index.html"]) expect(isPinnedNchmfListUrl(bad)).toBe(false)
  })

  it("accepts only same-host -post<digits>.html articles; rejects credentials, query, fragment, other hosts/paths, pdf/images", () => {
    expect(nchmfArticlePostId(`${BASE}tin-canh-bao-lu-post54547.html`)).toBe("54547")
    for (const bad of [
      `${BASE}tin-canh-bao-lu-post54547.html?utm=1`,
      `${BASE}tin-canh-bao-lu-post54547.html#x`,
      "https://user:pw@www.nchmf.gov.vn/kttv/vi-VN/1/a-post1.html",
      "https://evil.example/kttv/vi-VN/1/a-post1.html",
      "https://www.nchmf.gov.vn:8443/kttv/vi-VN/1/a-post1.html",
      "http://www.nchmf.gov.vn/kttv/vi-VN/1/a-post1.html",
      "https://www.nchmf.gov.vn/kttv/en-US/1/a-post1.html",
      "https://kttv.gov.vn//upload/thoitiet/2026/10/10/x.pdf",
      `${BASE}a-post1.pdf`,
      `${BASE}images/a-post1.jpg`,
      `${BASE}a-postabc.html`,
    ]) expect(nchmfArticlePostId(bad), bad).toBeUndefined()
  })

  it("one list request + capped, deduplicated article requests, all with redirect: error, never PDFs", async () => {
    const { calls, fetcher } = siteFetcher()
    const reports: NchmfRunReport[] = []
    const provider = createOfficialWeatherAlertProvider({ sources: [vn], allowPending: true, fetcher, now: () => new Date(FETCHED), onNchmfReport: r => reports.push(r) })
    await provider.getFeedItems([])
    expect(calls[0]).toEqual({ url: NCHMF_LIST_URL, init: { redirect: "error" } })
    expect(calls.length).toBeLessThanOrEqual(1 + NCHMF_MAX_ARTICLES)
    expect(new Set(calls.map(c => c.url)).size).toBe(calls.length)
    expect(calls.every(c => c.init?.redirect === "error" && (c.url === NCHMF_LIST_URL || nchmfArticlePostId(c.url)))).toBe(true)
    expect(calls.some(c => /\.pdf|kttv\.gov\.vn/.test(c.url))).toBe(false)
    expect(reports[0].truncated).toBe(reports[0].candidates - reports[0].requested)
  })

  it("a redirected list or article is rejected", async () => {
    const list = siteFetcher(url => url === NCHMF_LIST_URL ? { ok: true, status: 200, body: INDEX, redirected: true, url: "https://evil.example/" } : undefined)
    await expect(createOfficialWeatherAlertProvider({ sources: [vn], allowPending: true, fetcher: list.fetcher, now: () => new Date(FETCHED), throwOnSourceFailureWithoutLastKnown: true }).getFeedItems([])).rejects.toThrow()
    const art = siteFetcher(url => url.includes("post54547") ? { ok: true, status: 200, body: pages["54547"], redirected: true, url: "https://evil.example/x" } : undefined)
    const { report } = await collectNchmfNotices(INDEX, art.fetcher, ctx, FETCHED)
    expect(report.failed.find(f => f.postId === "54547")?.reason).toMatch(/redirect/)
  })
})

describe("vN-W01 list parsing and filter", () => {
  it("reads the warning block and confirmed title families; excludes 10-day trend and daily reports", () => {
    const { entries } = parseNchmfList(INDEX)
    const candidates = entries.filter(e => classifyNchmfTitle(e.title, e.inWarningBlock) === "candidate").map(e => e.postId)
    expect(candidates).toEqual(expect.arrayContaining(["54353", "54547", "54492", "54545", "54544"]))
    for (const excluded of ["54548", "54280", "54282", "54281", "54543"]) expect(candidates).not.toContain(excluded)
    expect(entries.find(e => e.postId === "54547")).toMatchObject({ listTimeText: "10/10/2026 15:31:19", inWarningBlock: true })
  })

  it("is Vietnamese case/Unicode tolerant (NFC vs NFD, upper/lower) and covers 'Bản tin cảnh báo lũ' and tides", () => {
    expect(classifyNchmfTitle("Bản tin cảnh báo lũ phục vụ quy trình LHC sông Cả", false)).toBe("candidate")
    expect(classifyNchmfTitle("BẢN TIN CẢNH BÁO LŨ".normalize("NFD"), false)).toBe("candidate")
    expect(classifyNchmfTitle("tin cảnh báo, dự báo triều cường vùng ven biển nam bộ", false)).toBe("candidate")
    expect(classifyNchmfTitle("TIN DỰ BÁO GIÓ MẠNH, SÓNG LỚN VÀ MƯA DÔNG TRÊN BIỂN", false)).toBe("candidate")
    expect(classifyNchmfTitle("Bản tin dự báo sóng 10 ngày tới", true)).toBe("excluded")
    expect(classifyNchmfTitle("Bản tin dự báo thủy văn hàng ngày", false)).toBe("excluded")
    expect(classifyNchmfTitle("Giới thiệu", false)).toBe("excluded")
  })

  it("lost list structure is a contract failure, never 'no warnings'", () => {
    expect(() => parseNchmfList("<html><body><div>maintenance</div></body></html>")).toThrow(/structure lost/)
    expect(() => parseNchmfList(listHtml([{ href: `${BASE}a-post1.html`, title: "TIN CẢNH BÁO LŨ" }], "Tin tức"))).toThrow(/structure lost/)
  })

  it("valid structure with no matching titles reports the no-match wording and clears nothing", async () => {
    const html = listHtml([{ href: `${BASE}ban-tin-du-bao-song-10-ngay-post9.html`, title: "Bản tin dự báo sóng 10 ngày tới" }])
    const prior = (await collectNchmfNotices(INDEX, siteFetcher().fetcher, ctx, FETCHED)).items
    const { items, report } = await collectNchmfNotices(html, siteFetcher().fetcher, ctx, "2026-10-10T10:00:00.000Z", prior)
    expect(report.candidates).toBe(0)
    expect(report.noMatchZh).toBe(NCHMF_NO_MATCH_ZH)
    expect(items.length).toBe(prior.length)
    expect(items.every(i => i.stale && i.error === "warning_missing_from_current_index")).toBe(true)
  })

  it("header/footer/other links on the page are never notices", () => {
    const { entries } = parseNchmfList(INDEX)
    expect(entries.every(e => /-post\d+\.html$/.test(e.url))).toBe(true)
    expect(entries.some(e => /gioi-thieu|homerss|RegisNews/.test(e.url))).toBe(false)
  })
})

describe("vN-W01 article parsing", () => {
  it("parses title/body, strips script/style/iframe/form, keeps paragraph and table text", () => {
    const a = parseNchmfArticle(pages["54492"])
    expect(a.title).toBe("TIN CẢNH BÁO, DỰ BÁO TRIỀU CƯỜNG VÙNG VEN BIỂN NAM BỘ")
    expect(a.bodyText).toContain("Vũng Tàu")
    expect(a.bodyText).toContain("4,10 - 4,20")
    expect(a.bodyText).not.toMatch(/<script|function\(|facebook|iframe/i)
    expect(a.nextIssueText).toBe("Bản tin tiếp theo được phát lúc: 15h30 ngày 11/10/2026")
    expect(a.originalLevel).toBeNull()
  })

  it("keeps the original level verbatim: flood post54547 'Cấp 1', sea post54353 'cấp 2'", () => {
    const flood = parseNchmfArticle(pages["54547"])
    expect(flood.originalLevel).toBe("Cấp 1")
    expect(flood.originalLevelText).toBe("Cảnh báo cấp độ rủi ro thiên tai do lũ: Cấp 1")
    expect(flood.bodyPublishText).toBe("Tin phát lúc 15h30' ngày 10/10/2026")
    const sea = parseNchmfArticle(pages["54353"])
    expect(sea.originalLevel).toBe("cấp 2")
    expect(sea.bodyPublishText).toBe("Tin phát lúc: 16h00")
    expect(sea.nextIssueText).toBe("Tin phát tiếp theo lúc: 04h00 ngày 11/10")
  })

  it("200 with an empty article (non-existent post) is a failure", () => {
    expect(() => parseNchmfArticle(raw("missing"))).toThrow(/nchmf_article_empty/)
    expect(() => parseNchmfArticle("<div class=\"content-news\"><h2 class=\"tt-content-news\">T</h2><div class=\"text-content-news\"><script>x()</script><iframe></iframe></div></div>")).toThrow(/nchmf_article_empty/)
    expect(() => parseNchmfArticle("<header><h2>TIN CẢNH BÁO</h2></header><footer>text</footer>")).toThrow(/nchmf_article_empty/)
  })
})

describe("vN-W01 records, identity and failure semantics", () => {
  it("records: raw times, original level unmapped, lifecycle/validity unknown, no port, no impact", async () => {
    const { items, report } = await collectNchmfNotices(INDEX, siteFetcher().fetcher, ctx, FETCHED)
    const flood = items.find(i => i.id === "weather-alert:nchmf:54547")!
    expect(flood.weather).toMatchObject({ alertState: "unknown", validityStatus: "unknown", timezoneStatus: "unconfirmed", lifecycleStatus: "unknown", originalRiskLevel: "Cấp 1", standardizedSeverity: "unmapped", timeBasis: "received_at" })
    expect(flood.weather?.noticeRaw).toMatchObject({ postId: "54547", listTimeText: "10/10/2026 15:31:19", bodyPublishText: "Tin phát lúc 15h30' ngày 10/10/2026", firstReceivedAt: FETCHED })
    expect(flood.weather?.alertExpiresAt).toBeUndefined()
    expect(flood.weather?.alertEffectiveAt).toBeUndefined()
    const tide = items.find(i => i.id === "weather-alert:nchmf:54492")!
    expect(tide.weather?.officialSeverity).toBe("not_provided")
    expect(tide.weather?.originalRiskLevel).toBeUndefined()
    expect(items.every(i => i.relatedPortIds.length === 0 && i.eventEligibility === false && i.severity === "info" && i.tags?.includes("issuing_country_VN"))).toBe(true)
    // Unknown posts on the list answer 200 + empty shell in this fixture fetcher -> counted as failures, not records.
    expect(report.received + report.failed.length).toBe(report.requested)
    const hits = evaluateOfficialAlertImpactRules(items, { portId: "vnsgn", portCountry: "VN", cities: ["Ho Chi Minh City", "Vũng Tàu", "Đồng Nai"], now: new Date(FETCHED) } as never)
    expect(hits).toHaveLength(0)
  })

  it("same postId with changed content updates the record and keeps the first-received time; unchanged stays unchanged", async () => {
    const first = (await collectNchmfNotices(INDEX, siteFetcher().fetcher, ctx, FETCHED)).items
    const changed = siteFetcher(url => url.includes("post54547") ? { ok: true, status: 200, body: pages["54547"].replace("Cấp 1", "Cấp 2") } : undefined)
    const later = "2026-10-10T11:00:00.000Z"
    const { items, report } = await collectNchmfNotices(INDEX, changed.fetcher, ctx, later, first)
    const flood = items.find(i => i.id === "weather-alert:nchmf:54547")!
    expect(flood.publishedAt).toBe(FETCHED)
    expect(flood.weather?.noticeRaw?.firstReceivedAt).toBe(FETCHED)
    expect(flood.weather?.noticeRaw?.contentUpdatedAt).toBe(later)
    expect(flood.weather?.originalRiskLevel).toBe("Cấp 2")
    expect(report.updated).toBe(1)
    expect(report.unchanged).toBe(report.received - 1)
  })

  it("a new postId is a new record; no update/replace/cancel is inferred between posts", async () => {
    const { items } = await collectNchmfNotices(INDEX, siteFetcher().fetcher, ctx, FETCHED)
    const dongNai = items.filter(i => /SÔNG ĐỒNG NAI/.test(i.title))
    expect(dongNai.every(i => i.weather?.alertState === "unknown" && !i.error)).toBe(true)
  })

  it("partial article failures are reported and keep prior records (not cleared)", async () => {
    const first = (await collectNchmfNotices(INDEX, siteFetcher().fetcher, ctx, FETCHED)).items
    const broken = siteFetcher(url => url.includes("post54547") ? { ok: false, status: 503, body: "" } : url.includes("post54353") ? { ok: true, status: 200, body: raw("missing") } : undefined)
    const { items, report } = await collectNchmfNotices(INDEX, broken.fetcher, ctx, "2026-10-10T11:00:00.000Z", first)
    expect(report.failed.map(f => f.postId)).toEqual(expect.arrayContaining(["54547", "54353"]))
    const flood = items.find(i => i.id === "weather-alert:nchmf:54547")!
    expect(flood).toMatchObject({ stale: true, sourceStatus: "degraded", title: "TIN CẢNH BÁO LŨ TRÊN SÔNG ĐỒNG NAI" })
    expect(flood.weather?.originalRiskLevel).toBe("Cấp 1")
  })

  it("list failure or lost structure keeps old records through the provider (marked failed, never cleared)", async () => {
    const first = (await collectNchmfNotices(INDEX, siteFetcher().fetcher, ctx, FETCHED)).items
    for (const respond of [{ ok: false, status: 500, body: "" }, { ok: true, status: 200, body: "<html><body>maintenance</body></html>" }]) {
      const f = siteFetcher(url => url === NCHMF_LIST_URL ? respond : undefined)
      const reports: NchmfRunReport[] = []
      const out = await createOfficialWeatherAlertProvider({ sources: [vn], allowPending: true, fetcher: f.fetcher, now: () => new Date(FETCHED), onNchmfReport: r => reports.push(r) }).getFeedItems(first)
      expect(out.length).toBe(first.length)
      expect(out.every(i => i.sourceStatus === "failed" && i.stale)).toBe(true)
      if (respond.ok) expect(reports[0]?.listStatus).toBe("structure_lost")
    }
  })
})

describe("vN-W01 persistence through the sync job", () => {
  it("stores records in SQLite, re-run keeps first-received time, archives nothing on partial failure", async () => {
    const native = new NativeDatabase(":memory:")
    const database = createDatabase({
      name: "sqlite",
      dialect: "sqlite",
      getInstance: () => native,
      exec: (sql: string) => native.exec(sql),
      prepare: (sql: string) => {
        const statement = native.prepare(sql)
        return {
          all: async (...params: unknown[]) => statement.all(...params as never[]),
          get: async (...params: unknown[]) => statement.get(...params as never[]),
          run: async (...params: unknown[]) => {
            const result = statement.run(...params as never[])
            return { success: result.changes > 0, changes: result.changes, lastInsertRowid: result.lastInsertRowid }
          },
        }
      },
      dispose: () => native.close(),
    } as never)
    await initShippingTables(database, "real")
    const repository = new ShippingRepository(database, "real")
    await repository.seed(createMockSnapshot().ports, [], [], createMockSnapshot().settings)
    const run = async (iso: string, fetcher = siteFetcher().fetcher) => {
      const provider = createOfficialWeatherAlertProvider({ sources: [vn], allowPending: true, fetcher, now: () => new Date(iso) })
      await createWeatherAlertSyncJob({ database, dataMode: "real", sourceId: "nchmf", provider: provider as typeof provider & { providerId: string }, intervalMs: 900_000, now: () => new Date(iso) }).run()
      return (await repository.listFeedItems({ now: new Date(iso), view: "all" })).filter((i: FeedItem) => i.sourceId === "nchmf")
    }
    const a = await run(FETCHED)
    expect(a.length).toBeGreaterThan(0)
    const b = await run("2026-10-10T12:00:00.000Z", siteFetcher(url => url.includes("post54547") ? { ok: false, status: 503, body: "" } : undefined).fetcher)
    expect(b.map(i => i.id).sort()).toEqual(a.map(i => i.id).sort())
    expect(b.find(i => i.id === "weather-alert:nchmf:54353")?.publishedAt).toBe(FETCHED)
    native.close()
  })
})
