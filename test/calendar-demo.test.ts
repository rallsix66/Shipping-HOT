import { createElement } from "react"
import { renderToString } from "react-dom/server"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { annualCountries, annualMonthDays } from "@shared/annual-calendar"
import { AnnualCalendarPage } from "../src/components/shipping/annual-calendar"

const state = vi.hoisted(() => ({ values: [] as unknown[], index: 0, queries: [] as Array<{ enabled?: boolean, queryKey: unknown[] }>, annual: {} as Record<string, unknown>, promos: {} as Record<string, unknown>, policies: {} as Record<string, unknown> }))
vi.mock("react", async original => ({ ...await original<typeof import("react")>(), useState: (initial: unknown) => {
  const index = state.index++
  return [index < state.values.length ? state.values[index] : initial, vi.fn()]
} }))
vi.mock("@tanstack/react-query", () => ({ useQuery: (query: { enabled?: boolean, queryKey: unknown[] }) => {
  state.queries.push(query)
  return query.queryKey[0] === "annual-calendar-reference" ? state.annual : query.queryKey[0] === "promo-calendar" ? state.promos : state.policies
} }))
vi.mock("../src/components/shipping/app", () => ({ ShippingShell: ({ children }: { children: unknown }) => children }))
vi.mock("~/utils", () => ({ myFetch: vi.fn(() => {
  throw new Error("unexpected API call in SSR test")
}) }))

const event = (cc: string, date: string, title: string) => ({ id: title, countryCode: cc, date, nameZh: title, shortNameZh: title, nameLocal: "", type: "public_holiday", geographicScope: "national", subjectAndConditionsZh: "参考资料", sourceDocumentIds: [], verificationStatus: "cross_checked", notesZh: "" })
function draw() {
  state.index = 0
  state.queries = []
  return renderToString(createElement(AnnualCalendarPage))
}
describe("demo calendar existing-layer rendering", () => {
  beforeEach(() => {
    state.values = [2026, 0, "2026-01-01", Object.keys(annualCountries), false, false, false, false]
    state.annual = { data: { datasets: [{ countryCode: "TH", events: [event("TH", "2026-01-01", "合成泰国参考事项")], sourceDocuments: [], warning: "不完整" }], availableYears: [2026, 2027], statuses: [] }, isPending: false, isError: false }
    state.promos = { data: { events: [], gaps: [] }, isPending: false, isError: false }
    state.policies = { data: { records: [] }, isPending: false, isError: false }
  })
  it("keeps the country/month/day structure and unopened risk layer without demo dates", () => {
    const html = draw()
    for (const label of ["calendar-demo", "国家与图层筛选", "年度参考月历", "当天安排", "风险事件 / 备货窗口重叠（未开放）", "不代表停工"]) expect(html).toContain(label)
    expect(state.queries.filter(q => q.enabled === false)).toHaveLength(2)
  })
  it("preserves multi-country filtering and empty-date copy", () => {
    state.values[3] = ["VN"]
    const html = draw()
    expect(html).not.toContain("合成泰国参考事项")
    expect(html).toContain("空白不代表没有假日或正常作业")
    state.values[3] = []
    expect(draw()).toContain("请至少选择一个国家")
  })
  it("does not expose cached schedules as successful results after a read error", () => {
    state.annual.isError = true
    const html = draw()
    expect(html).toContain("年度资料读取失败，数量未知")
    expect(html).not.toContain("合成泰国参考事项")
    expect(html).toContain("参考记录数量未知")
  })
  it("keeps loading and missing-year states separate from an empty selected day", () => {
    state.annual = { isPending: true, isError: false }
    expect(draw()).toContain("正在读取参考记录")
    state.annual = { isPending: false, isError: false, data: { datasets: [], statuses: [], availableYears: [2026] } }
    expect(draw()).toContain("暂无已录入的正式年度数据")
  })
  it("preserves the existing workday-only filter without changing holiday dates", () => {
    state.annual = { isPending: false, isError: false, data: { datasets: [{ countryCode: "TH", events: [{ ...event("TH", "2026-01-01", "合成补班事项"), type: "special_working_day" }], sourceDocuments: [] }], statuses: [] } }
    expect(draw()).toContain("合成补班事项")
    state.values[4] = true
    expect(draw()).not.toContain("合成补班事项")
  })
  it("preserves the 2026/2027 navigation boundary and Monday civil-date grid", () => {
    expect(draw()).toMatch(/aria-label="上个月" disabled/)
    state.values[0] = 2027
    state.values[1] = 11
    expect(draw()).toMatch(/aria-label="下个月" disabled/)
    expect(annualMonthDays(2026, 0)[0].date).toBe("2025-12-29")
    expect(annualMonthDays(2028, 1).filter(d => !d.outside)).toHaveLength(29)
  })
  it("keeps rule anchors pending instead of promoting them to promo windows", () => {
    state.values[5] = true
    state.promos = { isPending: false, isError: false, data: { gaps: [], events: [{ id: "fixture-promo", countryCode: "TH", platform: "shopee", title: "合成节日锚点", startsAt: "2026-01-01", endsAt: "2026-01-02", ruleId: "E-R04", entryKind: "rule", windowStatus: "pending", confirmationStatus: "pending", confirmation: null, dataIssue: null }] } }
    const html = draw()
    expect(html).toContain("促销窗口待定")
    expect(html).toContain("节日锚点")
    expect(html).not.toContain("已由人工证据确认")
    state.values[2] = "2026-01-02"
    expect(draw()).toContain("合成节日锚点")
    state.promos.isError = true
    expect(draw()).not.toContain("合成节日锚点")
    expect(draw()).toContain("大促资料读取失败")
  })
  it("keeps CN independent, fixture identity and policy local timezone visible", () => {
    state.values[6] = true
    state.policies = { isPending: false, isError: false, data: { records: [{ id: "fixture-policy", countryCode: "CN", title: "合成中国政策", effectiveAt: "2026-01-01", displayStatus: "published", isFixture: true, autoActivated: false, currentVersionNumber: 1, applicableTimezone: "Asia/Shanghai", localToday: "2025-12-31" }] } }
    expect(draw()).not.toContain("合成中国政策")
    state.values[7] = true
    const html = draw()
    expect(html).toContain("非真实公告")
    expect(html).toContain("Asia/Shanghai")
    expect(html).toContain("当地判断日 2025-12-31")
    expect(html).toContain("已发布待生效")
    state.policies.isError = true
    expect(draw()).not.toContain("合成中国政策")
    expect(draw()).toContain("政策资料读取失败")
  })
})
