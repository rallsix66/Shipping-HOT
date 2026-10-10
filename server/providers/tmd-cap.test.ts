import { readFileSync } from "node:fs"
import { join } from "node:path"
import NativeDatabase from "better-sqlite3"
import { createDatabase } from "db0"
import { describe, expect, it } from "vitest"
import type { FeedItem, Port } from "@shared/shipping"
import { createMockSnapshot } from "@shared/shipping-fixtures"
import { capBodyUrlRejection, capIndexLinks, capSeverity, parseCapMessage, parseCapReferences, resolveCapBatch } from "./cap-alerts"
import { capSourceContext, createOfficialWeatherAlertProvider, officialWeatherAlertSources, parseWeatherAlertCap } from "./weather-alerts"
import { ShippingRepository, initShippingTables } from "#/database/shipping"
import { createWeatherAlertSyncJob } from "#/runtime/weather-alert-sync-job"
import { getPortWeatherPanel } from "#/services/port-weather-panel"

/**
 * TH-W01 TMD CAP. Fixtures under __fixtures__/tmd-cap-2026-10-10/ are the official index and the 7 CAP
 * documents fetched 2026-10-10 ~05:33Z (polygons stripped, nothing else changed). Synthetic CAP documents
 * below are clearly marked. Scope: parser → provider → SQLite (sync job) → panel SERVICE layer only;
 * not HTTP routes and not the browser.
 */
const tmd = officialWeatherAlertSources.find(source => source.id === "tmd")!
const FX = (name: string) => readFileSync(join(process.cwd(), "server/providers/__fixtures__/tmd-cap-2026-10-10", name), "utf8")
const LIVE_FETCHED_AT = "2026-10-10T05:35:00.000Z"
const LIVE_DOCS = [
  "TMD20261010062912_2-en.xml",
  "TMD20261010061852_2-en.xml",
  "TMD20261009164949_2-en.xml",
  "TMD20261009050353_2-en.xml",
  "TMD20261008161413_2-en.xml",
  "TMD20261008054542_2-en.xml",
  "TMD20261007164420_2-en.xml",
]

function cap(fields: { id: string, status?: string, msgType?: string, references?: string, sent?: string | null, expires?: string | null, severity?: string, geocodes?: string[], noInfo?: boolean }): string {
  const geocodes = (fields.geocodes ?? ["TH-20"]).map(code => `<geocode><valueName>ISO3166-2</valueName><value>${code}</value></geocode>`).join("")
  const expires = fields.expires === null ? "" : `<expires>${fields.expires ?? "2026-10-10T18:00:00+07:00"}</expires>`
  return `<?xml version="1.0"?><alert xmlns="urn:oasis:names:tc:emergency:cap:1.2"><identifier>${fields.id}-en</identifier><sender>TMD</sender>${fields.sent === null ? "" : `<sent>${fields.sent ?? "2026-10-10T06:00:00+07:00"}</sent>`}<status>${fields.status ?? "Actual"}</status><msgType>${fields.msgType ?? "Alert"}</msgType><scope>Public</scope>${fields.references ? `<references>${fields.references}</references>` : ""}${fields.noInfo ? "" : `<info><language>en-US</language><category>Met</category><event>Heavy Rain</event><urgency>Expected</urgency><severity>${fields.severity ?? "Severe"}</severity><certainty>Likely</certainty><effective>2026-10-10T06:00:00+07:00</effective>${expires}<senderName>TMD</senderName><headline>Heavy Rain Risk Area</headline><description>SYNTHETIC test alert.</description><area><areaDesc>Synthetic area</areaDesc>${geocodes}</area></info>`}</alert>`
}

const fetchInits: { url: string, redirect?: string }[] = []
function fetcherFor(index: string, docs: Record<string, string>, redirects: Record<string, string> = {}) {
  return async (url: string, init?: { redirect?: "error" | "manual" | "follow" }) => {
    fetchInits.push({ url, redirect: init?.redirect })
    if (url === tmd.url) return { ok: true, status: 200, text: async () => index }
    if (redirects[url]) return { ok: true, status: 200, redirected: true, url: redirects[url], text: async () => cap({ id: "R0" }) }
    const body = docs[url]
    return body ? { ok: true, status: 200, text: async () => body } : { ok: false, status: 404, text: async () => "" }
  }
}

