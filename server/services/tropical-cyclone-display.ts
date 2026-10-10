import { haversineDistanceKm } from "#/services/geo-distance"
import type { NormalizedTropicalCyclone, NormalizedTyphoonTrackPoint } from "#/services/jma-typhoon-parse"

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

function cycloneRelevantPoints(cyclone: NormalizedTropicalCyclone): NormalizedTyphoonTrackPoint[] {
  return [...cyclone.track, ...cyclone.forecast]
}

export function minDistanceKmToCyclone(
  cyclone: NormalizedTropicalCyclone,
  lat: number,
  lon: number,
): number | undefined {
  const points = cycloneRelevantPoints(cyclone)
  if (!points.length) return undefined
  let best = Infinity
  for (const point of points) {
    best = Math.min(best, haversineDistanceKm(lat, lon, point.lat, point.lon))
  }
  return Number.isFinite(best) ? best : undefined
}

export function cycloneVisibleToPorts(
  cyclone: NormalizedTropicalCyclone,
  ports: readonly PortCoordinate[],
): boolean {
  const points = cycloneRelevantPoints(cyclone)
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

export function minTyphoonDistanceKmForPort(
  cyclones: readonly NormalizedTropicalCyclone[],
  port: PortCoordinate,
  onlyVisible = true,
): number | undefined {
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
): number | undefined {
  let best: number | undefined
  for (const port of ports) {
    const distance = minTyphoonDistanceKmForPort(cyclones, port, true)
    if (distance === undefined) continue
    best = best === undefined ? distance : Math.min(best, distance)
  }
  return best
}

export function filterVisibleCyclones(
  cyclones: readonly NormalizedTropicalCyclone[],
  ports: readonly PortCoordinate[],
  nowMs: number,
): NormalizedTropicalCyclone[] {
  return cyclones.filter((cyclone) => {
    if (cyclone.dissipatedAt) {
      const dissipatedMs = Date.parse(cyclone.dissipatedAt)
      if (Number.isFinite(dissipatedMs) && nowMs - dissipatedMs > TROPICAL_CYCLONE_DISSIPATED_SUMMARY_MS) {
        return false
      }
    }
    return cycloneVisibleToPorts(cyclone, ports)
  })
}
