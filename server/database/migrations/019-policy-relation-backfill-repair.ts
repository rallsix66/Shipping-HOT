import type { Database } from "db0"

/**
 * Repair for the 018 backfill (dots 2026-10-12, test-DB upgrade path). 018 copied the single legacy 017 `relation_kind`
 * into both direction columns. In 017 the last writer of a row's relation_kind is its successor, so:
 * - inbound (superseded_by_relation_kind) = the row's own legacy relation_kind (unchanged from 018);
 * - outbound (supersedes_relation_kind) is recovered from the matching predecessor's legacy relation_kind
 *   (predecessor.superseded_by_policy_id = this row); if no matching predecessor exists, it is marked 'unknown'.
 * Only legacy rows (relation_kind IS NOT NULL) are touched; rows written by 018+ code never set relation_kind.
 * 018 is executed and not edited; versions and change log are not touched.
 */
export const policyRelationBackfillRepairMigration = {
  version: 19,
  name: "policy-relation-backfill-repair",
  async up(db: Database) {
    await db.exec(`UPDATE policy_record SET supersedes_relation_kind = COALESCE(
        (SELECT p.relation_kind FROM policy_record p
          WHERE p.id = policy_record.supersedes_policy_id AND p.superseded_by_policy_id = policy_record.id
            AND p.relation_kind IN ('revised', 'repealed')),
        'unknown')
      WHERE relation_kind IS NOT NULL AND supersedes_policy_id IS NOT NULL`)
    await db.exec(`UPDATE policy_record SET superseded_by_relation_kind = CASE WHEN relation_kind IN ('revised', 'repealed') THEN relation_kind ELSE 'unknown' END
      WHERE relation_kind IS NOT NULL AND superseded_by_policy_id IS NOT NULL`)
  },
}