function indexFor(urls: string[]): string {
  return `<rss version="2.0"><channel><title>TMD</title>${urls.map(url => `<item><title>Heavy Rain</title><link>${url}</link></item>`).join("")}</channel></rss>`
}

const DOC = (id: string) => `https://www.tmd.go.th/uploads/CAP/en/CAP${id}.xml`

describe("tH-W01 TMD CAP — official entry shape (fixed live samples 2026-10-10)", () => {
  it("the official entry is an RSS index whose items link to CAP 1.2 documents", () => {
    expect(tmd.format).toBe("cap_index")
    expect(tmd.countryCode).toBe("TH")
    const links = capIndexLinks(FX("index.xml"))
    expect(links).toHaveLength(7)
    expect(links.every(link => /^https:\/\/www\.tmd\.go\.th\/uploads\/CAP\/en\/CAPTMD\d+_2\.xml$/.test(link))).toBe(true)
  })

  it("resolves the live batch: Update chain retires older messages; expired ones are not active", () => {
    const messages = LIVE_DOCS.map(name => parseCapMessage(FX(name)))
    expect(messages.every(m => m.status === "Actual")).toBe(true)
    expect(parseCapReferences("TMD,TMD20261009050353_2,2026-10-09T04:58:00+07:00")).toEqual(["TMD|TMD20261009050353_2"])
    const batch = resolveCapBatch(messages, capSourceContext(tmd), LIVE_FETCHED_AT)
    const byId = Object.fromEntries(batch.items.map(item => [item.weather?.alertId, item]))
    expect(Object.keys(byId).sort()).toEqual(["tmd:TMD20261007164420_2-en", "tmd:TMD20261009164949_2-en", "tmd:TMD20261010061852_2-en", "tmd:TMD20261010062912_2-en"])
    expect(batch.ignored.filter(i => i.reason === "superseded_or_cancelled").map(i => i.identifier).sort()).toEqual(["TMD20261008054542_2-en", "TMD20261008161413_2-en", "TMD20261009050353_2-en"])
    expect(byId["tmd:TMD20261010062912_2-en"]).toMatchObject({ severity: "warning", eventEligibility: true, weather: { alertState: "active", alertExpiresAt: "2026-10-10T11:00:00.000Z" }, relatedPortIds: [] })
    expect(byId["tmd:TMD20261010061852_2-en"]).toMatchObject({ severity: "critical", eventEligibility: true, weather: { alertRegion: "TH-21, TH-22, TH-23, TH-71" } })
    expect(byId["tmd:TMD20261009164949_2-en"]).toMatchObject({ severity: "info", eventEligibility: false, weather: { alertState: "expired" } })
    // no live alert on 2026-10-10 covers Chon Buri (TH-20), so no port association
    expect(batch.items.every(item => item.relatedPortIds.length === 0)).toBe(true)
  })
})

