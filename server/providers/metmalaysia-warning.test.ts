import { readFileSync } from "node:fs"
import { join } from "node:path"
import NativeDatabase from "better-sqlite3"
import { createDatabase } from "db0"
import { beforeEach, describe, expect, it } from "vitest"
import type { FeedItem, Port } from "@shared/shipping"
import { createMockSnapshot } from "@shared/shipping-fixtures"
import { METMALAYSIA_WARNING_URL, isPinnedMetMalaysiaUrl, parseMetMalaysiaWarnings } from "./metmalaysia-warning"
import { activeOfficialWeatherAlertSourceIds, createOfficialWeatherAlertProvider, officialWeatherAlertSources, resetWeatherAlertRateLimit, weatherAlertProvenance } from "./weather-alerts"
import { ShippingRepository, initShippingTables } from "#/database/shipping"
import { createWeatherAlertSyncJob } from "#/runtime/weather-alert-sync-job"
import { evaluateOfficialAlertImpactRules, officialAlertIneligibility } from "#/services/official-alert-impact"
import { getPortWeatherPanel } from "#/services/port-weather-panel"

/**
 * MY-W01 MetMalaysia limited integration (dots review 2026-10-10 16:05). Fixture = the official response fetched
 * unchanged 2026-10-10T07:54:44Z (same bytes as docs/evidence/metmalaysia-warning-2026-10-10/raw/warning.json).
 * Scope: parser -> provider -> SQLite (sync job) -> panel/impact SERVICE layer. Browser display is verified separately.
 */
const my = officialWeatherAlertSources.find(source => source.id === "metmalaysia")!
const RAW = readFileSync(join(process.cwd(), "server/providers/__fixtures__/metmalaysia-2026-10-10/warning.json"), "utf8")
const FETCHED = "2026-10-10T07:54:44.000Z"
const ctx = { id: my.id, sourceUrl: my.sourceUrl, provenance: weatherAlertProvenance(my) }
const live = { ...my, enabled: true }

type Init = { redirect?: "error" | "manual" | "follow" } | undefined
function recorder(respond: (url: string, init: Init) => { ok: boolean, status: number, body?: string, redirected?: boolean, url?: string } | Error) {
  const calls: { url: string, init: Init }[] = []
  const fetcher = async (url: string, init?: Init) => {
    calls.push({ url, init })
    const r = respond(url, init)
    if (r instanceof Error) throw r
    return { ok: r.ok, status: r.status, redirected: r.redirected, url: r.url ?? url, text: async () => r.body ?? "" }
  }
  return { calls, fetcher }
}
const okBody = (body: string) => recorder(() => ({ ok: true, status: 200, body }))

function provider(fetcher: ReturnType<typeof recorder>["fetcher"], nowIso = FETCHED, extra: { throwOnSourceFailureWithoutLastKnown?: boolean } = {}) {
  return createOfficialWeatherAlertProvider({ sources: [live], allowPending: true, fetcher, now: () => new Date(nowIso), ...extra })
}

beforeEach(() => resetWeatherAlertRateLimit())

