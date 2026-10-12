import type { Database } from "db0"

/**
 * R1.5-7 rework (dots 2026-10-12): per-direction relation kinds, scheduled supersession switch date, applicable time zone.
 * 015/016/017 are executed and not edited. The 017 single `relation_kind` column is kept but no longer written; it is
 * back-filled best-effort into both direction columns (it may already have been overwritten in a mixed chain).
 * Legacy rows get the single zone of their country; ID rows stay NULL (zone must be entered explicitly).
 */
const columns: [string, string][] = [
  ["supersedes_relation_kind", "TEXT NULL"],
  ["superseded_by_relation_kind", "TEXT NULL"],
  ["supersede_switch_at", "TEXT NULL"],
  ["supersede_switch_tz", "TEXT NULL"],
  ["applicable_timezone", "TEXT NULL"],
]

export const policyRelationsTimezoneMigration = {
  version: 18,
  name: "policy-relations-timezone",
  async up(db: Database) {
    const existing = new Set(((await db.prepare("PRAGMA table_info(policy_record)").all()) as { name: string }[]).map(c => c.name))
    for (const [name, type] of columns) {
      if (!existing.has(name)) await db.exec(`ALTER TABLE policy_record ADD COLUMN ${name} ${type}`)
    }
    await db.exec("UPDATE policy_record SET supersedes_relation_kind = relation_kind WHERE supersedes_policy_id IS NOT NULL AND supersedes_relation_kind IS NULL")
    await db.exec("UPDATE policy_record SET superseded_by_relation_kind = relation_kind WHERE superseded_by_policy_id IS NOT NULL AND superseded_by_relation_kind IS NULL")
    await db.exec(`UPDATE policy_record SET applicable_timezone = CASE country_code
      WHEN 'CN' THEN 'Asia/Shanghai' WHEN 'VN' THEN 'Asia/Ho_Chi_Minh' WHEN 'TH' THEN 'Asia/Bangkok'
      WHEN 'MY' THEN 'Asia/Kuala_Lumpur' WHEN 'PH' THEN 'Asia/Manila' ELSE NULL END
      WHERE applicable_timezone IS NULL`)
  },
}
