import type { Database } from "db0"

// R2 first slice (ADR-007: intel migrations are additive; 015–020 belong to R1.5, intel starts at 021).
// Per-source health and per-source run records. Job-level scheduling stays in BackgroundRuntime
// (sync_runs / provider_runtime); these tables only add the per-source detail the plan requires.
export const intelSourceRunsMigration = {
  version: 21,
  name: "intel-source-runs",
  async up(db: Database) {
    await db.exec(`
      CREATE TABLE IF NOT EXISTS intel_source (
        id TEXT PRIMARY KEY,
        catalog_id TEXT NOT NULL,
        name TEXT NOT NULL,
        kind TEXT NOT NULL CHECK (kind IN ('rss', 'atom', 'rdf')),
        url TEXT NOT NULL,
        persistence TEXT NOT NULL CHECK (persistence IN ('full', 'excerpt_only', 'disallowed')),
        enabled INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'never_run' CHECK (status IN ('never_run', 'ok', 'ok_empty', 'failing')),
        consecutive_failures INTEGER NOT NULL DEFAULT 0,
        next_sync_at TEXT NULL,
        last_run_at TEXT NULL,
        last_ok_at TEXT NULL,
        last_error_code TEXT NULL,
        updated_at TEXT NOT NULL
      )
    `)
    await db.exec("CREATE INDEX IF NOT EXISTS idx_intel_source_next_sync ON intel_source(enabled, next_sync_at)")
    await db.exec(`
      CREATE TABLE IF NOT EXISTS intel_fetch_run (
        id TEXT PRIMARY KEY,
        source_id TEXT NOT NULL,
        started_at TEXT NOT NULL,
        finished_at TEXT NULL,
        status TEXT NOT NULL CHECK (status IN ('running', 'ok_items', 'ok_empty', 'failed')),
        items_seen INTEGER NOT NULL DEFAULT 0,
        items_new INTEGER NOT NULL DEFAULT 0,
        items_revised INTEGER NOT NULL DEFAULT 0,
        error_code TEXT NULL,
        error_message TEXT NULL
      )
    `)
    await db.exec("CREATE INDEX IF NOT EXISTS idx_intel_fetch_run_source ON intel_fetch_run(source_id, started_at)")
    // At most one in-flight run per source: the DB-level guard behind BackgroundRuntime's in-process guard.
    await db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_intel_fetch_run_one_running ON intel_fetch_run(source_id) WHERE status = 'running'")
  },
} as const
