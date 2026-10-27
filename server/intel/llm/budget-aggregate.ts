/**
 * Scoped paid monthly budget aggregation (R3-1 / ADR-007 helper).
 *
 * Does NOT replace per-provider×capability gates (ADR-011 Search/Fetch independent budgets).
 * Callers that need a multi-capability pool must pass an explicit { currency, capabilities? }.
 * Cross-currency numeric sum is forbidden; unknown/mismatched currency → fail-closed (no FX network).
 * Pending/unknown with usage_recorded = 0 stay reserved (never auto-released here).
 *
 * Translation paid path wires through paidRequest(sharedBudget),
 * which calls this helper inside BEGIN IMMEDIATE; this module itself is never a standalone execution gate.
 */
import type { Database } from "db0"
import { paidBudgetWindow } from "#/services/paid-budget"

const CURRENCY_RE = /^[A-Z]{3}$/

export interface BudgetAggregateScope {
  /** ISO 4217; required — no implicit FX. */
  currency: string
  /** When set, only these capabilities are included. */
  capabilities?: readonly string[]
  /** When set, only these provider_ids are included. */
  providerIds?: readonly string[]
}

export interface AggregateSpendBreakdown {
  usageSpend: number
  pendingReserve: number
  total: number
  currency: string
  windowFrom: string
  windowTo: string
  scope: BudgetAggregateScope
}

export class BudgetAggregateError extends Error {
  readonly code: "budget_scope_invalid" | "budget_currency_unknown" | "budget_currency_mixed"
  constructor(code: BudgetAggregateError["code"], message?: string) {
    super(message ?? code)
    this.name = "BudgetAggregateError"
    this.code = code
  }
}

function assertScope(scope: BudgetAggregateScope): BudgetAggregateScope {
  if (!scope || typeof scope !== "object") throw new BudgetAggregateError("budget_scope_invalid")
  if (typeof scope.currency !== "string" || !CURRENCY_RE.test(scope.currency)) {
    throw new BudgetAggregateError("budget_currency_unknown", `currency required as ISO 4217, got ${String(scope?.currency)}`)
  }
  if (scope.capabilities !== undefined) {
    if (!Array.isArray(scope.capabilities) || scope.capabilities.length === 0 || scope.capabilities.some(c => typeof c !== "string" || !c)) {
      throw new BudgetAggregateError("budget_scope_invalid", "capabilities must be non-empty strings when provided")
    }
  }
  if (scope.providerIds !== undefined) {
    if (!Array.isArray(scope.providerIds) || scope.providerIds.length === 0 || scope.providerIds.some(c => typeof c !== "string" || !c)) {
      throw new BudgetAggregateError("budget_scope_invalid", "providerIds must be non-empty strings when provided")
    }
  }
  return scope
}

function placeholders(count: number): string {
  return Array.from({ length: count }, () => "?").join(", ")
}

/**
 * When an explicit capability/provider domain is requested, refuse to pretend mixed/blank
 * currencies can share one numeric pool. Unscoped currency totals simply filter to the
 * requested ISO code (other currencies are out of scope, not converted).
 */
async function assertDomainCurrencyConsistent(
  db: Database,
  source: "provider_usage" | "paid_receipt_attempt",
  sql: string,
  params: Array<string | number>,
  expected: string,
): Promise<void> {
  const rows = await db.prepare(sql).all(...params) as Array<{ currency: string | null }>
  for (const row of rows) {
    if (!row.currency || !CURRENCY_RE.test(row.currency)) {
      throw new BudgetAggregateError("budget_currency_unknown", `${source} row missing/invalid currency: ${String(row.currency)}`)
    }
    if (row.currency !== expected) {
      throw new BudgetAggregateError("budget_currency_mixed", `${source} has ${row.currency} in scope requesting ${expected}`)
    }
  }
}

/**
 * Sum estimated_cost for one currency (+ optional capability/provider filters) in the UTC month.
 */
export async function aggregatePaidMonthSpend(
  db: Database,
  scope: BudgetAggregateScope,
  now: Date = new Date(),
): Promise<AggregateSpendBreakdown> {
  const normalized = assertScope(scope)
  const window = paidBudgetWindow(now)
  const domainFilter = Boolean(normalized.capabilities?.length || normalized.providerIds?.length)

  const usageWhere = ["window_start >= ?", "window_start < ?"]
  const usageParams: Array<string | number> = [window.from, window.to]
  if (normalized.capabilities?.length) {
    usageWhere.push(`capability IN (${placeholders(normalized.capabilities.length)})`)
    usageParams.push(...normalized.capabilities)
  }
  if (normalized.providerIds?.length) {
    usageWhere.push(`provider_id IN (${placeholders(normalized.providerIds.length)})`)
    usageParams.push(...normalized.providerIds)
  }

  if (domainFilter) {
    await assertDomainCurrencyConsistent(
      db,
      "provider_usage",
      `SELECT DISTINCT currency AS currency FROM provider_usage WHERE ${usageWhere.join(" AND ")}`,
      usageParams,
      normalized.currency,
    )
  }

  const usageSumWhere = [...usageWhere, "currency = ?"]
  const usageSumParams = [...usageParams, normalized.currency]
  const usageRow = await db.prepare(`
    SELECT COALESCE(SUM(estimated_cost), 0) AS spend
    FROM provider_usage
    WHERE ${usageSumWhere.join(" AND ")}
  `).get(...usageSumParams) as { spend: number }

  const pendingWhere = [
    "a.usage_recorded = 0",
    "a.status IN ('pending', 'unknown')",
    "a.started_at >= ?",
    "a.started_at < ?",
  ]
  const pendingParams: Array<string | number> = [window.from, window.to]
  if (normalized.capabilities?.length) {
    pendingWhere.push(`a.capability IN (${placeholders(normalized.capabilities.length)})`)
    pendingParams.push(...normalized.capabilities)
  }
  if (normalized.providerIds?.length) {
    pendingWhere.push(`a.provider_id IN (${placeholders(normalized.providerIds.length)})`)
    pendingParams.push(...normalized.providerIds)
  }

  if (domainFilter) {
    await assertDomainCurrencyConsistent(
      db,
      "paid_receipt_attempt",
      `SELECT DISTINCT COALESCE(a.currency, r.currency) AS currency
       FROM paid_receipt_attempt a
       LEFT JOIN paid_receipt r ON r.id = a.receipt_id
       WHERE ${pendingWhere.join(" AND ")}`,
      pendingParams,
      normalized.currency,
    )
  }

  const pendingSumWhere = [...pendingWhere, "COALESCE(a.currency, r.currency) = ?"]
  const pendingSumParams = [...pendingParams, normalized.currency]
  const pendingRow = await db.prepare(`
    SELECT COALESCE(SUM(a.estimated_cost), 0) AS spend
    FROM paid_receipt_attempt a
    LEFT JOIN paid_receipt r ON r.id = a.receipt_id
    WHERE ${pendingSumWhere.join(" AND ")}
  `).get(...pendingSumParams) as { spend: number }

  const usageSpend = Number(usageRow.spend)
  const pendingReserve = Number(pendingRow.spend)

  return {
    usageSpend,
    pendingReserve,
    total: usageSpend + pendingReserve,
    currency: normalized.currency,
    windowFrom: window.from,
    windowTo: window.to,
    scope: normalized,
  }
}
