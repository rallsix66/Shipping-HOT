import process from "node:process"
import type { Database } from "db0"
import { portDirectoryBaseline } from "@shared/port-directory"
import type { PortDirectoryCoordinate, PortDirectoryCoordinateLookup, PortDirectoryRecord, PortDirectorySource } from "@shared/port-directory"
import type { ShippingDataMode } from "#/database/runtime"

type Row = Record<string, unknown>
const defaultShippingDataMode: ShippingDataMode = process.env.SHIPPING_DATA_MODE === "real" ? "real" : "mock"

function rows<T>(value: unknown): T[] {
  if (Array.isArray(value)) return value as T[]
  if (value && typeof value === "object" && Array.isArray((value as { results?: unknown[] }).results)) return (value as { results: T[] }).results
  return []
}

function parseAliases(value: unknown): string[] {
  try {
    const aliases = JSON.parse(String(value))
    return Array.isArray(aliases) ? aliases.filter((alias): alias is string => typeof alias === "string") : []
  } catch {
    return []
  }
}

function mapRow(row: Row): PortDirectoryRecord {
  return {
    unlocode: String(row.unlocode),
    nameEn: String(row.name_en),
    nameZh: String(row.name_zh),
    countryCode: String(row.country_code),
    latitude: Number(row.latitude),
    longitude: Number(row.longitude),
    timezone: String(row.timezone),
    aliases: parseAliases(row.aliases),
    source: String(row.source) as PortDirectorySource,
    verifiedAt: row.verified_at ? String(row.verified_at) : undefined,
    isActive: Number(row.is_active) === 1,
  }
}

export class PortDirectoryRepository implements PortDirectoryCoordinateLookup {
  constructor(private readonly db: Database, private readonly dataMode: ShippingDataMode = defaultShippingDataMode) {}

  private sourcePredicate() {
    return this.dataMode === "real" ? " AND source <> 'mock'" : ""
  }

  async searchPorts(query = "", limit = 50): Promise<PortDirectoryRecord[]> {
    const normalized = query.trim()
    const safeLimit = Math.max(1, Math.min(200, Math.trunc(limit)))
    const queryClause = normalized
      ? `
        AND (
          unlocode LIKE ? COLLATE NOCASE OR
          name_en LIKE ? COLLATE NOCASE OR
          name_zh LIKE ? OR
          aliases LIKE ? COLLATE NOCASE
        )`
      : ""
    const pattern = `%${normalized}%`
    const params = normalized ? [pattern, pattern, pattern, pattern, safeLimit] : [safeLimit]
    const values = rows<Row>(await this.db.prepare(`
      SELECT unlocode, name_en, name_zh, country_code, latitude, longitude, timezone, aliases, source, verified_at, is_active
      FROM port_directory
      WHERE is_active = 1${this.sourcePredicate()}${queryClause}
      ORDER BY name_en COLLATE NOCASE
      LIMIT ?
    `).all(...params))
    return values.map(mapRow)
  }

  async getPortByUNLocode(unlocode: string): Promise<PortDirectoryRecord | undefined> {
    const value = await this.db.prepare(`
      SELECT unlocode, name_en, name_zh, country_code, latitude, longitude, timezone, aliases, source, verified_at, is_active
      FROM port_directory
      WHERE unlocode = ? AND is_active = 1${this.sourcePredicate()}
    `).get(unlocode.trim().toUpperCase()) as Row | undefined
    return value ? mapRow(value) : undefined
  }

  async getPortCoordinate(unlocode: string): Promise<PortDirectoryCoordinate | undefined> {
    const port = await this.getPortByUNLocode(unlocode)
    return port ? { latitude: port.latitude, longitude: port.longitude } : undefined
  }

  async getPortAliases(unlocode: string): Promise<string[]> {
    return (await this.getPortByUNLocode(unlocode))?.aliases ?? []
  }

  async listActivePorts(): Promise<PortDirectoryRecord[]> {
    return this.searchPorts()
  }

  static baseline(): PortDirectoryRecord[] {
    return portDirectoryBaseline.map(({ shippingPortId: _shippingPortId, ...port }) => ({ ...port, aliases: [...port.aliases] }))
  }
}

export function createRuntimePortDirectoryLookup(dataMode: ShippingDataMode = defaultShippingDataMode): PortDirectoryCoordinateLookup {
  let repository: PortDirectoryRepository | undefined
  const getRepository = () => repository ??= new PortDirectoryRepository(useDatabase(), dataMode)
  return {
    getPortCoordinate: unlocode => getRepository().getPortCoordinate(unlocode),
  }
}
