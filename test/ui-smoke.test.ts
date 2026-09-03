import { renderToString } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { createMockSnapshot } from "@shared/shipping-fixtures"
import { FeedItemDisplayText } from "../src/components/shipping/feed-display"
import { EmptyState, GradientText, ProvenanceBadge, ProviderChip, StatusDot } from "../src/components/shipping/ui"
import { formatDataNature, formatDate, formatPortMetric, formatProvenance, formatSourceStatus, formatSourceType, formatStatus, navTone, providerSummary, severityTone, statusBadgePresentation, statusLabels } from "../src/components/shipping/format"

/**
 * UI 烟雾护栏：不引入 jsdom/testing-library 的前提下，
 * 用 renderToString 验证共享原语能渲染出关键类名与内容，
 * 并锁定 format 纯函数的标签/色调映射。
 */
describe("shipping UI primitives smoke", () => {
  it("renders StatusDot with tone and pulse classes", () => {
    const html = renderToString(StatusDot({ tone: "fresh", pulse: true }))
    expect(html).toContain("status-dot")
    expect(html).toContain("fresh")
    expect(html).toContain("pulse")
  })

  it("renders ProviderChip with label, value and tone dot", () => {
    const html = renderToString(ProviderChip({ label: "船位", value: "mock", tone: "dim" }))
    expect(html).toContain("船位")
    expect(html).toContain("mock")
    expect(html).toContain("status-dot")
  })

  it("renders mock and third-party provenance without exposing code-only labels", () => {
    const mockHtml = renderToString(ProvenanceBadge({ provenance: { sourceType: "mock", dataNature: "forecast", sourceId: "mock-weather", verified: false } }))
    const realHtml = renderToString(ProvenanceBadge({ provenance: { sourceType: "third_party", dataNature: "observed", sourceId: "aisstream", verified: false } }))
    expect(mockHtml).toContain("模拟数据")
    expect(realHtml).toContain("aisstream")
    expect(realHtml).toContain("第三方")
    expect(realHtml).toContain("观测")
    expect(realHtml).not.toContain("third_party")
  })

  it("renders EmptyState with icon and text", () => {
    const html = renderToString(EmptyState({ text: "暂无数据" }))
    expect(html).toContain("i-ph-waves")
    expect(html).toContain("暂无数据")
  })

  it("prioritizes provider status over stale freshness in StatusBadge", () => {
    expect(statusBadgePresentation({ sourceStatus: "disabled", stale: true }).label).toBe("已禁用")
    expect(statusBadgePresentation({ sourceStatus: "failed", stale: true }).label).toBe("数据源失败")
    expect(statusBadgePresentation({ sourceStatus: "degraded", stale: true }).label).toBe("数据源降级")
    expect(statusBadgePresentation({ sourceStatus: "healthy", stale: true }).label).toBe("已过期")
  })

  it("renders GradientText wrapper", () => {
    const html = renderToString(GradientText({ children: "HOT" }))
    expect(html).toContain("gradient-text")
    expect(html).toContain("HOT")
  })

  it("keeps format label mapping stable", () => {
    expect(formatStatus("under_way")).toBe("航行中")
    expect(formatStatus("unknown_key")).toBe("unknown key")
    expect(formatSourceStatus("healthy")).toBe("正常")
    expect(formatDate(undefined)).toBe("—")
    expect(formatPortMetric(undefined, "艘")).toBe("暂无数据")
    expect(formatPortMetric(3, "艘")).toBe("3 艘")
    expect(statusLabels.critical).toBe("严重")
  })

  it("keeps provenance format mapping stable", () => {
    expect(formatSourceType("third_party")).toBe("第三方")
    expect(formatDataNature("derived")).toBe("衍生")
    expect(formatProvenance({ sourceType: "mock", dataNature: "planned", sourceId: "mock-schedule" })).toBe("mock-schedule · 模拟 · 计划")
  })

  it("keeps tone mapping stable", () => {
    expect(navTone("under_way")).toBe("info")
    expect(navTone("anchored")).toBe("watch")
    expect(navTone("moored")).toBe("fresh")
    expect(navTone("aground")).toBe("failed")
    expect(navTone("unknown")).toBe("dim")
    expect(severityTone("info")).toBe("info")
    expect(severityTone("warning")).toBe("watch")
    expect(severityTone("critical")).toBe("failed")
  })

  it("does not call a public alert source all Mock", () => {
    expect(providerSummary({ vessel: "mock", weather: "mock", port: "mock", schedule: "mock", feed: "mock", calendar: "mock", weatherAlerts: "off" })).toEqual({ allMock: true, label: "全 Mock" })
    expect(providerSummary({ vessel: "mock", weather: "mock", port: "mock", schedule: "mock", feed: "mock", calendar: "mock", weatherAlerts: "public" }).label).toContain("预警 public")
  })

  it("renders Chinese-first Feed text with an accessible original disclosure", () => {
    const item = createMockSnapshot().feedItems[0]
    const html = renderToString(FeedItemDisplayText({
      item: { ...item, displayTitle: "蛇口港中文标题", displaySummary: "中文摘要", translation: { title: "translated", summary: "historical" } },
    }))
    expect(html).toContain("蛇口港中文标题")
    expect(html).toContain("中文摘要")
    expect(html).toContain("查看原文")
    expect(html).toContain(item.title)
    expect(html).toContain(item.summary)
  })

  it("renders original Feed text with safe pending status", () => {
    const item = createMockSnapshot().feedItems[0]
    const html = renderToString(FeedItemDisplayText({
      item: { ...item, displayTitle: item.title, displaySummary: item.summary, translation: { title: "pending", summary: "unavailable" } },
    }))
    expect(html).toContain(item.title)
    expect(html).toContain(item.summary)
    expect(html).toContain("翻译中")
    expect(html).not.toContain("provider_contract_changed")
  })
})
