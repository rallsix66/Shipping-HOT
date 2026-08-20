import type { Database } from "db0"

interface TableInfoRow {
  name?: string
}

async function hasColumn(db: Database, table: string, column: string) {
  const rows = await db.prepare(`PRAGMA table_info(${table})`).all() as TableInfoRow[]
  return rows.some(row => row.name === column)
}

export const watchlistIsolationMigration = {
  version: 2,
  name: "p0-watchlist-isolation",
  async up(db: Database) {
    if (await hasColumn(db, "vessels", "is_watched")) {
      await db.exec(`
        INSERT INTO vessel_watchlist (vessel_id, watched_at, ais_enabled)
          SELECT id, COALESCE(last_updated_at, CURRENT_TIMESTAMP), 1
          FROM vessels
          WHERE is_watched = 1
          ON CONFLICT(vessel_id) DO NOTHING;
        CREATE TABLE vessels_p0_new (
          id TEXT PRIMARY KEY,
          data TEXT NOT NULL,
          navigation_status TEXT NOT NULL,
          status_changed_at TEXT,
          last_updated_at TEXT
        );
        INSERT INTO vessels_p0_new (id, data, navigation_status, status_changed_at, last_updated_at)
          SELECT id, data, navigation_status, status_changed_at, last_updated_at FROM vessels;
        DROP TABLE vessels;
        ALTER TABLE vessels_p0_new RENAME TO vessels;
      `)
    }
    if (await hasColumn(db, "ports", "is_watched")) {
      await db.exec(`
        INSERT INTO port_watchlist (port_id, watched_at)
          SELECT id, COALESCE(last_updated_at, CURRENT_TIMESTAMP)
          FROM ports
          WHERE is_watched = 1
          ON CONFLICT(port_id) DO NOTHING;
        CREATE TABLE ports_p0_new (
          id TEXT PRIMARY KEY,
          data TEXT NOT NULL,
          congestion_level TEXT,
          last_updated_at TEXT
        );
        INSERT INTO ports_p0_new (id, data, congestion_level, last_updated_at)
          SELECT id, data, congestion_level, last_updated_at FROM ports;
        DROP TABLE ports;
        ALTER TABLE ports_p0_new RENAME TO ports;
      `)
    }
  },
} as const
