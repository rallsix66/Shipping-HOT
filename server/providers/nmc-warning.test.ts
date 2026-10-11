import { readFileSync } from "node:fs"
import { join } from "node:path"
import NativeDatabase from "better-sqlite3"
import { createDatabase } from "db0"
import { describe, expect, it } from "vitest"
import type { FeedItem } from "@shared/shipping"
import { createMockSnapshot } from "@shared/shipping-fixtures"
import { NMC_HISTORICAL_NOTICE, NMC_PAGES, collectNmcNotices, isApprovedNmcUrl, parseNmcPage } from "./nmc-warning"
import { activeOfficialWeatherAlertSourceIds, createOfficialWeatherAlertProvider, officialWeatherAlertSources, weatherAlertProvenance } from "./weather-alerts"
import { ShippingRepository, initShippingTables } from "#/database/shipping"
import { createWeatherAlertSyncJob } from "#/runtime/weather-alert-sync-job"
import { BackgroundRuntime } from "#/runtime/background-runtime"
import { RuntimeRepository } from "#/database/runtime-jobs"
import { evaluateOfficialAlertImpactRules } from "#/services/official-alert-impact"

/**
 * CN-W01/CN-W02 NMC limited integration (dots approved 76b39fc). Fixtures = the six raw pages fetched read-only
 * 2026-10-11 09:19-09:20 UTC+8 (docs/evidence/nmc-warning-2026-10-11/raw; key-like scan 0 hits, unmodified).
 */
const DIR = join(process.cwd(), "server/providers/__fixtures__/nmc-2026-10-11")
const raw: Record<string, string> = Object.fromEntries(NMC_PAGES.map(p => [p.url, readFileSync(join(DIR, `${p.column}.html`), "utf8")]))
const page = (column: string) => NMC_PAGES.find(p => p.column === column)!
const FETCHED = "2026-10-11T01:20:00.000Z"
const LATER = "2026-10-11T04:00:00.000Z"
const cn = officialWeatherAlertSources.find(source => source.id === "nmc")!
const ctx = { id: cn.id, provenance: weatherAlertProvenance(cn) }
const rid = (column: string, key: string) => `weather-alert:nmc:${column}:${key}`

type Init = { redirect?: "error" | "manual" | "follow" } | undefined
type Override = { ok: boolean, status: number, body: string, redirected?: boolean, url?: string } | undefined
function siteFetcher(override: (url: string) => Override = () => undefined) {
  const calls: { url: string, init: Init }[] = []
  const fetcher = async (url: string, init?: Init) => {
    calls.push({ url, init })
    const o = override(url)
    if (o) return { ok: o.ok, status: o.status, redirected: o.redirected, url: o.url ?? url, text: async () => o.body }
    const body = raw[url]
    return body ? { ok: true, status: 200, url, text: async () => body } : { ok: false, status: 404, url, text: async () => "" }
  }
  return { calls, fetcher }
}
function replaceOn(column: string, from: string | RegExp, to: string) {
  return (url: string): Override =>
    url === page(column).url ? { ok: true, status: 200, body: raw[url].replace(from, to) } : undefined
}

describe("cN-W01/02 fetch bounds", () => {
  it("fetches exactly the six pinned URLs once each with redirects refused", async () => {
    const f = siteFetcher()
    const { report } = await collectNmcNotices(f.fetcher, ctx, FETCHED)
    expect(f.calls.map(c => c.url)).toEqual(NMC_PAGES.map(p => p.url))
    expect(f.calls).toHaveLength(6)
    expect(f.calls.every(c => c.init?.redirect === "error")).toBe(true)
    expect(f.calls.some(c => /getContent|dataId|\.pdf|\.png|\.js/.test(c.url))).toBe(false)
    expect(report).toMatchObject({ requested: 6, received: 6, failed: [], created: 6 })
  })

  it("approves only exact pinned URLs (no column wildcard, query, credentials, other host)", () => {
    expect(isApprovedNmcUrl("https://www.nmc.cn/publish/typhoon/typhoon_new.html")?.column).toBe("typhoon_flash")
    for (const bad of [
      "https://www.nmc.cn/publish/country/warning/wind.html",
      "https://www.nmc.cn/publish/country/warning/index.html?x=1",
      "http://www.nmc.cn/publish/country/warning/index.html",
      "https://u:p@www.nmc.cn/publish/country/warning/index.html",
      "https://nmc.cn/publish/country/warning/index.html",
      "https://www.nmc.cn/f/rest/getContent?dataId=1",
    ]) expect(isApprovedNmcUrl(bad)).toBeUndefined()
  })

  it("a redirected page is a page failure, others still recorded", async () => {
    const f = siteFetcher(url => url === page("warning_downpour").url ? { ok: true, status: 200, body: raw[url], redirected: true, url: "https://www.nmc.cn/other.html" } : undefined)
    const { report, items } = await collectNmcNotices(f.fetcher, ctx, FETCHED)
    expect(report.failed).toEqual([{ column: "warning_downpour", reason: "redirect rejected" }])
    expect(items).toHaveLength(5)
  })
})

