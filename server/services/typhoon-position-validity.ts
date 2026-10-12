import type { NormalizedTropicalCyclone } from "#/services/jma-typhoon-parse"
import { haversineDistanceKm } from "#/services/geo-distance"

/** JMA analysis “current” center remains applicable for WR-S03 for this long after `current.at`. */
export const TYPHOON_CURRENT_POSITION_VALID_MS = 3 * 60 * 60 * 1000
/** Default forecast-point applicability when the next forecast instant is unknown. */
export const TYPHOON_FORECAST_POINT_DEFAULT_VALID_MS = 6 * 60 * 60 * 1000

export interface TimeIntervalMs {
  fromMs: number
  untilMs: number
}

export function intersectIntervals(a: TimeIntervalMs, b: TimeIntervalMs): TimeIntervalMs | undefined {
  const fromMs = Math.max(a.fromMs, b.fromMs)
  const untilMs = Math.min(a.untilMs, b.untilMs)
  if (!Number.isFinite(fromMs) || !Number.isFinite(untilMs) || untilMs <= fromMs) return undefined
  return { fromMs, untilMs }
}

export function currentPositionApplicability(cyclone: NormalizedTropicalCyclone): TimeIntervalMs | undefined {
  if (!cyclone.current?.at) return undefined
  const atMs = Date.parse(cyclone.current.at)
  if (!Number.isFinite(atMs)) return undefined
  return { fromMs: atMs, untilMs: atMs + TYPHOON_CURRENT_POSITION_VALID_MS }
}

export function forecastPointApplicability(
  forecast: readonly { at: string }[],
  index: number,
): TimeIntervalMs | undefined {
  const atMs = Date.parse(forecast[index].at)
  if (!Number.isFinite(atMs)) return undefined
  const nextAtMs = index + 1 < forecast.length ? Date.parse(forecast[index + 1].at) : undefined
  const untilMs = nextAtMs !== undefined && Number.isFinite(nextAtMs)
    ? Math.max(atMs + 60_000, nextAtMs - 1)
    : atMs + TYPHOON_FORECAST_POINT_DEFAULT_VALID_MS
  return { fromMs: atMs, untilMs }
}

export function minTyphoonDistanceKmForWrS03InInterval(
  cyclone: NormalizedTropicalCyclone,
  lat: number,
  lon: number,
  impactFromMs: number,
  impactUntilMs: number,
): number | undefined {
  const impact: TimeIntervalMs = { fromMs: impactFromMs, untilMs: impactUntilMs }
  const candidates: number[] = []

  const currentWindow = currentPositionApplicability(cyclone)
  if (currentWindow && cyclone.current) {
    const overlap = intersectIntervals(currentWindow, impact)
    if (overlap) {
      candidates.push(haversineDistanceKm(lat, lon, cyclone.current.lat, cyclone.current.lon))
    }
  }

  for (let index = 0; index < cyclone.forecast.length; index += 1) {
    const point = cyclone.forecast[index]
    const pointWindow = forecastPointApplicability(cyclone.forecast, index)
    if (!pointWindow) continue
    const overlap = intersectIntervals(pointWindow, impact)
    if (overlap) {
      candidates.push(haversineDistanceKm(lat, lon, point.lat, point.lon))
    }
  }

  if (!candidates.length) return undefined
  return Math.min(...candidates)
}
