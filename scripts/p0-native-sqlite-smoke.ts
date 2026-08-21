import { spawnSync } from "node:child_process"
import { rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import process from "node:process"
import { fileURLToPath } from "node:url"
import NativeDatabase from "better-sqlite3"
import type { Vessel } from "@shared/shipping"
import type { VesselSearchResult } from "@shared/vessel-search"
import { p0FoundationMigration } from "../server/database/migrations/001-p0-foundation"
import { watchlistIsolationMigration } from "../server/database/migrations/002-watchlist-isolation"
import { p1aPortDirectoryMigration } from "../server/database/migrations/003-p1a-port-directory"
import { p1bMockIsolationMigration } from "../server/database/migrations/004-p1b-mock-isolation"
import { p2aSearchFoundationMigration } from "../server/database/migrations/005-p2a-search-foundation"

async function openDatabase(path: string): Promise<InstanceType<typeof NativeDatabase>> {
  const native = new NativeDatabase(path)
  native.exec("CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)")
  const migrations = [p0FoundationMigration, watchlistIsolationMigration, p1aPortDirectoryMigration, p1bMockIsolationMigration, p2aSearchFoundationMigration]
  for (const migration of migrations) {
    if (native.prepare("SELECT 1 FROM schema_migrations WHERE version = ?").get(migration.version)) continue
    native.exec("BEGIN")
    try {
      await migration.up({
        exec: (sql: string) => native.exec(sql),
        prepare: (sql: string) => ({
          all: async (...params: (string | number | boolean | null | undefined)[]) => native.prepare(sql).all(...params),
          run: async (...params: (string | number | boolean | null | undefined)[]) => native.prepare(sql).run(...params),
        }),
      } as never)
      native.prepare("INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)").run(migration.version, migration.name, new Date().toISOString())
      native.exec("COMMIT")
    } catch (error) {
      native.exec("ROLLBACK")
      throw error
    }
  }
  native.prepare(`
    INSERT INTO settings (id, data, updated_at) VALUES ('default', ?, ?)
    ON CONFLICT(id) DO NOTHING
  `).run(JSON.stringify({ refreshInterval: 15, sourceEnabled: true, providerEnabled: true, eventThresholds: { anchoredHours: 24, delayMinutes: 120, congestionLevel: "high" }, retentionDays: 30, calendarSync: [] }), new Date().toISOString())
  const existing = native.prepare("SELECT database_id FROM app_metadata WHERE id = 'default'").get() as { database_id?: string } | undefined
  native.prepare(`
    INSERT INTO app_metadata (id, schema_version, bootstrap_completed_at, database_id, last_migration_at, data_mode)
    VALUES ('default', 5, ?, COALESCE(?, lower(hex(randomblob(16)))), ?, 'real')
    ON CONFLICT(id) DO UPDATE SET bootstrap_completed_at = COALESCE(app_metadata.bootstrap_completed_at, excluded.bootstrap_completed_at), data_mode = excluded.data_mode
  `).run(new Date().toISOString(), existing?.database_id ?? null, new Date().toISOString())
  native.prepare(`
    INSERT INTO port_directory_status (id, port_directory_status, port_directory_version, port_directory_imported_at)
    VALUES ('default', 'ready', 'p1a-unlocode-baseline-v1', ?)
    ON CONFLICT(id) DO NOTHING
  `).run(new Date().toISOString())
  return native
}

const smokeVessel: Vessel = {
  id: "p0-native-smoke-vessel",
  name: "P0 NATIVE SMOKE",
  isWatched: false,
  navigationStatus: "unknown",
  stale: false,
  sourceStatus: "healthy",
  provenance: { sourceType: "third_party", dataNature: "observed", sourceId: "p0-native-smoke" },
  updatedAt: "2026-08-20T00:00:00.000Z",
}

const smokeSearchVessel: VesselSearchResult = {
  id: "vesselapi:dong-fang-fu",
  name: "DONG FANG FU",
  mmsi: "413393620",
  callsign: "BPCL3",
  type: "Container Ship",
  flag: "Panama",
  source: "vesselapi",
  fetchedAt: "2026-08-21T00:00:00.000Z",
  source_type: "real",
  providerRecordId: "dong-fang-fu",
}

const promotedSmokeSearchVessel: VesselSearchResult = {
  ...smokeSearchVessel,
  id: "imo:9162423",
  imo: "9162423",
}

async function writer(path: string) {
  const database = await openDatabase(path)
  database.prepare(`
    INSERT INTO vessels (id, data, source_type, navigation_status, status_changed_at, last_updated_at)
    VALUES (?, ?, 'real', ?, NULL, ?)
    ON CONFLICT(id) DO UPDATE SET data = excluded.data, source_type = excluded.source_type, navigation_status = excluded.navigation_status, last_updated_at = excluded.last_updated_at
  `).run(smokeVessel.id, JSON.stringify({ ...smokeVessel, source_type: "real" }), smokeVessel.navigationStatus, smokeVessel.updatedAt)
  database.prepare(`
    INSERT INTO vessel_watchlist (vessel_id, watched_at, ais_enabled) VALUES (?, ?, 1)
    ON CONFLICT(vessel_id) DO UPDATE SET watched_at = excluded.watched_at
  `).run(smokeVessel.id, new Date().toISOString())
  database.prepare(`
    INSERT INTO vessel_metadata (id, name, imo, mmsi, callsign, type, flag, source, fetched_at, source_type, provider_record_id, data)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET name = excluded.name, imo = excluded.imo, mmsi = excluded.mmsi, callsign = excluded.callsign, type = excluded.type, flag = excluded.flag, source = excluded.source, fetched_at = excluded.fetched_at, source_type = excluded.source_type, provider_record_id = excluded.provider_record_id, data = excluded.data
  `).run(smokeSearchVessel.id, smokeSearchVessel.name, smokeSearchVessel.imo ?? null, smokeSearchVessel.mmsi ?? null, smokeSearchVessel.callsign ?? null, smokeSearchVessel.type ?? null, smokeSearchVessel.flag ?? null, smokeSearchVessel.source, smokeSearchVessel.fetchedAt, smokeSearchVessel.source_type, smokeSearchVessel.providerRecordId ?? null, JSON.stringify(smokeSearchVessel))
  database.prepare(`
    INSERT INTO vessel_watchlist (vessel_id, watched_at, ais_enabled) VALUES (?, ?, ?)
    ON CONFLICT(vessel_id) DO UPDATE SET ais_enabled = excluded.ais_enabled
  `).run(smokeSearchVessel.id, new Date().toISOString(), smokeSearchVessel.mmsi ? 1 : 0)
  database.close()
}

async function reader(path: string) {
  const database = await openDatabase(path)
  database.prepare(`
    UPDATE vessel_metadata
    SET imo = ?, mmsi = ?, fetched_at = ?, data = ?
    WHERE id = ? AND source = ? AND provider_record_id = ?
  `).run(promotedSmokeSearchVessel.imo ?? null, promotedSmokeSearchVessel.mmsi ?? null, promotedSmokeSearchVessel.fetchedAt, JSON.stringify(promotedSmokeSearchVessel), smokeSearchVessel.id, smokeSearchVessel.source, smokeSearchVessel.providerRecordId)
  database.prepare(`
    INSERT INTO vessel_watchlist (vessel_id, watched_at, ais_enabled) VALUES (?, ?, ?)
    ON CONFLICT(vessel_id) DO UPDATE SET ais_enabled = excluded.ais_enabled
  `).run(smokeSearchVessel.id, new Date().toISOString(), promotedSmokeSearchVessel.mmsi ? 1 : 0)
  const appMetadata = database.prepare("SELECT schema_version, bootstrap_completed_at, data_mode FROM app_metadata WHERE id = 'default'").get() as { schema_version: number, bootstrap_completed_at?: string, data_mode: string } | undefined
  const vesselRow = database.prepare(`SELECT v.data, w.vessel_id FROM vessels v LEFT JOIN vessel_watchlist w ON w.vessel_id = v.id WHERE v.id = ?`).get(smokeVessel.id) as { data: string, vessel_id?: string } | undefined
  const searchWatchRow = database.prepare(`SELECT w.vessel_id, m.name, m.imo, m.mmsi FROM vessel_watchlist w JOIN vessel_metadata m ON m.id = w.vessel_id WHERE w.vessel_id = ?`).get(smokeSearchVessel.id) as { vessel_id?: string, name?: string, imo?: string, mmsi?: string } | undefined
  const tables = database.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>
  const tableNames = new Set(tables.map(table => table.name))
  const portDirectory = database.prepare("SELECT port_directory_status, port_directory_version, port_directory_imported_at FROM port_directory_status WHERE id = 'default'").get() as { port_directory_status: string, port_directory_version?: string, port_directory_imported_at?: string } | undefined
  const portCount = database.prepare("SELECT COUNT(*) AS count FROM port_directory WHERE is_active = 1 AND source <> 'mock'").get() as { count: number }
  if (appMetadata?.data_mode !== "real") throw new Error(`unexpected data mode: ${appMetadata?.data_mode}`)
  if (!appMetadata.bootstrap_completed_at) throw new Error("bootstrap_completed_at was not persisted")
  if (!vesselRow || vesselRow.vessel_id !== smokeVessel.id) throw new Error("user watchlist was not persisted")
  if (!searchWatchRow || searchWatchRow.vessel_id !== smokeSearchVessel.id || searchWatchRow.name !== smokeSearchVessel.name || searchWatchRow.imo !== promotedSmokeSearchVessel.imo || searchWatchRow.mmsi !== promotedSmokeSearchVessel.mmsi) throw new Error("search vessel watchlist was not persisted")
  const searchWatchCount = database.prepare("SELECT COUNT(*) AS count FROM vessel_watchlist WHERE vessel_id = ?").get(smokeSearchVessel.id) as { count: number }
  if (Number(searchWatchCount.count) !== 1) throw new Error("search vessel watchlist was duplicated")
  for (const table of ["schema_migrations", "app_metadata", "port_directory_status", "vessel_watchlist", "port_watchlist", "translation_cache", "provider_usage", "provider_runtime", "sync_runs", "vessel_metadata", "vessel_search_cache"]) {
    if (!tableNames.has(table)) throw new Error(`missing P0 table: ${table}`)
  }
  if (portDirectory?.port_directory_status !== "ready" || portDirectory.port_directory_version !== "p1a-unlocode-baseline-v1" || !portDirectory.port_directory_imported_at) throw new Error("Port Directory baseline was not persisted")
  if (Number(portCount.count) !== 8) throw new Error(`unexpected active Port Directory baseline count: ${portCount.count}`)
  database.close()
  console.log(JSON.stringify({ process: "B", node: process.version, abi: process.versions.modules, bootstrapCompletedAt: appMetadata.bootstrap_completed_at, watched: true, searchWatched: searchWatchRow.name, canonicalVesselId: smokeSearchVessel.id, promotedImo: searchWatchRow.imo, promotedMmsi: searchWatchRow.mmsi, portDirectory: portDirectory?.port_directory_status }))
}

const phase = process.argv[2]
const path = process.argv[3] ?? join(tmpdir(), "shipping-hot-p0-native-restart-smoke.sqlite3")

if (phase === "writer") {
  await writer(path)
} else if (phase === "reader") {
  await reader(path)
} else {
  rmSync(path, { force: true })
  const script = fileURLToPath(import.meta.url)
  for (const childPhase of ["writer", "reader"]) {
    const result = spawnSync(process.execPath, ["--import", "tsx/esm", script, childPhase, path], {
      stdio: "inherit",
      env: { ...process.env, SHIPPING_DATA_MODE: "real" },
    })
    if (result.status !== 0) throw new Error(`native SQLite smoke ${childPhase} failed with status ${result.status}`)
  }
  rmSync(path, { force: true })
  console.log(JSON.stringify({ process: "A-to-B", node: process.version, abi: process.versions.modules, persisted: true }))
}
