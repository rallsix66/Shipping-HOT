/** Demo navigation order, opened only where an existing page is usable. */
export const consoleNavigation = [
  { label: "国家总览", to: "/", available: true },
  { label: "港口", to: "/ports", available: true },
  { label: "天气", stage: "R5 · 港口天气已可用", available: false },
  { label: "风险事件", to: "/events", available: true },
  { label: "政策库", to: "/policies", available: true },
  { label: "日历", to: "/calendar", available: true },
  { label: "资讯", to: "/feed", available: true },
  { label: "设置", to: "/settings", available: true },
] as const