describe("mY-W01 bound 1: pinned entry, no redirects, rate limit, existing switch", () => {
  it("source is pinned to https://api.data.gov.my/weather/warning/ and only runs under the existing experimental switch", () => {
    expect(my).toMatchObject({ url: METMALAYSIA_WARNING_URL, sourceUrl: METMALAYSIA_WARNING_URL, format: "json_warning", countryCode: "MY", enabled: false, liveStatus: "experimental" })
    expect(activeOfficialWeatherAlertSourceIds().has("metmalaysia")).toBe(false)
    expect(activeOfficialWeatherAlertSourceIds({ allowPending: true }).has("metmalaysia")).toBe(true)
    expect(isPinnedMetMalaysiaUrl(METMALAYSIA_WARNING_URL)).toBe(true)
    for (const bad of ["https://api.data.gov.my/weather/warning", "http://api.data.gov.my/weather/warning/", "https://evil.example/weather/warning/", "https://api.data.gov.my/weather/warning/?x=1", "https://api.data.gov.my.evil/weather/warning/"]) expect(isPinnedMetMalaysiaUrl(bad)).toBe(false)
  })

  it("one request per run with redirect: error; no key/headers", async () => {
    const { calls, fetcher } = okBody(RAW)
    await provider(fetcher).getFeedItems([])
    expect(calls).toEqual([{ url: METMALAYSIA_WARNING_URL, init: { redirect: "error" } }])
  })

  it("a followed redirect or different final URL is rejected (contract failure, not 'no warnings')", async () => {
    for (const response of [{ ok: true, status: 200, body: RAW, redirected: true }, { ok: true, status: 200, body: RAW, url: "https://api.data.gov.my/other/" }]) {
      resetWeatherAlertRateLimit()
      const { fetcher } = recorder(() => response)
      await expect(provider(fetcher, FETCHED, { throwOnSourceFailureWithoutLastKnown: true }).getFeedItems([])).rejects.toThrow(/redirect rejected/)
    }
  })

  it("a non-pinned configured URL is refused before any network call", async () => {
    const { calls, fetcher } = okBody(RAW)
    const p = createOfficialWeatherAlertProvider({ sources: [{ ...live, url: "https://api.data.gov.my/weather/warning" }], allowPending: true, fetcher, now: () => new Date(FETCHED), throwOnSourceFailureWithoutLastKnown: true })
    await expect(p.getFeedItems([])).rejects.toThrow(/pinned/)
    expect(calls).toHaveLength(0)
  })

  it("local rate limit: a second run within 15 s makes no request (4 req/min ceiling)", async () => {
    const { calls, fetcher } = okBody(RAW)
    const first = await provider(fetcher, FETCHED).getFeedItems([])
    const second = await provider(fetcher, "2026-10-10T07:54:50.000Z").getFeedItems(first)
    expect(calls).toHaveLength(1)
    expect(second.every(item => item.sourceStatus === "failed")).toBe(true)
    await provider(fetcher, "2026-10-10T07:55:00.000Z").getFeedItems(first)
    expect(calls).toHaveLength(2)
  })
})

