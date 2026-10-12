import type { OpenMeteoPortPoint } from "#/services/open-meteo-port-forecast"

/** Hourly step validity — never extended to the next sparse hour. */
export const HOURLY_IMPACT_DURATION_MS = 60 * 60 * 1000
/** Current observation validity — shorter than hourly; never shares hourly's end boundary. */
export const CURRENT_IMPACT_DURATION_MS = 15 * 60 * 1000

export interface ImpactValidityInterval {
  validFrom: string
  validUntil: string
}

export function impactValidityInterval(
  point: OpenMeteoPortPoint,
  sorted: readonly OpenMeteoPortPoint[],
  index: number,
): ImpactValidityInterval {
  const fromMs = Date.parse(point.timestamp)
  if (!Number.isFinite(fromMs)) {
    const fallback = new Date().toISOString()
    return { validFrom: fallback, validUntil: fallback }
  }
  const maxDurationMs = point.horizon === "current" ? CURRENT_IMPACT_DURATION_MS : HOURLY_IMPACT_DURATION_MS
  let untilMs = fromMs + maxDurationMs

  for (let j = index + 1; j < sorted.length; j += 1) {
    const nextMs = Date.parse(sorted[j].timestamp)
    if (!Number.isFinite(nextMs) || nextMs <= fromMs) continue
    untilMs = Math.min(untilMs, nextMs - 1)
    break
  }

  if (untilMs <= fromMs) {
    untilMs = fromMs + (point.horizon === "current" ? 60_000 : HOURLY_IMPACT_DURATION_MS)
  }

  return {
    validFrom: point.timestamp,
    validUntil: new Date(untilMs).toISOString(),
  }
}

export function assertValidImpactInterval(interval: ImpactValidityInterval): boolean {
  return Date.parse(interval.validUntil) > Date.parse(interval.validFrom)
}
