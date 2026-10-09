/** Plan §4.8 gust thresholds are defined in m/s; Open-Meteo uses km/h at the adapter boundary. */
export const KMH_PER_MS = 3.6

export function windGustMsToKmh(ms: number): number {
  return ms * KMH_PER_MS
}

export function windGustKmhToMs(kmh: number): number {
  return kmh / KMH_PER_MS
}
