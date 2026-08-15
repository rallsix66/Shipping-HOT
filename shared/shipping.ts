import type { CalendarCoverage, CalendarEvent } from "./calendar"

export type SourceStatus = "healthy" | "degraded" | "failed" | "disabled" | "never_succeeded"
export type SourceType = "official" | "third_party" | "user" | "mock"
export type DataNature = "observed" | "reported" | "forecast" | "modelled" | "derived" | "estimated" | "planned"
export type FreshnessState = "fresh" | "stale" | "unknown"
export type Severity = "info" | "watch" | "warning" | "critical"
export type EventStatus = "active" | "resolved"
export type NavigationStatus = "under_way" | "anchored" | "moored" | "aground" | "unknown"
export type FeedCategory = "shipping_news" | "carrier_notice" | "weather" | "port_notice"

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
  statusChangedAt: string
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
  congestionLevel: "low" | "medium" | "high" | "critical"
  congestionDetail?: PortCongestionDetail
  waitingVessels: number
  containerWaitingVessels: number
  waitingHours: number
  operationalStatus: "normal" | "disrupted" | "closed"
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
  publishedAt: string
  severity: Severity
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
    congestionLevel: Port["congestionLevel"]
  }
  retentionDays: number
  calendarSync?: CalendarCoverage[]
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
}
