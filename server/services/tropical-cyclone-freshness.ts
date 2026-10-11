import type { TropicalCycloneSyncMeta } from "@shared/shipping"

/** JMA targetTc / forecast refresh cadence (conservative TTL for “fresh enough to exclude typhoon risk”). */
export const JMA_TYPHOON_DATA_TTL_MS = 6 * 60 * 60 * 1000

export function syncFreshnessAnchor(meta: TropicalCycloneSyncMeta): string | undefined {
  return meta.lastFullSuccessAt ?? meta.lastSuccessAt ?? meta.lastCheckedAt
}

export function jmaDataValidUntil(anchor: string | undefined, ttlMs = JMA_TYPHOON_DATA_TTL_MS): string | undefined {
  if (!anchor) return undefined
  const ms = Date.parse(anchor)
  if (!Number.isFinite(ms)) return undefined
  return new Date(ms + ttlMs).toISOString()
}

export function isJmaTyphoonSyncFresh(meta: TropicalCycloneSyncMeta, nowMs: number, ttlMs = JMA_TYPHOON_DATA_TTL_MS): boolean {
  const anchor = syncFreshnessAnchor(meta)
  if (!anchor) return false
  const ms = Date.parse(anchor)
  if (!Number.isFinite(ms)) return false
  return nowMs - ms <= ttlMs
}

/** True only when WR-S03 may treat ok_empty as “no storm within range” (not stale/failed/partial). */
export function isJmaTyphoonSyncTrustworthyForWrS03(meta: TropicalCycloneSyncMeta, nowMs: number): boolean {
  if (meta.outcome !== "ok" && meta.outcome !== "ok_empty") return false
  if (meta.stale === true) return false
  return isJmaTyphoonSyncFresh(meta, nowMs)
}

export function enrichTropicalCycloneSyncMeta(meta: TropicalCycloneSyncMeta, nowMs: number): TropicalCycloneSyncMeta {
  const anchor = syncFreshnessAnchor(meta)
  const stale = !isJmaTyphoonSyncFresh(meta, nowMs)
  const dataValidUntil = jmaDataValidUntil(anchor)
  const lastSuccessAt = meta.lastFullSuccessAt ?? meta.lastSuccessAt
  return { ...meta, lastSuccessAt, stale, dataValidUntil }
}
