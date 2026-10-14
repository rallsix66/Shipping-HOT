import { readFileSync } from "node:fs"
import { renderToString } from "react-dom/server"
import { describe, expect, it } from "vitest"
import type { PolicyRecordView, PolicyVersionView } from "@shared/policy"
import { PolicyFacts, PolicyHistory, PolicyRows } from "../src/components/shipping/policy-view"
import { consoleNavigation, existingNavigation } from "../src/components/shipping/console-navigation"

const record: PolicyRecordView = {
  id: "fixture-policy",
  category: "customs_tax",
  countryCode: "ID",
  platform: null,
  title: "示例政策 <script>不可执行</script>",
  documentNumber: null,
  publisher: null,
  publishedAt: "2025-01-01",
  effectiveAt: null,
  expiresAt: null,
  status: "published",
  applicableTimezone: null,
  scopeText: null,
  stage: null,
  sourceType: "official",
  sourceUrl: "https://example.org/fixture",
  bodyExcerpt: null,
  fullText: "示例全文",
  basisText: "示例依据",
  enteredBy: "tester",
  isFixture: true,
  entryMethod: "manual",
  currentVersionId: "v2",
  currentVersionNumber: 2,
  displayStatus: "published",
  autoActivated: false,
  datePosition: "timezone_unconfirmed",
  localToday: null,
  supersedesPolicyId: null,
  supersedesRelationKind: null,
  supersededByPolicyId: null,
  supersededByRelationKind: null,
  supersedeSwitchAt: null,
  supersedeSwitchTimezone: null,
  supersedeSwitched: false,
  createdAt: "2026-10-01T00:00:00.000Z",
  updatedAt: "2026-10-01T00:00:00.000Z",
}
function version(number: number): PolicyVersionView {
  return {
    id: `v${number}`,
    versionNumber: number,
    status: "published",
    title: `原版本 ${number}`,
    effectiveAt: null,
    changeSummary: `修订 ${number}`,
    sourceUrl: record.sourceUrl,
    createdAt: record.createdAt,
    supersededByVersionId: number === 1 ? "v2" : null,
    enteredBy: "tester",
    snapshot: { ...record, basisText: `独立依据 ${number}` },
  }
}

describe("policy console honest rendering", () => {
  it.each(["loading", "error", "ready"] as const)("keeps %s distinguishable from a successful empty list", (state) => {
    const html = renderToString(PolicyRows({ records: [], selectedId: "", state, onSelect: () => {} }))
    expect(html).toContain(state === "loading" ? "正在读取" : state === "error" ? "无法确认记录数量" : "无记录不代表没有政策变化")
    expect(html).not.toContain("正常")
  })
  it("uses native selected buttons, labels fixtures, and escapes source text", () => {
    const html = renderToString(PolicyRows({ records: [record], selectedId: record.id, state: "ready", onSelect: () => {} }))
    expect(html).toContain("<button type=\"button\"")
    expect(html).toContain("aria-pressed=\"true\"")
    expect(html).toContain("示例 fixture · 非真实公告")
    expect(html).toContain("未定生效日")
    expect(html).toContain("&lt;script&gt;")
    expect(html).not.toContain("<script>")
  })
  it("does not turn a past publication date or unknown zone into current activation", () => {
    const html = renderToString(PolicyFacts({ record }))
    expect(html).toContain("2025-01-01")
    expect(html).toContain("未确认，不自动生效")
    expect(html).toContain("未定")
    expect(html).not.toContain("已生效")
  })
  it("does not label manually entered real records as fixtures", () => {
    const html = renderToString(PolicyRows({ records: [{ ...record, isFixture: false }], selectedId: "", state: "ready", onSelect: () => {} }))
    expect(html).not.toContain("非真实公告")
    expect(html).toContain("aria-pressed=\"false\"")
  })
  it("preserves old version evidence and does not activate a future supersession", () => {
    const html = renderToString(PolicyHistory({ record: { ...record, supersededByPolicyId: "future-policy", supersededByRelationKind: "revised", supersedeSwitchAt: "2026-11-01", supersedeSwitchTimezone: "Asia/Jakarta" }, versions: [version(2), version(1)] }))
    expect(html).toContain("尚未生效，当前状态不变")
    expect(html).toContain("独立依据 1")
    expect(html).toContain("独立依据 2")
    expect(html).toContain("data-version=\"1\"")
    expect(html).toContain("data-version=\"2\"")
    expect(html).toContain("已被新版本取代")
  })
  it("does not guess unknown historical relationship types", () => {
    const html = renderToString(PolicyHistory({ record: { ...record, supersedesPolicyId: "legacy", supersedesRelationKind: "unknown" }, versions: [] }))
    expect(html).toContain("关系类型未知")
  })
})

describe("gradual module opening", () => {
  it("opens only existing routes while retaining all currently usable routes", () => {
    const opened = [...consoleNavigation.filter(i => i.available).map(i => i.to), ...existingNavigation.map(i => i.to)]
    expect(new Set(opened)).toEqual(new Set(["/", "/ports", "/events", "/feed", "/calendar", "/policies", "/settings"]))
    for (const route of opened) expect(readFileSync(`src/routes/${route === "/" ? "index" : route.slice(1)}.tsx`, "utf8")).toContain("createFileRoute")
    const unopened = consoleNavigation.filter(i => !i.available)
    expect(unopened.map(i => i.label)).toEqual(["国家总览", "天气", "风险事件"])
    for (const item of unopened) expect(item).not.toHaveProperty("to")
  })
})
