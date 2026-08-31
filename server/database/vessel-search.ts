import type { Database } from "db0"
import type { VesselIdentityObservation, VesselMetadata, VesselSearchQuery, VesselSearchResult } from "@shared/vessel-search"
import { normalizeVesselSearchQuery, normalizeVesselSearchTerm, stableVesselMetadataId, vesselSearchCacheKey } from "@shared/vessel-search"
import type { ShippingDataMode } from "#/database/runtime"

type Row = Record<string, unknown>

function rows<T>(value: unknown): T[] {
  if (Array.isArray(value)) return value as T[]
  if (value && typeof value === "object" && Array.isArray((value as { results?: unknown[] }).results)) return (value as { results: T[] }).results
  return []
}

function parse<T>(value: unknown): T {
  return JSON.parse(String(value)) as T
}

async function transaction<T>(db: Database, work: () => Promise<T>): Promise<T> {
  await db.prepare("BEGIN").run()
  try {
    const result = await work()
    await db.prepare("COMMIT").run()
    return result
  } catch (error) {
    try {
      await db.prepare("ROLLBACK").run()
    } catch {
      // Preserve the original persistence error.
    }
    throw error
  }
}

function sourceWhere(dataMode: ShippingDataMode): string {
  return dataMode === "real" ? " AND source_type IN ('real', 'imported', 'derived')" : ""
}

function mapMetadata(row: Row): VesselMetadata {
  const data = row.data ? parse<Partial<VesselMetadata>>(row.data) : {}
  return {
    ...data,
    id: String(row.id),
    name: String(row.name),
    imo: row.imo ? String(row.imo) : undefined,
    mmsi: row.mmsi ? String(row.mmsi) : undefined,
    callsign: row.callsign ? String(row.callsign) : undefined,
    type: row.type ? String(row.type) : undefined,
    flag: row.flag ? String(row.flag) : undefined,
    source: String(row.source),
    fetchedAt: String(row.fetched_at),
    source_type: String(row.source_type) as VesselMetadata["source_type"],
    providerRecordId: row.provider_record_id ? String(row.provider_record_id) : undefined,
  }
}

function parseIds(value: unknown): string[] {
  try {
    const parsed = JSON.parse(String(value))
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : []
  } catch {
    return []
  }
}

function identityObservationKey(observation: VesselIdentityObservation): string {
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
    observation.source,
  ])
}

function mergeIdentityHistory(existing: VesselMetadata | undefined, result: VesselSearchResult): VesselIdentityObservation[] | undefined {
  const history = [...(existing?.identityHistory ?? []), ...(result.identityHistory ?? [])]
  if (!history.length) return undefined
  return [...new Map(history.map(observation => [identityObservationKey(observation), observation])).values()]
}

export class VesselIdentityConflictError extends Error {
  readonly code = "identity_conflict"

  constructor() {
    super("identity_conflict")
    this.name = "VesselIdentityConflictError"
  }
}

export function isVesselIdentityConflict(error: unknown): boolean {
  return error instanceof VesselIdentityConflictError
    || Boolean(error && typeof error === "object" && (error as { code?: unknown }).code === "identity_conflict")
}

export interface VesselIdentityResolution {
  id: string
  existing?: VesselMetadata
}

export interface CachedVesselSearch {
  results: VesselSearchResult[]
  providerId: string
  fetchedAt: string
}

export class VesselMetadataRepository {
  constructor(private readonly db: Database, private readonly dataMode: ShippingDataMode = "real") {}

  private async findMetadataRows(where: string, ...params: (string | number | null)[]): Promise<VesselMetadata[]> {
    const values = rows<Row>(await this.db.prepare(`
      SELECT id, name, imo, mmsi, callsign, type, flag, source, fetched_at, source_type, provider_record_id, data
      FROM vessel_metadata
      WHERE ${where}${sourceWhere(this.dataMode)}
    `).all(...params))
    return values.map(mapMetadata)
  }

  private async findProvisionalNameMatches(result: VesselSearchResult): Promise<VesselMetadata[]> {
    const normalizedName = normalizeVesselSearchTerm(result.name)
    const candidates = await this.findMetadataRows("source = ?", result.source)
    return candidates.filter(candidate => (
      !candidate.imo
      && !candidate.mmsi
      && !candidate.providerRecordId
      && normalizeVesselSearchTerm(candidate.name) === normalizedName
    ))
  }

  async resolveCanonicalIdentity(result: VesselSearchResult): Promise<VesselIdentityResolution> {
    const strongCandidates = new Map<string, VesselMetadata>()
    const addCandidates = (candidates: VesselMetadata[]) => {
      for (const candidate of candidates) strongCandidates.set(candidate.id, candidate)
    }

    if (result.imo) addCandidates(await this.findMetadataRows("imo = ?", result.imo))
    if (result.providerRecordId) {
      addCandidates(await this.findMetadataRows("source = ? AND provider_record_id = ?", result.source, result.providerRecordId))
    }
    if (result.mmsi) addCandidates(await this.findMetadataRows("mmsi = ?", result.mmsi))

    if (strongCandidates.size > 1) throw new VesselIdentityConflictError()
    const existing = [...strongCandidates.values()][0]
    if (existing) {
      if (existing.imo && result.imo && existing.imo !== result.imo) throw new VesselIdentityConflictError()
      return { id: existing.id, existing }
    }

    const provisionalMatches = await this.findProvisionalNameMatches(result)
    if (provisionalMatches.length > 1) throw new VesselIdentityConflictError()
    if (provisionalMatches[0]) return { id: provisionalMatches[0].id, existing: provisionalMatches[0] }

    if (result.source === "gfw" && result.imo) return { id: `imo:${result.imo}` }
    if (result.source === "gfw" && result.mmsi) return { id: `mmsi:${result.mmsi}` }
    return { id: stableVesselMetadataId(result.source, result) }
  }

