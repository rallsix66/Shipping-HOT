import { windGustKmhToMs } from "@shared/weather-units"
import type { PortWeatherForecastRow, PortWeatherImpactRow } from "@shared/shipping"
import { evaluateWeatherImpactRules } from "#/services/weather-impact-engine"

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

export function mergeOpenMeteoPortPoints(marine: OpenMeteoPayload, land: OpenMeteoPayload): OpenMeteoPortPoint[] {
  const points = new Map<string, OpenMeteoPortPoint>()
  const ensure = (value: unknown) => {
    const timestamp = normalizeProviderTimestamp(value)
    if (!timestamp) return undefined
    const point = points.get(timestamp) ?? { timestamp }
    points.set(timestamp, point)
    return point
  }
  const marineHourly = marine.hourly
  marineHourly?.time?.forEach((time, index) => {
    const point = ensure(time)
    if (!point) return
    point.waveHeightM = numberValue((marineHourly as { wave_height?: number[] }).wave_height?.[index])
    point.swellWaveHeightM = numberValue((marineHourly as { swell_wave_height?: number[] }).swell_wave_height?.[index])
  })
  const landHourly = land.hourly
  landHourly?.time?.forEach((time, index) => {
    const point = ensure(time)
    if (!point) return
    point.windSpeedKmh = numberValue((landHourly as { wind_speed_10m?: number[] }).wind_speed_10m?.[index])
    point.windGustKmh = numberValue((landHourly as { wind_gusts_10m?: number[] }).wind_gusts_10m?.[index])
    point.precipitationMm = numberValue((landHourly as { precipitation?: number[] }).precipitation?.[index])
    point.visibilityM = numberValue((landHourly as { visibility?: number[] }).visibility?.[index])
  })
  const marineCurrent = marine.current
  const landCurrent = land.current
  const currentPoint = ensure(marineCurrent?.time ?? landCurrent?.time)
  if (currentPoint) {
    currentPoint.waveHeightM ??= numberValue(marineCurrent?.wave_height)
    currentPoint.swellWaveHeightM ??= numberValue(marineCurrent?.swell_wave_height)
    currentPoint.windSpeedKmh ??= numberValue(landCurrent?.wind_speed_10m)
    currentPoint.windGustKmh ??= numberValue(landCurrent?.wind_gusts_10m)
    currentPoint.precipitationMm ??= numberValue(landCurrent?.precipitation)
    currentPoint.visibilityM ??= numberValue(landCurrent?.visibility)
  }
  return [...points.values()].sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp)).slice(0, 7 * 24 + 1)
}

export function openMeteoPointsToForecastRows(
  portId: string,
  unlocode: string | undefined,
  points: OpenMeteoPortPoint[],
  fetchedAt: string,
  sourceId = "open-meteo-marine",
): PortWeatherForecastRow[] {
  return points.map((point) => {
    const id = `wf-${portId}-${Date.parse(point.timestamp)}`
    return {
      id,
      portId,
      unlocode,
      forecastAt: point.timestamp,
      horizon: "hourly" as const,
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

function precipitation24hAt(points: OpenMeteoPortPoint[], index: number): number | undefined {
  const window = points.slice(Math.max(0, index - 23), index + 1)
  const values = window.map(p => p.precipitationMm).filter((v): v is number => v !== undefined)
  if (!values.length) return undefined
  return values.reduce((sum, v) => sum + v, 0)
}

export function computePortWeatherImpacts(
  portId: string,
  points: OpenMeteoPortPoint[],
  computedAt: string,
): PortWeatherImpactRow[] {
  const impacts: PortWeatherImpactRow[] = []
  points.forEach((point, index) => {
    const gustMs = point.windGustKmh === undefined ? undefined : windGustKmhToMs(point.windGustKmh)
    const waveM = point.waveHeightM ?? point.swellWaveHeightM
    const hits = evaluateWeatherImpactRules({
      windGustMs: gustMs,
      waveHeightM: waveM,
      visibilityM: point.visibilityM,
      precipitationMm24h: precipitation24hAt(points, index),
    })
    for (const hit of hits) {
      impacts.push({
        id: `wi-${portId}-${hit.ruleId}-${Date.parse(point.timestamp)}`,
        portId,
        validFrom: point.timestamp,
        validUntil: point.timestamp,
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
