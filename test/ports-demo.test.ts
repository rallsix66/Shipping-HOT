import { readFileSync } from "node:fs"
import { renderToString } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"
import type { PortWeatherPanelResponse } from "@shared/shipping"
import { demoFocusPorts } from "../src/components/shipping/port-focus"
import { ForecastTable, PortWeatherPanelView } from "../src/components/shipping/port-weather"

vi.mock("../src/components/shipping/data", () => ({ usePortWeather: () => ({}) }))

function panel(state: PortWeatherPanelResponse["state"]): PortWeatherPanelResponse {
  return {
    portId: "port-ho-chi-minh",
    state,
    forecasts: [],
    impacts: [],
    officialAlerts: [],
    sources: { forecast: "synthetic", impacts: "system", alerts: "off" },
    ruleCoverage: [],
    precipCoverage: { status: "insufficient", hourlySamplesInWindow: 0, fullRequired: 24 },
    impactMeta: { truncated: false },
    forecastMeta: { targetWindow: { start: "2026-10-14T00:00:00Z", end: "2026-10-21T00:00:00Z" }, actualCoverage: { totalReturned: 0, hourlyReturned: 0, currentReturned: 0 }, missingCounts: {} },
  } as unknown as PortWeatherPanelResponse
}

describe("demo ports scope and weather trust", () => {
  it("uses exactly the approved eight ports in demo order, with stable existing IDs", () => {
    expect(demoFocusPorts.map(p => p.unlocode)).toEqual(["CNYTN", "CNSHK", "CNNSA", "VNSGN", "THLCH", "MYPKG", "IDJKT", "PHMNL"])
    expect(new Set(demoFocusPorts.map(p => p.shippingPortId)).size).toBe(8)
    expect(readFileSync("src/routes/ports.tsx", "utf8")).toContain("DemoPortsPage")
  })
  it("preserves numerical zero, missing marine values and hourly units without daily aggregation", () => {
    const html = renderToString(ForecastTable({ rows: [{ id: "fixture", portId: "port-ho-chi-minh", horizon: "hourly", forecastAt: "2026-10-14T00:00:00Z", fetchedAt: "2026-10-14T00:00:00Z", sourceId: "synthetic", precipitationMm: 0, windGustKmh: 0 }] }))
    expect(html).toContain("km/h")
    expect(html).toContain("mm（原值）")
    expect(html).toContain("不是日累计")
    expect(html).toContain("<td>0</td>")
    expect(html).toContain("缺测")
    expect(html).not.toContain("正常")
  })
  it.each(["data_stale", "sync_failed", "data_empty", "partial_rule_coverage"] as const)("keeps %s distinct from no risk", (state) => {
    const html = renderToString(PortWeatherPanelView({ data: panel(state) }))
    expect(html).not.toContain("港口正常")
    expect(html).toContain(state === "data_stale" ? "已过期" : state === "sync_failed" ? "同步失败" : state === "partial_rule_coverage" ? "未评估" : "暂无")
  })
  it("keeps a stale engineering reference independent of missing original-point marine", () => {
    const data = panel("data_empty")
    data.marineReference = { nameZh: "独立海况参考点", labelZh: "工程参考，不能冒充泊位海况", latitude: 10, longitude: 107, approxDistanceKm: 62, model: "synthetic", status: "stale", statusNoteZh: "已过期", showingHistoricalData: true, lastSuccessAt: "2026-10-01T00:00:00Z", coverage: { hourlyWithMarine: 3, expectedHours: 169 }, maxWaveHeightM: 9.5, impacts: [], historicalImpactCount: 2 } as unknown as NonNullable<PortWeatherPanelResponse["marineReference"]>
    const html = renderToString(PortWeatherPanelView({ data }))
    expect(html).toContain("不能冒充泊位海况")
    expect(html).toContain("62 km")
    expect(html).toContain("历史参考")
    expect(html).toContain("不计入当前")
    expect(data.forecasts).toEqual([])
  })
})
