import { createHash } from "node:crypto"
import type { Database } from "db0"

/**
 * R3-8 RC2: repair v38 unique index for databases that already applied the first
 * idx_policy_auto_pending_idempotent (IFNULL(candidate_fp,"") form). Idempotent.
 * Preserves pending rows + audits; does not delete migration history or rebuild DB.
 */
function fpFromCandidateJson(candidateJson: string, id: string): string {
  const base = createHash("sha256").update(candidateJson || "", "utf8").digest("hex").slice(0, 32)
  return `${base}:${id}`
}

export const policyAutoPendingIdempotentRepairMigration = {
  version: 39,
  name: "policy-auto-pending-idempotent-repair",
  async up(db: Database) {
    const tables = (await db.prepare(
      `SELECT name FROM sqlite_master WHERE type='table' AND name='policy_auto_pending'`,
    ).all()) as Array<{ name: string }>
    if (tables.length === 0) return

    const cols = ((await db.prepare("PRAGMA table_info(policy_auto_pending)").all()) as Array<{ name: string }>).map(c => c.name)
    if (!cols.includes("candidate_fp")) {
      await db.exec("ALTER TABLE policy_auto_pending ADD COLUMN candidate_fp TEXT")
    }

    const rows = (await db.prepare(
      `SELECT id, candidate_json, candidate_fp FROM policy_auto_pending`,
    ).all()) as Array<{ id: string, candidate_json: string | null, candidate_fp: string | null }>

    for (const row of rows) {
      if (row.candidate_fp && String(row.candidate_fp).length > 0) continue
      const fp = fpFromCandidateJson(String(row.candidate_json ?? ""), String(row.id))
      await db.prepare(`UPDATE policy_auto_pending SET candidate_fp = ? WHERE id = ?`).run(fp, row.id)
    }

    await db.exec(`DROP INDEX IF EXISTS idx_policy_auto_pending_idempotent`)
    await db.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_policy_auto_pending_idempotent
        ON policy_auto_pending(status, candidate_fp)
        WHERE status = 'pending' AND candidate_fp IS NOT NULL AND candidate_fp != ''
    `)
  },
} as const
