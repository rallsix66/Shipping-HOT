import { renderToString } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { EmptyState, GradientText, ProviderChip, StatusDot } from "../src/components/shipping/ui"
import { formatDate, formatSourceStatus, formatStatus, navTone, severityTone, statusLabels } from "../src/components/shipping/format"

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

  it("renders EmptyState with icon and text", () => {
    const html = renderToString(EmptyState({ text: "暂无数据" }))
    expect(html).toContain("i-ph-waves")
    expect(html).toContain("暂无数据")
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
    expect(statusLabels.critical).toBe("严重")
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
})
