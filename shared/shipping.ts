import type { CalendarCoverage, CalendarEvent } from "./calendar"

export type SourceStatus = "healthy" | "degraded" | "failed" | "disabled" | "never_succeeded"
export type SourceType = "official" | "third_party" | "user" | "mock"
export type DataNature = "observed" | "reported" | "forecast" | "modelled" | "derived" | "estimated" | "planned"
export type FreshnessState = "fresh" | "stale" | "unknown"
export type Severity = "info" | "watch" | "warning" | "critical"
export type EventStatus = "active" | "resolved"
export type NavigationStatus = "under_way" | "anchored" | "moored" | "aground" | "unknown"
export type FeedCategory = "shipping_news" | "carrier_notice" | "weather" | "port_notice"
export type WeatherRiskSource = "model" | "official"
export type WeatherAlertState = "active" | "expired" | "unknown"

export interface DataProvenance {
  sourceType: SourceType
  dataNature: DataNature
  sourceId: string
  sourceUrl?: string
  verified?: boolean
}

export interface DataEvidence {
  provenance: DataProvenance
  sourceUpdatedAt?: string
}

export interface Freshness {
  updatedAt?: string
  sourceUpdatedAt?: string
  fetchedAt?: string
  stale: boolean
  sourceStatus: SourceStatus
  error?: string
}

export interface ProvenanceAware {
  provenance?: DataProvenance
}

export interface VesselWatchTarget {
  id: string
  name: string
  mmsi?: string
  imo?: string
  isWatched: boolean
}

export function toVesselWatchTarget(vessel: Pick<Vessel, "id" | "name" | "mmsi" | "imo" | "isWatched">): VesselWatchTarget {
  return {
    id: vessel.id,
    name: vessel.name,
    mmsi: vessel.mmsi,
    imo: vessel.imo,
    isWatched: vessel.isWatched,
  }
}

export type PortCongestionCoverage = "public" | "no_public_data"

export interface PortCongestionDetail {
  coverageStatus: PortCongestionCoverage
  congestionCategory?: Port["congestionLevel"]
  medianWaitingHours?: number
  previousMedianWaitingHours?: number
  weekOverWeekChangePct?: number
  longTailCongestion?: boolean
}

export interface ProviderResult<T> {
  data: T[]
  provenance: DataProvenance
  fetchedAt: string
  sourceUpdatedAt?: string
  freshness: Freshness
}

export interface ShippingProviderFreshness {
  vessel: Freshness
  port: Freshness
  schedule: Freshness
  weather: Freshness
  weatherAlerts: Freshness
  feed?: Freshness
}

export function deriveProvenance(source?: DataProvenance): DataProvenance | undefined {
  return source ? { ...source, dataNature: "derived" } : undefined
}

export function provenanceEvidence(source?: DataProvenance, sourceUpdatedAt?: string): DataEvidence[] {
  return source ? [{ provenance: source, sourceUpdatedAt }] : []
}

const knownMockProvenance: Record<string, DataProvenance> = {
  "mock-vessel": { sourceType: "mock", dataNature: "observed", sourceId: "mock-vessel", verified: false },
  "mock-port": { sourceType: "mock", dataNature: "derived", sourceId: "mock-port", verified: false },
  "mock-schedule": { sourceType: "mock", dataNature: "planned", sourceId: "mock-schedule", verified: false },
  "mock-weather": { sourceType: "mock", dataNature: "forecast", sourceId: "mock-weather", verified: false },
  "mock-port-notice": { sourceType: "mock", dataNature: "reported", sourceId: "mock-port-notice", verified: false },
}

export function knownMockProvenanceFor(sourceId?: string): DataProvenance | undefined {
  const provenance = sourceId ? knownMockProvenance[sourceId] : undefined
  return provenance ? { ...provenance } : undefined
}

export function isMockProvenance(provenance?: DataProvenance): boolean {
  return provenance?.sourceType === "mock"
}

export function normalizeLegacyTrust<T extends ProvenanceAware>(entity: T, provenance?: DataProvenance): T {
  if (entity.provenance || !provenance) return entity
  return { ...entity, provenance: { ...provenance } }
}

export function normalizeLegacyEventTrust(event: ShippingEvent, source?: Freshness & ProvenanceAware): ShippingEvent {
  if (event.provenance || !source?.provenance) return event
  const sourceUpdatedAt = event.sourceUpdatedAt ?? source.sourceUpdatedAt ?? source.updatedAt
  return {
    ...event,
    provenance: deriveProvenance(source.provenance),
    evidence: event.evidence?.length ? event.evidence : provenanceEvidence(source.provenance, sourceUpdatedAt),
    updatedAt: event.updatedAt ?? source.updatedAt,
    sourceUpdatedAt,
    fetchedAt: event.fetchedAt ?? source.fetchedAt,
    stale: event.stale ?? source.stale,
  }
}

