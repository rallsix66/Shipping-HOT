import type { Database } from "db0"

export const p3aAisTrackingMigration = {
  version: 7,
  name: "p3a-ais-tracking",
  async up(db: Database) {
    await db.exec(`
      CREATE TABLE IF NOT EXISTS ais_positions (
        id TEXT PRIMARY KEY,
        vessel_id TEXT NOT NULL,
        mmsi TEXT NOT NULL,
        latitude REAL NOT NULL,
        longitude REAL NOT NULL,
        speed REAL,
        course REAL,
        heading REAL,
        navigation_status TEXT,
        timestamp TEXT NOT NULL,
        source TEXT NOT NULL,
        source_type TEXT NOT NULL DEFAULT 'real' CHECK (source_type IN ('real', 'mock', 'imported', 'derived')),
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_ais_positions_vessel_timestamp ON ais_positions(vessel_id, timestamp DESC);
      CREATE INDEX IF NOT EXISTS idx_ais_positions_mmsi_timestamp ON ais_positions(mmsi, timestamp DESC);

      CREATE TABLE IF NOT EXISTS ais_latest_positions (
        vessel_id TEXT PRIMARY KEY,
        position_id TEXT NOT NULL,
        mmsi TEXT NOT NULL,
        latitude REAL NOT NULL,
        longitude REAL NOT NULL,
        speed REAL,
        course REAL,
        heading REAL,
        navigation_status TEXT,
        timestamp TEXT NOT NULL,
        source TEXT NOT NULL,
        source_type TEXT NOT NULL DEFAULT 'real' CHECK (source_type IN ('real', 'mock', 'imported', 'derived')),
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_ais_latest_positions_timestamp ON ais_latest_positions(timestamp);
    `)
  },
} as const