describe("cN-W01/02 page parsing", () => {
  it("flash report keeps raw issue number, time, intensity and centre separately; strips executable nodes", () => {
    const html = raw[page("typhoon_flash").url].replace("<div class=title", "<script>alert('x')</script><div class=title")
    const p = parseNmcPage(html, page("typhoon_flash"))
    expect(p).toMatchObject({ pageTitle: "台风快讯", numberText: "2026年总1873期", identityKey: "2026-1873", publishTimeText: "10月11日08时27分", typhoonIntensityText: "超强台风级", centerPositionText: "北纬24.5度、东经148.2度", nextIssueText: "11日11时30分", liftStatement: null, rawColorLevel: null })
    expect(p.bodyText).not.toMatch(/alert|<|>/)
  })

  it("missing #text / writing is a structure failure, not 'no warnings'", () => {
    expect(() => parseNmcPage("<html><body>ok</body></html>", page("warning_index"))).toThrow(/nmc_structure_lost/)
  })
})

describe("cN-W01/02 records, identity and lifecycle wording", () => {
  it("historical-product notice is saved; old lift notices stay lift notices, never new active warnings; zero ports/impact", async () => {
    const { items } = await collectNmcNotices(siteFetcher().fetcher, ctx, FETCHED)
    const wind = items.find(i => i.id === rid("warning_index", "2026-10-05T06"))!
    expect(wind.weather?.cnNoticeRaw).toMatchObject({ historicalProductNotice: NMC_HISTORICAL_NOTICE, liftStatement: { sentence: "中央气象台10月5日06时解除大风蓝色预警", object: "大风蓝色预警" }, rawColorLevel: "蓝色", publishTimeText: "2026 年 10 月 05 日 06 时" })
    expect(wind.tags).toEqual(expect.arrayContaining(["historical_product_notice", "official_lift_statement", "issuing_country_CN", "no_port_association"]))
    expect(items.filter(i => i.weather?.cnNoticeRaw?.historicalProductNotice)).toHaveLength(4)
    for (const item of items) {
      expect(item).toMatchObject({ eventEligibility: false, severity: "info", relatedPortIds: [] })
      expect(item.weather).toMatchObject({ alertState: "unknown", validityStatus: "unknown", timezoneStatus: "unconfirmed", lifecycleStatus: "unknown", standardizedSeverity: "unmapped" })
      expect(item.weather?.originalRiskLevel).toBeUndefined()
    }
    const hits = evaluateOfficialAlertImpactRules(items, { portId: "cnsha", portCountry: "CN", cities: ["Shanghai", "上海"], now: new Date(FETCHED) } as never)
    expect(hits).toHaveLength(0)
  })

  it("multi-typhoon bulletin: 诺洛停止编号 does not make KOGUMA or the bulletin a cancellation; 无影响 stays with its typhoon", async () => {
    const { items } = await collectNmcNotices(siteFetcher().fetcher, ctx, FETCHED)
    const bulletin = items.find(i => i.id === rid("typhoon_bulletin", "2026-10-11T06"))!
    const raw = bulletin.weather!.cnNoticeRaw!
    expect(raw.liftStatement).toBeNull()
    expect(raw.typhoonObjects.map(o => o.object)).toEqual(["小熊", "诺洛"])
    expect(raw.typhoonObjects[0].text).toContain("未来对我国海域无影响")
    expect(raw.typhoonObjects[1].text).toContain("停止编号")
    expect(raw.typhoonObjects[0].text).not.toContain("停止编号")
    expect(bulletin.tags).not.toContain("official_lift_statement")
    expect(bulletin.summary).not.toMatch(/全国无|无天气风险|无预警/)
    const flash = items.find(i => i.id === rid("typhoon_flash", "2026-1873"))!
    expect(flash.weather?.cnNoticeRaw?.liftStatement).toBeNull()
  })

  it("body incidentally containing 发布/解除 sets no lifecycle; only the explicit main sentence records a lift", async () => {
    const f = siteFetcher((url) => {
      if (url === page("warning_downpour").url) return { ok: true, status: 200, body: raw[url].replace("<b>解除暴雨蓝色预警：</b>", "<b>发布暴雨蓝色预警：</b>") }
      if (url === page("typhoon_bulletin").url) return { ok: true, status: 200, body: raw[url].replace("未来对我国海域无影响</span>", "未来对我国海域无影响，此前发布的预警已解除</span>") }
      return undefined
    })
    const { items } = await collectNmcNotices(f.fetcher, ctx, FETCHED)
    const published = items.find(i => i.id === rid("warning_downpour", "2026-09-10T06"))!
    expect(published.weather?.cnNoticeRaw?.liftStatement).toBeNull()
    expect(published.weather?.alertState).toBe("unknown")
    expect(published.tags).not.toContain("official_lift_statement")
    expect(published.weather?.cnNoticeRaw?.rawColorLevel).toBe("蓝色")
    const bulletin = items.find(i => i.id === rid("typhoon_bulletin", "2026-10-11T06"))!
    expect(bulletin.weather?.cnNoticeRaw?.bodyText).toContain("已解除")
    expect(bulletin.weather?.cnNoticeRaw?.liftStatement).toBeNull()
  })

  it("unchanged refetch keeps the record; same-identity revision updates it keeping first-received", async () => {
    const first = (await collectNmcNotices(siteFetcher().fetcher, ctx, FETCHED)).items
    const again = await collectNmcNotices(siteFetcher().fetcher, ctx, LATER, first)
    expect(again.report).toMatchObject({ unchanged: 6, created: 0, updated: 0 })
    expect(again.items.map(i => i.id).sort()).toEqual(first.map(i => i.id).sort())
    const revised = await collectNmcNotices(siteFetcher(replaceOn("warning_typhoon", "钓鱼岛附近海域", "钓鱼岛及附近海域")).fetcher, ctx, LATER, first)
    expect(revised.report).toMatchObject({ updated: 1, unchanged: 5, created: 0 })
    const item = revised.items.find(i => i.id === rid("warning_typhoon", "2026-09-06T10"))!
    expect(item.weather?.cnNoticeRaw).toMatchObject({ firstReceivedAt: FETCHED, contentUpdatedAt: LATER, fetchedAt: LATER })
    expect(item.publishedAt).toBe(FETCHED)
  })

  it("new annual issue number is a new record; the older issue is kept, not superseded or lifted", async () => {
    const first = (await collectNmcNotices(siteFetcher().fetcher, ctx, FETCHED)).items
    const next = await collectNmcNotices(siteFetcher(replaceOn("typhoon_flash", "2026年总1873期", "2026年总1874期")).fetcher, ctx, LATER, first)
    expect(next.report.created).toBe(1)
    const older = next.items.find(i => i.id === rid("typhoon_flash", "2026-1873"))!
    expect(next.items.find(i => i.id === rid("typhoon_flash", "2026-1874"))?.weather?.cnNoticeRaw?.firstReceivedAt).toBe(LATER)
    expect(older).toMatchObject({ error: "nmc_not_on_current_page", stale: true })
    expect(older.weather?.cnNoticeRaw?.liftStatement).toBeNull()
    expect(older.weather?.cnNoticeRaw?.identityKey).toBe("2026-1873")
  })

  it("missing reliable identity fails that page; fetch time never mints a record", async () => {
    const f = siteFetcher(replaceOn("warning_downpour", "<b>2026</b>&nbsp;年&nbsp;<b>09</b>", "待定"))
    const { items, report } = await collectNmcNotices(f.fetcher, ctx, FETCHED)
    expect(report.failed[0]).toMatchObject({ column: "warning_downpour" })
    expect(report.failed[0].reason).toMatch(/nmc_identity_missing/)
    expect(items.some(i => i.weather?.cnNoticeRaw?.column === "warning_downpour")).toBe(false)
    expect(items.some(i => i.id.includes(FETCHED))).toBe(false)
  })

  it("is experimental and default off (only allowPending activates it)", () => {
    expect(cn).toMatchObject({ enabled: false, liveStatus: "experimental", countryCode: "CN", format: "html_page_set" })
    expect(activeOfficialWeatherAlertSourceIds({}).has("nmc")).toBe(false)
    expect(activeOfficialWeatherAlertSourceIds({ allowPending: true }).has("nmc")).toBe(true)
  })
})

