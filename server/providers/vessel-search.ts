import { env } from "node:process"
import { mockVessels } from "@shared/shipping-fixtures"
import type { SourceLineage } from "@shared/shipping"
import { type VesselIdentityObservation, type VesselMetadata, type VesselSearchQuery, type VesselSearchResult, normalizeVesselSearchQuery, normalizeVesselSearchTerm, stableVesselMetadataId } from "@shared/vessel-search"
import { FileSecretStore } from "#/secrets/file-secret-store"
import { ProviderError, providerErrorFromUnknown, providerHttpError } from "#/providers/contracts"
import type { SecretStore } from "#/providers/contracts"

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
      ? recordValue(value as Record<string, unknown>, "vessels", "results", "data", "items")
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
  const callsign = stringValue(recordValue(record, "call_sign", "callsign", "callSign", "Callsign"))
  const type = stringValue(recordValue(record, "vessel_type", "type", "ship_type", "shipType"))
  const flag = stringValue(recordValue(record, "country", "flag", "flag_code", "flagCode"))
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
      url.searchParams.set(`filter.${query.field ?? "name"}`, query.query)
      const response = await fetcher(url.toString(), {
        headers: { Accept: "application/json", Authorization: `Bearer ${options.apiKey}` },
      })
      if (!response.ok) {
        const body = await response.json().catch(() => undefined)
        throw providerHttpError("VesselAPI", response.status, `VesselAPI search failed (${response.status})`, body)
      }
      const fetchedAt = new Date().toISOString()
      return responseRecords(await response.json())
        .map(record => normalizeVesselApiRecord(record, fetchedAt))
        .filter((result): result is VesselSearchResult => result !== undefined)
        .map(result => ({ ...result, matchField: query.field }))
    },
  }
}

export interface GfwVesselSearchProviderOptions {
  apiToken: string
  endpoint?: string
  limit?: number
  fetcher?: VesselSearchFetcher
}

type GfwRecord = Record<string, unknown>

function objectRecords(value: unknown): GfwRecord[] {
  return Array.isArray(value)
    ? value.filter((item): item is GfwRecord => Boolean(item && typeof item === "object" && !Array.isArray(item)))
    : []
}

function firstString(value: unknown): string | undefined {
  const direct = stringValue(value)
  if (direct) return direct
  if (Array.isArray(value)) {
    for (const item of value) {
      const nested = firstString(item)
      if (nested) return nested
    }
  }
  if (value && typeof value === "object") {
    const record = value as GfwRecord
    for (const key of ["name", "label", "type", "shiptype", "shipType", "code"]) {
      const nested = firstString(record[key])
      if (nested) return nested
    }
  }
  return undefined
}

function identifierValue(value: unknown, length: number): string | undefined {
  const normalized = stringValue(value)
  return normalized && new RegExp(`^\\d{${length}}$`).test(normalized) ? normalized : undefined
}

function dateValue(value: unknown): string | undefined {
  return stringValue(value)
}

function identityMatch(left: GfwRecord, right: GfwRecord): boolean {
  const leftId = stringValue(recordValue(left, "id", "vesselId", "vessel_id"))
  const rightId = stringValue(recordValue(right, "id", "vesselId", "vessel_id"))
  if (leftId && rightId && leftId === rightId) return true
  const leftImo = identifierValue(recordValue(left, "imo", "IMO"), 7)
  const rightImo = identifierValue(recordValue(right, "imo", "IMO"), 7)
  if (leftImo && rightImo && leftImo === rightImo) return true
  const leftMmsi = identifierValue(recordValue(left, "ssvid", "mmsi", "MMSI"), 9)
  const rightMmsi = identifierValue(recordValue(right, "ssvid", "mmsi", "MMSI"), 9)
  return Boolean(leftMmsi && rightMmsi && leftMmsi === rightMmsi)
}

function findRelatedRecord(identity: GfwRecord, records: GfwRecord[]): GfwRecord | undefined {
  return records.find(candidate => identityMatch(identity, candidate))
}

