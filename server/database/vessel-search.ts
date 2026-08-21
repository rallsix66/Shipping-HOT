import type { Database } from "db0"
import type { VesselMetadata, VesselSearchQuery, VesselSearchResult } from "@shared/vessel-search"
import { normalizeVesselSearchQuery, vesselSearchCacheKey } from "@shared/vessel-search"
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

export interface CachedVesselSearch {
  results: VesselSearchResult[]
  providerId: string
  fetchedAt: string
}

export class VesselMetadataRepository {
  constructor(private readonly db: Database, private readonly dataMode: ShippingDataMode = "real") {}

  async getCachedSearch(query: VesselSearchQuery, now = new Date()): Promise<CachedVesselSearch | undefined> {
    const normalized = normalizeVesselSearchQuery(query)
    const row = await this.db.prepare(`
      SELECT result_ids, provider_id, fetched_at
      FROM vessel_search_cache
      WHERE search_key = ? AND expires_at > ?${sourceWhere(this.dataMode)}
    `).get(vesselSearchCacheKey(normalized), now.toISOString()) as Row | undefined
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

  async saveSearch(query: VesselSearchQuery, results: VesselSearchResult[], providerId: string, sourceType: NonNullable<VesselMetadata["source_type"]>, now = new Date(), ttlMs = 24 * 60 * 60 * 1000): Promise<void> {
    if (this.dataMode === "real" && sourceType === "mock") throw new Error("mock_search_not_allowed_in_real_mode")
    const normalized = normalizeVesselSearchQuery(query)
    const fetchedAt = now.toISOString()
    const expiresAt = new Date(now.getTime() + ttlMs).toISOString()
    await transaction(this.db, async () => {
      for (const result of results) {
        if (this.dataMode === "real" && result.source_type === "mock") throw new Error("mock_search_not_allowed_in_real_mode")
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
          result.id,
          result.name,
          result.imo ?? null,
          result.mmsi ?? null,
          result.callsign ?? null,
          result.type ?? null,
          result.flag ?? null,
          result.source,
          fetchedAt,
          sourceType,
          result.providerRecordId ?? null,
          JSON.stringify({ ...result, fetchedAt, source_type: sourceType }),
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
        vesselSearchCacheKey(normalized),
        normalized.query,
        normalized.field,
        JSON.stringify(results.map(result => result.id)),
        providerId,
        sourceType,
        fetchedAt,
        expiresAt,
      )
    })
  }
}