  async getCachedSearch(query: VesselSearchQuery, providerIdOrNow?: string | Date, maybeNow?: Date): Promise<CachedVesselSearch | undefined> {
    const normalized = normalizeVesselSearchQuery(query)
    const providerId = typeof providerIdOrNow === "string" ? providerIdOrNow : undefined
    const now = providerIdOrNow instanceof Date ? providerIdOrNow : maybeNow ?? new Date()
    const searchKey = vesselSearchCacheKey(normalized, providerId)
    const row = await this.db.prepare(`
      SELECT result_ids, provider_id, fetched_at
      FROM vessel_search_cache
      WHERE search_key = ? AND expires_at > ?${sourceWhere(this.dataMode)}
    `).get(searchKey, now.toISOString()) as Row | undefined
    if (!row) return undefined
    const ids = parseIds(row.result_ids)
    const results = await this.listByIds(ids)
    return {
      results: results.map(item => ({ ...item, matchField: normalized.field })),
      providerId: String(row.provider_id),
      fetchedAt: String(row.fetched_at),
    }
  }

  private async listByIds(ids: string[]): Promise<VesselMetadata[]> {
    if (!ids.length) return []
    const placeholders = ids.map(() => "?").join(",")
    const values = rows<Row>(await this.db.prepare(`
      SELECT id, name, imo, mmsi, callsign, type, flag, source, fetched_at, source_type, provider_record_id, data
      FROM vessel_metadata
      WHERE id IN (${placeholders})${sourceWhere(this.dataMode)}
    `).all(...ids))
    const mapped = new Map(values.map(row => [String(row.id), mapMetadata(row)]))
    return ids.flatMap(id => mapped.get(id) ? [mapped.get(id)!] : [])
  }

  async getByIds(ids: string[]): Promise<VesselMetadata[]> {
    return this.listByIds(ids)
  }

  async saveSearch(query: VesselSearchQuery, results: VesselSearchResult[], providerId: string, sourceType: NonNullable<VesselMetadata["source_type"]>, now = new Date(), ttlMs = 24 * 60 * 60 * 1000): Promise<VesselSearchResult[]> {
    if (this.dataMode === "real" && sourceType === "mock") throw new Error("mock_search_not_allowed_in_real_mode")
    const normalized = normalizeVesselSearchQuery(query)
    const fetchedAt = now.toISOString()
    const expiresAt = new Date(now.getTime() + ttlMs).toISOString()
    const canonicalResults: VesselSearchResult[] = []
    await transaction(this.db, async () => {
      for (const result of results) {
        if (this.dataMode === "real" && result.source_type === "mock") throw new Error("mock_search_not_allowed_in_real_mode")
        const identity = await this.resolveCanonicalIdentity(result)
        const existing = identity.existing
        const canonicalResult: VesselSearchResult = {
          ...(existing ?? {}),
          ...result,
          id: identity.id,
          name: result.name || existing?.name || "",
          imo: result.imo ?? existing?.imo,
          mmsi: result.mmsi ?? existing?.mmsi,
          callsign: result.callsign ?? existing?.callsign,
          type: result.type ?? existing?.type,
          flag: result.flag ?? existing?.flag,
          source: result.source || existing?.source || "",
          fetchedAt,
          source_type: sourceType,
          providerRecordId: result.providerRecordId ?? existing?.providerRecordId,
          identityHistory: mergeIdentityHistory(existing, result),
        }
        canonicalResults.push(canonicalResult)
        await this.db.prepare(`
          INSERT INTO vessel_metadata (
            id, name, imo, mmsi, callsign, type, flag, source, fetched_at,
            source_type, provider_record_id, data
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            name = excluded.name,
            imo = excluded.imo,
            mmsi = excluded.mmsi,
            callsign = excluded.callsign,
            type = excluded.type,
            flag = excluded.flag,
            source = excluded.source,
            fetched_at = excluded.fetched_at,
            source_type = excluded.source_type,
            provider_record_id = excluded.provider_record_id,
            data = excluded.data
        `).run(
          canonicalResult.id,
          canonicalResult.name,
          canonicalResult.imo ?? null,
          canonicalResult.mmsi ?? null,
          canonicalResult.callsign ?? null,
          canonicalResult.type ?? null,
          canonicalResult.flag ?? null,
          canonicalResult.source,
          fetchedAt,
          sourceType,
          canonicalResult.providerRecordId ?? null,
          JSON.stringify(canonicalResult),
        )
      }
      await this.db.prepare(`
        INSERT INTO vessel_search_cache (
          search_key, query, field, result_ids, provider_id, source_type, fetched_at, expires_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(search_key) DO UPDATE SET
          query = excluded.query,
          field = excluded.field,
          result_ids = excluded.result_ids,
          provider_id = excluded.provider_id,
          source_type = excluded.source_type,
          fetched_at = excluded.fetched_at,
          expires_at = excluded.expires_at
      `).run(
        vesselSearchCacheKey(normalized, providerId),
        normalized.query,
        normalized.field,
        JSON.stringify(canonicalResults.map(result => result.id)),
        providerId,
        sourceType,
        fetchedAt,
        expiresAt,
      )
    })
    return canonicalResults
  }
}
