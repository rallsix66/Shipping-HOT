import { describe, expect, it } from "vitest"
import { mockPorts } from "@shared/shipping-fixtures"
import { createOfficialWeatherAlertProvider, officialWeatherAlertSources, parseWeatherAlertHtml, parseWeatherAlertRss } from "./weather-alerts"

const tmd = officialWeatherAlertSources.find(source => source.id === "tmd")!

describe("official weather alert provider", () => {
  it("normalizes explicit HTML warning metadata as official reported data", () => {
    const [item] = parseWeatherAlertHtml(`
      <article data-weather-warning data-title="Gale warning for Laem Chabang" data-summary="Strong wind is expected near the port." data-severity="warning" data-region="Thailand Gulf" data-issued-at="2026-08-15T00:00:00Z" data-expires-at="2026-08-16T00:00:00Z" data-url="/warning/1"><a href="/warning/1">Gale warning</a></article>
    `, tmd, mockPorts, "2026-08-15T01:00:00.000Z")
    expect(item).toMatchObject({
      sourceId: "tmd",
      type: "weather_warning_official",
      severity: "warning",
      relatedPortIds: ["port-laem-chabang"],
      weather: { riskSource: "official", alertRegion: "Thailand Gulf", alertExpiresAt: "2026-08-16T00:00:00.000Z" },
      provenance: { sourceType: "official", dataNature: "reported", sourceId: "tmd", verified: true },
    })
  })

  it("supports RSS fixtures and does not invent alerts from an unstructured page", () => {
    const [item] = parseWeatherAlertRss(`<rss><channel><item><title>Typhoon warning</title><description>Typhoon signal for Manila.</description><link>https://official.example/warnings/1</link><pubDate>2026-08-15T00:00:00Z</pubDate><severity>critical</severity></item></channel></rss>`, { ...tmd, format: "rss" }, mockPorts, "2026-08-15T01:00:00.000Z")
    expect(item).toMatchObject({ severity: "critical", relatedPortIds: ["port-laem-chabang", "port-manila"] })
    expect(parseWeatherAlertHtml("<html><body><h1>No active warnings</h1></body></html>", tmd, mockPorts)).toEqual([])
  })

  it("isolates failures and expires an official warning without leaving a HOT severity", async () => {
    const [previous] = parseWeatherAlertHtml(`<article data-weather-warning data-title="Gale warning" data-summary="Wind warning" data-severity="warning" data-issued-at="2026-08-15T00:00:00Z" data-expires-at="2026-08-15T02:00:00Z" data-url="/warning/1" />`, tmd, mockPorts, "2026-08-15T00:00:00.000Z")
    let mode: "expired" | "failed" = "expired"
    const provider = createOfficialWeatherAlertProvider({
      now: () => new Date("2026-08-15T03:00:00.000Z"),
      sources: [tmd],
      fetcher: async () => mode === "expired"
        ? { ok: true, status: 200, text: async () => "<html><body>No active warnings</body></html>" }
        : { ok: false, status: 503, text: async () => "" },
    })
    const expired = await provider.getFeedItems([previous], mockPorts)
    expect(expired[0]).toMatchObject({ id: previous.id, severity: "info", stale: false, sourceStatus: "healthy" })
    mode = "failed"
    const failed = await provider.getFeedItems([previous], mockPorts)
    expect(failed[0]).toMatchObject({ id: previous.id, severity: "warning", stale: true, sourceStatus: "failed" })
  })
})
