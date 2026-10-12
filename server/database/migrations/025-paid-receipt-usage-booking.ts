import type { Database } from "db0"

async function hasColumn(db: Database, table: string, column: string): Promise<boolean> {
  const rows = await db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name?: string }>
  return rows.some(row => row.name === column)
}

// R2-3 review repair (additive): every attempt that may have been billed is booked into provider_usage exactly once.
// usage_recorded = 1 once booked. Backfill is conservative: received/failed rows were booked by 024 code; unknown rows
// stay 0, so the estimated budget gate keeps counting their reservation (never released; may double-count legacy
// timeout rows, which only tightens the gate).
export const paidReceiptUsageBookingMigration = {
  version: 25,
  name: "paid-receipt-usage-booking",
  async up(db: Database) {
    if (!(await hasColumn(db, "paid_receipt_attempt", "usage_recorded"))) {
      await db.exec("ALTER TABLE paid_receipt_attempt ADD COLUMN usage_recorded INTEGER NOT NULL DEFAULT 0")
      await db.exec("UPDATE paid_receipt_attempt SET usage_recorded = 1 WHERE status IN ('received', 'failed')")
    }
    await db.exec("CREATE INDEX IF NOT EXISTS idx_paid_receipt_attempt_unbooked ON paid_receipt_attempt(provider_id, capability, usage_recorded, status, started_at)")
  },
} as const
