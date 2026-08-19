import type { DataProvenance, Freshness, NavigationStatus, Port } from "./shipping"
import { portWeatherConfig } from "./shipping-fixtures"

export type AisAreaTrend = "rising" | "stable" | "falling" | "unknown"
export type AisAreaCoverage = "usable" | "insufficient_samples" | "no_observation" | "stale"

export interface AisAreaBoundingBox {
  south: number
  west: number
  north: number
  east: number
}

export interface PortAisAreaConfig {
  portId: string
  center: { latitude: number, longitude: number }
  bbox: AisAreaBoundingBox
  boundarySource: "configured_heuristic"
}

export interface AisAreaObservation {
  mmsi: string
  portId: string
  latitude: number
  longitude: number
  speed?: number
  course?: number
  navigationStatus: NavigationStatus
  sourceUpdatedAt?: string
  fetchedAt: string
  areaAmbiguous: boolean
}

export interface AisAreaObservationMessage {
  MessageType?: string
  MetaData?: { MMSI?: number | string, ShipName?: string, time_utc?: number | string }
  Metadata?: { MMSI?: number | string, ShipName?: string, time_utc?: number | string }
  Message?: { PositionReport?: {
    UserID?: number | string
    Latitude?: number
    Longitude?: number
    Sog?: number
    Cog?: number
    NavigationalStatus?: number
  } }
}

export interface AisDerivedPortMetric extends Freshness {
  portId: string
  sampleSize: number
  activeVesselCount: number
  anchoredCount: number
  mooredCount: number
  lowSpeedCount: number
  stationaryRatio: number
  ambiguousSampleCount: number
  trend: AisAreaTrend
  consecutiveRisingWindows: number
  observationWindow?: { startAt: string, endAt: string }
  bbox: AisAreaBoundingBox
  boundarySource: "configured_heuristic"
  coverage: AisAreaCoverage
  lowSpeedThresholdKnots: number
  minimumSampleSize: number
  provenance?: DataProvenance
  observationProvenance?: DataProvenance
  trendProvenance?: DataProvenance
}

export const AIS_AREA_SOURCE_ID = "aisstream-area"
export const AIS_AREA_DEFAULT_TTL_MS = 15 * 60 * 1000
export const AIS_AREA_DEFAULT_MINIMUM_SAMPLE_SIZE = 5
export const AIS_AREA_DEFAULT_LOW_SPEED_KNOTS = 1
export const AIS_AREA_DEFAULT_HISTORY_SIZE = 12

const areaHalfHeight = 0.12
const areaHalfWidth = 0.16

function clampLatitude(value: number): number {
  return Math.max(-90, Math.min(90, value))
}

function clampLongitude(value: number): number {
  return Math.max(-180, Math.min(180, value))
}

export const portAisAreaConfig: Record<string, PortAisAreaConfig> = Object.fromEntries(
  Object.entries(portWeatherConfig).map(([portId, center]) => [portId, {
    portId,
    center,
    bbox: {
      south: clampLatitude(center.latitude - areaHalfHeight),
      west: clampLongitude(center.longitude - areaHalfWidth),
      north: clampLatitude(center.latitude + areaHalfHeight),
      east: clampLongitude(center.longitude + areaHalfWidth),
    },
    boundarySource: "configured_heuristic" as const,
  }]),
)

export function getPortAisAreaConfig(portId: string): PortAisAreaConfig | undefined {
  return portAisAreaConfig[portId]
}

export function watchedPortAisAreaConfigs(ports: Pick<Port, "id" | "isWatched">[]): PortAisAreaConfig[] {
  return ports.filter(port => port.isWatched).map(port => portAisAreaConfig[port.id]).filter((config): config is PortAisAreaConfig => config !== undefined)
}

export function aisAreaBoundingBoxContains(bbox: AisAreaBoundingBox, latitude: number, longitude: number): boolean {
  const longitudeInRange = bbox.west <= bbox.east
    ? longitude >= bbox.west && longitude <= bbox.east
    : longitude >= bbox.west || longitude <= bbox.east
  return latitude >= bbox.south && latitude <= bbox.north && longitudeInRange
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

function mmsiValue(value: unknown): string | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return String(value)
  if (typeof value === "string" && value.trim()) return value.trim()
  return undefined
}

