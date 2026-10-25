// Adapted from AIHOT@44578fa11da55f2e863900752653e0c221f6cf70,
// packages/backend/src/sources/collect.ts adaptIntervals (MIT; docs/licenses/aihot-mit.txt).
export interface IntelAdaptiveBounds {
  minMinutes: number
  maxMinutes: number
}
const DAY = 86400000

/** Daily UTC window, using the existing collection task rather than another scheduler. */
export function adaptiveWindow(now: Date) {
  const until = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  return { from: new Date(until.getTime() - 7 * DAY).toISOString(), until: until.toISOString() }
}

export function adaptiveIntervalMs(recentCount: number, bounds: IntelAdaptiveBounds): number {
  if (!Number.isSafeInteger(recentCount) || recentCount < 0 || !Number.isSafeInteger(bounds.minMinutes) || !Number.isSafeInteger(bounds.maxMinutes) || bounds.minMinutes < 15 || bounds.maxMinutes < bounds.minMinutes || bounds.maxMinutes > 180) throw new Error("intel_adaptive_bounds_invalid")
  const perDay = recentCount / 7
  const minutes = perDay <= 0.15 ? bounds.maxMinutes : Math.round(Math.min(bounds.maxMinutes, Math.max(bounds.minMinutes, 1440 / (perDay * 3))))
  return minutes * 60000
}
