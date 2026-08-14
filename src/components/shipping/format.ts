import type { DataProvenance } from "@shared/shipping"

export const statusLabels: Record<string, string> = {
  healthy: "正常",
  degraded: "降级",
  failed: "失败",
  disabled: "已禁用",
  never_succeeded: "尚未成功",
  under_way: "航行中",
  anchored: "锚泊",
  moored: "靠泊",
  aground: "搁浅",
  unknown: "未知",
  normal: "正常",
  disrupted: "受影响",
  closed: "关闭",
  low: "低",
  medium: "中",
  high: "高",
  critical: "严重",
  active: "进行中",
  resolved: "已解决",
  info: "信息",
  watch: "关注",
  warning: "警告",
  shipping_news: "航运新闻",
  carrier_notice: "船公司通知",
  weather: "天气",
  port_notice: "港口通知",
}

export const sourceTypeLabels: Record<string, string> = {
  official: "官方",
  third_party: "第三方",
  user: "手工",
  mock: "模拟",
}

export const dataNatureLabels: Record<string, string> = {
  observed: "观测",
  reported: "报告",
  forecast: "预测",
  modelled: "模型",
  derived: "衍生",
  estimated: "估算",
  planned: "计划",
}

export type DotTone = "fresh" | "watch" | "failed" | "info" | "dim"

export function navTone(status: string): DotTone {
  if (status === "under_way") return "info"
  if (status === "anchored") return "watch"
  if (status === "moored") return "fresh"
  if (status === "aground") return "failed"
  return "dim"
}

export function severityTone(value: string): DotTone {
  if (value === "info") return "info"
  if (value === "watch" || value === "warning") return "watch"
  if (value === "critical") return "failed"
  return "dim"
}

export function formatDate(value?: string) {
  return value ? new Date(value).toLocaleString("zh-CN", { year: "numeric", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "—"
}

export function formatStatus(value: string) {
  return statusLabels[value] ?? value.replace(/_/g, " ")
}

export function formatSourceStatus(value: string) {
  return statusLabels[value] ?? value
}

export function formatSourceType(value: string) {
  return sourceTypeLabels[value] ?? "来源未记录"
}

export function formatDataNature(value: string) {
  return dataNatureLabels[value] ?? "性质未记录"
}

export function formatProvenance(provenance?: DataProvenance) {
  if (!provenance) return "来源未记录"
  return `${provenance.sourceId} · ${formatSourceType(provenance.sourceType)} · ${formatDataNature(provenance.dataNature)}`
}
