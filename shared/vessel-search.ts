import type { SourceLineage } from "./shipping"

export type VesselSearchField = "name" | "imo" | "mmsi" | "callsign"

export interface VesselSearchQuery {
  query: string
  field?: VesselSearchField
}

export interface VesselIdentityObservation {
  providerRecordId?: string
  name: string
  imo?: string
  mmsi?: string
  callsign?: string
  flag?: string
  type?: string
  transmissionDateFrom?: string
  transmissionDateTo?: string
  source: string
}

export interface VesselMetadata {
  id: string
  name: string
  imo?: string
  mmsi?: string
  callsign?: string
  type?: string
  flag?: string
  source: string
  fetchedAt: string
  source_type?: SourceLineage
  providerRecordId?: string
  identityHistory?: VesselIdentityObservation[]
}

export interface VesselSearchResult extends VesselMetadata {
  matchField?: VesselSearchField
}

export interface VesselWatchlistItem extends VesselMetadata {
  watchedAt: string
  aisEnabled: boolean
  aisTrackingAvailable: boolean
}

export interface VesselSearchResponse {
  query: VesselSearchQuery
  results: VesselSearchResult[]
  cacheHit: boolean
  providerId: string
  fetchedAt: string
}

export function normalizeVesselSearchTerm(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase()
}

export function detectVesselSearchField(value: string): VesselSearchField {
  const normalized = normalizeVesselSearchTerm(value)
  if (/^\d{9}$/.test(normalized)) return "mmsi"
  if (/^\d{7}$/.test(normalized)) return "imo"
  return "name"
}

export function normalizeVesselSearchQuery(query: VesselSearchQuery): VesselSearchQuery {
  const normalized = normalizeVesselSearchTerm(query.query)
  if (!normalized) throw new Error("vessel_search_query_required")
  return { query: normalized, field: query.field ?? detectVesselSearchField(normalized) }
}

export function vesselSearchCacheKey(query: VesselSearchQuery, providerId?: string): string {
  const normalized = normalizeVesselSearchQuery(query)
  return `${providerId ? `${providerId}:` : ""}${normalized.field}:${normalized.query}`
}

export function stableVesselMetadataId(source: string, record: Pick<VesselMetadata, "imo" | "mmsi" | "providerRecordId" | "name">): string {
  if (record.imo) return `imo:${record.imo}`
  if (record.providerRecordId) return `${source}:${record.providerRecordId}`
  if (record.mmsi) return `mmsi:${record.mmsi}`
  return `${source}:name:${normalizeVesselSearchTerm(record.name)}`
}
