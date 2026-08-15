import { describe, expect, it } from "vitest"
import { mockPorts } from "@shared/shipping-fixtures"
import { createOfficialWeatherAlertProvider, officialWeatherAlertSources, parseJmaWarning, parseTmdWarning, parseWeatherAlertCap, parseWeatherAlertRss } from "./weather-alerts"

const jma = officialWeatherAlertSources.find(source => source.id === "jma")!
const tmd = officialWeatherAlertSources.find(source => source.id === "tmd")!
const bmkg = officialWeatherAlertSources.find(source => source.id === "bmkg")!

describe("official weather alert provider", () => {
  it("parses a source-specific TMD warning structure", () => {
    const [item] = parseTmdWarning(`
      <main><section class="warning-list"><article class="warning-item"><h3>Gale warning for Laem Chabang</h3><p class="summary">Strong wind is expected near the port.</p><a href="/warning/1">Detail</a><time datetime="2026-08-15T00:00:00Z">15 Aug</time><time datetime="2026-08-16T00:00:00Z">16 Aug</time></article></section></main>
    `, tmd, mockPorts, "2026-08-15T01:00:00.000Z")
    expect(item).toMatchObject({
      sourceId: "tmd",
      type: "weather_warning_official",
      severity: "warning",
      relatedPortIds: ["port-laem-chabang"],
      weather: { riskSource: "official", alertState: "active", alertExpiresAt: "2026-08-16T00:00:00.000Z" },
      provenance: { sourceType: "official", dataNature: "reported", sourceId: "tmd", verified: true },
    })
  })

  it("uses source-specific JMA and BMKG structures", () => {
    const [jmaItem] = parseJmaWarning(`<div id="contents"><table><tbody><tr><td><a href="/bosai/information/typhoon.html?id=1">台風第7号に関する情報</a><time datetime="2026-08-15T00:00:00Z">2026-08-15</time></td></tr></tbody></table></div>`, jma, mockPorts, "2026-08-15T01:00:00.000Z")
    const [bmkgItem] = parseWeatherAlertRss(`<rss><channel><lastBuildDate>Sat, 15 Aug 2026 06:00:00 GMT</lastBuildDate><item><title>Extreme weather warning Bangka Belitung</title><description>Heavy rain and strong wind.</description><link>https://www.bmkg.go.id/alerts/nowcast/en/1</link><pubDate>Sat, 15 Aug 2026 05:15:00 GMT</pubDate></item></channel></rss>`, bmkg, mockPorts, "2026-08-15T05:30:00.000Z")
    expect(jmaItem).toMatchObject({ sourceId: "jma", eventEligibility: true, weather: { alertIssuedAt: "2026-08-15T00:00:00.000Z" } })
    expect(bmkgItem).toMatchObject({ sourceId: "bmkg", eventEligibility: true, sourceUpdatedAt: "2026-08-15T06:00:00.000Z", provenance: { sourceId: "bmkg" } })
  })

  it("maps official CAP timestamps and provenance without relying on HTML", () => {
    const [item] = parseWeatherAlertCap(`
      <alert><identifier>tmd-123</identifier><sent>2026-08-15T00:00:00Z</sent><info><event>Gale Warning</event><effective>2026-08-15T01:00:00Z</effective><onset>2026-08-15T02:00:00Z</onset><expires>2026-08-15T06:00:00Z</expires><severity>Severe</severity><urgency>Immediate</urgency><certainty>Likely</certainty><headline>Gale warning near Laem Chabang</headline><description>Strong wind is expected.</description><area><areaDesc>Laem Chabang</areaDesc></area></info></alert>
    `, tmd, mockPorts, "2026-08-15T03:00:00.000Z")
    expect(item).toMatchObject({ sourceId: "tmd", publishedAt: "2026-08-15T00:00:00.000Z", sourceUpdatedAt: "2026-08-15T00:00:00.000Z", eventEligibility: true, severity: "warning", weather: { alertEffectiveAt: "2026-08-15T01:00:00.000Z", alertExpiresAt: "2026-08-15T06:00:00.000Z", alertUrgency: "Immediate", alertCertainty: "Likely" }, provenance: { sourceType: "official", dataNature: "reported", sourceId: "tmd" } })
  })

  it("does not invent alerts from an empty or unrelated page", async () => {
    expect(parseTmdWarning("<html><body><h1>No active warnings</h1></body></html>", tmd, mockPorts)).toEqual([])
    const provider = createOfficialWeatherAlertProvider({ allowPending: true, sources: [tmd], fetcher: async () => ({ ok: true, status: 200, text: async () => "<html><body>No active warnings</body></html>" }) })
    expect(await provider.getFeedItems([], mockPorts)).toEqual([])
  })

  it("does not enable unverified official parsers in public mode", async () => {
    expect(officialWeatherAlertSources.every(source => source.enabled === false && source.liveStatus === "live_pending")).toBe(true)
    let requests = 0
    const provider = createOfficialWeatherAlertProvider({
      fetcher: async () => {
        requests += 1
        return { ok: true, status: 200, text: async () => "" }
      },
    })
    const [previous] = parseJmaWarning(`<div id="contents"><table><tbody><tr><td><a href="/warning/1">Marine gale warning</a><time datetime="2026-08-15T00:00:00Z">2026-08-15</time></td></tr></tbody></table></div>`, jma, mockPorts, "2026-08-15T00:00:00.000Z")
    const items = await provider.getFeedItems([previous], mockPorts)
    expect(requests).toBe(0)
    expect(items[0]).toMatchObject({ id: previous.id, stale: true, sourceStatus: "disabled", error: "official_weather_source_live_pending" })
  })

  it("expires a disappeared warning without changing official timestamps, while failures stay stale", async () => {
    const [previous] = parseTmdWarning(`<section class="warning-list"><article class="warning-item"><h3>Gale warning</h3><p>Wind warning</p><a href="/warning/1">Detail</a><time datetime="2026-08-15T00:00:00Z">15 Aug</time><time datetime="2026-08-15T02:00:00Z">16 Aug</time></article></section>`, tmd, mockPorts, "2026-08-15T00:00:00.000Z")
    const tmdHtml = { ...tmd, format: "html" as const }
    let mode: "cleared" | "failed" = "cleared"
    const provider = createOfficialWeatherAlertProvider({
      allowPending: true,
      now: () => new Date("2026-08-15T03:00:00.000Z"),
      sources: [tmdHtml],
      fetcher: async () => mode === "cleared"
        ? { ok: true, status: 200, text: async () => "<section class=\"warning-list\"></section>" }
        : { ok: false, status: 503, text: async () => "" },
    })
    const cleared = await provider.getFeedItems([previous], mockPorts)
    expect(cleared[0]).toMatchObject({ id: previous.id, severity: "info", stale: false, sourceStatus: "healthy", eventEligibility: false, updatedAt: previous.updatedAt, sourceUpdatedAt: previous.sourceUpdatedAt, fetchedAt: "2026-08-15T03:00:00.000Z" })
    mode = "failed"
    const failed = await provider.getFeedItems([previous], mockPorts)
    expect(failed[0]).toMatchObject({ id: previous.id, severity: "warning", stale: true, sourceStatus: "failed", sourceUpdatedAt: previous.sourceUpdatedAt })
  })

  it("keeps last-known warnings stale when a source parser cannot recognize the response", async () => {
    const [previous] = parseJmaWarning(`<div id="contents"><table><tbody><tr><td><a href="/warning/1">Marine gale warning</a><time datetime="2026-08-15T00:00:00Z">2026-08-15</time></td></tr></tbody></table></div>`, jma, mockPorts, "2026-08-15T00:00:00.000Z")
    const provider = createOfficialWeatherAlertProvider({ allowPending: true, sources: [jma], fetcher: async () => ({ ok: true, status: 200, text: async () => "<html><body>unrecognized layout</body></html>" }) })
    const [item] = await provider.getFeedItems([previous], mockPorts)
    expect(item).toMatchObject({ id: previous.id, stale: true, sourceStatus: "failed", sourceUpdatedAt: previous.sourceUpdatedAt })
  })
})
