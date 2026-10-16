import { readFileSync } from "node:fs"
import { renderToString } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"
import type { PortWeatherPanelResponse } from "@shared/shipping"
import { createMockSnapshot } from "@shared/shipping-fixtures"
import { FeedNoticeMetadata } from "../src/components/shipping/feed-notice-metadata"
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
  it("discloses stale historical publication without deriving expiry from the date", () => {
    const item = { ...createMockSnapshot().feedItems[0], publishedAt: "2020-01-01T00:00:00Z", publicationTimeKnown: true, stale: true }
    const html = renderToString(FeedNoticeMetadata({ item }))
    expect(html).toContain("发布时间")
    expect(html).toContain("2020")
    expect(html).toContain("缓存已过期")
    expect(html).not.toContain("预警状态：已过期")
  })
  it("keeps source failure and persisted expired/unknown lifecycle states visible", () => {
    const item = { ...createMockSnapshot().feedItems[0], sourceStatus: "failed" as const, weather: { riskSource: "official" as const, alertState: "expired" as const, validityStatus: "unknown" as const, lifecycleStatus: "unknown" as const } }
    const html = renderToString(FeedNoticeMetadata({ item }))
    for (const label of ["数据源失败", "预警状态：已过期", "有效性待确认", "生命周期未知"]) expect(html).toContain(label)
  })
  it("does not display a placeholder timestamp as a known publication", () => {
    const item = { ...createMockSnapshot().feedItems[0], publishedAt: "2001-01-01T00:00:00Z", publicationTimeKnown: false }
    const html = renderToString(FeedNoticeMetadata({ item }))
    expect(html).toContain("发布时间未知")
    expect(html).not.toContain("2001")
  })
  it("labels received_at as first receipt even if publicationTimeKnown is false", () => {
    const item = { ...createMockSnapshot().feedItems[0], publicationTimeKnown: false, publishedAt: "2026-10-14T00:00:00Z", weather: { riskSource: "official" as const, timeBasis: "received_at" as const } }
    const html = renderToString(FeedNoticeMetadata({ item }))
    expect(html).toContain("发布时间未知")
    expect(html).toContain("首次接收")
    expect(html).toContain("非发布时间")
    expect(html).not.toMatch(/发布时间 2026/)
  })
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
