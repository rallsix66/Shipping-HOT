import type { PortWeatherPanelResponse } from "@shared/shipping"

export function portWeatherImpactEmptyCopy(state: PortWeatherPanelResponse["state"]): string {
  switch (state) {
    case "sync_failed":
      return "天气同步失败或数据源不可用；潜在影响暂不可信。"
    case "data_empty":
      return "暂无有效窗口内的持久化预报；请等待 Open-Meteo 同步。"
    case "data_stale":
      return "预报数据已过期；请触发同步后再查看潜在影响。"
    case "no_rule_hits":
      return "有效窗口内无规则命中（⚙ 潜在影响）；不含已实施封港结论。"
    case "partial_rule_coverage":
      return "部分规则因阵风/浪高/能见度/降水缺测或台风分支未接入而未评估；已评估规则的无命中不代表完整排除风险。"
    case "data_insufficient":
      return "测值不足，无法判断规则命中；请等待完整预报同步。"
    default:
      return "当前无规则命中；仅展示 ⚙ 潜在影响，不含已实施封港结论。"
  }
}