describe("cN-W01/02 failure status on the normal runtime -> SQLite path", () => {
  async function setup() {
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
    const runtimeRepository = new RuntimeRepository(database)
    let fetcher = siteFetcher().fetcher
    let clock = new Date(FETCHED)
    const runtime = new BackgroundRuntime(runtimeRepository)
    // Same provider options as server/runtime/registry.ts weatherAlertJobs.
    const provider = createOfficialWeatherAlertProvider({ sources: [cn], allowPending: true, throwOnSourceFailureWithoutLastKnown: true, now: () => clock, fetcher: (url, init) => fetcher(url, init) })
    runtime.register(createWeatherAlertSyncJob({ database, dataMode: "real", sourceId: "nmc", provider: provider as typeof provider & { providerId: string }, intervalMs: 3_600_000, now: () => clock }))
    await runtime.start()
    const run = async (iso: string, next: ReturnType<typeof siteFetcher>["fetcher"]) => {
      clock = new Date(iso)
      fetcher = next
      const result = await runtime.runNow("weather-alert-sync:nmc")
      const records = (await repository.listFeedItems({ now: clock, view: "all" })).filter((i: FeedItem) => i.sourceId === "nmc")
      const runs = await runtimeRepository.listSyncRuns("nmc")
      const health = await runtimeRepository.getProviderRuntime("nmc", "weather_alerts")
      return { result, records, lastRun: runs[0], health }
    }
    return {
      run,
      close: () => {
        runtime.stop()
        native.close()
      },
    }
  }
  const all503 = () => siteFetcher(() => ({ ok: false, status: 503, body: "" }))

  it("success run stores six records; unchanged rerun stays success", async () => {
    const s = await setup()
    const a = await s.run(FETCHED, siteFetcher().fetcher)
    expect(a.result.status).toBe("success")
    expect(a.records).toHaveLength(6)
    const b = await s.run(LATER, siteFetcher().fetcher)
    expect(b.result.status).toBe("success")
    expect(b.records.find(r => r.id === rid("typhoon_flash", "2026-1873"))?.weather?.cnNoticeRaw?.firstReceivedAt).toBe(FETCHED)
    s.close()
  })

  it("partial failure: successes kept, failed page's old record kept stale, run + source status failed with column", async () => {
    const s = await setup()
    await s.run(FETCHED, siteFetcher().fetcher)
    const { result, records, lastRun, health } = await s.run(LATER, siteFetcher(url => url === page("warning_downpour").url ? { ok: false, status: 503, body: "" } : undefined).fetcher)
    expect(result).toMatchObject({ status: "failed", errorCode: "nmc_partial_page_failure" })
    expect(result.errorMessage).toMatch(/received 5, failed 1 \(columns warning_downpour: http 503\)/)
    expect(lastRun).toMatchObject({ status: "failed", errorCode: "nmc_partial_page_failure" })
    expect(health?.status).not.toBe("healthy")
    expect(records).toHaveLength(6)
    const old = records.find(r => r.id === rid("warning_downpour", "2026-09-10T06"))!
    expect(old).toMatchObject({ stale: true, sourceStatus: "degraded" })
    expect(old.weather?.cnNoticeRaw?.liftStatement?.object).toBe("暴雨蓝色预警")
    s.close()
  })

  it("first run, all pages failed: failure, never success-empty", async () => {
    const s = await setup()
    const { result, records, lastRun } = await s.run(FETCHED, all503().fetcher)
    expect(result.status).toBe("failed")
    expect(result.errorMessage).toMatch(/nmc_pages_all_failed: received 0\/6/)
    expect(lastRun?.status).toBe("failed")
    expect(records).toHaveLength(0)
    s.close()
  })

  it("all pages failed after records (incl. structure lost): failure, all prior records retained stale", async () => {
    const s = await setup()
    const first = await s.run(FETCHED, siteFetcher().fetcher)
    const { result, records } = await s.run(LATER, siteFetcher(() => ({ ok: true, status: 200, body: "<html><body>maintenance</body></html>" })).fetcher)
    expect(result.status).toBe("failed")
    expect(records.map(r => r.id).sort()).toEqual(first.records.map(r => r.id).sort())
    expect(records.every(r => r.stale && r.sourceStatus === "failed")).toBe(true)
    s.close()
  })
})