function timestampValue(value: unknown): string | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    const date = new Date(value * 1000)
    return Number.isNaN(date.getTime()) ? undefined : date.toISOString()
  }
  if (typeof value !== "string" || !value.trim()) return undefined
  const text = value.trim()
  if (/^\d+(?:\.\d+)?$/.test(text)) return timestampValue(Number(text))
  if (!/(?:Z|[+-]\d{2}:?\d{2})$/i.test(text)) return undefined
  const timestamp = Date.parse(text)
  return Number.isNaN(timestamp) ? undefined : new Date(timestamp).toISOString()
}

function navigationStatus(value: number | undefined): NavigationStatus {
  return value === 1 ? "anchored" : value === 5 ? "moored" : value === 6 ? "aground" : value === 0 ? "under_way" : "unknown"
}

function messageMetadata(message: AisAreaObservationMessage) {
  return message.MetaData ?? message.Metadata
}

export function normalizeAisAreaPositionReport(message: AisAreaObservationMessage, fetchedAt: string): Omit<AisAreaObservation, "portId" | "areaAmbiguous"> | undefined {
  if (message.MessageType !== "PositionReport") return undefined
  const position = message.Message?.PositionReport
  if (!position) return undefined
  const metadata = messageMetadata(message)
  const mmsi = mmsiValue(metadata?.MMSI) ?? mmsiValue(position.UserID)
  const latitude = numberValue(position.Latitude)
  const longitude = numberValue(position.Longitude)
  if (!mmsi || latitude === undefined || longitude === undefined || latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return undefined
  const speed = numberValue(position.Sog)
  return {
    mmsi,
    latitude,
    longitude,
    speed: speed !== undefined && speed >= 0 ? speed : undefined,
    course: numberValue(position.Cog),
    navigationStatus: navigationStatus(numberValue(position.NavigationalStatus)),
    sourceUpdatedAt: timestampValue(metadata?.time_utc),
    fetchedAt,
  }
}

export function assignAisAreaObservation(observation: Omit<AisAreaObservation, "portId" | "areaAmbiguous">, configs: PortAisAreaConfig[]): AisAreaObservation | undefined {
  const matches = configs.filter(config => aisAreaBoundingBoxContains(config.bbox, observation.latitude, observation.longitude))
  if (!matches.length) return undefined
  const nearest = matches.reduce((best, candidate) => {
    const bestDistance = (best.center.latitude - observation.latitude) ** 2 + (best.center.longitude - observation.longitude) ** 2
    const candidateDistance = (candidate.center.latitude - observation.latitude) ** 2 + (candidate.center.longitude - observation.longitude) ** 2
    return candidateDistance < bestDistance ? candidate : best
  })
  return { ...observation, portId: nearest.portId, areaAmbiguous: matches.length > 1 }
}

function observationTimestamp(observation: AisAreaObservation): number {
  const source = observation.sourceUpdatedAt ? Date.parse(observation.sourceUpdatedAt) : Number.NaN
  const fetched = Date.parse(observation.fetchedAt)
  return Number.isFinite(source) ? source : fetched
}

export function pruneAisAreaObservations(observations: Iterable<AisAreaObservation>, now: Date | string, ttlMs = AIS_AREA_DEFAULT_TTL_MS): AisAreaObservation[] {
  const nowTimestamp = typeof now === "string" ? Date.parse(now) : now.getTime()
  return [...observations].filter((observation) => {
    const timestamp = observationTimestamp(observation)
    return Number.isFinite(timestamp) && (!Number.isFinite(nowTimestamp) || nowTimestamp - timestamp <= ttlMs)
  })
}

function trendFor(current: number, previous: number | undefined): AisAreaTrend {
  if (previous === undefined || Math.abs(current - previous) < 0.001) return previous === undefined ? "unknown" : "stable"
  return current > previous ? "rising" : "falling"
}

export interface AggregateAisAreaOptions {
  now?: Date | string
  previous?: AisDerivedPortMetric
  ttlMs?: number
  minimumSampleSize?: number
  lowSpeedThresholdKnots?: number
  provenance?: DataProvenance
  observationProvenance?: DataProvenance
  trendProvenance?: DataProvenance
}

export function aggregateAisPortMetric(config: PortAisAreaConfig, observations: Iterable<AisAreaObservation>, options: AggregateAisAreaOptions = {}): AisDerivedPortMetric {
  const now = options.now ?? new Date()
  const fetchedAt = typeof now === "string" ? now : now.toISOString()
  const minimumSampleSize = options.minimumSampleSize ?? AIS_AREA_DEFAULT_MINIMUM_SAMPLE_SIZE
  const lowSpeedThresholdKnots = options.lowSpeedThresholdKnots ?? AIS_AREA_DEFAULT_LOW_SPEED_KNOTS
  const latestByMmsi = new Map<string, AisAreaObservation>()
  for (const observation of observations) latestByMmsi.set(observation.mmsi, observation)
  const fresh = pruneAisAreaObservations(latestByMmsi.values(), now, options.ttlMs)
  const sampleSize = new Set(fresh.map(item => item.mmsi)).size
  const anchoredCount = fresh.filter(item => item.navigationStatus === "anchored").length
  const mooredCount = fresh.filter(item => item.navigationStatus === "moored").length
  const lowSpeedCount = fresh.filter(item => item.speed !== undefined && item.speed <= lowSpeedThresholdKnots).length
  const stationaryRatio = sampleSize ? (anchoredCount + mooredCount) / sampleSize : 0
  const trend = sampleSize >= minimumSampleSize && options.previous?.coverage === "usable"
    ? trendFor(stationaryRatio, options.previous.stationaryRatio)
    : "unknown"
  const consecutiveRisingWindows = trend === "rising" ? (options.previous?.trend === "rising" ? options.previous.consecutiveRisingWindows + 1 : 1) : 0
  const timestamps = fresh.map(observation => observation.sourceUpdatedAt ?? observation.fetchedAt).filter(value => Number.isFinite(Date.parse(value))).sort()
  const coverage: AisAreaCoverage = sampleSize === 0 ? "no_observation" : sampleSize < minimumSampleSize ? "insufficient_samples" : "usable"
  const latestSourceUpdatedAt = timestamps.at(-1)
  const stale = coverage === "no_observation"
  return {
    portId: config.portId,
    sampleSize,
    activeVesselCount: sampleSize,
    anchoredCount,
    mooredCount,
    lowSpeedCount,
    stationaryRatio,
    ambiguousSampleCount: fresh.filter(item => item.areaAmbiguous).length,
    trend,
    consecutiveRisingWindows,
    observationWindow: timestamps.length ? { startAt: timestamps[0], endAt: timestamps.at(-1)! } : undefined,
    bbox: config.bbox,
    boundarySource: config.boundarySource,
    coverage,
    lowSpeedThresholdKnots,
    minimumSampleSize,
    updatedAt: latestSourceUpdatedAt,
    sourceUpdatedAt: latestSourceUpdatedAt,
    fetchedAt,
    stale,
    sourceStatus: sampleSize === 0 ? "never_succeeded" : "healthy",
    error: sampleSize === 0 ? "no_observation" : undefined,
    provenance: options.provenance,
    observationProvenance: options.observationProvenance,
    trendProvenance: options.trendProvenance,
  }
}

export function pushAisAreaMetricHistory(history: AisDerivedPortMetric[], metric: AisDerivedPortMetric, maxSize = AIS_AREA_DEFAULT_HISTORY_SIZE): AisDerivedPortMetric[] {
  return [...history, metric].slice(-Math.max(1, maxSize))
}

export function isUsableAisAreaMetric(metric: AisDerivedPortMetric, minimumSampleSize = AIS_AREA_DEFAULT_MINIMUM_SAMPLE_SIZE): boolean {
  return metric.sourceStatus === "healthy" && !metric.stale && metric.coverage === "usable" && metric.sampleSize >= minimumSampleSize
}
