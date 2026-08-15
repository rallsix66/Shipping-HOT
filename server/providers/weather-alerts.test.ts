import { describe, expect, it } from "vitest"
import { mockPorts } from "@shared/shipping-fixtures"
import { createOfficialWeatherAlertProvider, officialWeatherAlertSources, parseBmkgWarning, parseJmaWarning, parseTmdWarning } from "./weather-alerts"

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
    const [bmkgItem] = parseBmkgWarning(`<div class="table-responsive"><table><tbody><tr><td><a href="/cuaca/peringatan-dini-cuaca/detail/1">Bangka Belitung</a></td><td><time datetime="2026-08-15T05:15:00Z">Mulai</time><time datetime="2026-08-15T07:00:00Z">Berakhir</time></td></tr></tbody></table></div>`, bmkg, mockPorts, "2026-08-15T01:00:00.000Z")
    expect(jmaItem).toMatchObject({ sourceId: "jma", eventEligibility: true, weather: { alertIssuedAt: "2026-08-15T00:00:00.000Z" } })
    expect(bmkgItem).toMatchObject({ sourceId: "bmkg", weather: { alertExpiresAt: "2026-08-15T07:00:00.000Z" } })
  })

  it("does not invent alerts from an empty or unrelated page", async () => {
    expect(parseTmdWarning("<html><body><h1>No active warnings</h1></body></html>", tmd, mockPorts)).toEqual([])
    const provider = createOfficialWeatherAlertProvider({ sources: [tmd], fetcher: async () => ({ ok: true, status: 200, text: async () => "<html><body>No active warnings</body></html>" }) })
    expect(await provider.getFeedItems([], mockPorts)).toEqual([])
  })

  it("expires a disappeared warning without changing official timestamps, while failures stay stale", async () => {
    const [previous] = parseTmdWarning(`<section class="warning-list"><article class="warning-item"><h3>Gale warning</h3><p>Wind warning</p><a href="/warning/1">Detail</a><time datetime="2026-08-15T00:00:00Z">15 Aug</time><time datetime="2026-08-15T02:00:00Z">16 Aug</time></article></section>`, tmd, mockPorts, "2026-08-15T00:00:00.000Z")
    let mode: "cleared" | "failed" = "cleared"
    const provider = createOfficialWeatherAlertProvider({
      now: () => new Date("2026-08-15T03:00:00.000Z"),
      sources: [tmd],
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
})
