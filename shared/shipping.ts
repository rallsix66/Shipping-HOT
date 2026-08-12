export type SourceStatus = "healthy" | "degraded" | "failed" | "disabled" | "never_succeeded"
export type FreshnessState = "fresh" | "stale" | "unknown"
export type Severity = "info" | "watch" | "warning" | "critical"
export type EventStatus = "active" | "resolved"
export type NavigationStatus = "under_way" | "anchored" | "moored" | "aground" | "unknown"
export type FeedCategory = "shipping_news" | "carrier_notice" | "weather" | "port_notice"

export interface Freshness {
  updatedAt?: string
  stale: boolean
  sourceStatus: SourceStatus
  error?: string
}

export interface Vessel extends Freshness {
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

export interface Port extends Freshness {
  id: string
  name: string
  nameEn: string
  country: string
  unlocode: string
  isWatched: boolean
  congestionLevel: "low" | "medium" | "high" | "critical"
  waitingVessels: number
  containerWaitingVessels: number
  waitingHours: number
  operationalStatus: "normal" | "disrupted" | "closed"
}

export interface Voyage extends Freshness {
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

export interface FeedItem extends Freshness {
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

export interface ShippingEvent {
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
  evidenceJson: Record<string, unknown>
  sourceStatus: SourceStatus
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
}

export interface ShippingSnapshot {
  vessels: Vessel[]
  ports: Port[]
  voyages: Voyage[]
  events: ShippingEvent[]
  feedItems: FeedItem[]
  settings: ShippingSettings
}

export interface HotItem {
  id: string
  kind: "event" | "feed"
  title: string
  summary: string
  severity: Severity
  freshness: FreshnessState
  sourceStatus: SourceStatus
  occurredAt: string
  relatedLabel?: string
  eventId?: string
  feedItemId?: string
}
