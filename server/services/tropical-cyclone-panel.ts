import type { TropicalCyclonePanelResponse, TropicalCycloneSummary, TropicalCycloneSyncMeta } from "@shared/shipping"
import { portDirectoryBaseline } from "@shared/port-directory"
import type { ShippingRepository } from "#/database/shipping"
import { enrichTropicalCycloneSyncMeta } from "#/services/tropical-cyclone-freshness"
import {
  type PortCoordinate,
  TROPICAL_CYCLONE_DISSIPATED_SUMMARY_MS,
  filterActiveCyclonesForPanel,
  filterHistoricalSummaryCyclones,
  minDistanceKmToCyclone,
  minTyphoonDistanceKmForWrS03InInterval,
} from "#/services/tropical-cyclone-display"

function focusPorts(): PortCoordinate[] {
  return portDirectoryBaseline.map(row => ({
    portId: row.shippingPortId,
    unlocode: row.unlocode,
    latitude: row.latitude,
    longitude: row.longitude,
  }))
}

function seasonHint(nowMs: number): string | undefined {
  const month = new Date(nowMs).getUTCMonth() + 1
  if (month >= 6 && month <= 11) return "西北太平洋台风季（约 6–11 月）内请持续关注 JMA 路径更新。"
  return "当前处于台风淡季；仍显示最近一次 JMA 检查结果。"
}

function buildMessage(
  sync: TropicalCycloneSyncMeta,
  activeCount: number,
  historicalCount: number,
): string {
  if (sync.outcome === "failed") {
    const retained = activeCount + historicalCount
    const retainedLabel = retained > 0 ? ` · 保留 ${retained} 条上次路径` : ""
    return `台风数据暂不可用（${sync.errorMessage ?? sync.errorCode ?? "同步失败"}）${retainedLabel}。`
  }
  if (sync.outcome === "partial") {
    const failed = sync.failedTcIds?.length ? ` · 部分气旋详情失败：${sync.failedTcIds.join(", ")}` : ""
    const listInvalid = sync.listInvalidCount ? ` · 列表含 ${sync.listInvalidCount} 个非法元素` : ""
    return `JMA 部分同步${failed}${listInvalid}；WR-S03 仅在列表完整且新鲜时排除风险。`
  }
  if (sync.stale) {
    return `JMA 台风数据已过期（最近完整成功：${sync.lastFullSuccessAt ?? sync.lastSuccessAt ?? "未知"}），不能据此排除台风风险。`
  }
  if (sync.outcome === "not_run") {
    return "台风路径尚未接入或未运行同步；WR-S03 台风距离分支不可用。"
  }
  if (activeCount === 0 && historicalCount === 0) {
    const label = sync.lastFullSuccessAt ?? sync.lastCheckedAt ?? "未知"
    if (sync.outcome === "ok_empty") {
      return `目前没有影响本区域的活跃台风 · 最近完整成功：${label}（新鲜度内可排除近距离台风风险）。`
    }
    return `目前没有影响本区域的活跃台风 · 最近完整成功：${label}`
  }
  return `活跃 ${activeCount} 个 · 历史摘要 ${historicalCount} 个（48h 内）。`
}

function cycloneSummaryZh(
  cyclone: {
    nameEn?: string
    nameJp?: string
    jmaId: string
    dissipatedAt?: string
    lifecycleStatus?: string
    summaryZhPersisted?: string
  },
  nowMs: number,
): string | undefined {
  if (cyclone.summaryZhPersisted) return cyclone.summaryZhPersisted
  const dissipatedMs = cyclone.dissipatedAt ? Date.parse(cyclone.dissipatedAt) : undefined
  if (dissipatedMs && nowMs - dissipatedMs <= TROPICAL_CYCLONE_DISSIPATED_SUMMARY_MS) {
    return `${cyclone.nameEn ?? cyclone.nameJp ?? cyclone.jmaId} 已减弱/登陆（JMA 分析）· 48 小时内保留摘要`
  }
  if (cyclone.lifecycleStatus === "missing_from_list") {
    return `${cyclone.nameEn ?? cyclone.nameJp ?? cyclone.jmaId} 自最新 JMA 列表消失 · 不等于已登陆/减弱 · 48h 内保留路径摘要`
  }
  return undefined
}

function toSummary(
  cyclone: Awaited<ReturnType<ShippingRepository["listNormalizedTropicalCyclones"]>>[number],
  ports: PortCoordinate[],
  nowMs: number,
): TropicalCycloneSummary {
  let minDistanceKm: number | undefined
  let wrS03DistanceKm: number | undefined
  const intervalEnd = nowMs + 60 * 60 * 1000 - 1
  for (const port of ports) {
    const displayDistance = minDistanceKmToCyclone(cyclone, port.latitude, port.longitude)
    if (displayDistance !== undefined) {
      minDistanceKm = minDistanceKm === undefined ? displayDistance : Math.min(minDistanceKm, displayDistance)
    }
    const wrDistance = minTyphoonDistanceKmForWrS03InInterval(cyclone, port.latitude, port.longitude, nowMs, intervalEnd)
    if (wrDistance !== undefined) {
      wrS03DistanceKm = wrS03DistanceKm === undefined ? wrDistance : Math.min(wrS03DistanceKm, wrDistance)
    }
  }
  const pathFetchedAt = cyclone.pathFetchedAt ?? cyclone.issuedAt ?? new Date(nowMs).toISOString()
  return {
    id: cyclone.id,
    jmaId: cyclone.jmaId,
    nameEn: cyclone.nameEn,
    nameJp: cyclone.nameJp,
    typhoonNumber: cyclone.typhoonNumber,
    category: cyclone.category,
    sourceId: "jma-typhoon",
    pathFetchedAt,
    fetchedAt: pathFetchedAt,
    dissipatedAt: cyclone.dissipatedAt,
    lifecycleStatus: cyclone.lifecycleStatus,
    minDistanceKm,
    wrS03DistanceKm,
    current: cyclone.current,
    trackHistory: cyclone.trackHistory,
    forecast: cyclone.forecast,
    summaryZh: cycloneSummaryZh(cyclone, nowMs),
  }
}

export async function getTropicalCyclonePanel(
  repository: ShippingRepository,
  options: { now?: Date } = {},
): Promise<TropicalCyclonePanelResponse> {
  const now = options.now ?? new Date()
  const nowMs = now.getTime()
  const asOf = now.toISOString()
  const sync = enrichTropicalCycloneSyncMeta(await repository.getTropicalCycloneSyncMeta({ nowMs }), nowMs)
  const ports = focusPorts()
  const stored = await repository.listNormalizedTropicalCyclones()
  const active = filterActiveCyclonesForPanel(stored, ports)
  const historical = filterHistoricalSummaryCyclones(stored, ports, nowMs)
  const cyclones = [
    ...active.map(c => toSummary(c, ports, nowMs)),
    ...historical.map(c => toSummary(c, ports, nowMs)),
  ]
  return {
    asOf,
    sync,
    cyclones,
    activeCount: active.length,
    historicalSummaryCount: historical.length,
    messageZh: buildMessage(sync, active.length, historical.length),
    seasonHintZh: seasonHint(nowMs),
  }
}
