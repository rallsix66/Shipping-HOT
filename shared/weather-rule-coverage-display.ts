/** Maps machine-readable rule coverage reasons to UI copy. */
export function ruleCoverageReasonLabelZh(reason: string | undefined): string {
  if (!reason) return "缺测"
  if (reason === "hit" || reason === "no_hit") return reason === "hit" ? "命中" : "无命中"
  if (reason === "wind_gust_missing") return "阵风数据缺失"
  if (reason === "wind_gust_invalid") return "阵风数值无效"
  if (reason === "wave_height_missing") return "浪高数据缺失"
  if (reason === "wave_height_invalid") return "浪高数值无效"
  if (reason === "visibility_missing") return "能见度数据缺失"
  if (reason === "visibility_invalid") return "能见度数值无效"
  if (reason === "typhoon_distance_not_covered") return "台风距离分支尚未接入"
  if (reason === "typhoon_data_unavailable") return "台风数据不可用或尚未成功同步"
  const partial = /^precip_24h_partial_(\d+)_of_24$/.exec(reason)
  if (partial) return `24h 降水仅 ${partial[1]}/24 小时（部分覆盖，不可用于 WR-S05）`
  const insufficient = /^precip_24h_insufficient_(\d+)_of_24$/.exec(reason)
  if (insufficient) return `24h 降水仅 ${insufficient[1]}/24 小时（不足）`
  if (reason.includes(",")) {
    return reason.split(",").map(part => ruleCoverageReasonLabelZh(part.trim())).join("；")
  }
  return reason
}