export interface Vessel extends Freshness, ProvenanceAware {
  id: string
  name: string
  imo?: string
  mmsi?: string
  callSign?: string
  carrier?: string
  shipType?: string
  isWatched: boolean
  latitude?: number
  longitude?: number
  speed?: number
  course?: number
  navigationStatus: NavigationStatus
  statusChangedAt?: string
  destination?: string
  eta?: string
}

export interface Port extends Freshness, ProvenanceAware {
  id: string
  name: string
  nameEn: string
  country: string
  unlocode: string
  isWatched: boolean
  congestionLevel?: "low" | "medium" | "high" | "critical"
  congestionDetail?: PortCongestionDetail
  waitingVessels?: number
  containerWaitingVessels?: number
  waitingHours?: number
  operationalStatus?: "normal" | "disrupted" | "closed"
}

export interface ShippingProviderModes {
  vessel?: string
  port?: string
  schedule?: string
  weather?: string
  weatherAlerts?: string
  feed?: string
  calendar?: string
}

export interface OperationalSourceContext {
  modes: ShippingProviderModes
  activeSourceIds: ReadonlySet<string>
}

const realFeedSourceIds = new Set([
  "shipping-feed",
  "the-loadstar",
  "maritime-executive",
  "shekou-official",
  "laem-chabang-official",
  "port-klang-official",
  "yantian-official",
  "nansha-official",
])

const officialWeatherAlertSourceIds = new Set(["official-weather-alerts", "jma", "tmd", "bmkg"])

export function sourceAllowedForProviderModes(sourceId: string | undefined, modes: ShippingProviderModes): boolean {
  if (!sourceId) return false
  if (sourceId === "mock-vessel") return modes.vessel === "mock"
  if (sourceId === "aisstream") return modes.vessel === "aisstream"
  if (sourceId === "mock-port") return modes.port === "mock"
  if (sourceId === "portcast-public") return modes.port === "portcast"
  if (sourceId === "mock-weather") return modes.weather === "mock"
  if (sourceId === "open-meteo-marine") return modes.weather === "open-meteo"
  if (officialWeatherAlertSourceIds.has(sourceId)) return modes.weatherAlerts === "public" || modes.weatherAlerts === "experimental"
  if (sourceId === "mock-port-notice") return modes.feed === "mock"
  if (realFeedSourceIds.has(sourceId)) return modes.feed === "public"
  if (sourceId === "mock-calendar") return modes.calendar === "mock"
  if (sourceId === "calendarific") return modes.calendar === "calendarific"
  if (sourceId === "official-holiday-source" || ["official-th", "official-id", "official-my", "official-ph", "official-vn"].includes(sourceId)) return modes.calendar === "calendarific" || modes.calendar === "official"
  if (sourceId === "manual-holiday") return modes.calendar === "calendarific" || modes.calendar === "official" || modes.calendar === "manual"
  if (sourceId === "mock-schedule") return modes.schedule === "mock"
  return false
}

const sourceScopedEventTypes = new Set(["vessel_anchored", "port_congestion", "voyage_delay"])

export function sourceScopedEventDedupeKey(logicalDedupeKey: string, sourceId?: string): string {
  return `${logicalDedupeKey}:${sourceId ?? "unknown"}`
}

function sourceScopeForEvent(event: Pick<ShippingEvent, "provenance" | "evidence">): string | undefined {
  return event.provenance?.sourceId ?? event.evidence?.[0]?.provenance.sourceId
}

function entityIdForSourceScopedEvent(event: Pick<ShippingEvent, "type" | "vesselId" | "portId" | "voyageId">): string | undefined {
  if (event.type === "vessel_anchored") return event.vesselId
  if (event.type === "port_congestion") return event.portId
  if (event.type === "voyage_delay") return event.voyageId
  return undefined
}

export function eventHasSourceScopedIdentity(event: Pick<ShippingEvent, "type" | "dedupeKey" | "provenance" | "evidence" | "vesselId" | "portId" | "voyageId">): boolean {
  if (!sourceScopedEventTypes.has(event.type)) return true
  const entityId = entityIdForSourceScopedEvent(event)
  const sourceId = sourceScopeForEvent(event)
  return Boolean(entityId && sourceId && event.dedupeKey === sourceScopedEventDedupeKey(`${event.type}:${entityId}`, sourceId))
}

export function sourceAllowedForOperationalContext(sourceId: string | undefined, context: OperationalSourceContext): boolean {
  return Boolean(sourceId && context.activeSourceIds.has(sourceId) && sourceAllowedForProviderModes(sourceId, context.modes))
}

export function eventIsCompatibleWithCurrentProviders(event: Pick<ShippingEvent, "type" | "dedupeKey" | "provenance" | "evidence" | "vesselId" | "portId" | "voyageId">, modes: ShippingProviderModes): boolean {
  if (!eventHasSourceScopedIdentity(event)) return false
  const sourceId = event.provenance?.sourceId
  if (sourceId) return sourceAllowedForProviderModes(sourceId, modes)
  return (event.evidence ?? []).some(evidence => sourceAllowedForProviderModes(evidence.provenance.sourceId, modes))
}

