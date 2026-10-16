import type { Database } from "db0"

// R2-3 paid receipts (adapted from AIHOT@44578fa 0001_core `receipts` + 0022/0033 `receipt_attempts`, SQLite form).
// - paid_receipt: one logical paid request, unique logical_key; reused once received.
// - paid_receipt_attempt: every request actually sent; budget reservations count pending attempts.
// - Costs: estimated_cost and actual_cost are separate columns. actual_cost is set only from a provider receipt
//   (cost_basis = 'actual'); without one it stays NULL and is never reported as a known actual cost.
// - No budgets table: the budget decision is the existing one (server/services/paid-budget.ts) over provider_usage.
export const paidReceiptMigration = {
  version: 24,
  name: "paid-receipt",
  async up(db: Database) {
    await db.exec(`
      CREATE TABLE IF NOT EXISTS paid_receipt (
        id TEXT PRIMARY KEY,
        logical_key TEXT NOT NULL UNIQUE,
        provider_id TEXT NOT NULL,
        capability TEXT NOT NULL,
        model TEXT NULL,
        purpose TEXT NOT NULL,
        subject TEXT NULL,
        status TEXT NOT NULL CHECK (status IN ('pending', 'received', 'completed', 'failed', 'unknown')),
        request TEXT NULL,
        response TEXT NULL,
        request_id TEXT NULL,
        usage TEXT NULL,
        estimated_cost REAL NULL,
        actual_cost REAL NULL,
        currency TEXT NULL,
        cost_basis TEXT NULL CHECK (cost_basis IS NULL OR cost_basis IN ('actual', 'estimated')),
        error TEXT NULL,
        attempts INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        received_at TEXT NULL,
        completed_at TEXT NULL,
        updated_at TEXT NOT NULL,
        CHECK ((cost_basis IS 'actual' AND actual_cost IS NOT NULL) OR (cost_basis IS NOT 'actual' AND actual_cost IS NULL))
      )
    `)
    await db.exec("CREATE INDEX IF NOT EXISTS idx_paid_receipt_status ON paid_receipt(status, updated_at)")
    await db.exec(`
      CREATE TABLE IF NOT EXISTS paid_receipt_attempt (
        id TEXT PRIMARY KEY,
        receipt_id TEXT NOT NULL REFERENCES paid_receipt(id) ON DELETE CASCADE,
        attempt INTEGER NOT NULL,
        provider_id TEXT NOT NULL,
        capability TEXT NOT NULL,
        model TEXT NULL,
        status TEXT NOT NULL CHECK (status IN ('pending', 'received', 'failed', 'unknown')),
        request_id TEXT NULL,
        usage TEXT NULL,
        estimated_cost REAL NOT NULL DEFAULT 0,
        actual_cost REAL NULL,
        currency TEXT NULL,
        cost_basis TEXT NULL CHECK (cost_basis IS NULL OR cost_basis IN ('actual', 'estimated')),
        latency_ms INTEGER NULL,
        error TEXT NULL,
        started_at TEXT NOT NULL,
        finished_at TEXT NULL,
        UNIQUE (receipt_id, attempt),
        CHECK ((cost_basis IS 'actual' AND actual_cost IS NOT NULL) OR (cost_basis IS NOT 'actual' AND actual_cost IS NULL))
      )
    `)
    await db.exec("CREATE INDEX IF NOT EXISTS idx_paid_receipt_attempt_budget ON paid_receipt_attempt(provider_id, capability, status, started_at)")
  },
} as const