function normalizeGfwObservation(
  identity: GfwRecord,
  combined: GfwRecord[],
  registry: GfwRecord[],
  allowIdentityProviderId = true,
): VesselIdentityObservation | undefined {
  const relatedCombined = findRelatedRecord(identity, combined) ?? (combined.length === 1 ? combined[0] : undefined)
  const relatedRegistry = findRelatedRecord(identity, registry)
  const providerRecordId = (allowIdentityProviderId ? stringValue(recordValue(identity, "id", "vesselId", "vessel_id")) : undefined)
    ?? stringValue(recordValue(relatedCombined ?? {}, "vesselId", "id"))
  const name = stringValue(recordValue(identity, "shipname", "ship_name", "name"))
    ?? stringValue(recordValue(relatedRegistry ?? {}, "shipname", "ship_name", "name"))
  const imo = identifierValue(recordValue(identity, "imo", "IMO"), 7)
    ?? identifierValue(recordValue(relatedRegistry ?? {}, "imo", "IMO"), 7)
  const mmsi = identifierValue(recordValue(identity, "ssvid", "mmsi", "MMSI"), 9)
    ?? identifierValue(recordValue(relatedRegistry ?? {}, "ssvid", "mmsi", "MMSI"), 9)
  const callsign = stringValue(recordValue(identity, "callsign", "callSign", "call_sign"))
    ?? stringValue(recordValue(relatedRegistry ?? {}, "callsign", "callSign", "call_sign"))
  const flag = stringValue(recordValue(identity, "flag", "flag_code", "flagCode"))
    ?? stringValue(recordValue(relatedRegistry ?? {}, "flag", "flag_code", "flagCode"))
  const type = firstString(recordValue(identity, "shiptype", "ship_type", "shipType", "vessel_type"))
    ?? firstString(recordValue(relatedCombined ?? {}, "shiptypes", "ship_types", "shiptype", "shipType"))
    ?? firstString(recordValue(relatedRegistry ?? {}, "shiptype", "ship_type", "shipType", "vessel_type"))
  if (!name && !providerRecordId && !imo && !mmsi) return undefined
  return {
    providerRecordId,
    name: name ?? "",
    imo,
    mmsi,
    callsign,
    flag,
    type,
    transmissionDateFrom: dateValue(recordValue(identity, "transmissionDateFrom", "transmission_date_from"))
      ?? dateValue(recordValue(relatedRegistry ?? {}, "transmissionDateFrom", "transmission_date_from")),
    transmissionDateTo: dateValue(recordValue(identity, "transmissionDateTo", "transmission_date_to"))
      ?? dateValue(recordValue(relatedRegistry ?? {}, "transmissionDateTo", "transmission_date_to")),
    source: "gfw",
  }
}

function gfwEntryObservations(entry: GfwRecord): VesselIdentityObservation[] {
  const combined = objectRecords(entry.combinedSourcesInfo)
  const registry = objectRecords(entry.registryInfo)
  const selfReported = objectRecords(entry.selfReportedInfo)
  const identities = selfReported.length > 0 ? selfReported : registry
  const observations = identities
    .map(identity => normalizeGfwObservation(identity, combined, registry, selfReported.length > 0))
    .filter((observation): observation is VesselIdentityObservation => observation !== undefined)
  if (observations.length > 0) return observations
  return combined
    .map(identity => normalizeGfwObservation(identity, combined, registry))
    .filter((observation): observation is VesselIdentityObservation => observation !== undefined)
}

function observationKey(observation: VesselIdentityObservation): string {
  return JSON.stringify([
    observation.providerRecordId,
    observation.name,
    observation.imo,
    observation.mmsi,
    observation.callsign,
    observation.flag,
    observation.type,
    observation.transmissionDateFrom,
    observation.transmissionDateTo,
  ])
}

function parsedDateRank(value: string | undefined, openEndedRank: number): number {
  if (value === undefined) return openEndedRank
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) ? timestamp : Number.NEGATIVE_INFINITY
}

function nameQuality(name: string): number {
  return /\d/.test(name) ? 0 : 1
}