describe("mY-W01 bounds 2-5 on the real 2026-10-10 sample", () => {
  const items = parseMetMalaysiaWarnings(RAW, ctx, FETCHED)
  const rows = JSON.parse(RAW) as Array<{ warning_issue: { issued: string, title_en: string }, valid_from: string | null, valid_to: string | null, text_en: string }>

  it("bound 2: raw issued/valid_from/valid_to strings are preserved verbatim; no timezone assumed; validity unknown", () => {
    expect(items).toHaveLength(4)
    items.forEach((item, index) => {
      expect(item.weather?.alertRaw).toMatchObject({ issued: rows[index].warning_issue.issued, validFrom: rows[index].valid_from, validTo: rows[index].valid_to, textEn: rows[index].text_en, sourceUrl: METMALAYSIA_WARNING_URL, fetchedAt: FETCHED })
      expect(item.weather).toMatchObject({ alertState: "unknown", validityStatus: "unknown", timezoneStatus: "unconfirmed", timeBasis: "received_at" })
      expect(item.weather?.alertIssuedAt).toBeUndefined()
      expect(item.weather?.alertEffectiveAt).toBeUndefined()
      expect(item.weather?.alertExpiresAt).toBeUndefined()
      expect(item.effectiveAt).toBeUndefined()
      expect(item.expiresAt).toBeUndefined()
      expect(item.publishedAt).toBe(FETCHED)
      expect(item.eventEligibility).toBe(false)
      expect(item.summary).not.toMatch(/生效中|active warnings exist|有效预警存在/i)
    })
    expect(items.filter(item => !item.tags?.includes("tropical_cyclone_no_advisory_scope_only")).every(item => item.summary.startsWith("已接收 MetMalaysia 官方预警记录，有效性待确认"))).toBe(true)
  })

  it("bound 3: no severity field -> officialSeverity not_provided; MY is issuing country; no region, no port, no WR-O01/O02", () => {
    for (const item of items) {
      expect(item.weather?.officialSeverity).toBe("not_provided")
      expect(item.tags).toEqual(expect.arrayContaining(["official_severity_not_provided", "issuing_country_MY", "no_structured_region"]))
      expect(item.relatedPortIds).toEqual([])
      expect(item.weather?.alertRegion).toBeUndefined()
      expect(officialAlertIneligibility(item, Date.parse(FETCHED))).toBe("event_eligibility_not_true")
    }
    // The real text names "Klang" and "Selangor": still zero association / zero impact.
    expect(items.some(item => /Klang/.test(item.weather?.alertRaw?.textEn ?? ""))).toBe(true)
    const hits = evaluateOfficialAlertImpactRules(items, { portId: "port-klang", portCountry: "MY", cities: ["Klang", "Kuala Lumpur", "Selangor"], now: new Date(FETCHED) } as never)
    expect(hits).toEqual([])
  })

  it("bound 4: 'No Advisory' is its own scoped record and does not clear thunderstorm / sea records", () => {
    const na = items.filter(item => item.tags?.includes("tropical_cyclone_no_advisory_scope_only"))
    expect(na).toHaveLength(1)
    expect(na[0].summary).toMatch(/仅表示其所述监测区域内无热带气旋系统/)
    expect(items.filter(item => item.title !== "No Advisory")).toHaveLength(3)
  })

  it("bound 5: rows sharing title/issued/text but different validity are distinct records", () => {
    expect(rows[0].warning_issue).toEqual(rows[1].warning_issue)
    expect(rows[0].text_en).toBe(rows[1].text_en)
    expect(items[0].id).not.toBe(items[1].id)
    expect(new Set(items.map(item => item.id)).size).toBe(4)
    expect(parseMetMalaysiaWarnings(RAW, ctx, "2026-10-10T08:30:00.000Z").map(item => item.id)).toEqual(items.map(item => item.id))
  })

  it("contract: non-array / missing warning_issue is a failure, never 'no warnings'", () => {
    expect(() => parseMetMalaysiaWarnings("{}", ctx, FETCHED)).toThrow(/not an array/)
    expect(() => parseMetMalaysiaWarnings("<html>", ctx, FETCHED)).toThrow(/not JSON/)
    expect(() => parseMetMalaysiaWarnings("[{\"valid_from\":null}]", ctx, FETCHED)).toThrow(/warning_issue/)
    expect(() => parseMetMalaysiaWarnings("[{\"warning_issue\":{\"title_en\":\"x\",\"issued\":5}}]", ctx, FETCHED)).toThrow(/not a string/)
  })
})

