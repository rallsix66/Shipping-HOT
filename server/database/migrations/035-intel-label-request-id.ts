import type { Database } from "db0"

/**
 * R3 §4.9 RC: real client_request_id idempotency for human label decisions.
 * Additive only — unique per (label_item_id, client_request_id) when set.
 */
export const intelLabelRequestIdMigration = {
  version: 35,
  name: "intel-label-request-id",
  async up(db: Database) {
    await db.exec(`
      ALTER TABLE intel_label_decision
        ADD COLUMN client_request_id TEXT NULL
    `)
    await db.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_intel_label_decision_request
        ON intel_label_decision(label_item_id, client_request_id)
        WHERE client_request_id IS NOT NULL
    `)
  },
} as const
