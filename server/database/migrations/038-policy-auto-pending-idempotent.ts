import type { Database } from "db0"

/**
 * R3-8 RC: pending queue idempotency under concurrency.
 * Additive: candidate_fp column + partial unique index for open pending rows.
 */
export const policyAutoPendingIdempotentMigration = {
  version: 38,
  name: "policy-auto-pending-idempotent",
  async up(db: Database) {
    const cols = ((await db.prepare("PRAGMA table_info(policy_auto_pending)").all()) as Array<{ name: string }>).map(c => c.name)
    if (!cols.includes("candidate_fp")) {
      await db.exec("ALTER TABLE policy_auto_pending ADD COLUMN candidate_fp TEXT")
    }
    await db.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_policy_auto_pending_idempotent
        ON policy_auto_pending(status, country_code, IFNULL(publisher, ''), IFNULL(document_number, ''), reason, IFNULL(candidate_fp, ''))
        WHERE status = 'pending'
    `)
  },
} as const
