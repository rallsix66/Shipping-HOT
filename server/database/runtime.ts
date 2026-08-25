import { randomUUID } from "node:crypto"
import type { Database } from "db0"
import type { DatabasePersistenceStatus, ShippingSettings } from "@shared/shipping"
import { p0FoundationMigration } from "#/database/migrations/001-p0-foundation"
import { watchlistIsolationMigration } from "#/database/migrations/002-watchlist-isolation"
import { p1aPortDirectoryMigration } from "#/database/migrations/003-p1a-port-directory"
import { p1bMockIsolationMigration } from "#/database/migrations/004-p1b-mock-isolation"
import { p2aSearchFoundationMigration } from "#/database/migrations/005-p2a-search-foundation"
import { p2cRuntimeFoundationMigration } from "#/database/migrations/006-p2c-runtime-foundation"
import { p3aAisTrackingMigration } from "#/database/migrations/007-p3a-ais-tracking"
import { p3bVoyageEtaMigration } from "#/database/migrations/008-p3b-voyage-eta"
import { p3FeedFreshnessMigration } from "#/database/migrations/009-p3-feed-freshness"

export const latestSchemaVersion = p3FeedFreshnessMigration.version

export type ShippingDataMode = "mock" | "real"

export const defaultShippingSettings: ShippingSettings = {
  refreshInterval: 15,
  sourceEnabled: true,
  providerEnabled: true,
  eventThresholds: {
    anchoredHours: 24,
    delayMinutes: 120,
    congestionLevel: "high",
  },
  retentionDays: 30,
  calendarSync: [],
}

interface AppMetadataRow {
  schema_version: number
  bootstrap_completed_at?: string | null
  database_id: string
  last_migration_at: string
  data_mode: ShippingDataMode
}

export interface DatabaseMetadata {
  schemaVersion: number
  bootstrapCompletedAt?: string
  databaseId: string
  lastMigrationAt: string
  dataMode: ShippingDataMode
}

export function persistenceUnavailableError(cause?: unknown): Error & { statusCode: number, statusMessage: string } {
  const error = new Error("persistence_unavailable") as Error & { statusCode: number, statusMessage: string }
  error.statusCode = 503
  error.statusMessage = "persistence_unavailable"
  if (cause) error.cause = cause
  return error
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
      // Preserve the original migration/bootstrap error.
    }
    throw error
  }
}

async function runMigrations(db: Database) {
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    )
  `).run()

  const appliedRows = await db.prepare("SELECT version FROM schema_migrations ORDER BY version").all() as Array<{ version: number }>
  const applied = new Set(appliedRows.map(row => Number(row.version)))
  const migrations = [p0FoundationMigration, watchlistIsolationMigration, p1aPortDirectoryMigration, p1bMockIsolationMigration, p2aSearchFoundationMigration, p2cRuntimeFoundationMigration, p3aAisTrackingMigration, p3bVoyageEtaMigration, p3FeedFreshnessMigration]
  for (const migration of migrations) {
    if (applied.has(migration.version)) continue
    await transaction(db, async () => {
      await migration.up(db)
      await db.prepare("INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)")
        .run(migration.version, migration.name, new Date().toISOString())
    })
  }
  return latestSchemaVersion
}

async function bootstrapDatabase(db: Database, dataMode: ShippingDataMode): Promise<DatabaseMetadata> {
  const existing = await db.prepare("SELECT database_id FROM app_metadata WHERE id = 'default'").get() as { database_id?: string } | undefined
  const databaseId = existing?.database_id ?? randomUUID()
  const now = new Date().toISOString()
  await transaction(db, async () => {
    await db.prepare(`
      INSERT INTO settings (id, data, updated_at) VALUES ('default', ?, ?)
      ON CONFLICT(id) DO NOTHING
    `).run(JSON.stringify(defaultShippingSettings), now)
    await db.prepare(`
      INSERT INTO port_directory_status (id, port_directory_status, port_directory_version, port_directory_imported_at)
      VALUES ('default', 'pending', NULL, NULL)
      ON CONFLICT(id) DO NOTHING
    `).run()
    await db.prepare(`
      INSERT INTO app_metadata (id, schema_version, bootstrap_completed_at, database_id, last_migration_at, data_mode)
      VALUES ('default', ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        schema_version = excluded.schema_version,
        bootstrap_completed_at = COALESCE(app_metadata.bootstrap_completed_at, excluded.bootstrap_completed_at),
        last_migration_at = excluded.last_migration_at,
        data_mode = excluded.data_mode
    `).run(latestSchemaVersion, now, databaseId, now, dataMode)
  })
  return readDatabaseMetadata(db)
}

export async function readDatabaseMetadata(db: Database): Promise<DatabaseMetadata> {
  const row = await db.prepare(`
    SELECT schema_version, bootstrap_completed_at, database_id, last_migration_at, data_mode
    FROM app_metadata WHERE id = 'default'
  `).get() as AppMetadataRow | undefined
  if (!row) throw new Error("app_metadata bootstrap row missing")
  return {
    schemaVersion: Number(row.schema_version),
    bootstrapCompletedAt: row.bootstrap_completed_at ?? undefined,
    databaseId: row.database_id,
    lastMigrationAt: row.last_migration_at,
    dataMode: row.data_mode,
  }
}

export async function initializeShippingDatabase(db: Database, dataMode: ShippingDataMode): Promise<DatabaseMetadata> {
  await runMigrations(db)
  return bootstrapDatabase(db, dataMode)
}

export function healthyPersistenceStatus(metadata: DatabaseMetadata): DatabasePersistenceStatus {
  return {
    status: "healthy",
    schemaVersion: metadata.schemaVersion,
    bootstrapCompletedAt: metadata.bootstrapCompletedAt,
  }
}
