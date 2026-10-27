/**
 * Shared LLM monthly budget aggregation (ADR-007 / R3-1).
 * Sums estimated_cost across ALL providers and capabilities in the UTC month window,
 * plus unbooked pending/unknown attempt reservations. Does not auto-release unknown/pending.
 */
import type { Database } from "db0"
import { paidBudgetWindow } from "#/services/paid-budget"

export interface AggregateSpendBreakdown {
  usageSpend: number
  pendingReserve: number
  total: number
  windowFrom: string
  windowTo: string
}

/**
 * Cross-provider × capability month spend used by the shared paid gate.
 * Pending/unknown with usage_recorded = 0 remain reserved forever until booked —
 * never auto-released or retried by this helper.
 */
export async function aggregatePaidMonthSpend(db: Database, now: Date = new Date()): Promise<AggregateSpendBreakdown> {
  const window = paidBudgetWindow(now)
  const usage = await db.prepare(`
    SELECT COALESCE(SUM(estimated_cost), 0) AS spend
    FROM provider_usage
    WHERE window_start >= ? AND window_start < ?
  `).get(window.from, window.to) as { spend: number }
  const pending = await db.prepare(`
    SELECT COALESCE(SUM(estimated_cost), 0) AS spend
    FROM paid_receipt_attempt
    WHERE usage_recorded = 0
      AND status IN ('pending', 'unknown')
      AND started_at >= ? AND started_at < ?
  `).get(window.from, window.to) as { spend: number }
  const usageSpend = Number(usage.spend)
  const pendingReserve = Number(pending.spend)
  return {
    usageSpend,
    pendingReserve,
    total: usageSpend + pendingReserve,
    windowFrom: window.from,
    windowTo: window.to,
  }
}
