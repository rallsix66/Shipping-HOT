import type { Database } from "db0"
import type { VesselMetadata, VesselWatchlistItem } from "@shared/vessel-search"
import { normalizeVesselSearchTerm } from "@shared/vessel-search"
import { VesselMetadataRepository } from "#/database/vessel-search"
import type { ShippingDataMode } from "#/database/runtime"

type Row = Record<string, unknown>

function rows<T>(value: unknown): T[] {
  return Array.isArray(value) ? value as T[] : []
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

interface WatchRow {
  id: string
  watchedAt: string
  aisEnabled: boolean
}

function trackingAvailable(metadata: Pick<VesselMetadata, "mmsi">): boolean {
  return Boolean(metadata.mmsi && /^\d{9}$/.test(metadata.mmsi))
}

function toWatchlistItem(metadata: VesselMetadata, row: WatchRow): VesselWatchlistItem {
  return {
    ...metadata,
    watchedAt: row.watchedAt,
    aisEnabled: row.aisEnabled,
    aisTrackingAvailable: trackingAvailable(metadata),
  }
}

export class VesselWatchlistService {
  private readonly metadata: VesselMetadataRepository

  constructor(private readonly db: Database, dataMode: ShippingDataMode = "real") {
    this.metadata = new VesselMetadataRepository(db, dataMode)
  }

  private async watchRows(): Promise<WatchRow[]> {
    const values = rows<Row>(await this.db.prepare(`
      SELECT vessel_id, watched_at, ais_enabled
      FROM vessel_watchlist
      ORDER BY watched_at DESC, vessel_id
    `).all())
    return values.map(row => ({
      id: String(row.vessel_id),
      watchedAt: String(row.watched_at),
      aisEnabled: Boolean(Number(row.ais_enabled)),
    }))
  }

  private async findMatching(metadata: VesselMetadata): Promise<VesselWatchlistItem | undefined> {
    const items = await this.list()
    return items.find(item => (
      item.id === metadata.id
      || Boolean(metadata.imo && item.imo === metadata.imo)
      || Boolean(
        metadata.providerRecordId
        && item.source === metadata.source
        && item.providerRecordId === metadata.providerRecordId,
      )
      || Boolean(metadata.mmsi && item.mmsi === metadata.mmsi)
      || (
        !metadata.imo
        && !metadata.mmsi
        && !metadata.providerRecordId
        && !item.imo
        && !item.mmsi
        && !item.providerRecordId
        && item.source === metadata.source
        && normalizeVesselSearchTerm(item.name) === normalizeVesselSearchTerm(metadata.name)
      )
    ))
  }

  async list(): Promise<VesselWatchlistItem[]> {
    const watchRows = await this.watchRows()
    const metadata = new Map((await this.metadata.getByIds(watchRows.map(row => row.id))).map(item => [item.id, item]))
    return watchRows.flatMap((row) => {
      const item = metadata.get(row.id)
      return item ? [toWatchlistItem(item, row)] : []
    })
  }

  async add(id: string): Promise<VesselWatchlistItem> {
    const metadata = (await this.metadata.getByIds([id]))[0]
    if (!metadata) throw new Error("vessel_search_result_not_found")
    const existing = await this.findMatching(metadata)
    const targetId = existing?.id ?? metadata.id
    const watchedAt = existing?.watchedAt ?? new Date().toISOString()
    const selectedMmsi = metadata.mmsi ?? existing?.mmsi
    const aisEnabled = trackingAvailable({ mmsi: selectedMmsi })

    await transaction(this.db, async () => {
      await this.db.prepare(`
        INSERT INTO vessel_watchlist (vessel_id, watched_at, ais_enabled)
        VALUES (?, ?, ?)
        ON CONFLICT(vessel_id) DO UPDATE SET ais_enabled = excluded.ais_enabled
      `).run(targetId, watchedAt, aisEnabled ? 1 : 0)
      if (existing && existing.id !== targetId) {
        await this.db.prepare("DELETE FROM vessel_watchlist WHERE vessel_id = ?").run(existing.id)
      }
    })

    const watched = (await this.list()).find(item => item.id === targetId)
    if (!watched) throw new Error("vessel_watchlist_write_failed")
    return watched
  }

  async remove(id: string): Promise<boolean> {
    const metadata = (await this.metadata.getByIds([id]))[0]
    const existing = metadata ? await this.findMatching(metadata) : (await this.list()).find(item => item.id === id)
    if (!existing) return false
    await this.db.prepare("DELETE FROM vessel_watchlist WHERE vessel_id = ?").run(existing.id)
    return true
  }
}

export function createVesselWatchlistService(db: Database, dataMode: ShippingDataMode): VesselWatchlistService {
  return new VesselWatchlistService(db, dataMode)
}
