import { readFileSync } from "node:fs"
import { join } from "node:path"
import NativeDatabase from "better-sqlite3"
import { createDatabase } from "db0"
import { describe, expect, it } from "vitest"
import type { FeedItem, Port } from "@shared/shipping"
import { createMockSnapshot } from "@shared/shipping-fixtures"
import { capBodyUrlRejection, capIndexLinks, parseCapMessage, parseCapPolygon, pointInCapPolygon, resolveCapBatch } from "./cap-alerts"
import { capSourceContext, createOfficialWeatherAlertProvider, officialWeatherAlertSources } from "./weather-alerts"
import { ShippingRepository, initShippingTables } from "#/database/shipping"
import { createWeatherAlertSyncJob } from "#/runtime/weather-alert-sync-job"
import { getPortWeatherPanel } from "#/services/port-weather-panel"

/**
 * BMKG nowcast CAP (ID). Fixtures under __fixtures__/bmkg-cap-2026-10-10/ are the official RSS index and three
 * CAP bodies fetched unchanged 2026-10-10 06:48–06:49Z (full raw set: docs/evidence/bmkg-cap-2026-10-10/raw/).
 * Documents built by cap() below are SYNTHETIC and marked as such. Scope: parser -> provider -> SQLite (sync
 * job) -> panel SERVICE layer; not HTTP routes, not the browser. Live results are reported separately.
 */
const bmkg = officialWeatherAlertSources.find(source => source.id === "bmkg")!
const FX = (name: string) => readFileSync(join(process.cwd(), "server/providers/__fixtures__/bmkg-cap-2026-10-10", name), "utf8")
const JAKARTA_POLY = "-6.20,106.80 -6.20,106.95 -6.00,106.95 -6.00,106.80 -6.20,106.80"
const ELSEWHERE_POLY = "3.50,125.50 3.50,125.60 3.60,125.60 3.60,125.50 3.50,125.50"
const LAEM_CHABANG_POLY = "13.0,100.8 13.0,101.0 13.2,101.0 13.2,100.8 13.0,100.8"

function cap(fields: { id: string, status?: string, msgType?: string, references?: string, sent?: string, expires?: string | null, severity?: string, polygon?: string | null, areaDesc?: string, description?: string, headline?: string }): string {
  const expires = fields.expires === null ? "" : `<expires>${fields.expires ?? "2026-10-10T18:00:00+07:00"}</expires>`
  const polygon = fields.polygon === null ? "" : `<polygon>${fields.polygon ?? JAKARTA_POLY}</polygon>`
  return `<?xml version="1.0" ?><alert xmlns="urn:oasis:names:tc:emergency:cap:1.2"><identifier>${fields.id}</identifier><sender>cuaca.ekstrem@bmkg.go.id</sender><sent>${fields.sent ?? "2026-10-10T06:00:00+07:00"}</sent><status>${fields.status ?? "Actual"}</status><msgType>${fields.msgType ?? "Alert"}</msgType><scope>Public</scope>${fields.references ? `<references>${fields.references}</references>` : ""}<info><language>en</language><category>Met</category><event>Thunderstorm</event><urgency>Immediate</urgency><severity>${fields.severity ?? "Severe"}</severity><certainty>Observed</certainty><effective>2026-10-10T06:00:00+07:00</effective>${expires}<headline>${fields.headline ?? "SYNTHETIC Heavy rain and thunderstorm"}</headline><description>${fields.description ?? "SYNTHETIC test alert."}</description><area><areaDesc>${fields.areaDesc ?? "DKI Jakarta"}</areaDesc>${polygon}</area></info></alert>`
}

const DOC = (id: string) => `https://www.bmkg.go.id/alerts/nowcast/en/${id}_alert.xml`
function indexFor(urls: string[]): string {
  return `<rss version="2.0"><channel><title>BMKG Weather Alerts</title>${urls.map(url => `<item><title>x</title><link>${url}</link></item>`).join("")}</channel></rss>`
}
function fetcherFor(index: string | Error, docs: Record<string, string>, redirects: Record<string, string> = {}) {
  return async (url: string, _init?: { redirect?: "error" | "manual" | "follow" }) => {
    if (url === bmkg.url) {
      if (index instanceof Error) throw index
      return { ok: true, status: 200, text: async () => index }
    }
    if (redirects[url]) return { ok: true, status: 200, redirected: true, url: redirects[url], text: async () => cap({ id: "R0" }) }
    const body = docs[url]
    return body ? { ok: true, status: 200, url, text: async () => body } : { ok: false, status: 404, text: async () => "" }
  }
}

