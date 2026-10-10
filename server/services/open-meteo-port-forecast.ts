import { windGustKmhToMs } from "@shared/weather-units"
import type { PortWeatherForecastRow, PortWeatherImpactRow } from "@shared/shipping"
import type { TyphoonInputState } from "#/services/weather-rule-coverage"
import { impactValidityInterval } from "#/services/weather-impact-interval"
import { evaluatePointWeatherRules } from "#/services/weather-rule-evaluation"

function normalizeProviderTimestamp(value: unknown): string | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    const date = new Date(value * 1000)
    return Number.isNaN(date.getTime()) ? undefined : date.toISOString()
  }
  if (typeof value !== "string" || !value.trim()) return undefined
  const text = value.trim()
  if (/^\d+(?:\.\d+)?$/.test(text)) return normalizeProviderTimestamp(Number(text))
  if (!/(?:Z|[+-]\d{2}:?\d{2})$/i.test(text)) return undefined
  const timestamp = Date.parse(text)
  return Number.isNaN(timestamp) ? undefined : new Date(timestamp).toISOString()
}

interface OpenMeteoPayload {
  current?: Record<string, unknown> & { time?: number | string }
  hourly?: Record<string, unknown> & { time?: Array<number | string> }
}

export interface OpenMeteoPortPoint {
  timestamp: string
  horizon: "hourly" | "current"
  waveHeightM?: number
  swellWaveHeightM?: number
  windSpeedKmh?: number
  windGustKmh?: number
  precipitationMm?: number
  visibilityM?: number
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

function upsertPoint(
  points: Map<string, OpenMeteoPortPoint>,
  timestamp: string,
  horizon: "hourly" | "current",
  patch: Partial<Omit<OpenMeteoPortPoint, "timestamp" | "horizon">>,
) {
  const key = `${timestamp}|${horizon}`
  const existing = points.get(key)
  const next: OpenMeteoPortPoint = existing ?? { timestamp, horizon }
  Object.assign(next, patch)
  points.set(key, next)
}

export function mergeOpenMeteoPortPoints(marine: OpenMeteoPayload, land: OpenMeteoPayload): OpenMeteoPortPoint[] {
  const points = new Map<string, OpenMeteoPortPoint>()
  const marineHourly = marine.hourly
  marineHourly?.time?.forEach((time, index) => {
    const timestamp = normalizeProviderTimestamp(time)
    if (!timestamp) return
    upsertPoint(points, timestamp, "hourly", {
      waveHeightM: numberValue((marineHourly as { wave_height?: number[] }).wave_height?.[index]),
      swellWaveHeightM: numberValue((marineHourly as { swell_wave_height?: number[] }).swell_wave_height?.[index]),
    })
  })
  const landHourly = land.hourly
  landHourly?.time?.forEach((time, index) => {
    const timestamp = normalizeProviderTimestamp(time)
    if (!timestamp) return
    upsertPoint(points, timestamp, "hourly", {
      windSpeedKmh: numberValue((landHourly as { wind_speed_10m?: number[] }).wind_speed_10m?.[index]),
      windGustKmh: numberValue((landHourly as { wind_gusts_10m?: number[] }).wind_gusts_10m?.[index]),
      precipitationMm: numberValue((landHourly as { precipitation?: number[] }).precipitation?.[index]),
      visibilityM: numberValue((landHourly as { visibility?: number[] }).visibility?.[index]),
    })
  })
  const marineCurrent = marine.current
  const landCurrent = land.current
  const currentTimestamp = normalizeProviderTimestamp(marineCurrent?.time ?? landCurrent?.time)
  if (currentTimestamp) {
    upsertPoint(points, currentTimestamp, "current", {
      waveHeightM: numberValue(marineCurrent?.wave_height),
      swellWaveHeightM: numberValue(marineCurrent?.swell_wave_height),
      windSpeedKmh: numberValue(landCurrent?.wind_speed_10m),
      windGustKmh: numberValue(landCurrent?.wind_gusts_10m),
      precipitationMm: numberValue(landCurrent?.precipitation),
      visibilityM: numberValue(landCurrent?.visibility),
    })
  }
  return [...points.values()].sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp)).slice(0, 7 * 24 + 2)
}

export function openMeteoPointsToForecastRows(
  portId: string,
  unlocode: string | undefined,
  points: OpenMeteoPortPoint[],
  fetchedAt: string,
  sourceId = "open-meteo-marine",
): PortWeatherForecastRow[] {
  return points.map((point) => {
    const id = `wf-${portId}-${point.horizon}-${Date.parse(point.timestamp)}`
    return {
      id,
      portId,
      unlocode,
      forecastAt: point.timestamp,
      horizon: point.horizon,
      waveHeightM: point.waveHeightM,
      swellWaveHeightM: point.swellWaveHeightM,
      windSpeedKmh: point.windSpeedKmh,
      windGustKmh: point.windGustKmh,
      precipitationMm: point.precipitationMm,
      visibilityM: point.visibilityM,
      sourceId,
      fetchedAt,
    }
  })
}

export function forecastRowsToOpenMeteoPoints(rows: readonly PortWeatherForecastRow[]): OpenMeteoPortPoint[] {
  return rows.map(row => ({
    timestamp: row.forecastAt,
    horizon: row.horizon,
    waveHeightM: row.waveHeightM,
    swellWaveHeightM: row.swellWaveHeightM,
    windSpeedKmh: row.windSpeedKmh,
    windGustKmh: row.windGustKmh,
    precipitationMm: row.precipitationMm,
    visibilityM: row.visibilityM,
  }))
}

export function computePortWeatherImpacts(
  portId: string,
  points: OpenMeteoPortPoint[],
  computedAt: string,
  typhoonDistanceKm?: number,
  resolveTyphoon?: (validFrom: string, validUntil: string) => TyphoonInputState,
): PortWeatherImpactRow[] {
  const sorted = [...points].sort((a, b) => {
    const delta = Date.parse(a.timestamp) - Date.parse(b.timestamp)
    if (delta !== 0) return delta
    return a.horizon === "current" ? 1 : -1
  })
  const precipSamples = sorted.map(p => ({ timestamp: p.timestamp, precipitationMm: p.precipitationMm, horizon: p.horizon }))
  const impacts: PortWeatherImpactRow[] = []
  sorted.forEach((point, index) => {
    const gustMs = point.windGustKmh === undefined ? undefined : windGustKmhToMs(point.windGustKmh)
    const waveM = point.waveHeightM ?? point.swellWaveHeightM
    const interval = impactValidityInterval(point, sorted, index)
    const typhoon = resolveTyphoon
      ? resolveTyphoon(interval.validFrom, interval.validUntil)
      : typhoonDistanceKm === undefined
        ? { status: "unavailable" as const }
        : { status: "checked" as const, distanceKm: typhoonDistanceKm }
    const { hits } = evaluatePointWeatherRules({
      windGustMs: gustMs,
      waveHeightM: waveM,
      visibilityM: point.visibilityM,
    }, precipSamples, point.timestamp, typhoon)
    for (const hit of hits) {
      impacts.push({
        id: `wi-${portId}-${hit.ruleId}-${point.horizon}-${Date.parse(point.timestamp)}`,
        portId,
        validFrom: interval.validFrom,
        validUntil: interval.validUntil,
        ruleId: hit.ruleId,
        severity: hit.severity,
        status: "potential",
        provenance: "system",
        summaryZh: hit.summaryZh,
        inputValues: Object.fromEntries(
          Object.entries(hit.inputValues).filter((entry): entry is [string, number] => typeof entry[1] === "number"),
        ),
        computedAt,
      })
    }
  })
  return impacts
}
