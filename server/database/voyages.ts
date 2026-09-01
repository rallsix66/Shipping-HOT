import type { Database } from "db0"
import type { VoyageEtaHistoryRecord, VoyageRecord, VoyageStatus } from "@shared/voyage"
import { calculateDelayMinutes } from "@shared/shipping-rules"
import type { ShippingDataMode } from "#/database/runtime"

export interface VoyageWriteResult {
  written: number
  historyWritten: number
  rejectedVesselIds: number
  staleSkipped: number
  acceptedIds: string[]
}

export interface SaveVoyagesOptions {
  requestedVesselIds?: readonly string[]
}

interface VoyageRow {
  id: string
  vessel_id: string
  imo?: string | null
  mmsi?: string | null
  origin_port_id?: string | null
  destination_port_id?: string | null
  voyage_number?: string | null
  status?: string | null
  eta?: string | null
  etd?: string | null
  source?: string | null
  source_type: string
  last_updated_at?: string | null
  created_at?: string | null
}

interface ExistingVoyageRow {
  imo?: string | null
  mmsi?: string | null
  origin_port_id?: string | null
  destination_port_id?: string | null
  last_updated_at?: string | null
  baseline_etd?: string | null
  baseline_eta?: string | null
  data?: string | null
}

interface HistoryRow {
  id: string
  voyage_id: string
  vessel_id: string
  eta?: string | null
  etd?: string | null
  source: string
  source_type: string
  observed_at: string
  created_at: string
}

const voyageStatuses = new Set<VoyageStatus>(["planned", "departed", "in_transit", "arrived", "cancelled", "unknown"])
const lineageValues = new Set(["real", "mock", "imported", "derived"])

function rows<T>(value: unknown): T[] {
  return Array.isArray(value) ? value as T[] : []
}

function storedFields(value: string | null | undefined): Record<string, unknown> {
  if (!value) return {}
  try {
    const parsed = JSON.parse(value) as unknown
    return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : {}
  } catch {
    return {}
  }
}

function validateRecord(record: VoyageRecord): void {
  if (!record.id || !record.vesselId) throw new Error("voyage_identity_required")
  if (!voyageStatuses.has(record.status)) throw new Error("voyage_status_invalid")
  if (!lineageValues.has(record.sourceType)) throw new Error("voyage_source_type_invalid")
  if (!Number.isFinite(Date.parse(record.lastUpdatedAt))) throw new Error("voyage_timestamp_invalid")
}

function toVoyage(row: VoyageRow): VoyageRecord | undefined {
  if (!row.status || !row.source || !row.last_updated_at) return undefined
  if (!voyageStatuses.has(row.status as VoyageStatus) || !lineageValues.has(row.source_type)) return undefined
  return {
    id: row.id,
    vesselId: row.vessel_id,
    imo: row.imo ?? undefined,
    mmsi: row.mmsi ?? undefined,
    originPortId: row.origin_port_id ?? undefined,
    destinationPortId: row.destination_port_id ?? undefined,
    voyageNumber: row.voyage_number ?? undefined,
    status: row.status as VoyageStatus,
    eta: row.eta ?? undefined,
    etd: row.etd ?? undefined,
    source: row.source,
    sourceType: row.source_type as VoyageRecord["sourceType"],
    timestamp: row.last_updated_at,
    lastUpdatedAt: row.last_updated_at,
  }
}