describe("bMKG official entry shape (fixed live samples 2026-10-10)", () => {
  it("is an RSS index linking to CAP 1.2 bodies under https://www.bmkg.go.id/alerts/nowcast/en/", () => {
    expect(bmkg).toMatchObject({ format: "cap_index", countryCode: "ID", capAreaMatch: "polygon", enabled: true, liveStatus: "verified_live" })
    const links = capIndexLinks(FX("index.xml"), 100, "bmkg", "anomaly")
    expect(links).toHaveLength(12)
    expect(links.every(link => /^https:\/\/www\.bmkg\.go\.id\/alerts\/nowcast\/en\/[A-Z]{3}\d{11}_alert\.xml$/.test(link))).toBe(true)
  })

  it("real bodies: Actual/Alert, Moderate -> watch, validity from CAP, areaDesc as region, no Jakarta polygon -> no port", () => {
    const messages = ["CSR20261010002_alert.xml", "CBL20261010002_alert.xml", "CKG20261010002_alert.xml"].map(name => parseCapMessage(FX(name)))
    expect(messages.every(m => m.status === "Actual" && m.msgType === "Alert" && m.geocodes.length === 0)).toBe(true)
    expect(messages.every(m => m.areas.some(area => area.polygons.length > 0))).toBe(true)
    const batch = resolveCapBatch(messages, capSourceContext(bmkg), "2026-10-10T06:40:00.000Z")
    const csr = batch.items.find(item => item.weather?.alertId === "bmkg:2.49.0.1.360.0.2026.10.10.06.71.002")!
    expect(csr).toMatchObject({ severity: "watch", relatedPortIds: [], eventEligibility: true, expiresAt: "2026-10-10T08:30:00.000Z", weather: { alertState: "active", alertRegion: "Sulawesi Utara", alertEffectiveAt: "2026-10-10T06:35:00.000Z" } })
    expect(batch.items.every(item => item.relatedPortIds.length === 0)).toBe(true)
  })

  it("polygon helpers: Jakarta port coordinate inside the synthetic ring, invalid rings dropped", () => {
    expect(pointInCapPolygon(-6.1, 106.88, parseCapPolygon(JAKARTA_POLY))).toBe(true)
    expect(pointInCapPolygon(-6.1, 106.88, parseCapPolygon(ELSEWHERE_POLY))).toBe(false)
    expect(parseCapPolygon("1,2 x,3 4,5")).toEqual([])
    expect(parseCapPolygon("91,2 1,2 1,3")).toEqual([])
  })
})

describe("bMKG body source restriction (unit)", () => {
  it("allows only https://www.bmkg.go.id/alerts/nowcast/en/<code>_alert.xml for bmkg; TMD rule unchanged", () => {
    expect(capBodyUrlRejection(DOC("CSR20261010002"), "bmkg")).toBeUndefined()
    expect(capBodyUrlRejection(DOC("CSR20261010002"), "tmd")).toBe("host")
    expect(capBodyUrlRejection("https://www.tmd.go.th/uploads/CAP/en/CAPTMD1_2.xml", "bmkg")).toBe("host")
    expect(capBodyUrlRejection("https://www.tmd.go.th/uploads/CAP/en/CAPTMD1_2.xml")).toBeUndefined()
    const rejected: [string, string][] = [
      ["http://www.bmkg.go.id/alerts/nowcast/en/C1_alert.xml", "scheme"],
      ["https://user:pw@www.bmkg.go.id/alerts/nowcast/en/C1_alert.xml", "credentials"],
      ["https://www.bmkg.go.id:8443/alerts/nowcast/en/C1_alert.xml", "port"],
      ["https://bmkg.go.id/alerts/nowcast/en/C1_alert.xml", "host"],
      ["https://www.bmkg.go.id.evil.example/alerts/nowcast/en/C1_alert.xml", "host"],
      ["https://www.bmkg.go.id/alerts/nowcast/en/../../x_alert.xml", "path_disguise"],
      ["https://www.bmkg.go.id/alerts/nowcast/en/%2e%2e/x_alert.xml", "path_disguise"],
      ["https://www.bmkg.go.id/alerts/nowcast/id/C1_alert.xml", "path"],
      ["https://www.bmkg.go.id/alerts/nowcast/en/C1_alert.xml?x=1", "query_or_fragment"],
      ["https://www.bmkg.go.id/alerts/nowcast/en/C1.xml", "path"],
    ]
    for (const [url, reason] of rejected) expect([url, capBodyUrlRejection(url, "bmkg")]).toEqual([url, reason])
  })

  it("an invalid link or index overflow is a structural anomaly, never 'no alerts'", () => {
    expect(() => capIndexLinks(indexFor([DOC("A1"), "https://evil.example/x_alert.xml"]), 100, "bmkg", "anomaly")).toThrow(/cap_index_structural_anomaly/)
    expect(() => capIndexLinks(indexFor(Array.from({ length: 101 }, (_, i) => DOC(`A${i}`))), 100, "bmkg", "anomaly")).toThrow(/exceed limit/)
    expect(capIndexLinks(indexFor([]), 100, "bmkg", "anomaly")).toEqual([])
  })
})

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
        all: async (...params: (string | number | boolean | null | undefined)[]) => statement.all(...params),
        get: async (...params: (string | number | boolean | null | undefined)[]) => statement.get(...params),
        run: async (...params: (string | number | boolean | null | undefined)[]) => {
          const result = statement.run(...params)
          return { success: result.changes > 0, changes: result.changes, lastInsertRowid: result.lastInsertRowid }
        },
      }
    },
    dispose: () => native.close(),
  } as never)
  return { database, native }
}

