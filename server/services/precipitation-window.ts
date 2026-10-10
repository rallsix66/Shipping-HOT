/** Rolling 24 h precipitation (mm) ending at `atTimestamp`, using real time bounds. */

export interface PrecipitationSample {
  timestamp: string
  precipitationMm?: number
  horizon?: "hourly" | "current"
}

/** Minimum hourly readings to expose a **partial** sum (display / coverage only). */
export const PRECIP_24H_PARTIAL_MIN_HOURLY_SAMPLES = 18
/** Required hourly readings for a **full** 24 h cumulative (WR-S05 evaluation). */
export const PRECIP_24H_FULL_HOURLY_SAMPLES = 24

export type Precip24hCoverageStatus = "full" | "partial" | "insufficient"

export interface Precipitation24hResult {
  status: Precip24hCoverageStatus
  hourlySamplesInWindow: number
  /** Sum when status is `full` — valid for rule WR-S05. */
  totalMm?: number
  /** Sum when status is `partial` — display only, must not drive WR-S05. */
  partialSumMm?: number
}

export function precipitation24hEndingAtDetailed(
  samples: readonly PrecipitationSample[],
  atTimestamp: string,
): Precipitation24hResult {
  const endMs = Date.parse(atTimestamp)
  if (!Number.isFinite(endMs)) {
    return { status: "insufficient", hourlySamplesInWindow: 0 }
  }
  const startMs = endMs - 24 * 60 * 60 * 1000
  const byTime = new Map<number, number>()
  for (const sample of samples) {
    if (sample.horizon !== "hourly") continue
    const t = Date.parse(sample.timestamp)
    if (!Number.isFinite(t) || t > endMs || t <= startMs) continue
    if (sample.precipitationMm === undefined) continue
    byTime.set(t, sample.precipitationMm)
  }
  const hourlySamplesInWindow = byTime.size
  if (hourlySamplesInWindow < PRECIP_24H_PARTIAL_MIN_HOURLY_SAMPLES) {
    return { status: "insufficient", hourlySamplesInWindow }
  }
  let sum = 0
  for (const mm of byTime.values()) sum += mm
  if (hourlySamplesInWindow >= PRECIP_24H_FULL_HOURLY_SAMPLES) {
    return { status: "full", hourlySamplesInWindow, totalMm: sum }
  }
  return { status: "partial", hourlySamplesInWindow, partialSumMm: sum }
}

export function precipitation24hEndingAt(samples: readonly PrecipitationSample[], atTimestamp: string): number | undefined {
  const result = precipitation24hEndingAtDetailed(samples, atTimestamp)
  return result.status === "full" ? result.totalMm : undefined
}
