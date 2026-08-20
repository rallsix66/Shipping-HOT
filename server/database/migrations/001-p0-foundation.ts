import type { Database } from "db0"

export const p0FoundationMigration = {
  version: 1,
  name: "p0-foundation",
  async up(db: Database) {
    await db.exec(`
      CREATE TABLE IF NOT EXISTS app_metadata (
        id TEXT PRIMARY KEY,
        schema_version INTEGER NOT NULL,
        bootstrap_completed_at TEXT,
        database_id TEXT NOT NULL,
        last_migration_at TEXT NOT NULL,
        data_mode TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS port_directory_status (
        id TEXT PRIMARY KEY,
        port_directory_status TEXT NOT NULL DEFAULT 'pending',
        port_directory_version TEXT,
        port_directory_imported_at TEXT
      );

      CREATE TABLE IF NOT EXISTS user (
        id TEXT PRIMARY KEY,
        email TEXT,
        data TEXT,
        type TEXT,
        created INTEGER,
        updated INTEGER
      );

      CREATE TABLE IF NOT EXISTS settings (
        id TEXT PRIMARY KEY,
        data TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS feed_items (
        id TEXT PRIMARY KEY,
        source_id TEXT NOT NULL,
        category TEXT NOT NULL,
        type TEXT NOT NULL,
        title TEXT NOT NULL,
        summary TEXT NOT NULL,
        source_url TEXT NOT NULL,
        published_at TEXT NOT NULL,
        fetched_at TEXT NOT NULL,
        severity TEXT NOT NULL,
        related_port_ids TEXT NOT NULL,
        related_vessel_ids TEXT NOT NULL,
        related_voyage_ids TEXT NOT NULL,
        data TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS vessels (
        id TEXT PRIMARY KEY,
        data TEXT NOT NULL,
        navigation_status TEXT NOT NULL,
        status_changed_at TEXT,
        last_updated_at TEXT
      );

      CREATE TABLE IF NOT EXISTS ports (
        id TEXT PRIMARY KEY,
        data TEXT NOT NULL,
        congestion_level TEXT,
        last_updated_at TEXT
      );

      CREATE TABLE IF NOT EXISTS vessel_watchlist (
        vessel_id TEXT PRIMARY KEY,
        watched_at TEXT NOT NULL,
        ais_enabled INTEGER NOT NULL DEFAULT 1
      );

      CREATE TABLE IF NOT EXISTS port_watchlist (
        port_id TEXT PRIMARY KEY,
        watched_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS voyages (
        id TEXT PRIMARY KEY,
        data TEXT NOT NULL,
        vessel_id TEXT NOT NULL,
        baseline_etd TEXT,
        baseline_eta TEXT,
        latest_etd TEXT,
        latest_eta TEXT,
        delay_minutes INTEGER
      );

      CREATE TABLE IF NOT EXISTS events (
        id TEXT PRIMARY KEY,
        data TEXT NOT NULL,
        type TEXT NOT NULL,
        severity TEXT NOT NULL,
        status TEXT NOT NULL,
        dedupe_key TEXT NOT NULL UNIQUE,
        first_detected_at TEXT NOT NULL,
        last_detected_at TEXT NOT NULL,
        resolved_at TEXT
      );

      CREATE TABLE IF NOT EXISTS calendar_events (
        id TEXT PRIMARY KEY,
        country_code TEXT NOT NULL,
        subdivision_code TEXT,
        date TEXT NOT NULL,
        end_date TEXT,
        type TEXT NOT NULL,
        is_public_holiday INTEGER NOT NULL,
        business_impact TEXT NOT NULL,
        source_id TEXT NOT NULL,
        source_url TEXT,
        verified INTEGER NOT NULL,
        last_checked_at TEXT NOT NULL,
        updated_at TEXT,
        stale INTEGER NOT NULL,
        data TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS ais_port_metrics (
        port_id TEXT PRIMARY KEY,
        data TEXT NOT NULL,
        updated_at TEXT
      );

      CREATE TABLE IF NOT EXISTS translation_cache (
        id TEXT PRIMARY KEY,
        entity_type TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        field_name TEXT NOT NULL,
        source_text TEXT NOT NULL,
        source_hash TEXT NOT NULL,
        source_language TEXT,
        target_language TEXT NOT NULL,
        provider TEXT NOT NULL,
        model TEXT NOT NULL,
        translated_text TEXT,
        translated_at TEXT,
        status TEXT NOT NULL,
        error_message TEXT,
        preferred INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (entity_type, entity_id, field_name, source_hash, target_language, provider, model)
      );

      CREATE TABLE IF NOT EXISTS provider_usage (
        id TEXT PRIMARY KEY,
        provider_id TEXT NOT NULL,
        capability TEXT NOT NULL,
        window_start TEXT NOT NULL,
        request_count INTEGER NOT NULL DEFAULT 0,
        success_count INTEGER NOT NULL DEFAULT 0,
        failure_count INTEGER NOT NULL DEFAULT 0,
        cache_hit_count INTEGER NOT NULL DEFAULT 0,
        characters_in INTEGER,
        characters_out INTEGER,
        tokens_in INTEGER,
        tokens_out INTEGER,
        estimated_cost REAL,
        currency TEXT,
        pricing_reference TEXT,
        source_scope TEXT,
        last_called_at TEXT,
        error_code TEXT
      );

      CREATE TABLE IF NOT EXISTS provider_runtime (
        provider_id TEXT PRIMARY KEY,
        capability TEXT NOT NULL,
        status TEXT NOT NULL,
        last_request_at TEXT,
        last_success_at TEXT,
        last_failure_at TEXT,
        last_source_updated_at TEXT,
        last_fetched_at TEXT,
        cache_age_seconds INTEGER,
        ttl_seconds INTEGER,
        next_sync_at TEXT,
        consecutive_failures INTEGER NOT NULL DEFAULT 0,
        error_code TEXT,
        error_message TEXT,
        rate_limit_reset_at TEXT,
        data_count INTEGER,
        coverage_json TEXT,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS sync_runs (
        id TEXT PRIMARY KEY,
        provider_id TEXT NOT NULL,
        capability TEXT NOT NULL,
        started_at TEXT NOT NULL,
        completed_at TEXT,
        status TEXT NOT NULL,
        records_read INTEGER,
        records_written INTEGER,
        error_code TEXT,
        error_message TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_feed_items_published_at ON feed_items(published_at);
      CREATE INDEX IF NOT EXISTS idx_events_last_detected_at ON events(last_detected_at);
      CREATE INDEX IF NOT EXISTS idx_translation_cache_lookup ON translation_cache(entity_type, entity_id, field_name, source_hash, target_language);
      CREATE INDEX IF NOT EXISTS idx_provider_usage_window ON provider_usage(provider_id, capability, window_start);
      CREATE INDEX IF NOT EXISTS idx_sync_runs_provider_started ON sync_runs(provider_id, started_at);

    `)
  },
} as const