describe("cAP lifecycle (synthetic)", () => {
  const ctx = capSourceContext(tmd)
  const at = "2026-10-10T05:00:00.000Z"

  it("parseWeatherAlertCap no longer forces active: lifecycle comes from CAP fields", () => {
    expect(parseWeatherAlertCap(cap({ id: "A1" }), tmd, [], at)[0]).toMatchObject({ eventEligibility: true, weather: { alertState: "active" }, relatedPortIds: ["port-laem-chabang"] })
    expect(parseWeatherAlertCap(cap({ id: "A2", expires: null }), tmd, [], at)[0]).toMatchObject({ eventEligibility: false, weather: { alertState: "unknown" } })
    expect(parseWeatherAlertCap(cap({ id: "A3", expires: "2026-10-10T11:00:00+07:00" }), tmd, [], at)[0]).toMatchObject({ eventEligibility: false, severity: "info", weather: { alertState: "expired" } })
    expect(parseWeatherAlertCap(cap({ id: "A4", expires: "not-a-date" }), tmd, [], at)[0]).toMatchObject({ eventEligibility: false, weather: { alertState: "unknown" } })
  })

  it.each(["Test", "Exercise", "System", "Draft", ""])("status %s is ignored", (status) => {
    const batch = resolveCapBatch([parseCapMessage(cap({ id: "T1", status }))], ctx, at)
    expect(batch.items).toEqual([])
  })

  it("ack/Error msgType is ignored", () => {
    expect(resolveCapBatch([parseCapMessage(cap({ id: "E1", msgType: "Ack" })), parseCapMessage(cap({ id: "E2", msgType: "Error" }))], ctx, at).items).toEqual([])
  })

  it("update supersedes the referenced alert", () => {
    const batch = resolveCapBatch([
      parseCapMessage(cap({ id: "U0" })),
      parseCapMessage(cap({ id: "U1", msgType: "Update", references: "TMD,U0,2026-10-10T05:00:00+07:00" })),
    ], ctx, at)
    expect(batch.items.map(i => i.weather?.alertId)).toEqual(["tmd:U1-en"])
  })

  it("cancel removes the referenced alert and is not itself an alert", () => {
    const batch = resolveCapBatch([
      parseCapMessage(cap({ id: "C0" })),
      parseCapMessage(cap({ id: "C1", msgType: "Cancel", references: "TMD,C0,2026-10-10T05:00:00+07:00" })),
    ], ctx, at)
    expect(batch.items).toEqual([])
  })

  it("severity mapping", () => {
    expect(["Extreme", "Severe", "Moderate", "Minor", "Unknown", undefined].map(capSeverity)).toEqual(["critical", "warning", "watch", "info", "info", "info"])
  })

  it("missing structured area => no region and no port", () => {
    expect(resolveCapBatch([parseCapMessage(cap({ id: "M1", geocodes: [] }))], ctx, at).items[0]).toMatchObject({ relatedPortIds: [], weather: { alertRegion: undefined } })
  })

  it("cross-country geocodes are dropped", () => {
    const [item] = resolveCapBatch([parseCapMessage(cap({ id: "X1", geocodes: ["VN-SG", "MY-10"] }))], ctx, at).items
    expect(item).toMatchObject({ relatedPortIds: [], weather: { alertRegion: undefined } })
    const [mixed] = resolveCapBatch([parseCapMessage(cap({ id: "X2", geocodes: ["VN-SG", "TH-20"] }))], ctx, at).items
    expect(mixed).toMatchObject({ relatedPortIds: ["port-laem-chabang"], weather: { alertRegion: "TH-20" } })
  })
})

describe("cAP body source restriction (unit)", () => {
  it("accepts only https://www.tmd.go.th/uploads/CAP/en/<name>.xml", () => {
    expect(capBodyUrlRejection("https://www.tmd.go.th/uploads/CAP/en/CAPTMD20261010062912_2.xml")).toBeUndefined()
  })

  it.each([
    ["https://evil.example/uploads/CAP/en/CAPX.xml", "host"],
    ["https://tmd.go.th/uploads/CAP/en/CAPX.xml", "host"],
    ["https://www.tmd.go.th.evil.example/uploads/CAP/en/CAPX.xml", "host"],
    ["http://www.tmd.go.th/uploads/CAP/en/CAPX.xml", "scheme"],
    ["https://user:pw@www.tmd.go.th/uploads/CAP/en/CAPX.xml", "credentials"],
    ["https://www.tmd.go.th@evil.example/uploads/CAP/en/CAPX.xml", "credentials"],
    ["https://www.tmd.go.th:8443/uploads/CAP/en/CAPX.xml", "port"],
    ["https://www.tmd.go.th/uploads/CAP/th/CAPX.xml", "path"],
    ["https://www.tmd.go.th/uploads/CAP/en/sub/CAPX.xml", "path"],
    ["https://www.tmd.go.th/uploads/CAP/en/CAPX.xml?x=1", "query_or_fragment"],
    ["https://www.tmd.go.th/uploads/CAP/en/../../admin/CAPX.xml", "path_disguise"],
    ["https://www.tmd.go.th/uploads/CAP/en/%2e%2e/%2e%2e/CAPX.xml", "path_disguise"],
    ["https://www.tmd.go.th/uploads/CAP/en/..%2fCAPX.xml", "path_disguise"],
    ["https://www.tmd.go.th/uploads/CAP/en/..\\CAPX.xml", "path_disguise"],
    ["https://www.tmd.go.th/other/../uploads/CAP/en/CAPX.xml", "path_disguise"],
  ])("rejects %s (%s)", (url, reason) => {
    expect(capBodyUrlRejection(url)).toBe(reason)
  })

  it("non-empty index with any invalid or missing link throws instead of filtering", () => {
    expect(() => capIndexLinks(indexFor([DOC("A"), "https://evil.example/uploads/CAP/en/CAPX.xml"]))).toThrow(/structural/)
    expect(() => capIndexLinks(`<rss><channel><item><title>x</title></item></channel></rss>`)).toThrow(/structural/)
    expect(capIndexLinks(indexFor([]))).toEqual([])
  })
})

