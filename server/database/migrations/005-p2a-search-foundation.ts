import type { Database } from "db0"

export const p2aSearchFoundationMigration = {
  version: 5,
  name: "p2a-search-foundation",
  async up(db: Database) {
    await db.exec(`
      CREATE TABLE IF NOT EXISTS vessel_metadata (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        imo TEXT,
        mmsi TEXT,
        callsign TEXT,
        type TEXT,
        flag TEXT,
        source TEXT NOT NULL,
        fetched_at TEXT NOT NULL,
        source_type TEXT NOT NULL DEFAULT 'real' CHECK (source_type IN ('real', 'mock', 'imported', 'derived')),
        provider_record_id TEXT,
        data TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_vessel_metadata_name ON vessel_metadata(name COLLATE NOCASE);
      CREATE INDEX IF NOT EXISTS idx_vessel_metadata_imo ON vessel_metadata(imo);
      CREATE INDEX IF NOT EXISTS idx_vessel_metadata_mmsi ON vessel_metadata(mmsi);
      CREATE INDEX IF NOT EXISTS idx_vessel_metadata_callsign ON vessel_metadata(callsign COLLATE NOCASE);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_vessel_metadata_provider_record
        ON vessel_metadata(source, provider_record_id)
        WHERE provider_record_id IS NOT NULL;

      CREATE TABLE IF NOT EXISTS vessel_search_cache (
        search_key TEXT PRIMARY KEY,
        query TEXT NOT NULL,
        field TEXT NOT NULL CHECK (field IN ('name', 'imo', 'mmsi', 'callsign')),
        result_ids TEXT NOT NULL,
        provider_id TEXT NOT NULL,
        source_type TEXT NOT NULL DEFAULT 'real' CHECK (source_type IN ('real', 'mock', 'imported', 'derived')),
        fetched_at TEXT NOT NULL,
        expires_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_vessel_search_cache_expires ON vessel_search_cache(expires_at);
    `)
  },
} as const
