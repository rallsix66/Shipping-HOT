import type { TropicalCyclonePanelResponse, TropicalCycloneSummary, TropicalCycloneSyncMeta } from "@shared/shipping"
import { portDirectoryBaseline } from "@shared/port-directory"
import type { ShippingRepository } from "#/database/shipping"
import {
  type PortCoordinate,
  TROPICAL_CYCLONE_DISSIPATED_SUMMARY_MS,
  filterVisibleCyclones,
  minDistanceKmToCyclone,
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

function buildMessage(sync: TropicalCycloneSyncMeta, visibleCount: number, lastCheckedAt?: string): string {
  if (sync.outcome === "failed") {
    return `台风数据暂不可用（${sync.errorMessage ?? sync.errorCode ?? "同步失败"}）。`
  }
  if (sync.outcome === "not_run") {
    return "台风路径尚未接入或未运行同步；WR-S03 台风距离分支不可用。"
  }
  if (visibleCount === 0) {
    const label = lastCheckedAt ? `最近检查：${lastCheckedAt}` : "最近检查时间未知"
    return `目前没有影响本区域的台风 · ${label}`
  }
  return `当前有 ${visibleCount} 个热带气旋位于关注海域或距八港 ≤1000 km 范围内。`
}

export async function getTropicalCyclonePanel(
  repository: ShippingRepository,
  options: { now?: Date } = {},
): Promise<TropicalCyclonePanelResponse> {
  const now = options.now ?? new Date()
  const nowMs = now.getTime()
  const asOf = now.toISOString()
  const sync = await repository.getTropicalCycloneSyncMeta()
  const ports = focusPorts()
  const stored = await repository.listNormalizedTropicalCyclones()
  const visible = filterVisibleCyclones(stored, ports, nowMs)
  const cyclones: TropicalCycloneSummary[] = visible.map((cyclone) => {
    let minDistanceKm: number | undefined
    for (const port of ports) {
      const distance = minDistanceKmToCyclone(cyclone, port.latitude, port.longitude)
      if (distance === undefined) continue
      minDistanceKm = minDistanceKm === undefined ? distance : Math.min(minDistanceKm, distance)
    }
    const dissipatedMs = cyclone.dissipatedAt ? Date.parse(cyclone.dissipatedAt) : undefined
    const summaryZh = dissipatedMs && nowMs - dissipatedMs <= TROPICAL_CYCLONE_DISSIPATED_SUMMARY_MS
      ? `${cyclone.nameEn ?? cyclone.nameJp ?? cyclone.jmaId} 已减弱/登陆 · 48 小时内保留摘要`
      : undefined
    return {
      id: cyclone.id,
      jmaId: cyclone.jmaId,
      nameEn: cyclone.nameEn,
      nameJp: cyclone.nameJp,
      typhoonNumber: cyclone.typhoonNumber,
      category: cyclone.category,
      sourceId: "jma-typhoon",
      fetchedAt: sync.lastCheckedAt ?? cyclone.issuedAt ?? asOf,
      dissipatedAt: cyclone.dissipatedAt,
      minDistanceKm,
      track: cyclone.track,
      forecast: cyclone.forecast,
      summaryZh,
    }
  })
  return {
    asOf,
    sync,
    cyclones,
    messageZh: buildMessage(sync, cyclones.length, sync.lastCheckedAt),
    seasonHintZh: seasonHint(nowMs),
  }
}
