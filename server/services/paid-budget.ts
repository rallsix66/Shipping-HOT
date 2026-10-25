/**
 * The one budget decision for paid calls. Extracted from the existing translation gate
 * (translation_budget_zero / translation_budget_exhausted) so translation and paid receipts share it; no second budget system.
 * Spend comes from provider_usage (estimated_cost) for one provider + capability in the current UTC month.
 */
export type PaidBudgetCode = "budget_unconfigured" | "budget_zero" | "budget_exhausted"

export function decidePaidBudget(monthlyBudget: number | null | undefined, monthSpend: number, nextEstimate = 0): PaidBudgetCode | null {
  if (typeof monthlyBudget !== "number" || !Number.isFinite(monthlyBudget) || monthlyBudget < 0) return "budget_unconfigured"
  if (monthlyBudget <= 0) return "budget_zero"
  if (monthSpend >= monthlyBudget || monthSpend + Math.max(0, nextEstimate) > monthlyBudget) return "budget_exhausted"
  return null
}

/** Current UTC calendar month, the window the translation budget already uses. */
export function paidBudgetWindow(now = new Date()): { from: string, to: string } {
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
  const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1))
  return { from: from.toISOString(), to: to.toISOString() }
}
