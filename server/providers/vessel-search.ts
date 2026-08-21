import { env } from "node:process"
import { mockVessels } from "@shared/shipping-fixtures"
import type { SourceLineage } from "@shared/shipping"
import { type VesselMetadata, type VesselSearchQuery, type VesselSearchResult, normalizeVesselSearchQuery, stableVesselMetadataId } from "@shared/vessel-search"

export interface VesselSearchProvider {
  readonly providerId: string
  search: (query: VesselSearchQuery) => Promise<VesselSearchResult[]>
}

export interface VesselSearchProviderResponse {
  ok: boolean
  status: number
  json: () => Promise<unknown>
  headers?: { get: (name: string) => string | null }
}

export interface VesselSearchFetcher {
  (url: string, init?: { headers?: Record<string, string> }): Promise<VesselSearchProviderResponse>
}

export interface VesselApiSearchProviderOptions {
  apiKey: string
  endpoint?: string
  fetcher?: VesselSearchFetcher
}

function searchFetcher(): VesselSearchFetcher {
  const fetchImplementation = (globalThis as typeof globalThis & { fetch?: VesselSearchFetcher }).fetch
  if (!fetchImplementation) throw new Error("Fetch runtime is unavailable")
  return fetchImplementation
}

function stringValue(value: unknown): string | undefined {
  if (typeof value !== "string" && typeof value !== "number") return undefined
  const normalized = String(value).trim()
  return normalized || undefined
}

function recordValue(record: Record<string, unknown>, ...keys: string[]): unknown {
  return keys.map(key => record[key]).find(value => value !== undefined && value !== null)
}

function responseRecords(value: unknown): Array<Record<string, unknown>> {
  const candidate = Array.isArray(value)
    ? value
    : value && typeof value === "object"
      ? (value as { results?: unknown[], data?: unknown[], items?: unknown[] }).results
      ?? (value as { results?: unknown[], data?: unknown[], items?: unknown[] }).data
      ?? (value as { results?: unknown[], data?: unknown[], items?: unknown[] }).items
      : undefined
  return Array.isArray(candidate)
    ? candidate.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object"))
    : []
}

function normalizeVesselApiRecord(record: Record<string, unknown>, fetchedAt: string): VesselSearchResult | undefined {
  const name = stringValue(recordValue(record, "name", "vessel_name", "shipName", "ship_name"))
  if (!name) return undefined
  const imo = stringValue(recordValue(record, "imo", "IMO"))
  const mmsi = stringValue(recordValue(record, "mmsi", "MMSI"))
  const callsign = stringValue(recordValue(record, "callsign", "callSign", "call_sign", "Callsign"))
  const type = stringValue(recordValue(record, "type", "ship_type", "shipType", "vessel_type"))
  const flag = stringValue(recordValue(record, "flag", "flag_code", "flagCode"))
  const providerRecordId = stringValue(recordValue(record, "id", "vessel_id", "vesselId", "uuid"))
  const source = "vesselapi"
  const metadata: VesselMetadata = {
    id: stableVesselMetadataId(source, { imo, mmsi, providerRecordId, name }),
    name,
    imo,
    mmsi,
    callsign,
    type,
    flag,
    source,
    fetchedAt,
    source_type: "real",
    providerRecordId,
  }
  return metadata
}

export function createVesselApiSearchProvider(options: VesselApiSearchProviderOptions): VesselSearchProvider {
  const endpoint = options.endpoint ?? "https://api.vesselapi.com/v1/search/vessels"
  const fetcher = options.fetcher ?? searchFetcher()
  return {
    providerId: "vesselapi",
    async search(input) {
      const query = normalizeVesselSearchQuery(input)
      const url = new URL(endpoint)
      url.searchParams.set(query.field ?? "name", query.query)
      const response = await fetcher(url.toString(), {
        headers: { Accept: "application/json", Authorization: `Bearer ${options.apiKey}` },
      })
      if (!response.ok) throw new Error(`VesselAPI search failed (${response.status})`)
      const fetchedAt = new Date().toISOString()
      return responseRecords(await response.json())
        .map(record => normalizeVesselApiRecord(record, fetchedAt))
        .filter((result): result is VesselSearchResult => result !== undefined)
        .map(result => ({ ...result, matchField: query.field }))
    },
  }
}

export const MockVesselSearchProvider: VesselSearchProvider = {
  providerId: "mock-vessel-search",
  async search(input) {
    const query = normalizeVesselSearchQuery(input)
    const fetchedAt = new Date().toISOString()
    const normalizedQuery = query.query
    return structuredClone(mockVessels)
      .filter((vessel) => {
        const value = query.field === "imo" ? vessel.imo : query.field === "mmsi" ? vessel.mmsi : query.field === "callsign" ? vessel.callSign : vessel.name
        return value?.toLowerCase().includes(normalizedQuery)
      })
      .map(vessel => ({
        id: `mock:${vessel.id}`,
        name: vessel.name,
        imo: vessel.imo,
        mmsi: vessel.mmsi,
        callsign: vessel.callSign,
        type: vessel.shipType,
        source: "mock-vessel-search",
        fetchedAt,
        source_type: "mock" as SourceLineage,
        providerRecordId: vessel.id,
        matchField: query.field,
      }))
  },
}

export function createUnavailableVesselSearchProvider(error: string): VesselSearchProvider {
  return {
    providerId: "unavailable",
    async search() {
      throw new Error(error)
    },
  }
}

interface VesselSearchEnvironment {
  [key: string]: string | undefined
  SHIPPING_DATA_MODE?: string
  SHIPPING_VESSEL_SEARCH_PROVIDER?: string
  VESSELAPI_API_KEY?: string
}

export function configureVesselSearchProvider(environment: VesselSearchEnvironment = { ...env }): VesselSearchProvider {
  const dataMode = environment.SHIPPING_DATA_MODE === "real" ? "real" : "mock"
  if (environment.SHIPPING_VESSEL_SEARCH_PROVIDER === "vesselapi" || (dataMode === "real" && environment.VESSELAPI_API_KEY)) {
    return environment.VESSELAPI_API_KEY
      ? createVesselApiSearchProvider({ apiKey: environment.VESSELAPI_API_KEY })
      : createUnavailableVesselSearchProvider("VESSELAPI_API_KEY missing")
  }
  if (dataMode === "mock") return MockVesselSearchProvider
  return createUnavailableVesselSearchProvider("Real Vessel Search provider not configured")
}
