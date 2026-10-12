import type { Database } from "db0"

/**
 * Repair for 019 on mixed-version databases (dots 2026-10-12 12:24). A legacy (017) row keeps its stale single
 * `relation_kind`; if a post-v18 successor later superseded it, 018+ code wrote the correct superseded_by_relation_kind
 * together with supersede_switch_at, but 019 overwrote it from the stale legacy column.
 * Post-v18 relations are recognised by supersede_switch_at IS NOT NULL (018+ code always sets it; legacy rows never have it).
 * For those rows the inbound kind is recovered only from consistent evidence, in order:
 *   1. the successor's supersedes_relation_kind when the successor links back (successor.supersedes_policy_id = row.id);
 *   2. the row's own latest revise_scheduled / repeal_scheduled change-log entry naming that successor;
 *   otherwise 'unknown'. Versions and change-log text are never modified. 019 is executed and not edited.
 */
export const policyRelationMixedVersionRepairMigration = {
  version: 20,
  name: "policy-relation-mixed-version-repair",
  async up(db: Database) {
    await db.exec(`UPDATE policy_record SET superseded_by_relation_kind = COALESCE(
        (SELECT s.supersedes_relation_kind FROM policy_record s
          WHERE s.id = policy_record.superseded_by_policy_id AND s.supersedes_policy_id = policy_record.id
            AND s.supersedes_relation_kind IN ('revised', 'repealed')),
        (SELECT CASE l.action WHEN 'revise_scheduled' THEN 'revised' WHEN 'repeal_scheduled' THEN 'repealed' END
          FROM policy_change_log l
          WHERE l.policy_id = policy_record.id AND l.action IN ('revise_scheduled', 'repeal_scheduled')
            AND instr(l.summary, policy_record.superseded_by_policy_id) > 0
          ORDER BY l.created_at DESC, l.rowid DESC LIMIT 1),
        'unknown')
      WHERE relation_kind IS NOT NULL AND superseded_by_policy_id IS NOT NULL AND supersede_switch_at IS NOT NULL`)
  },
}
