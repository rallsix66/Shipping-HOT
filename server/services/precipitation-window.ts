/** Rolling 24 h precipitation (mm) ending at `atTimestamp`, using real time bounds. */

export interface PrecipitationSample {
  timestamp: string
  precipitationMm?: number
  /** When duplicate timestamps exist, hourly wins over current. */
  horizon?: "hourly" | "current"
}

export function precipitation24hEndingAt(samples: readonly PrecipitationSample[], atTimestamp: string): number | undefined {
  const endMs = Date.parse(atTimestamp)
  if (!Number.isFinite(endMs)) return undefined
  const startMs = endMs - 24 * 60 * 60 * 1000
  const byTime = new Map<number, { mm: number, horizon: "hourly" | "current" | undefined }>()
  for (const sample of samples) {
    const t = Date.parse(sample.timestamp)
    if (!Number.isFinite(t) || t > endMs || t <= startMs) continue
    if (sample.precipitationMm === undefined) continue
    const prev = byTime.get(t)
    if (!prev || sample.horizon === "hourly" || prev.horizon !== "hourly") {
      byTime.set(t, { mm: sample.precipitationMm, horizon: sample.horizon })
    }
  }
  if (byTime.size === 0) return undefined
  let sum = 0
  for (const { mm } of byTime.values()) sum += mm
  return sum
}