function compareLatestIdentity(left: VesselIdentityObservation, right: VesselIdentityObservation): number {
  const compareDescending = (leftRank: number, rightRank: number): number => {
    if (leftRank === rightRank) return 0
    if (leftRank === Number.POSITIVE_INFINITY) return -1
    if (rightRank === Number.POSITIVE_INFINITY) return 1
    if (leftRank === Number.NEGATIVE_INFINITY) return 1
    if (rightRank === Number.NEGATIVE_INFINITY) return -1
    return rightRank - leftRank
  }
  const endDifference = compareDescending(
    parsedDateRank(left.transmissionDateTo, Number.POSITIVE_INFINITY),
    parsedDateRank(right.transmissionDateTo, Number.POSITIVE_INFINITY),
  )
  if (endDifference !== 0) return endDifference
  const fromDifference = compareDescending(
    parsedDateRank(left.transmissionDateFrom, Number.NEGATIVE_INFINITY),
    parsedDateRank(right.transmissionDateFrom, Number.NEGATIVE_INFINITY),
  )
  if (fromDifference !== 0) return fromDifference
  const qualityDifference = nameQuality(right.name) - nameQuality(left.name)
  if (qualityDifference !== 0) return qualityDifference
  return JSON.stringify(right).localeCompare(JSON.stringify(left))
}

function canonicalGroupKey(observation: VesselIdentityObservation): string {
  if (observation.imo) return `imo:${observation.imo}`
  if (observation.mmsi) return `mmsi:${observation.mmsi}`
  if (observation.providerRecordId) return `gfw:${observation.providerRecordId}`
  return `gfw:unidentified:${observationKey(observation)}`
}

function observationMatchesQuery(observation: VesselIdentityObservation, query: VesselSearchQuery): boolean {
  const value = query.field === "imo"
    ? observation.imo
    : query.field === "mmsi"
      ? observation.mmsi
      : query.field === "callsign"
        ? observation.callsign
        : normalizeVesselSearchTerm(observation.name)
  return value === query.query
}

function candidateRank(result: VesselSearchResult, query: VesselSearchQuery): number {
  const history = result.identityHistory ?? []
  const observations = [{
    providerRecordId: result.providerRecordId,
    name: result.name,
    imo: result.imo,
    mmsi: result.mmsi,
    callsign: result.callsign,
    flag: result.flag,
    type: result.type,
    source: result.source,
  }, ...history]
  if (observations.some(observation => observationMatchesQuery(observation, query))) {
    if (query.field === "imo") return 500
    if (query.field === "mmsi") return 490
    if (query.field === "callsign") return 480
    return 470
  }
  return 0
}

function canonicalizeGfwEntries(entries: GfwRecord[], query: VesselSearchQuery, fetchedAt: string): VesselSearchResult[] {
  const groups = new Map<string, VesselIdentityObservation[]>()
  for (const entry of entries) {
    for (const observation of gfwEntryObservations(entry)) {
      const key = canonicalGroupKey(observation)
      groups.set(key, [...(groups.get(key) ?? []), observation])
    }
  }

  return [...groups.entries()]
    .map(([id, values]) => {
      const history = [...new Map(values.map(value => [observationKey(value), value])).values()].sort(compareLatestIdentity)
      const latest = history[0]
      return {
        id,
        name: latest.name,
        imo: latest.imo,
        mmsi: latest.mmsi,
        callsign: latest.callsign,
        type: latest.type,
        flag: latest.flag,
        source: "gfw",
        fetchedAt,
        source_type: "real" as SourceLineage,
        providerRecordId: latest.providerRecordId,
        identityHistory: history,
        matchField: query.field,
      }
    })
    .sort((left, right) => {
      const rankDifference = candidateRank(right, query) - candidateRank(left, query)
      if (rankDifference !== 0) return rankDifference
      const latestDifference = compareLatestIdentity(left.identityHistory?.[0] ?? { name: left.name, source: left.source }, right.identityHistory?.[0] ?? { name: right.name, source: right.source })
      if (latestDifference !== 0) return latestDifference
      return left.id.localeCompare(right.id)
    })
}