describe("cAP control-message time gating (unit, same batch)", () => {
  const ctx = capSourceContext(tmd)
  const at = "2026-10-10T05:00:00.000Z"
  it.each([
    ["future", "2026-10-11T06:00:00+07:00"],
    ["unparseable", "not-a-date"],
    ["missing", null],
  ])("cancel/Update with %s sent does not revoke or supersede", (_label, sent) => {
    const cancel = resolveCapBatch([parseCapMessage(cap({ id: "G0" })), parseCapMessage(cap({ id: "G1", msgType: "Cancel", noInfo: true, sent, references: "TMD,G0,2026-10-10T06:00:00+07:00" }))], ctx, at)
    expect(cancel.items.map(i => i.weather?.alertId)).toEqual(["tmd:G0-en"])
    expect(cancel.ignored).toContainEqual({ identifier: "G1-en", reason: "control_sent_missing_invalid_or_future" })
    const update = resolveCapBatch([parseCapMessage(cap({ id: "H0" })), parseCapMessage(cap({ id: "H1", msgType: "Update", sent, references: "TMD,H0,2026-10-10T06:00:00+07:00" }))], ctx, at)
    expect(update.items.map(i => i.weather?.alertId)).toEqual(["tmd:H0-en", "tmd:H1-en"])
    expect(update.items[1]).toMatchObject({ eventEligibility: false, weather: { alertState: "unknown" } })
  })

  it("cancel without info/expires and a valid sent revokes in the same batch", () => {
    const batch = resolveCapBatch([parseCapMessage(cap({ id: "J0" })), parseCapMessage(cap({ id: "J1", msgType: "Cancel", noInfo: true, references: "TMD,J0,2026-10-10T06:00:00+07:00" }))], ctx, "2026-10-10T00:00:00.000Z")
    expect(batch.items).toEqual([])
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

function laemChabang(): Port {
  const port = createMockSnapshot().ports.find(p => p.id === "port-laem-chabang")!
  return { ...port, provenance: { sourceType: "official", dataNature: "reported", sourceId: "unlocode", verified: true } }
}

describe("tMD CAP → provider → SQLite (sync job) → panel service layer", () => {
  async function setup() {
    const { database, native } = db()
    await initShippingTables(database, "real")
    const repository = new ShippingRepository(database, "real")
    await repository.seed([laemChabang()], [], [], createMockSnapshot().settings)
    return { database, native, repository }
  }
  // Same provider options as server/runtime/registry.ts weatherAlertJobs (throwOnSourceFailureWithoutLastKnown: true).
  async function runOnce(database: ReturnType<typeof db>["database"], index: string, docs: Record<string, string>, nowIso: string, redirects: Record<string, string> = {}) {
    const provider = createOfficialWeatherAlertProvider({ sources: [tmd], fetcher: fetcherFor(index, docs, redirects), now: () => new Date(nowIso), throwOnSourceFailureWithoutLastKnown: true })
    const job = createWeatherAlertSyncJob({ database, dataMode: "real", sourceId: "tmd", provider: provider as typeof provider & { providerId: string }, intervalMs: 900_000, now: () => new Date(nowIso) })
    return job.run()
  }
  async function panel(repository: ShippingRepository, nowIso: string) {
    const now = new Date(nowIso)
    const feed: FeedItem[] = await repository.listFeedItems({ now, view: "current" })
    return getPortWeatherPanel(repository, "port-laem-chabang", feed, "test", "TMD", { now })
  }
  const T0 = "2026-10-10T00:00:00.000Z"

  it("positive: an active Actual alert for TH-20 is stored and reaches officialAlerts + WR-O01 potential impact", async () => {
    const { database, native, repository } = await setup()
    await expect(runOnce(database, indexFor([DOC("P1")]), { [DOC("P1")]: cap({ id: "P1" }) }, T0)).resolves.toMatchObject({ status: "success", recordsRead: 1 })
    const view = await panel(repository, T0)
    expect(view.officialAlerts.map(a => a.sourceId)).toEqual(["tmd"])
    expect(view.officialAlertImpacts).toEqual([expect.objectContaining({ ruleId: "WR-O01", status: "potential", severity: "warning" })])
    native.close()
  })

  it("test-status alert is ignored end to end", async () => {
    const { database, native, repository } = await setup()
    await runOnce(database, indexFor([DOC("Q1")]), { [DOC("Q1")]: cap({ id: "Q1", status: "Test" }) }, T0)
    expect((await panel(repository, T0)).officialAlertImpacts).toEqual([])
    native.close()
  })

  it("cancel in a later run removes the stored alert's impact", async () => {
    const { database, native, repository } = await setup()
    await runOnce(database, indexFor([DOC("K0")]), { [DOC("K0")]: cap({ id: "K0" }) }, T0)
    expect((await panel(repository, T0)).officialAlertImpacts).toHaveLength(1)
    await runOnce(database, indexFor([DOC("K1")]), { [DOC("K1")]: cap({ id: "K1", msgType: "Cancel", references: "TMD,K0,2026-10-10T06:00:00+07:00" }) }, "2026-10-10T00:15:00.000Z")
    const stored = (await repository.listFeedItems({ view: "all" })).find(item => item.weather?.alertId === "tmd:K0-en")
    expect(stored).toMatchObject({ eventEligibility: false, weather: { alertState: "expired" } })
    expect((await panel(repository, "2026-10-10T00:15:00.000Z")).officialAlertImpacts).toEqual([])
    native.close()
  })

  it("update in a later run supersedes: only the new message drives the impact", async () => {
    const { database, native, repository } = await setup()
    await runOnce(database, indexFor([DOC("V0")]), { [DOC("V0")]: cap({ id: "V0", severity: "Moderate" }) }, T0)
    await runOnce(database, indexFor([DOC("V1")]), { [DOC("V1")]: cap({ id: "V1", msgType: "Update", references: "TMD,V0,2026-10-10T06:00:00+07:00", severity: "Extreme" }) }, "2026-10-10T00:15:00.000Z")
    const impacts = (await panel(repository, "2026-10-10T00:15:00.000Z")).officialAlertImpacts
    expect(impacts.map(i => [i.inputValues.officialAlertId, i.severity])).toEqual([["tmd:V1-en", "critical"]])
    native.close()
  })

  it("expired alert yields no impact", async () => {
    const { database, native, repository } = await setup()
    await runOnce(database, indexFor([DOC("X0")]), { [DOC("X0")]: cap({ id: "X0", expires: "2026-10-10T06:30:00+07:00" }) }, T0)
    expect((await panel(repository, T0)).officialAlertImpacts).toEqual([])
    native.close()
  })

  it("missing area or cross-country area yields no port impact", async () => {
    const { database, native, repository } = await setup()
    await runOnce(database, indexFor([DOC("N0"), DOC("N1")]), { [DOC("N0")]: cap({ id: "N0", geocodes: [] }), [DOC("N1")]: cap({ id: "N1", geocodes: ["VN-SG"] }) }, T0)
    expect((await panel(repository, T0)).officialAlertImpacts).toEqual([])
    native.close()
  })

  it("an empty index is a valid 'no active alerts' run", async () => {
    const { database, native } = await setup()
    await expect(runOnce(database, indexFor([]), {}, T0)).resolves.toMatchObject({ status: "success", recordsRead: 0 })
    native.close()
  })

  it("first-time CAP document failure fails the whole run (production config) and stores nothing", async () => {
    const { database, native, repository } = await setup()
    await expect(runOnce(database, indexFor([DOC("F0")]), {}, T0)).rejects.toThrow()
    expect(await repository.listFeedItems({ view: "all" })).toEqual([])
    native.close()
  })

  it("cAP document failure with existing records keeps them as stale/failed instead of dropping them", async () => {
    const { database, native, repository } = await setup()
    await runOnce(database, indexFor([DOC("S0")]), { [DOC("S0")]: cap({ id: "S0" }) }, T0)
    const result = await runOnce(database, indexFor([DOC("S0"), DOC("S1")]), { [DOC("S0")]: cap({ id: "S0" }) }, "2026-10-10T00:15:00.000Z")
    expect(result.status).toBe("failed")
    const stored = (await repository.listFeedItems({ view: "all" })).filter(item => item.sourceId === "tmd")
    expect(stored).toEqual([expect.objectContaining({ weather: expect.objectContaining({ alertId: "tmd:S0-en" }), stale: true, sourceStatus: "failed" })])
    expect((await panel(repository, "2026-10-10T00:15:00.000Z")).officialAlertImpacts).toEqual([])
    native.close()
  })

  it("an out-of-scope body link in a non-empty index is a structural failure, not 'no alerts'", async () => {
    const { database, native, repository } = await setup()
    await expect(runOnce(database, indexFor([DOC("G0"), "https://evil.example/uploads/CAP/en/CAPX.xml"]), { [DOC("G0")]: cap({ id: "G0" }) }, T0)).rejects.toThrow(/structural/)
    expect(await repository.listFeedItems({ view: "all" })).toEqual([])
    native.close()
  })

  it("cross-host redirect of a CAP body is rejected; bodies are requested with redirect=error", async () => {
    const { database, native, repository } = await setup()
    fetchInits.length = 0
    await expect(runOnce(database, indexFor([DOC("H0")]), {}, T0, { [DOC("H0")]: "https://evil.example/CAP.xml" })).rejects.toThrow(/redirect/)
    expect(fetchInits.find(call => call.url === DOC("H0"))?.redirect).toBe("error")
    expect(await repository.listFeedItems({ view: "all" })).toEqual([])
    native.close()
  })

  it("cancel with a future sent does not revoke a stored alert (cross-run)", async () => {
    const { database, native, repository } = await setup()
    await runOnce(database, indexFor([DOC("W0")]), { [DOC("W0")]: cap({ id: "W0" }) }, T0)
    await runOnce(database, indexFor([DOC("W1")]), { [DOC("W1")]: cap({ id: "W1", msgType: "Cancel", noInfo: true, sent: "2026-10-12T06:00:00+07:00", references: "TMD,W0,2026-10-10T06:00:00+07:00" }) }, "2026-10-10T00:15:00.000Z")
    const stored = (await repository.listFeedItems({ view: "all" })).find(item => item.weather?.alertId === "tmd:W0-en")
    expect(stored?.weather?.alertState).not.toBe("expired")
    native.close()
  })

  it("cancel without info/expires but with a valid sent revokes a stored alert (cross-run)", async () => {
    const { database, native, repository } = await setup()
    await runOnce(database, indexFor([DOC("Y0")]), { [DOC("Y0")]: cap({ id: "Y0" }) }, T0)
    await runOnce(database, indexFor([DOC("Y1")]), { [DOC("Y1")]: cap({ id: "Y1", msgType: "Cancel", noInfo: true, sent: "2026-10-10T07:10:00+07:00", references: "TMD,Y0,2026-10-10T06:00:00+07:00" }) }, "2026-10-10T00:15:00.000Z")
    const stored = (await repository.listFeedItems({ view: "all" })).find(item => item.weather?.alertId === "tmd:Y0-en")
    expect(stored).toMatchObject({ eventEligibility: false, weather: { alertState: "expired" } })
    native.close()
  })
})
