import type { Database } from "db0"

/**
 * R3-8 (offline only): durable auto-apply pending queue + source/model/prompt audit.
 * Additive. Does not change manual policy_record write path semantics.
 */
export const policyAutoMigration = {
  version: 37,
  name: "policy-auto",
  async up(db: Database) {
    await db.exec(`
      CREATE TABLE IF NOT EXISTS policy_auto_pending (
        id TEXT PRIMARY KEY,
        country_code TEXT NOT NULL,
        publisher TEXT,
        document_number TEXT,
        reason TEXT NOT NULL,
        candidate_json TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        created_at TEXT NOT NULL,
        resolved_at TEXT,
        resolved_policy_id TEXT
      )
    `)
    await db.exec(`
      CREATE INDEX IF NOT EXISTS idx_policy_auto_pending_status
        ON policy_auto_pending(status, created_at)
    `)
    await db.exec(`
      CREATE TABLE IF NOT EXISTS policy_auto_audit (
        id TEXT PRIMARY KEY,
        policy_id TEXT,
        version_id TEXT,
        outcome TEXT NOT NULL,
        reason TEXT,
        analysis_ids_json TEXT,
        model_id TEXT,
        model_name TEXT,
        prompt_hash TEXT,
        intel_item_id TEXT,
        intel_version_id TEXT,
        content_hash TEXT,
        source_url TEXT,
        detail_json TEXT,
        created_at TEXT NOT NULL
      )
    `)
    await db.exec(`
      CREATE INDEX IF NOT EXISTS idx_policy_auto_audit_policy
        ON policy_auto_audit(policy_id, created_at)
    `)
  },
} as const
