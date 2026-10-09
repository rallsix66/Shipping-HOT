/**
 * R1-3: run pending migrations twice on an isolated DB copy (never the retained DB).
 *
 * Usage (from repo root):
 *   node --import tsx/esm --experimental-loader ./scripts/tsx-alias-loader.mjs ./scripts/r1-migration-copy-test.ts <copy-dir>
 */
import process from "node:process"
import NativeDatabase from "better-sqlite3"
import { createDatabase } from "db0"
import { resolveAllowedCopyDatabasePath } from "./r1-migration-copy-guard"
import { initializeShippingDatabase } from "#/database/runtime"

export const RETIRED_TABLES = [
  "_retired_vessels",
  "_retired_vessel_watchlist",
  "_retired_voyages",
  "_retired_vessel_metadata",
  "_retired_vessel_search_cache",
  "_retired_ais_positions",
  "_retired_ais_latest_positions",
  "_retired_voyage_eta_history",
  "_retired_ais_port_metrics",
] as const

const LEGACY_SOURCES = [
  "vessels",
  "vessel_watchlist",
  "voyages",
  "vessel_metadata",
  "vessel_search_cache",
  "ais_positions",
  "ais_latest_positions",
  "voyage_eta_history",
  "ais_port_metrics",
] as const

function openDatabase(dbPath: string) {
  const native = new NativeDatabase(dbPath)
  const database = createDatabase({
    name: "sqlite",
    dialect: "sqlite",
    getInstance: () => native,
    exec: (sql: string) => native.exec(sql),
    prepare: (sql: string) => {
      const statement = native.prepare(sql)
      return {
        all: async (...params: (string | number | boolean | null | undefined)[]) => statement.all(...params),
        get: async (...params: (string | number | boolean | null | undefined)[]) => statement.get(...params),
        run: async (...params: (string | number | boolean | null | undefined)[]) => {
          const result = statement.run(...params)
          return { success: result.changes > 0, changes: result.changes, lastInsertRowid: result.lastInsertRowid }
        },
      }
    },
    dispose: () => native.close(),
  } as never)
  return { database, close: () => native.close() }
}

function tableExists(probe: NativeDatabase, name: string): boolean {
  const row = probe.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(name) as { name?: string } | undefined
  return Boolean(row?.name)
}

function countTable(probe: NativeDatabase, table: string): number {
  if (!tableExists(probe, table)) return 0
  const row = probe.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count?: number }
  return Number(row?.count ?? 0)
}

function snapshotArchiveCounts(probe: NativeDatabase): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const legacy of LEGACY_SOURCES) {
    if (tableExists(probe, legacy)) counts[legacy] = countTable(probe, legacy)
  }
  for (const retired of RETIRED_TABLES) {
    if (tableExists(probe, retired)) counts[retired] = countTable(probe, retired)
  }
  return counts
}

function assertPostMigration(probe: NativeDatabase, before: Record<string, number>) {
  const version = probe.prepare("SELECT schema_version FROM app_metadata").get() as { schema_version?: number }
  if (version?.schema_version !== 14) {
    throw new Error(`expected schema_version 14, got ${version?.schema_version}`)
  }

  const tables = probe.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE '_retired_%' ORDER BY name").all() as { name: string }[]
  const names = tables.map(row => row.name)
  if (names.length !== RETIRED_TABLES.length) {
    throw new Error(`expected ${RETIRED_TABLES.length} _retired_* tables, got ${names.length}: ${names.join(", ")}`)
  }
  for (const expected of RETIRED_TABLES) {
    if (!names.includes(expected)) throw new Error(`missing archived table ${expected}`)
  }

  for (const legacy of LEGACY_SOURCES) {
    const retired = `_retired_${legacy}`
    if (tableExists(probe, legacy)) {
      throw new Error(`legacy table still present after migration: ${legacy}`)
    }
    const beforeCount = before[legacy] ?? before[retired] ?? 0
    const afterCount = countTable(probe, retired)
    if (afterCount !== beforeCount) {
      throw new Error(`row count mismatch for ${retired}: before=${beforeCount} after=${afterCount}`)
    }
  }
}

export async function runR1MigrationCopyTest(copyDirArg: string) {
  const { dbPath } = resolveAllowedCopyDatabasePath(copyDirArg)
  const beforeProbe = new NativeDatabase(dbPath, { readonly: true })
  const beforeCounts = snapshotArchiveCounts(beforeProbe)
  beforeProbe.close()

  for (let pass = 1; pass <= 2; pass++) {
    const { database, close } = openDatabase(dbPath)
    const meta = await initializeShippingDatabase(database, "real")
    close()
    if (meta.schemaVersion !== 14) throw new Error(`pass ${pass}: expected schema 14, got ${meta.schemaVersion}`)
    console.log(`pass ${pass}: schemaVersion=${meta.schemaVersion}`)
  }

  const probe = new NativeDatabase(dbPath, { readonly: true })
  assertPostMigration(probe, beforeCounts)
  const afterCounts = snapshotArchiveCounts(probe)
  console.log("app_metadata.schema_version", 14)
  console.log("_retired_* tables:")
  for (const name of RETIRED_TABLES) console.log(`  ${name} rows=${afterCounts[name] ?? 0}`)
  probe.close()
  return { dbPath, beforeCounts, afterCounts }
}

const copyDir = process.argv[2]
if (!copyDir) {
  console.error("usage: r1-migration-copy-test.ts <copy-dir-under-.tmp>")
  process.exit(1)
}

runR1MigrationCopyTest(copyDir).catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