function jakarta(): Port {
  const port = createMockSnapshot().ports.find(p => p.id === "port-jakarta")!
  return { ...port, provenance: { sourceType: "official", dataNature: "reported", sourceId: "unlocode", verified: true } }
}

describe("bMKG CAP -> provider -> SQLite (sync job) -> panel service layer (fixed samples)", () => {
  async function setup() {
    const { database, native } = db()
    await initShippingTables(database, "real")
    const repository = new ShippingRepository(database, "real")
    await repository.seed([jakarta()], [], [], createMockSnapshot().settings)
    return { database, native, repository }
  }
  // Same provider options as the runtime registry (throwOnSourceFailureWithoutLastKnown: true).
  async function runOnce(database: ReturnType<typeof db>["database"], index: string | Error, docs: Record<string, string>, nowIso: string, redirects: Record<string, string> = {}) {
    const provider = createOfficialWeatherAlertProvider({ sources: [bmkg], fetcher: fetcherFor(index, docs, redirects), now: () => new Date(nowIso), throwOnSourceFailureWithoutLastKnown: true })
    const job = createWeatherAlertSyncJob({ database, dataMode: "real", sourceId: "bmkg", provider: provider as typeof provider & { providerId: string }, intervalMs: 900_000, now: () => new Date(nowIso) })
    return job.run().catch((error: unknown) => ({ status: "threw", error: String(error) }))
  }
  async function panel(repository: ShippingRepository, nowIso: string) {
    const now = new Date(nowIso)
    const feed: FeedItem[] = await repository.listFeedItems({ now, view: "current" })
    return getPortWeatherPanel(repository, "port-jakarta", feed, "test", "BMKG", { now })
  }
  const T0 = "2026-10-10T00:00:00.000Z"
  const stored = async (repository: ShippingRepository) => repository.listFeedItems({ view: "all" })

  it("positive: polygon covering the Jakarta port coordinate -> officialAlerts + WR-O01 potential/system", async () => {
    const { database, native, repository } = await setup()
    await expect(runOnce(database, indexFor([DOC("P1")]), { [DOC("P1")]: cap({ id: "P1" }) }, T0)).resolves.toMatchObject({ status: "success", recordsRead: 1 })
    const view = await panel(repository, T0)
    expect(view.officialAlerts.map(a => a.sourceId)).toEqual(["bmkg"])
    expect(view.officialAlertImpacts.length).toBeGreaterThan(0)
    expect(view.officialAlertImpacts.every(hit => hit.status === "potential" && hit.provenance === "system")).toBe(true)
    expect(view.officialAlertImpacts[0]).toMatchObject({ ruleId: "WR-O01", severity: "warning" })
    native.close()
  })

  it("body/areaDesc mentioning Jakarta or Tanjung Priok without polygon coverage is NOT coverage", async () => {
    const { database, native, repository } = await setup()
    await runOnce(database, indexFor([DOC("M1")]), { [DOC("M1")]: cap({ id: "M1", polygon: ELSEWHERE_POLY, areaDesc: "DKI Jakarta", description: "Heavy rain in Jakarta especially in: TANJUNG PRIOK, KOJA." }) }, T0)
    expect((await stored(repository))[0]).toMatchObject({ relatedPortIds: [], weather: { alertRegion: "DKI Jakarta" } })
    const view = await panel(repository, T0)
    expect(view.officialAlerts).toEqual([])
    expect(view.officialAlertImpacts).toEqual([])
    native.close()
  })

  it("missing polygon -> no association; cross-country polygon (Laem Chabang) -> no association", async () => {
    const { database, native, repository } = await setup()
    await runOnce(database, indexFor([DOC("N1"), DOC("N2")]), { [DOC("N1")]: cap({ id: "N1", polygon: null }), [DOC("N2")]: cap({ id: "N2", polygon: LAEM_CHABANG_POLY }) }, T0)
    expect((await stored(repository)).every(item => item.relatedPortIds.length === 0)).toBe(true)
    expect((await panel(repository, T0)).officialAlertImpacts).toEqual([])
    native.close()
  })

  it("normal no-alert: empty official index succeeds with zero records (not a failure)", async () => {
    const { database, native, repository } = await setup()
    await expect(runOnce(database, indexFor([]), {}, T0)).resolves.toMatchObject({ status: "success", recordsRead: 0 })
    expect(await stored(repository)).toEqual([])
    native.close()
  })

  it("test status ignored; expired not active; missing expires -> unknown; none produce impacts", async () => {
    const { database, native, repository } = await setup()
    await runOnce(database, indexFor([DOC("T1"), DOC("E1"), DOC("U1")]), {
      [DOC("T1")]: cap({ id: "T1", status: "Test" }),
      [DOC("E1")]: cap({ id: "E1", expires: "2026-10-10T06:30:00+07:00" }),
      [DOC("U1")]: cap({ id: "U1", expires: null }),
    }, T0)
    const items = await stored(repository)
    expect(items.map(item => item.weather?.alertId).sort()).toEqual(["bmkg:E1", "bmkg:U1"])
    expect(items.find(item => item.weather?.alertId === "bmkg:E1")).toMatchObject({ eventEligibility: false, weather: { alertState: "expired" } })
    expect(items.find(item => item.weather?.alertId === "bmkg:U1")).toMatchObject({ eventEligibility: false, weather: { alertState: "unknown" } })
    expect((await panel(repository, T0)).officialAlertImpacts).toEqual([])
    native.close()
  })

  it("stale: an unexpired alert missing from the next index becomes unknown/stale and stops driving impacts", async () => {
    const { database, native, repository } = await setup()
    await runOnce(database, indexFor([DOC("S1")]), { [DOC("S1")]: cap({ id: "S1" }) }, T0)
    expect((await panel(repository, T0)).officialAlertImpacts.length).toBeGreaterThan(0)
    const T1 = "2026-10-10T00:15:00.000Z"
    await runOnce(database, indexFor([]), {}, T1)
    expect((await stored(repository))[0]).toMatchObject({ stale: true, weather: { alertState: "unknown" } })
    expect((await panel(repository, T1)).officialAlertImpacts).toEqual([])
    native.close()
  })

  it("first-time fetch failure fails the run and stores nothing (not 'no current alerts')", async () => {
    const { database, native, repository } = await setup()
    const result = await runOnce(database, new Error("fetch failed"), {}, T0)
    expect(result.status).not.toBe("success")
    expect(await stored(repository)).toEqual([])
    native.close()
  })

  it("fetch failure with an existing record keeps it as failed/stale — never treated as revocation", async () => {
    const { database, native, repository } = await setup()
    await runOnce(database, indexFor([DOC("F1")]), { [DOC("F1")]: cap({ id: "F1" }) }, T0)
    const T1 = "2026-10-10T00:15:00.000Z"
    await runOnce(database, new Error("fetch failed"), {}, T1)
    const [item] = await stored(repository)
    expect(item).toMatchObject({ weather: { alertId: "bmkg:F1" }, sourceStatus: "failed", stale: true })
    expect(item.weather?.alertState).not.toBe("expired")
    expect((await panel(repository, T1)).officialAlertImpacts).toEqual([])
    native.close()
  })

  it("out-of-scope body link and cross-host redirect fail the source (structural anomaly / redirect rejected)", async () => {
    const a = await setup()
    expect((await runOnce(a.database, indexFor([DOC("O1"), "https://evil.example/O2_alert.xml"]), { [DOC("O1")]: cap({ id: "O1" }) }, T0)).status).not.toBe("success")
    expect(await stored(a.repository)).toEqual([])
    a.native.close()
    const b = await setup()
    expect((await runOnce(b.database, indexFor([DOC("R1")]), {}, T0, { [DOC("R1")]: "https://evil.example/R1_alert.xml" })).status).not.toBe("success")
    expect(await stored(b.repository)).toEqual([])
    b.native.close()
  })
})
