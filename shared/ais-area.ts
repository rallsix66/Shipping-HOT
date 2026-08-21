import type { DataProvenance, Freshness, NavigationStatus, Port } from "./shipping"
import { portDirectoryBaseline } from "./port-directory"
import type { PortDirectoryCoordinate } from "./port-directory"

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
  bucketStartedAt?: string
  bucketEndedAt?: string
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
export const AIS_AREA_BUCKET_MS = 5 * 60 * 1000
export const AIS_AREA_MAX_OBSERVATIONS = 5000

const areaHalfHeight = 0.12
const areaHalfWidth = 0.16

function clampLatitude(value: number): number {
  return Math.max(-90, Math.min(90, value))
}

function clampLongitude(value: number): number {
  return Math.max(-180, Math.min(180, value))
}

export function createPortAisAreaConfig(portId: string, center: PortDirectoryCoordinate): PortAisAreaConfig {
  return {
    portId,
    center,
    bbox: {
      south: clampLatitude(center.latitude - areaHalfHeight),
      west: clampLongitude(center.longitude - areaHalfWidth),
      north: clampLatitude(center.latitude + areaHalfHeight),
      east: clampLongitude(center.longitude + areaHalfWidth),
    },
    boundarySource: "configured_heuristic",
  }
}

// Pure-function/test baseline. Server providers inject PortDirectoryRepository-backed coordinates.
export const portAisAreaConfig: Record<string, PortAisAreaConfig> = Object.fromEntries(
  portDirectoryBaseline.map(port => [port.shippingPortId, createPortAisAreaConfig(port.shippingPortId, port)]),
)

export function getPortAisAreaConfig(portId: string): PortAisAreaConfig | undefined {
  return portAisAreaConfig[portId]
}

export function watchedPortAisAreaConfigs(ports: Pick<Port, "id" | "isWatched">[], configs: Record<string, PortAisAreaConfig> = portAisAreaConfig): PortAisAreaConfig[] {
  return ports.filter(port => port.isWatched).map(port => configs[port.id]).filter((config): config is PortAisAreaConfig => config !== undefined)
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

export function aisAreaObservationTimestamp(observation: AisAreaObservation): number {
  const source = observation.sourceUpdatedAt ? Date.parse(observation.sourceUpdatedAt) : Number.NaN
  const fetched = Date.parse(observation.fetchedAt)
  return Number.isFinite(source) ? source : fetched
}

export function pruneAisAreaObservations(observations: Iterable<AisAreaObservation>, now: Date | string, ttlMs = AIS_AREA_DEFAULT_TTL_MS): AisAreaObservation[] {
  const nowTimestamp = typeof now === "string" ? Date.parse(now) : now.getTime()
  return [...observations].filter((observation) => {
    const timestamp = aisAreaObservationTimestamp(observation)
    return Number.isFinite(timestamp) && (!Number.isFinite(nowTimestamp) || nowTimestamp - timestamp <= ttlMs)
  })
}

function metricBucketId(metric: AisDerivedPortMetric): number | undefined {
  const bucketStartedAt = metric.bucketStartedAt ? Date.parse(metric.bucketStartedAt) : Number.NaN
  if (Number.isFinite(bucketStartedAt)) return Math.floor(bucketStartedAt / AIS_AREA_BUCKET_MS)
  const observationEndAt = metric.observationWindow?.endAt ? Date.parse(metric.observationWindow.endAt) : Number.NaN
  return Number.isFinite(observationEndAt) ? Math.floor(observationEndAt / AIS_AREA_BUCKET_MS) : undefined
}

function bucketBounds(timestamp: number): { id: number, startedAt: string, endedAt: string } {
  const id = Math.floor(timestamp / AIS_AREA_BUCKET_MS)
  const start = id * AIS_AREA_BUCKET_MS
  return {
    id,
    startedAt: new Date(start).toISOString(),
    endedAt: new Date(start + AIS_AREA_BUCKET_MS).toISOString(),
  }
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
  const stationaryCount = anchoredCount + mooredCount
  const stationaryRatio = sampleSize ? stationaryCount / sampleSize : 0
  const timestamps = fresh
    .map((observation) => {
      const timestamp = aisAreaObservationTimestamp(observation)
      return Number.isFinite(timestamp) ? { timestamp, value: new Date(timestamp).toISOString() } : undefined
    })
    .filter((value): value is { timestamp: number, value: string } => value !== undefined)
    .sort((a, b) => a.timestamp - b.timestamp)
  const coverage: AisAreaCoverage = sampleSize === 0 ? "no_observation" : sampleSize < minimumSampleSize ? "insufficient_samples" : "usable"
  const latestEffectiveTimestamp = timestamps.at(-1)
  const reliableSourceTimestamps = fresh
    .map(observation => observation.sourceUpdatedAt)
    .filter((value): value is string => value !== undefined && Number.isFinite(Date.parse(value)))
    .map(value => ({ timestamp: Date.parse(value), value: new Date(Date.parse(value)).toISOString() }))
    .sort((a, b) => a.timestamp - b.timestamp)
  const latestReliableSourceUpdatedAt = reliableSourceTimestamps.at(-1)?.value
  const currentBucket = latestEffectiveTimestamp ? bucketBounds(latestEffectiveTimestamp.timestamp) : undefined
  let trend: AisAreaTrend = "unknown"
  let consecutiveRisingWindows = 0
  const previous = options.previous
  const previousBucketId = previous ? metricBucketId(previous) : undefined
  const previousIsUsable = previous?.sourceStatus === "healthy" && !previous.stale && previous.coverage === "usable"
  if (coverage === "usable" && currentBucket && previous && previousIsUsable && previousBucketId !== undefined) {
    const bucketDelta = currentBucket.id - previousBucketId
    if (bucketDelta === 0) {
      trend = previous.trend
      consecutiveRisingWindows = previous.trend === "rising" ? previous.consecutiveRisingWindows : 0
    } else if (bucketDelta === 1) {
      const previousStationaryCount = previous.anchoredCount + previous.mooredCount
      if (stationaryCount < previousStationaryCount) trend = "falling"
      else if (stationaryCount === previousStationaryCount) trend = "stable"
      else if (stationaryRatio > previous.stationaryRatio) trend = "rising"
      else trend = "stable"
      consecutiveRisingWindows = trend === "rising"
        ? previous.trend === "rising" ? previous.consecutiveRisingWindows + 1 : 1
        : 0
    }
  }
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
    bucketStartedAt: currentBucket?.startedAt,
    bucketEndedAt: currentBucket?.endedAt,
    observationWindow: timestamps.length ? { startAt: timestamps[0].value, endAt: timestamps.at(-1)!.value } : undefined,
    bbox: config.bbox,
    boundarySource: config.boundarySource,
    coverage,
    lowSpeedThresholdKnots,
    minimumSampleSize,
    updatedAt: latestReliableSourceUpdatedAt ?? latestEffectiveTimestamp?.value,
    sourceUpdatedAt: latestReliableSourceUpdatedAt,
    fetchedAt,
    stale,
    sourceStatus: sampleSize === 0 ? "never_succeeded" : "healthy",
    error: sampleSize === 0 ? "no_observation" : undefined,
    provenance: options.provenance,
    observationProvenance: options.observationProvenance,
    trendProvenance: options.trendProvenance,
  }
}

export function isUsableAisAreaMetric(metric: AisDerivedPortMetric, minimumSampleSize = AIS_AREA_DEFAULT_MINIMUM_SAMPLE_SIZE): boolean {
  return metric.sourceStatus === "healthy" && !metric.stale && metric.coverage === "usable" && metric.sampleSize >= minimumSampleSize
}
