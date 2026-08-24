import type { Database } from "db0"
import type { SourceLineage } from "@shared/shipping"
import type { ShippingDataMode } from "#/database/runtime"
import type { AisPosition, AisTrackingVessel } from "#/providers/ais/contracts"

export const AIS_POSITION_DEFAULT_TTL_MS = 15 * 60 * 1000

export interface AisPositionRecord extends AisPosition {
  id: string
  vesselId: string
  createdAt: string
  stale: boolean
}

export interface AisPositionWriteResult {
  written: number
  unknownVesselCount: number
  invalidCoordinateCount: number
  latestUpdatedCount: number
}

interface Row {
  id: string
  vessel_id: string
  position_id?: string
  mmsi: string
  latitude: number
  longitude: number
  speed?: number | null
  course?: number | null
  heading?: number | null
  navigation_status?: string | null
  timestamp: string
  source: string
  source_type: SourceLineage
  created_at?: string
  updated_at?: string
}

function rows<T>(value: unknown): T[] {
  return Array.isArray(value) ? value as T[] : []
}

function validCoordinate(position: Pick<AisPosition, "latitude" | "longitude">): boolean {
  return Number.isFinite(position.latitude)
    && Number.isFinite(position.longitude)
    && position.latitude >= -90
    && position.latitude <= 90
    && position.longitude >= -180
    && position.longitude <= 180
}

function positionId(position: AisPosition): string {
  return `${position.source}:${position.mmsi}:${position.timestamp}`
}

function timestampMs(value: string): number {
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) ? timestamp : Number.NEGATIVE_INFINITY
}

function toPosition(row: Row, now: Date, ttlMs: number): AisPositionRecord {
  const timestamp = row.timestamp
  return {
    id: row.id,
    vesselId: row.vessel_id,
    mmsi: row.mmsi,
    latitude: Number(row.latitude),
    longitude: Number(row.longitude),
    speed: row.speed ?? undefined,
    course: row.course ?? undefined,
    heading: row.heading ?? undefined,
    navigationStatus: row.navigation_status ?? undefined,
    timestamp,
    source: row.source,
    sourceType: row.source_type,
    createdAt: row.created_at ?? row.updated_at ?? timestamp,
    stale: !Number.isFinite(timestampMs(timestamp)) || now.getTime() - timestampMs(timestamp) > ttlMs,
  }
}

export class AisPositionRepository {
  constructor(private readonly db: Database, private readonly dataMode: ShippingDataMode = "real") {}

  private sourceWhere(): string {
    return this.dataMode === "real" ? " AND source_type IN ('real', 'imported', 'derived')" : ""
  }

  async savePositions(positions: readonly AisPosition[], vessels: readonly AisTrackingVessel[], createdAt = new Date().toISOString()): Promise<AisPositionWriteResult> {
    const vesselByMmsi = new Map(vessels.map(vessel => [vessel.mmsi, vessel]))
    let written = 0
    let unknownVesselCount = 0
    let invalidCoordinateCount = 0
    let latestUpdatedCount = 0
    await this.db.prepare("BEGIN").run()
    try {
      for (const position of positions) {
        const vessel = vesselByMmsi.get(position.mmsi)
        if (!vessel) {
          unknownVesselCount++
          continue
        }
        if (!validCoordinate(position)) {
          invalidCoordinateCount++
          continue
        }
        if (this.dataMode === "real" && position.sourceType === "mock") throw new Error("mock_position_not_allowed_in_real_mode")
        const id = position.id ?? positionId(position)
        const record = { ...position, id, vesselId: vessel.vesselId }
        const insertResult = await this.db.prepare(`
          INSERT INTO ais_positions (
            id, vessel_id, mmsi, latitude, longitude, speed, course, heading,
            navigation_status, timestamp, source, source_type, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO NOTHING
        `).run(
          record.id,
          record.vesselId,
          record.mmsi,
          record.latitude,
          record.longitude,
          record.speed ?? null,
          record.course ?? null,
          record.heading ?? null,
          record.navigationStatus ?? null,
          record.timestamp,
          record.source,
          record.sourceType,
          createdAt,
        )
        const changes = (insertResult as { changes?: number }).changes ?? 0
        if (changes > 0) written++
        const current = await this.db.prepare("SELECT timestamp FROM ais_latest_positions WHERE vessel_id = ?").get(record.vesselId) as { timestamp?: string } | undefined
        if (!current?.timestamp || timestampMs(record.timestamp) >= timestampMs(current.timestamp)) {
          await this.db.prepare(`
            INSERT INTO ais_latest_positions (
              vessel_id, position_id, mmsi, latitude, longitude, speed, course, heading,
              navigation_status, timestamp, source, source_type, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(vessel_id) DO UPDATE SET
              position_id = excluded.position_id,
              mmsi = excluded.mmsi,
              latitude = excluded.latitude,
              longitude = excluded.longitude,
              speed = excluded.speed,
              course = excluded.course,
              heading = excluded.heading,
              navigation_status = excluded.navigation_status,
              timestamp = excluded.timestamp,
              source = excluded.source,
              source_type = excluded.source_type,
              updated_at = excluded.updated_at
          `).run(
            record.vesselId,
            record.id,
            record.mmsi,
            record.latitude,
            record.longitude,
            record.speed ?? null,
            record.course ?? null,
            record.heading ?? null,
            record.navigationStatus ?? null,
            record.timestamp,
            record.source,
            record.sourceType,
            createdAt,
          )
          latestUpdatedCount++
        }
      }
      await this.db.prepare("COMMIT").run()
      return { written, unknownVesselCount, invalidCoordinateCount, latestUpdatedCount }
    } catch (error) {
      try {
        await this.db.prepare("ROLLBACK").run()
      } catch {
        // Preserve the original persistence error.
      }
      throw error
    }
  }

  async getLatestPosition(vesselId: string, now = new Date(), ttlMs = AIS_POSITION_DEFAULT_TTL_MS): Promise<AisPositionRecord | undefined> {
    const row = await this.db.prepare(`
      SELECT vessel_id, position_id AS id, mmsi, latitude, longitude, speed, course, heading,
        navigation_status, timestamp, source, source_type, updated_at
      FROM ais_latest_positions
      WHERE vessel_id = ?${this.sourceWhere()}
    `).get(vesselId) as Row | undefined
    return row ? toPosition({ ...row, created_at: row.updated_at }, now, ttlMs) : undefined
  }

  async listLatestPositions(vesselIds: readonly string[], now = new Date(), ttlMs = AIS_POSITION_DEFAULT_TTL_MS): Promise<AisPositionRecord[]> {
    if (!vesselIds.length) return []
    const placeholders = vesselIds.map(() => "?").join(",")
    const result = await this.db.prepare(`
      SELECT vessel_id, position_id AS id, mmsi, latitude, longitude, speed, course, heading,
        navigation_status, timestamp, source, source_type, updated_at
      FROM ais_latest_positions
      WHERE vessel_id IN (${placeholders})${this.sourceWhere()}
    `).all(...vesselIds) as Row[]
    const mapped = new Map(rows<Row>(result).map(row => [row.vessel_id, toPosition({ ...row, created_at: row.updated_at }, now, ttlMs)]))
    return vesselIds.flatMap(vesselId => mapped.get(vesselId) ? [mapped.get(vesselId)!] : [])
  }
}
