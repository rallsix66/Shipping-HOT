/** Plan §4.8 gust thresholds are defined in m/s; Open-Meteo uses km/h at the adapter boundary. */
export const KMH_PER_MS = 3.6

/** Tolerance for threshold comparisons after km/h↔m/s conversion (IEEE-754 residue). */
export const WEATHER_THRESHOLD_EPSILON = 1e-6

export function windGustMsToKmh(ms: number): number {
  return ms * KMH_PER_MS
}

export function windGustKmhToMs(kmh: number): number {
  return kmh / KMH_PER_MS
}

/** Inclusive lower bound for plan §4.8 rule thresholds. */
export function weatherValueGte(actual: number, threshold: number, epsilon = WEATHER_THRESHOLD_EPSILON): boolean {
  return actual + epsilon >= threshold
}

export function weatherValueLt(actual: number, threshold: number, epsilon = WEATHER_THRESHOLD_EPSILON): boolean {
  return actual + epsilon < threshold
}

/** km/h input converted once, compared with epsilon against an m/s plan threshold. */
export function windGustKmhMeetsMsThreshold(kmh: number, thresholdMs: number): boolean {
  return weatherValueGte(windGustKmhToMs(kmh), thresholdMs)
}
