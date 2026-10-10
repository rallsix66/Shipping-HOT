/** Rolling 24 h precipitation (mm) ending at `atTimestamp`, using real time bounds. */

export interface PrecipitationSample {
  timestamp: string
  precipitationMm?: number
  horizon?: "hourly" | "current"
}

/** Minimum hourly readings inside the 24 h window — sparse gaps must not fake a full total. */
export const PRECIP_24H_MIN_HOURLY_SAMPLES = 18

export interface Precipitation24hResult {
  totalMm?: number
  hourlySamplesInWindow: number
  coverageSufficient: boolean
}

export function precipitation24hEndingAtDetailed(
  samples: readonly PrecipitationSample[],
  atTimestamp: string,
): Precipitation24hResult {
  const endMs = Date.parse(atTimestamp)
  if (!Number.isFinite(endMs)) {
    return { hourlySamplesInWindow: 0, coverageSufficient: false }
  }
  const startMs = endMs - 24 * 60 * 60 * 1000
  const byTime = new Map<number, number>()
  for (const sample of samples) {
    if (sample.horizon === "current") continue
    if (sample.horizon !== "hourly") continue
    const t = Date.parse(sample.timestamp)
    if (!Number.isFinite(t) || t > endMs || t <= startMs) continue
    if (sample.precipitationMm === undefined) continue
    byTime.set(t, sample.precipitationMm)
  }
  const hourlySamplesInWindow = byTime.size
  const coverageSufficient = hourlySamplesInWindow >= PRECIP_24H_MIN_HOURLY_SAMPLES
  if (!coverageSufficient) {
    return { hourlySamplesInWindow, coverageSufficient: false }
  }
  let sum = 0
  for (const mm of byTime.values()) sum += mm
  return { totalMm: sum, hourlySamplesInWindow, coverageSufficient: true }
}

export function precipitation24hEndingAt(samples: readonly PrecipitationSample[], atTimestamp: string): number | undefined {
  const result = precipitation24hEndingAtDetailed(samples, atTimestamp)
  return result.coverageSufficient ? result.totalMm : undefined
}
