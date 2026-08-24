import type { Database } from "db0"

export const p2cRuntimeFoundationMigration = {
  version: 6,
  name: "p2c-runtime-foundation",
  async up(db: Database) {
    await db.exec(`
      DROP TABLE IF EXISTS provider_runtime_rebuild;

      CREATE TABLE provider_runtime_rebuild (
        provider_id TEXT NOT NULL,
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
        updated_at TEXT NOT NULL,
        PRIMARY KEY (provider_id, capability)
      );

      INSERT INTO provider_runtime_rebuild (
        provider_id, capability, status, last_request_at, last_success_at, last_failure_at,
        last_source_updated_at, last_fetched_at, cache_age_seconds, ttl_seconds, next_sync_at,
        consecutive_failures, error_code, error_message, rate_limit_reset_at, data_count,
        coverage_json, updated_at
      )
      SELECT
        provider_id, capability, status, last_request_at, last_success_at, last_failure_at,
        last_source_updated_at, last_fetched_at, cache_age_seconds, ttl_seconds, next_sync_at,
        consecutive_failures, error_code, error_message, rate_limit_reset_at, data_count,
        coverage_json, updated_at
      FROM provider_runtime;

      DROP TABLE provider_runtime;
      ALTER TABLE provider_runtime_rebuild RENAME TO provider_runtime;
      CREATE INDEX IF NOT EXISTS idx_provider_runtime_next_sync ON provider_runtime(next_sync_at);
    `)
  },
} as const
