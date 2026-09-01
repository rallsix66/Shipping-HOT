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
  acceptedSourceUpdatedAt: string[]
  newEpisodes: number
  reusedEpisodes: number
  supersededEpisodes: number
  episodeStaleSkipped: number
  episodeTransitionConflicts: number
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
  data?: string | null
  first_history_observed_at?: string | null
}

interface ExistingVoyageRow {
  id?: string
  vessel_id?: string
  source?: string | null
  source_type?: string | null
  imo?: string | null
  mmsi?: string | null
  origin_port_id?: string | null
  destination_port_id?: string | null
  last_updated_at?: string | null
  baseline_etd?: string | null
  baseline_eta?: string | null
  data?: string | null
  created_at?: string | null
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

interface ParsedVesselApiEpisodeId {
  vesselId: string
  destinationKey: string
  anchor?: string
}

function parseVesselApiEpisodeId(id: string): ParsedVesselApiEpisodeId | undefined {
  const prefix = "vesselapi:"
  const marker = ":destination:"
  if (!id.startsWith(prefix)) return undefined
  const markerIndex = id.indexOf(marker, prefix.length)
  if (markerIndex < 0) return undefined
  const vesselId = id.slice(prefix.length, markerIndex)
  const destinationAndAnchor = id.slice(markerIndex + marker.length)
  if (!vesselId || !destinationAndAnchor) return undefined
  const anchorMarker = ":episode:"
  const anchorIndex = destinationAndAnchor.indexOf(anchorMarker)
  const destinationKey = anchorIndex < 0 ? destinationAndAnchor : destinationAndAnchor.slice(0, anchorIndex)
  const anchor = anchorIndex < 0 ? undefined : destinationAndAnchor.slice(anchorIndex + anchorMarker.length)
  if (!destinationKey || (anchorIndex >= 0 && !anchor)) return undefined
  return { vesselId, destinationKey, anchor }
}

function compactEpisodeAnchor(timestamp: string): string | undefined {
  const parsed = Date.parse(timestamp)
  return Number.isFinite(parsed) ? new Date(parsed).toISOString().replace(/[.:-]/g, "") : undefined
}

function isRealVesselApiRecord(record: VoyageRecord): boolean {
  return record.source === "vesselapi" && record.sourceType === "real"
}

function isVerifiedVesselApiVoyage(record: VoyageRecord, firstHistoryObservedAt?: string | null): boolean {
  if (!isRealVesselApiRecord(record)) return false
  if (!record.eta || !Number.isFinite(Date.parse(record.eta))) return false
  if (!Number.isFinite(Date.parse(record.lastUpdatedAt))) return false
  if (!firstHistoryObservedAt || !Number.isFinite(Date.parse(firstHistoryObservedAt))) return false
  if (!record.imo?.trim() && !record.mmsi?.trim()) return false
  const episode = parseVesselApiEpisodeId(record.id)
  return Boolean(
    episode
    && episode.vesselId === record.vesselId
    && /^[A-Z0-9]+(?:_[A-Z0-9]+)*$/.test(episode.destinationKey)
    && episode.anchor
    && episode.anchor === compactEpisodeAnchor(firstHistoryObservedAt),
  )
}

function destinationKeyForRecord(record: VoyageRecord): string | undefined {
  return parseVesselApiEpisodeId(record.id)?.destinationKey ?? (record.destinationPortId?.trim().toUpperCase() || undefined)
}

function destinationKeyForRow(row: ExistingVoyageRow): string | undefined {
  return (row.id ? parseVesselApiEpisodeId(row.id)?.destinationKey : undefined)
    ?? (typeof row.destination_port_id === "string" ? row.destination_port_id.trim().toUpperCase() : undefined)
    ?? (() => {
      const stored = storedFields(row.data)
      return typeof stored.destinationPortId === "string" ? stored.destinationPortId.trim().toUpperCase() : undefined
    })()
}

function candidateId(record: VoyageRecord, destinationKey: string): string {
  const anchor = compactEpisodeAnchor(record.lastUpdatedAt)
  return anchor
    ? `vesselapi:${record.vesselId}:destination:${destinationKey}:episode:${anchor}`
    : record.id
}

function toVoyage(row: VoyageRow): VoyageRecord | undefined {
  if (!row.status || !row.source || !row.last_updated_at) return undefined
  if (!voyageStatuses.has(row.status as VoyageStatus) || !lineageValues.has(row.source_type)) return undefined
  const stored = storedFields(row.data)
  const episodeState = stored.episodeState === "current" || stored.episodeState === "superseded" ? stored.episodeState : undefined
  const supersededAt = typeof stored.supersededAt === "string" ? stored.supersededAt : undefined
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
    episodeState,
    supersededAt,
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

  private async latestVesselApiEpisode(vesselId: string): Promise<ExistingVoyageRow | undefined> {
    return await this.db.prepare(`
      SELECT id, vessel_id, source, source_type, imo, mmsi, origin_port_id, destination_port_id,
        last_updated_at, baseline_etd, baseline_eta, data, created_at
      FROM voyages
      WHERE vessel_id = ? AND source = 'vesselapi' AND source_type = 'real'
      ORDER BY last_updated_at DESC, created_at DESC, id DESC
      LIMIT 1
    `).get(vesselId) as ExistingVoyageRow | undefined
  }

  private async supersedeVesselApiEpisode(row: ExistingVoyageRow, supersededAt: string): Promise<void> {
    if (!row.id) return
    const data = JSON.stringify({ ...storedFields(row.data), episodeState: "superseded", supersededAt })
    await this.db.prepare("UPDATE voyages SET data = ? WHERE id = ?").run(data, row.id)
  }

  private async resolveVesselApiEpisode(record: VoyageRecord): Promise<{ record?: VoyageRecord, previous?: ExistingVoyageRow, newEpisode?: boolean, reusedEpisode?: boolean, stale?: boolean, conflict?: boolean }> {
    if (!isRealVesselApiRecord(record)) return { record }
    const destinationKey = destinationKeyForRecord(record)
    if (!destinationKey) return { record }
    const current = await this.latestVesselApiEpisode(record.vesselId)
    if (!current) return { record: { ...record, id: candidateId(record, destinationKey), episodeState: "current" }, newEpisode: true }

    const currentDestinationKey = destinationKeyForRow(current)
    if (!currentDestinationKey) return { conflict: true }
    const incomingAt = Date.parse(record.lastUpdatedAt)
    const currentAt = Date.parse(current.last_updated_at ?? "")
    if (destinationKey === currentDestinationKey) {
      return { record: { ...record, id: current.id ?? record.id, episodeState: "current", supersededAt: undefined }, reusedEpisode: true }
    }
    if (Number.isFinite(currentAt) && incomingAt < currentAt) return { stale: true }
    if (Number.isFinite(currentAt) && incomingAt === currentAt) return { conflict: true }
    if (!Number.isFinite(currentAt)) return { conflict: true }
    return { record: { ...record, id: candidateId(record, destinationKey), episodeState: "current", supersededAt: undefined }, previous: current, newEpisode: true }
  }

  async saveVoyages(records: readonly VoyageRecord[], createdAt = new Date().toISOString(), options: SaveVoyagesOptions = {}): Promise<VoyageWriteResult> {
    let written = 0
    let historyWritten = 0
    let rejectedVesselIds = 0
    let staleSkipped = 0
    const acceptedIds: string[] = []
    const acceptedSourceUpdatedAt: string[] = []
    let newEpisodes = 0
    let reusedEpisodes = 0
    let supersededEpisodes = 0
    let episodeStaleSkipped = 0
    let episodeTransitionConflicts = 0
    const requestedVesselIds = options.requestedVesselIds ? new Set(options.requestedVesselIds) : undefined
    const orderedRecords = [...records].sort((left, right) => left.vesselId.localeCompare(right.vesselId) || Date.parse(left.lastUpdatedAt) - Date.parse(right.lastUpdatedAt) || left.id.localeCompare(right.id))
    await transaction(this.db, async () => {
      for (const record of orderedRecords) {
        validateRecord(record)
        if (requestedVesselIds && !requestedVesselIds.has(record.vesselId)) {
          rejectedVesselIds++
          continue
        }
        if (this.dataMode === "real" && record.sourceType === "mock") throw new Error("mock_voyage_not_allowed_in_real_mode")
        const resolution = await this.resolveVesselApiEpisode(record)
        if (resolution.stale) {
          episodeStaleSkipped++
          continue
        }
        if (resolution.conflict) {
          episodeTransitionConflicts++
          continue
        }
        const resolvedRecord = resolution.record ?? record
        if (resolution.newEpisode) {
          newEpisodes++
          if (resolution.previous) {
            await this.supersedeVesselApiEpisode(resolution.previous, resolvedRecord.lastUpdatedAt)
            supersededEpisodes++
          }
        }
        const existing = await this.db.prepare("SELECT id, imo, mmsi, origin_port_id, destination_port_id, last_updated_at, baseline_etd, baseline_eta, data FROM voyages WHERE id = ?").get(resolvedRecord.id) as ExistingVoyageRow | undefined
        if (existing?.last_updated_at && Date.parse(resolvedRecord.lastUpdatedAt) < Date.parse(existing.last_updated_at)) {
          staleSkipped++
          continue
        }
        if (resolution.reusedEpisode) reusedEpisodes++
        acceptedIds.push(resolvedRecord.id)
        acceptedSourceUpdatedAt.push(resolvedRecord.lastUpdatedAt)
        if (resolvedRecord.originPortId) await this.assertPortIdentity(resolvedRecord.originPortId)
        if (resolvedRecord.destinationPortId) await this.assertPortIdentity(resolvedRecord.destinationPortId)
        const previous = storedFields(existing?.data)
        const baselineEta = existing?.baseline_eta ?? resolvedRecord.eta
        const baselineEtd = existing?.baseline_etd ?? resolvedRecord.etd
        const delayMinutes = calculateDelayMinutes(baselineEta ?? undefined, resolvedRecord.eta)
        const baselineEtaSource = existing?.baseline_eta !== undefined && existing?.baseline_eta !== null
          ? typeof previous.baselineEtaSource === "string" ? previous.baselineEtaSource : resolvedRecord.source
          : resolvedRecord.source
        const baselineEtdSource = existing?.baseline_etd !== undefined && existing?.baseline_etd !== null
          ? typeof previous.baselineEtdSource === "string" ? previous.baselineEtdSource : resolvedRecord.source
          : resolvedRecord.source
        const persistedRecord: VoyageRecord = {
          ...resolvedRecord,
          imo: resolvedRecord.imo ?? existing?.imo ?? undefined,
          mmsi: resolvedRecord.mmsi ?? existing?.mmsi ?? undefined,
          originPortId: resolvedRecord.originPortId ?? existing?.origin_port_id ?? undefined,
          destinationPortId: resolvedRecord.destinationPortId ?? existing?.destination_port_id ?? undefined,
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
          persistedRecord.id,
          data,
          persistedRecord.sourceType,
          persistedRecord.vesselId,
          baselineEtd ?? null,
          baselineEta ?? null,
          persistedRecord.etd ?? null,
          persistedRecord.eta ?? null,
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

        const historyId = `${persistedRecord.id}:${persistedRecord.lastUpdatedAt}:${persistedRecord.eta ?? ""}:${persistedRecord.etd ?? ""}`
        const history = await this.db.prepare(`
          INSERT INTO voyage_eta_history (id, voyage_id, vessel_id, eta, etd, source, source_type, observed_at, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO NOTHING
        `).run(historyId, persistedRecord.id, persistedRecord.vesselId, persistedRecord.eta ?? null, persistedRecord.etd ?? null, persistedRecord.source, persistedRecord.sourceType, persistedRecord.lastUpdatedAt, createdAt) as { changes?: number }
        if ((history.changes ?? 0) > 0) historyWritten++
      }
    })
    return { written, historyWritten, rejectedVesselIds, staleSkipped, acceptedIds, acceptedSourceUpdatedAt, newEpisodes, reusedEpisodes, supersededEpisodes, episodeStaleSkipped, episodeTransitionConflicts }
  }

  async getLatestVoyage(vesselId: string): Promise<VoyageRecord | undefined> {
    const row = await this.db.prepare(`
      SELECT id, vessel_id, imo, mmsi, origin_port_id, destination_port_id, voyage_number, status,
        eta, etd, source, source_type, last_updated_at, created_at, data
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
        eta, etd, source, source_type, last_updated_at, created_at, data
      FROM voyages
      WHERE vessel_id = ? AND status NOT IN ('arrived', 'cancelled')${this.sourceWhere()}
      ORDER BY last_updated_at DESC, created_at DESC, id DESC
      LIMIT 1
    `).get(vesselId) as VoyageRow | undefined
    return row ? toVoyage(row) : undefined
  }

  async getLatestVerifiedRealVoyage(providerId: string): Promise<VoyageRecord | undefined> {
    const result = await this.db.prepare(`
      SELECT id, vessel_id, imo, mmsi, origin_port_id, destination_port_id, voyage_number, status,
        eta, etd, source, source_type, last_updated_at, created_at, data,
        (
          SELECT observed_at
          FROM voyage_eta_history
          WHERE voyage_id = voyages.id AND vessel_id = voyages.vessel_id
            AND source = 'vesselapi' AND source_type = 'real'
          ORDER BY observed_at ASC, id ASC
          LIMIT 1
        ) AS first_history_observed_at
      FROM voyages
      WHERE source = ? AND source_type = 'real' AND eta IS NOT NULL
      ORDER BY last_updated_at DESC, created_at DESC, id DESC
    `).all(providerId)
    for (const row of rows<VoyageRow>(result)) {
      const voyage = toVoyage(row)
      if (voyage && isVerifiedVesselApiVoyage(voyage, row.first_history_observed_at)) return voyage
    }
    return undefined
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
