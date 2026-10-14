import { createElement } from "react"
import { renderToString } from "react-dom/server"
import { beforeEach, expect, it, vi } from "vitest"
import { ManualIntelPage } from "../src/components/shipping/manual-intel"

const state = vi.hoisted(() => ({ values: [] as unknown[], index: 0, sources: {} as Record<string, unknown>, items: {} as Record<string, unknown>, detail: {} as Record<string, unknown> }))
vi.mock("react", async original => ({ ...await original<typeof import("react")>(), useState: (initial: unknown) => [state.values[state.index++] ?? initial, vi.fn()] }))
vi.mock("@tanstack/react-query", () => ({ useQueryClient: () => ({}), useQuery: (query: { queryKey: unknown[] }) => query.queryKey[0] === "intel-manual" ? state.sources : query.queryKey[0] === "intel-items" ? state.items : state.detail }))
vi.mock("../src/components/shipping/app", () => ({ ShippingShell: ({ children }: { children: unknown }) => children }))
vi.mock("../src/components/shipping/pages", () => ({ FeedPage: () => null }))
vi.mock("~/utils", () => ({ myFetch: vi.fn(() => {
  throw new Error("SSR must not fetch")
}) }))
function draw() {
  state.index = 0
  return renderToString(createElement(ManualIntelPage, { onLegacy: vi.fn() }))
}
beforeEach(() => {
  state.values = ["manual:synthetic", "", "", "", "", "", "item", "", false, "", null]
  state.sources = { data: { items: [{ id: "manual:synthetic", catalogId: "SYNTHETIC", name: "Synthetic source", urls: [], cadence: "每周", focus: "Synthetic", persistence: "disallowed", recentActions: [] }] } }
  state.items = { data: { items: [] } }
  state.detail = { data: { manualLabel: "官方通知（人工录入）", manualActions: [{ operator: "<img onerror=alert(1)>", entered_at: "2026-10-14T00:00:00Z", outcome: "created" }], selectedVersion: { id: "v1", blocks: [{ blockKey: "title", text: "<script>alert(1)</script>" }] }, versions: { items: [{ id: "v1", createdAt: "2026-10-14" }] } } }
})
it("renders checklist, no-network limits, metadata-only form and escaped stored text", () => {
  const html = draw()
  expect(html).toContain("官方通知（人工录入）")
  expect(html).toContain("未知留空")
  expect(html).toContain("&lt;script&gt;")
  expect(html).not.toContain("<script>")
  expect(html).toMatch(/<textarea disabled/)
  expect(html).toContain("不是失败")
})
it("separates read error/loading/empty and hides cached records on errors", () => {
  state.sources.isError = true
  state.items.isError = true
  state.detail.isError = true
  expect(draw()).toContain("检查清单读取失败")
  expect(draw()).not.toContain("Synthetic source")
  expect(draw()).not.toContain("&lt;script&gt;")
  state.sources = { isPending: true }
  expect(draw()).toContain("读取中")
})