export function normalizeGfwSearchResponse(value: unknown, query: VesselSearchQuery, fetchedAt = new Date().toISOString()): VesselSearchResult[] {
  if (!value || typeof value !== "object" || Array.isArray(value) || !Array.isArray((value as { entries?: unknown }).entries)) {
    throw new ProviderError("provider_contract_changed", "GFW vessel search response schema is invalid", 200)
  }
  const entries = (value as { entries: unknown[] }).entries
  if (!entries.every(entry => Boolean(entry && typeof entry === "object" && !Array.isArray(entry)))) {
    throw new ProviderError("provider_contract_changed", "GFW vessel search response schema is invalid", 200)
  }
  return canonicalizeGfwEntries(entries as GfwRecord[], normalizeVesselSearchQuery(query), fetchedAt)
}

export function createGfwVesselSearchProvider(options: GfwVesselSearchProviderOptions): VesselSearchProvider {
  const endpoint = options.endpoint ?? "https://gateway.api.globalfishingwatch.org/v3/vessels/search"
  const limit = options.limit ?? 20
  const fetcher = options.fetcher ?? searchFetcher()
  return {
    providerId: "gfw",
    async search(input) {
      const query = normalizeVesselSearchQuery(input)
      const url = new URL(endpoint)
      url.searchParams.set("query", query.query)
      url.searchParams.set("datasets[0]", "public-global-vessel-identity:latest")
      url.searchParams.set("limit", String(limit))
      let response: VesselSearchProviderResponse
      try {
        response = await fetcher(url.toString(), {
          headers: { Accept: "application/json", Authorization: `Bearer ${options.apiToken}` },
        })
      } catch (error) {
        throw providerErrorFromUnknown("GFW", error)
      }
      if (!response.ok) {
        const body = await response.json().catch(() => undefined)
        throw providerHttpError("GFW", response.status, `GFW vessel search failed (${response.status})`, body)
      }
      let body: unknown
      try {
        body = await response.json()
      } catch {
        throw new ProviderError("provider_contract_changed", "GFW vessel search response is not valid JSON", response.status)
      }
      return normalizeGfwSearchResponse(body, query).map(result => ({ ...result, matchField: query.field }))
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

export interface VesselSearchEnvironment {
  [key: string]: string | undefined
  SHIPPING_DATA_MODE?: string
  SHIPPING_VESSEL_SEARCH_PROVIDER?: string
  VESSELAPI_API_KEY?: string
  GFW_API_TOKEN?: string
}

export async function configureVesselSearchProvider(
  environment: VesselSearchEnvironment = { ...env },
  secretStore: SecretStore = new FileSecretStore({ environment }),
): Promise<VesselSearchProvider> {
  const dataMode = environment.SHIPPING_DATA_MODE === "real" ? "real" : "mock"
  const configuredProvider = environment.SHIPPING_VESSEL_SEARCH_PROVIDER?.trim().toLowerCase()
  if (dataMode === "mock") return MockVesselSearchProvider
  const [gfwToken, apiKey] = await Promise.all([secretStore.get("gfw"), secretStore.get("vesselapi")])
  if (configuredProvider === "gfw") {
    return gfwToken
      ? createGfwVesselSearchProvider({ apiToken: gfwToken })
      : createUnavailableVesselSearchProvider("GFW_API_TOKEN missing")
  }
  if (configuredProvider === "vesselapi") {
    return apiKey
      ? createVesselApiSearchProvider({ apiKey })
      : createUnavailableVesselSearchProvider("VESSELAPI_API_KEY missing")
  }
  if (configuredProvider) return createUnavailableVesselSearchProvider("Unknown real Vessel Search provider")
  if (gfwToken && !apiKey) return createGfwVesselSearchProvider({ apiToken: gfwToken })
  if (apiKey && !gfwToken) return createVesselApiSearchProvider({ apiKey })
  if (gfwToken && apiKey) return createUnavailableVesselSearchProvider("Multiple real Vessel Search providers configured; set SHIPPING_VESSEL_SEARCH_PROVIDER")
  return createUnavailableVesselSearchProvider("Real Vessel Search provider not configured")
}
