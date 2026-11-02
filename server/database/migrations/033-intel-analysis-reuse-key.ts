import type { Database } from "db0"

async function hasColumn(db: Database, table: string, column: string): Promise<boolean> {
  const rows = await db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name?: string }>
  return Array.isArray(rows) && rows.some(row => row.name === column)
}

/**
 * R3-1 analysis reuse identity: additive reuse_key for intel_analysis.
 *
 * Compatible with both shapes that may already be recorded as schema v32:
 * - original 032 (3fde142): table without reuse_key, dedupe index on model_id+prompt_hash
 * - amended 032 (802d997): table already has reuse_key column
 *
 * Never deletes analysis rows. Idempotent. Index replaced under a new name so
 * CREATE INDEX IF NOT EXISTS cannot leave the old column list in place.
 */
export const intelAnalysisReuseKeyMigration = {
  version: 33,
  name: "intel-analysis-reuse-key",
  async up(db: Database) {
    // Ensure table exists (fresh path already created it in 032; defensive for odd restore).
    await db.exec(`
      CREATE TABLE IF NOT EXISTS intel_analysis (
        id TEXT PRIMARY KEY,
        item_id TEXT NOT NULL,
        version_id TEXT NOT NULL,
        content_hash TEXT NOT NULL,
        step TEXT NOT NULL CHECK (step IN (
          'prefilter', 'extract', 'severity', 'severity_tiebreak'
        )),
        attempt_index INTEGER NOT NULL DEFAULT 1 CHECK (attempt_index >= 1),
        status TEXT NOT NULL CHECK (status IN (
          'completed', 'failed', 'unknown', 'denied', 'skipped', 'reused'
        )),
        provider_id TEXT NULL,
        model_id TEXT NULL,
        model_name TEXT NULL,
        prompt_hash TEXT NULL,
        reuse_key TEXT NULL,
        output_json TEXT NULL,
        provenance TEXT NOT NULL CHECK (provenance IN ('ai', 'system')),
        basis TEXT NOT NULL,
        receipt_id TEXT NULL,
        error_code TEXT NULL,
        created_at TEXT NOT NULL
      )
    `)

    if (!(await hasColumn(db, "intel_analysis", "reuse_key"))) {
      await db.exec("ALTER TABLE intel_analysis ADD COLUMN reuse_key TEXT NULL")
    }

    await db.exec("CREATE INDEX IF NOT EXISTS idx_intel_analysis_item_version ON intel_analysis(item_id, version_id, step, created_at)")
    // New dedupe index keyed by reuse_key. Drop legacy name so IF NOT EXISTS cannot preserve old columns.
    await db.exec("DROP INDEX IF EXISTS idx_intel_analysis_dedupe")
    await db.exec("DROP INDEX IF EXISTS idx_intel_analysis_reuse_dedupe")
    await db.exec("CREATE INDEX IF NOT EXISTS idx_intel_analysis_reuse_dedupe ON intel_analysis(item_id, version_id, step, reuse_key, content_hash, status)")
  },
} as const
