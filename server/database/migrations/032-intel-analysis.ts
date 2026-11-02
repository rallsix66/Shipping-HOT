import type { Database } from "db0"

/**
 * R3-1 offline intel analysis persistence (ADR-007 / plan section 4.1-4.2).
 * Append-only analysis rows: material version, step, model, prompt hash, reuse_key, provenance/basis.
 * Additive and idempotent. No budgets table.
 */
export const intelAnalysisMigration = {
  version: 32,
  name: "intel-analysis",
  async up(db: Database) {
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
    // Idempotent column add for DBs that created an earlier 032 shape without reuse_key.
    const cols = await db.prepare("PRAGMA table_info(intel_analysis)").all() as Array<{ name: string }>
    if (Array.isArray(cols) && cols.length > 0 && !cols.some(c => c.name === "reuse_key")) {
      await db.exec("ALTER TABLE intel_analysis ADD COLUMN reuse_key TEXT NULL")
    }
    await db.exec("CREATE INDEX IF NOT EXISTS idx_intel_analysis_item_version ON intel_analysis(item_id, version_id, step, created_at)")
    await db.exec("CREATE INDEX IF NOT EXISTS idx_intel_analysis_dedupe ON intel_analysis(item_id, version_id, step, reuse_key, content_hash, status)")
  },
} as const
