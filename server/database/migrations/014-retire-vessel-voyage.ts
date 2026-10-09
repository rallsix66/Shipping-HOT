import type { Database } from "db0"

// R1 retires vessel / AIS / voyage capabilities (ADR-006, plan §6 R1).
// Data is archived, not dropped: each vessel/voyage/AIS table is renamed with
// a `_retired_` prefix so user rows stay recoverable (see
// docs/archive/vessel-capability-recovery.md). The migration is idempotent and
// safe to re-run: a table is renamed only when the source table still exists
// and the `_retired_` target does not. Missing tables are skipped.
const retiredTables = [
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

async function tableExists(db: Database, name: string): Promise<boolean> {
  const row = await db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(name) as { name?: string } | undefined
  return Boolean(row?.name)
}

async function hasColumn(db: Database, table: string, column: string): Promise<boolean> {
  const rows = await db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name?: string }>
  return rows.some(row => row.name === column)
}

export const retireVesselVoyageMigration = {
  version: 14,
  name: "retire-vessel-voyage",
  async up(db: Database) {
    for (const table of retiredTables) {
      const retired = `_retired_${table}`
      if (await tableExists(db, retired)) continue
      if (!(await tableExists(db, table))) continue
      await db.exec(`ALTER TABLE ${table} RENAME TO ${retired}`)
    }
    // The feed_items.related_voyage_ids column is retired alongside voyages:
    // the FeedItem domain type no longer carries voyage linkage. Dropping the
    // orphaned NOT NULL column keeps inserts valid without any voyage-named
    // code in the product layer. Idempotent: skipped when already removed.
    if (await tableExists(db, "feed_items") && await hasColumn(db, "feed_items", "related_voyage_ids")) {
      await db.exec("ALTER TABLE feed_items DROP COLUMN related_voyage_ids")
    }
  },
} as const
