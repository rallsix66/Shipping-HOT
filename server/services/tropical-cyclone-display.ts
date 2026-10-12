import { haversineDistanceKm } from "#/services/geo-distance"
import type { NormalizedTropicalCyclone, NormalizedTyphoonPosition } from "#/services/jma-typhoon-parse"
import { minTyphoonDistanceKmForWrS03InInterval } from "#/services/typhoon-position-validity"

export { minTyphoonDistanceKmForWrS03InInterval } from "#/services/typhoon-position-validity"

/** Plan §R1.5 focus sea area (approx.). */
export const TROPICAL_CYCLONE_FOCUS_BBOX = {
  minLon: 100,
  maxLon: 130,
  minLat: 0,
  maxLat: 30,
} as const

export const TROPICAL_CYCLONE_PORT_DISPLAY_RADIUS_KM = 1000
export const TROPICAL_CYCLONE_WR_S03_RADIUS_KM = 300
export const TROPICAL_CYCLONE_DISSIPATED_SUMMARY_MS = 48 * 60 * 60 * 1000

export interface PortCoordinate {
  portId: string
  unlocode?: string
  latitude: number
  longitude: number
}

export function pointInFocusBbox(lat: number, lon: number): boolean {
  return lon >= TROPICAL_CYCLONE_FOCUS_BBOX.minLon
    && lon <= TROPICAL_CYCLONE_FOCUS_BBOX.maxLon
    && lat >= TROPICAL_CYCLONE_FOCUS_BBOX.minLat
    && lat <= TROPICAL_CYCLONE_FOCUS_BBOX.maxLat
}

export function isCycloneActiveForRules(cyclone: NormalizedTropicalCyclone): boolean {
  return cyclone.lifecycleStatus === undefined || cyclone.lifecycleStatus === "active"
}

export function filterActiveCyclonesForRules(cyclones: readonly NormalizedTropicalCyclone[]): NormalizedTropicalCyclone[] {
  return cyclones.filter(isCycloneActiveForRules)
}

function cycloneDisplayPoints(cyclone: NormalizedTropicalCyclone): NormalizedTyphoonPosition[] {
  const points: NormalizedTyphoonPosition[] = []
  if (cyclone.current) points.push(cyclone.current)
  points.push(...cyclone.trackHistory, ...cyclone.forecast)
  return points
}

export function minDistanceKmToCyclone(
  cyclone: NormalizedTropicalCyclone,
  lat: number,
  lon: number,
): number | undefined {
  const points = cycloneDisplayPoints(cyclone)
  if (!points.length) return undefined
  let best = Infinity
  for (const point of points) {
    best = Math.min(best, haversineDistanceKm(lat, lon, point.lat, point.lon))
  }
  return Number.isFinite(best) ? best : undefined
}

/** @deprecated Interval-based WR-S03 — use minTyphoonDistanceKmForWrS03InInterval */
export function minTyphoonDistanceKmForWrS03At(
  cyclone: NormalizedTropicalCyclone,
  lat: number,
  lon: number,
  asOfMs: number,
  intervalMs = 60 * 60 * 1000,
): number | undefined {
  return minTyphoonDistanceKmForWrS03InInterval(cyclone, lat, lon, asOfMs, asOfMs + intervalMs - 1)
}

export function cycloneVisibleToPorts(
  cyclone: NormalizedTropicalCyclone,
  ports: readonly PortCoordinate[],
): boolean {
  const points = cycloneDisplayPoints(cyclone)
  if (!points.length) return false
  for (const point of points) {
    if (pointInFocusBbox(point.lat, point.lon)) return true
    for (const port of ports) {
      if (haversineDistanceKm(port.latitude, port.longitude, point.lat, point.lon) <= TROPICAL_CYCLONE_PORT_DISPLAY_RADIUS_KM) {
        return true
      }
    }
  }
  return false
}