export function filterEventsForProviderModes(events: ShippingEvent[], modes: ShippingProviderModes): ShippingEvent[] {
  return events.filter(event => eventIsCompatibleWithCurrentProviders(event, modes))
}

export function eventIsCompatibleWithOperationalContext(event: ShippingEvent, context: OperationalSourceContext): boolean {
  if (!eventHasSourceScopedIdentity(event)) return false
  const sourceId = event.provenance?.sourceId ?? event.evidence?.[0]?.provenance.sourceId
  return sourceAllowedForOperationalContext(sourceId, context)
}

export function filterEventsForOperationalContext(events: ShippingEvent[], context: OperationalSourceContext): ShippingEvent[] {
  return events.filter(event => eventIsCompatibleWithOperationalContext(event, context))
}

export interface Voyage extends Freshness, ProvenanceAware {
  id: string
  vesselId: string
  voyageNumber: string
  originPortId: string
  destinationPortId: string
  baselineEtd?: string
  baselineEta?: string
  baselineEtdSource?: string
  baselineEtaSource?: string
  latestEtd?: string
  latestEta?: string
  latestEtdSource?: string
  latestEtaSource?: string
  latestEtaObservedAt?: string
  delayMinutes?: number
  status: "planned" | "in_transit" | "arrived" | "delayed"
}

export interface FeedItem extends Freshness, ProvenanceAware {
  id: string
  sourceId: string
  category: FeedCategory
  type: string
  title: string
  summary: string
  sourceUrl: string
  canonicalUrl?: string
  publishedAt: string
  publicationTimeKnown?: boolean
  eventEligibility?: boolean
  severity: Severity
  hotReason?: string
  tags?: string[]
  weather?: WeatherDetail
  relatedPortIds: string[]
  relatedVesselIds: string[]
  relatedVoyageIds: string[]
}

export interface ShippingEvent extends ProvenanceAware {
  id: string
  type: string
  severity: Severity
  status: EventStatus
  title: string
  summary: string
  occurredAt: string
  detectedAt: string
  dedupeKey: string
  firstDetectedAt: string
  lastDetectedAt: string
  resolvedAt?: string
  feedItemId?: string
  vesselId?: string
  portId?: string
  voyageId?: string
  calendarEventId?: string
  evidenceJson: Record<string, unknown>
  evidence?: DataEvidence[]
  updatedAt?: string
  sourceUpdatedAt?: string
  fetchedAt?: string
  stale?: boolean
  sourceStatus: SourceStatus
  error?: string
}

export interface ShippingSettings {
  refreshInterval: number
  sourceEnabled: boolean
  providerEnabled: boolean
  eventThresholds: {
    anchoredHours: number
    delayMinutes: number
    congestionLevel: NonNullable<Port["congestionLevel"]>
  }
  retentionDays: number
  calendarSync?: CalendarCoverage[]
}

export interface WeatherDetail {
  riskSource: WeatherRiskSource
  alertState?: WeatherAlertState
  forecastWindowHours?: number
  forecastStartAt?: string
  forecastEndAt?: string
  waveHeightM?: number
  swellWaveHeightM?: number
  swellPeriodSeconds?: number
  waveDirectionDeg?: number
  swellDirectionDeg?: number
  swellWaveDirectionDeg?: number
  windows?: WeatherWindows
  windSpeedKmh?: number
  windGustKmh?: number
  alertId?: string
  alertRegion?: string
  alertIssuedAt?: string
  alertEffectiveAt?: string
  alertExpiresAt?: string
  alertUrgency?: string
  alertCertainty?: string
}

export interface WeatherWindow {
  severity: Severity
  forecastStartAt?: string
  forecastEndAt?: string
  maxWaveHeightM?: number
  maxSwellWaveHeightM?: number
  maxSwellPeriodSeconds?: number
  maxWindSpeedKmh?: number
  maxWindGustKmh?: number
  waveDirectionDeg?: number
  swellDirectionDeg?: number
  swellWaveDirectionDeg?: number
}

export interface WeatherWindows {
  h24: WeatherWindow
  h72: WeatherWindow
  d7: WeatherWindow
}

export interface ShippingSnapshot {
  vessels: Vessel[]
  ports: Port[]
  voyages: Voyage[]
  events: ShippingEvent[]
  feedItems: FeedItem[]
  settings: ShippingSettings
  providerFreshness?: ShippingProviderFreshness
  calendarEvents?: CalendarEvent[]
  calendarCoverage?: CalendarCoverage[]
}

export interface HotItem {
  id: string
  kind: "event" | "feed"
  title: string
  summary: string
  severity: Severity
  freshness: FreshnessState
  sourceStatus: SourceStatus
  provenance?: DataProvenance
  occurredAt: string
  relatedLabel?: string
  eventId?: string
  feedItemId?: string
  hotReason?: string
}