describe("mY-W01 bound 4/6: empty vs failure, persistence, zero-inference impact", () => {
  function db() {
    const native = new NativeDatabase(":memory:")
    const database = createDatabase({
      name: "sqlite",
      dialect: "sqlite",
      getInstance: () => native,
      exec: (sql: string) => native.exec(sql),
      prepare: (sql: string) => {
        const statement = native.prepare(sql)
        return {
          all: async (...params: never[]) => statement.all(...params),
          get: async (...params: never[]) => statement.get(...params),
          run: async (...params: never[]) => {
            const result = statement.run(...params)
            return { success: result.changes > 0, changes: result.changes, lastInsertRowid: result.lastInsertRowid }
          },
        }
      },
      dispose: () => native.close(),
    } as never)
    return { database, native }
  }
  function klang(): Port {
    const port = createMockSnapshot().ports.find(p => p.id === "port-klang")!
    return { ...port, provenance: { sourceType: "official", dataNature: "reported", sourceId: "unlocode", verified: true } }
  }
  async function setup() {
    const { database, native } = db()
    await initShippingTables(database, "real")
    const repository = new ShippingRepository(database, "real")
    await repository.seed([klang()], [], [], createMockSnapshot().settings)
    return { database, native, repository }
  }
  function runOnce(database: ReturnType<typeof db>["database"], fetcher: ReturnType<typeof recorder>["fetcher"], nowIso: string) {
    const p = createOfficialWeatherAlertProvider({ sources: [live], allowPending: true, fetcher, now: () => new Date(nowIso), throwOnSourceFailureWithoutLastKnown: true })
    const job = createWeatherAlertSyncJob({ database, dataMode: "real", sourceId: "metmalaysia", provider: p as typeof p & { providerId: string }, intervalMs: 900_000, now: () => new Date(nowIso) })
    return job.run().catch((error: unknown) => ({ status: "threw", error: String(error) }))
  }

  it("persists 4 records (current feed), Klang panel shows no official alert and no impact", async () => {
    const { database, native, repository } = await setup()
    await expect(runOnce(database, okBody(RAW).fetcher, FETCHED)).resolves.toMatchObject({ status: "success", recordsRead: 4 })
    const now = new Date(FETCHED)
    const current: FeedItem[] = await repository.listFeedItems({ now, view: "current" })
    const mine = current.filter(item => item.sourceId === "metmalaysia")
    expect(mine).toHaveLength(4)
    expect(mine.every(item => item.weather?.alertRaw?.issued !== undefined && item.weather?.validityStatus === "unknown" && item.eventEligibility === false)).toBe(true)
    const view = await getPortWeatherPanel(repository, "port-klang", current, "test", "MetMalaysia", { now })
    expect(view.officialAlerts).toEqual([])
    expect(view.officialAlertImpacts).toEqual([])
    native.close()
  })

  it("empty array = successful fetch with 0 records (meaning unknown); prior records are only marked missing, not expired", async () => {
    const { database, native, repository } = await setup()
    await runOnce(database, okBody(RAW).fetcher, FETCHED)
    resetWeatherAlertRateLimit()
    await expect(runOnce(database, okBody("[]").fetcher, "2026-10-10T08:10:00.000Z")).resolves.toMatchObject({ status: "success" })
    const all = (await repository.listFeedItems({ view: "all" })).filter(item => item.sourceId === "metmalaysia")
    expect(all).toHaveLength(4)
    expect(all.every(item => item.error === "warning_missing_from_current_index" && item.weather?.alertState === "unknown")).toBe(true)
    native.close()
  })

  it("fetch failure is distinct from empty: first run throws; later failure keeps records marked failed", async () => {
    const { database, native, repository } = await setup()
    await expect(runOnce(database, recorder(() => new Error("ECONNRESET")).fetcher, FETCHED)).resolves.not.toMatchObject({ status: "success" })
    expect((await repository.listFeedItems({ view: "all" })).filter(item => item.sourceId === "metmalaysia")).toEqual([])
    await runOnce(database, okBody(RAW).fetcher, "2026-10-10T07:56:00.000Z")
    resetWeatherAlertRateLimit()
    await runOnce(database, recorder(() => ({ ok: false, status: 503 })).fetcher, "2026-10-10T08:20:00.000Z")
    const all = (await repository.listFeedItems({ view: "all" })).filter(item => item.sourceId === "metmalaysia")
    expect(all).toHaveLength(4)
    expect(all.every(item => item.sourceStatus === "failed")).toBe(true)
    native.close()
  })

  it("re-fetch keeps first-received time and the same 4 ids (no duplicates)", async () => {
    const { database, native, repository } = await setup()
    await runOnce(database, okBody(RAW).fetcher, FETCHED)
    resetWeatherAlertRateLimit()
    await runOnce(database, okBody(RAW).fetcher, "2026-10-10T08:30:00.000Z")
    const all = (await repository.listFeedItems({ view: "all" })).filter(item => item.sourceId === "metmalaysia")
    expect(all).toHaveLength(4)
    expect(all.every(item => item.publishedAt === FETCHED && item.fetchedAt === "2026-10-10T08:30:00.000Z")).toBe(true)
    native.close()
  })
})