export function minTyphoonDistanceKmForPortInInterval(
  cyclones: readonly NormalizedTropicalCyclone[],
  port: PortCoordinate,
  validFromMs: number,
  validUntilMs: number,
  onlyActive = true,
): number | undefined {
  let best: number | undefined
  for (const cyclone of cyclones) {
    if (onlyActive && !isCycloneActiveForRules(cyclone)) continue
    if (!cycloneVisibleToPorts(cyclone, [port])) continue
    const distance = minTyphoonDistanceKmForWrS03InInterval(cyclone, port.latitude, port.longitude, validFromMs, validUntilMs)
    if (distance === undefined) continue
    best = best === undefined ? distance : Math.min(best, distance)
  }
  return best
}

export function minTyphoonDistanceKmForPort(
  cyclones: readonly NormalizedTropicalCyclone[],
  port: PortCoordinate,
  onlyVisible = true,
  asOfMs?: number,
): number | undefined {
  if (asOfMs !== undefined) {
    return minTyphoonDistanceKmForPortInInterval(cyclones, port, asOfMs, asOfMs + 60 * 60 * 1000 - 1, onlyVisible)
  }
  let best: number | undefined
  for (const cyclone of cyclones) {
    if (onlyVisible && !cycloneVisibleToPorts(cyclone, [port])) continue
    const distance = minDistanceKmToCyclone(cyclone, port.latitude, port.longitude)
    if (distance === undefined) continue
    best = best === undefined ? distance : Math.min(best, distance)
  }
  return best
}

export function minTyphoonDistanceKmAcrossPorts(
  cyclones: readonly NormalizedTropicalCyclone[],
  ports: readonly PortCoordinate[],
  asOfMs?: number,
): number | undefined {
  let best: number | undefined
  for (const port of ports) {
    const distance = minTyphoonDistanceKmForPort(cyclones, port, true, asOfMs)
    if (distance === undefined) continue
    best = best === undefined ? distance : Math.min(best, distance)
  }
  return best
}

function withinHistoricalSummaryWindow(cyclone: NormalizedTropicalCyclone, nowMs: number): boolean {
  if (cyclone.lifecycleStatus === "missing_from_list" && cyclone.missingFromListAt) {
    const missingMs = Date.parse(cyclone.missingFromListAt)
    if (Number.isFinite(missingMs) && nowMs - missingMs > TROPICAL_CYCLONE_DISSIPATED_SUMMARY_MS) return false
  }
  if (cyclone.dissipatedAt) {
    const dissipatedMs = Date.parse(cyclone.dissipatedAt)
    if (Number.isFinite(dissipatedMs) && nowMs - dissipatedMs > TROPICAL_CYCLONE_DISSIPATED_SUMMARY_MS) return false
  }
  return true
}

export function filterActiveCyclonesForPanel(
  cyclones: readonly NormalizedTropicalCyclone[],
  ports: readonly PortCoordinate[],
): NormalizedTropicalCyclone[] {
  return cyclones.filter(cyclone =>
    isCycloneActiveForRules(cyclone) && cycloneVisibleToPorts(cyclone, ports),
  )
}

export function filterHistoricalSummaryCyclones(
  cyclones: readonly NormalizedTropicalCyclone[],
  ports: readonly PortCoordinate[],
  nowMs: number,
): NormalizedTropicalCyclone[] {
  return cyclones.filter((cyclone) => {
    if (isCycloneActiveForRules(cyclone)) return false
    if (!withinHistoricalSummaryWindow(cyclone, nowMs)) return false
    return cyclone.lifecycleStatus === "dissipated"
      || cyclone.lifecycleStatus === "missing_from_list"
      || cycloneVisibleToPorts(cyclone, ports)
  })
}

/** @deprecated Use filterActiveCyclonesForPanel + filterHistoricalSummaryCyclones */
export function filterVisibleCyclones(
  cyclones: readonly NormalizedTropicalCyclone[],
  ports: readonly PortCoordinate[],
  nowMs: number,
): NormalizedTropicalCyclone[] {
  return [
    ...filterActiveCyclonesForPanel(cyclones, ports),
    ...filterHistoricalSummaryCyclones(cyclones, ports, nowMs),
  ]
}
