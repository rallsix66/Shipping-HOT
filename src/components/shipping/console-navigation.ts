/** Demo navigation order, opened only where an existing page is usable. */
export const consoleNavigation = [
  { label: "国家总览", stage: "R5", available: false },
  { label: "港口", to: "/ports", available: true },
  { label: "天气", stage: "R5 · 港口天气已可用", available: false },
  { label: "风险事件", stage: "R4 · 合并与影响卡片", available: false },
  { label: "政策库", to: "/policies", available: true },
  { label: "日历", to: "/calendar", available: true },
] as const

export const existingNavigation = [
  { label: "首页", to: "/" },
  { label: "资讯", to: "/feed" },
  { label: "事件列表", to: "/events" },
  { label: "设置", to: "/settings" },
] as const
