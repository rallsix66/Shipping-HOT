import { createHash } from "node:crypto"
import type { Database } from "db0"

/**
 * R3-8 RC: pending queue idempotency under concurrency.
 * Additive: candidate_fp column + partial unique index for open pending rows.
 *
 * Safe on v37 data: backfill candidate_fp from candidate_json (and id disambiguation)
 * BEFORE creating the unique index, so distinct legacy pending rows never collide on
 * IFNULL(NULL,"").
 */
function fpFromCandidateJson(candidateJson: string, id: string): string {
  const base = createHash("sha256").update(candidateJson || "", "utf8").digest("hex").slice(0, 32)
  return `${base}:${id}`
}

export const policyAutoPendingIdempotentMigration = {
  version: 38,
  name: "policy-auto-pending-idempotent",
  async up(db: Database) {
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

    // Drop legacy unsafe index name if a partial attempt created it without backfill.
    await db.exec(`DROP INDEX IF EXISTS idx_policy_auto_pending_idempotent`)

    // Unique on pending + candidate_fp only (fps are always populated above for existing rows;
    // new writers must set candidate_fp). Avoid IFNULL(NULL,"") collapsing distinct rows.
    await db.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_policy_auto_pending_idempotent
        ON policy_auto_pending(status, candidate_fp)
        WHERE status = 'pending' AND candidate_fp IS NOT NULL AND candidate_fp != ''
    `)
  },
} as const