function toHistory(row: HistoryRow): VoyageEtaHistoryRecord {
  return {
    id: row.id,
    voyageId: row.voyage_id,
    vesselId: row.vessel_id,
    eta: row.eta ?? undefined,
    etd: row.etd ?? undefined,
    source: row.source,
    sourceType: row.source_type as VoyageEtaHistoryRecord["sourceType"],
    observedAt: row.observed_at,
    createdAt: row.created_at,
  }
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

export class VoyageRepository {
  constructor(private readonly db: Database, private readonly dataMode: ShippingDataMode = "real") {}

  private sourceWhere(alias = "") {
    const prefix = alias ? `${alias}.` : ""
    return this.dataMode === "real" ? ` AND ${prefix}source_type IN ('real', 'imported', 'derived')` : ""
  }

  private async assertPortIdentity(unlocode: string): Promise<void> {
    const row = await this.db.prepare(`
      SELECT unlocode FROM port_directory
      WHERE unlocode = ? AND is_active = 1${this.dataMode === "real" ? " AND source <> 'mock'" : ""}
    `).get(unlocode) as { unlocode?: string } | undefined
    if (!row) throw new Error("voyage_port_identity_not_found")
  }

  async saveVoyages(records: readonly VoyageRecord[], createdAt = new Date().toISOString(), options: SaveVoyagesOptions = {}): Promise<VoyageWriteResult> {
    let written = 0
    let historyWritten = 0
    let rejectedVesselIds = 0
    let staleSkipped = 0
    const acceptedIds: string[] = []
    const requestedVesselIds = options.requestedVesselIds ? new Set(options.requestedVesselIds) : undefined
    await transaction(this.db, async () => {
      for (const record of records) {
        validateRecord(record)
        if (requestedVesselIds && !requestedVesselIds.has(record.vesselId)) {
          rejectedVesselIds++
          continue
        }
        if (this.dataMode === "real" && record.sourceType === "mock") throw new Error("mock_voyage_not_allowed_in_real_mode")
        const existing = await this.db.prepare("SELECT imo, mmsi, origin_port_id, destination_port_id, last_updated_at, baseline_etd, baseline_eta, data FROM voyages WHERE id = ?").get(record.id) as ExistingVoyageRow | undefined
        if (existing?.last_updated_at && Date.parse(record.lastUpdatedAt) < Date.parse(existing.last_updated_at)) {
          staleSkipped++
          continue
        }
        acceptedIds.push(record.id)
        if (record.originPortId) await this.assertPortIdentity(record.originPortId)
        if (record.destinationPortId) await this.assertPortIdentity(record.destinationPortId)
        const previous = storedFields(existing?.data)
        const baselineEta = existing?.baseline_eta ?? record.eta
        const baselineEtd = existing?.baseline_etd ?? record.etd
        const delayMinutes = calculateDelayMinutes(baselineEta ?? undefined, record.eta)
        const baselineEtaSource = existing?.baseline_eta !== undefined && existing?.baseline_eta !== null
          ? typeof previous.baselineEtaSource === "string" ? previous.baselineEtaSource : record.source
          : record.source
        const baselineEtdSource = existing?.baseline_etd !== undefined && existing?.baseline_etd !== null
          ? typeof previous.baselineEtdSource === "string" ? previous.baselineEtdSource : record.source
          : record.source
        const persistedRecord: VoyageRecord = {
          ...record,
          imo: record.imo ?? existing?.imo ?? undefined,
          mmsi: record.mmsi ?? existing?.mmsi ?? undefined,
          originPortId: record.originPortId ?? existing?.origin_port_id ?? undefined,
          destinationPortId: record.destinationPortId ?? existing?.destination_port_id ?? undefined,
        }
        const data = JSON.stringify({
          ...persistedRecord,
          source_type: persistedRecord.sourceType,
          updatedAt: persistedRecord.lastUpdatedAt,
          latestEta: persistedRecord.eta,
          latestEtd: persistedRecord.etd,
          latestEtaSource: persistedRecord.source,
          latestEtdSource: persistedRecord.source,
          latestEtaObservedAt: persistedRecord.lastUpdatedAt,
          baselineEta,
          baselineEtd,
          baselineEtaSource,
          baselineEtdSource,
          delayMinutes,
          stale: false,
          sourceStatus: "healthy",
        })
        const result = await this.db.prepare(`
          INSERT INTO voyages (
            id, data, source_type, vessel_id, baseline_etd, baseline_eta, latest_etd, latest_eta, delay_minutes,
            imo, mmsi, origin_port_id, destination_port_id, voyage_number, status, eta, etd, source, last_updated_at, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            data = excluded.data,
            source_type = excluded.source_type,
            vessel_id = excluded.vessel_id,
            baseline_etd = COALESCE(voyages.baseline_etd, excluded.baseline_etd),
            baseline_eta = COALESCE(voyages.baseline_eta, excluded.baseline_eta),
            latest_etd = excluded.latest_etd,
            latest_eta = excluded.latest_eta,
            delay_minutes = excluded.delay_minutes,
            imo = COALESCE(excluded.imo, voyages.imo),
            mmsi = COALESCE(excluded.mmsi, voyages.mmsi),
            origin_port_id = COALESCE(excluded.origin_port_id, voyages.origin_port_id),
            destination_port_id = COALESCE(excluded.destination_port_id, voyages.destination_port_id),
            voyage_number = excluded.voyage_number,
            status = excluded.status,
            eta = excluded.eta,
            etd = excluded.etd,
            source = excluded.source,
            last_updated_at = excluded.last_updated_at
        `).run(
          record.id,
          data,
          record.sourceType,
          record.vesselId,
          baselineEtd ?? null,
          baselineEta ?? null,
          record.etd ?? null,
          record.eta ?? null,
          delayMinutes ?? null,
          persistedRecord.imo ?? null,
          persistedRecord.mmsi ?? null,
          persistedRecord.originPortId ?? null,
          persistedRecord.destinationPortId ?? null,
          persistedRecord.voyageNumber ?? null,
          persistedRecord.status,
          persistedRecord.eta ?? null,
          persistedRecord.etd ?? null,
          persistedRecord.source,
          persistedRecord.lastUpdatedAt,
          createdAt,
        ) as { changes?: number }
        if ((result.changes ?? 0) > 0) written++

        const historyId = `${record.id}:${record.lastUpdatedAt}:${record.eta ?? ""}:${record.etd ?? ""}`
        const history = await this.db.prepare(`
          INSERT INTO voyage_eta_history (id, voyage_id, vessel_id, eta, etd, source, source_type, observed_at, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO NOTHING
        `).run(historyId, record.id, record.vesselId, record.eta ?? null, record.etd ?? null, record.source, record.sourceType, record.lastUpdatedAt, createdAt) as { changes?: number }
        if ((history.changes ?? 0) > 0) historyWritten++
      }
    })
    return { written, historyWritten, rejectedVesselIds, staleSkipped, acceptedIds }
  }

  async getLatestVoyage(vesselId: string): Promise<VoyageRecord | undefined> {
    const row = await this.db.prepare(`
      SELECT id, vessel_id, imo, mmsi, origin_port_id, destination_port_id, voyage_number, status,
        eta, etd, source, source_type, last_updated_at, created_at
      FROM voyages
      WHERE vessel_id = ?${this.sourceWhere()}
      ORDER BY last_updated_at DESC, created_at DESC, id DESC
      LIMIT 1
    `).get(vesselId) as VoyageRow | undefined
    return row ? toVoyage(row) : undefined
  }

  async getActiveVoyage(vesselId: string): Promise<VoyageRecord | undefined> {
    const row = await this.db.prepare(`
      SELECT id, vessel_id, imo, mmsi, origin_port_id, destination_port_id, voyage_number, status,
        eta, etd, source, source_type, last_updated_at, created_at
      FROM voyages
      WHERE vessel_id = ? AND status NOT IN ('arrived', 'cancelled')${this.sourceWhere()}
      ORDER BY last_updated_at DESC, created_at DESC, id DESC
      LIMIT 1
    `).get(vesselId) as VoyageRow | undefined
    return row ? toVoyage(row) : undefined
  }

  async getLatestVerifiedRealVoyage(providerId: string): Promise<VoyageRecord | undefined> {
    const row = await this.db.prepare(`
      SELECT id, vessel_id, imo, mmsi, origin_port_id, destination_port_id, voyage_number, status,
        eta, etd, source, source_type, last_updated_at, created_at
      FROM voyages
      WHERE source = ? AND source_type IN ('real', 'imported', 'derived')
        AND destination_port_id IS NOT NULL AND eta IS NOT NULL
      ORDER BY last_updated_at DESC, created_at DESC, id DESC
      LIMIT 1
    `).get(providerId) as VoyageRow | undefined
    const voyage = row ? toVoyage(row) : undefined
    return voyage && voyage.destinationPortId && voyage.eta && Number.isFinite(Date.parse(voyage.lastUpdatedAt))
      ? voyage
      : undefined
  }

  async listEtaHistory(voyageId: string): Promise<VoyageEtaHistoryRecord[]> {
    const result = await this.db.prepare(`
      SELECT id, voyage_id, vessel_id, eta, etd, source, source_type, observed_at, created_at
      FROM voyage_eta_history
      WHERE voyage_id = ?${this.sourceWhere()}
      ORDER BY observed_at ASC, id ASC
    `).all(voyageId)
    return rows<HistoryRow>(result).map(toHistory)
  }
}
