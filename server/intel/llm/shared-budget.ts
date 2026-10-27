/**
 * Shared LLM monthly budget gate (R3-1 / ADR-007).
 *
 * Ownership:
 * - Scope: capabilities in SHARED_LLM_BUDGET_CAPABILITIES (translation + registry
 *   chat/embedding test + reserved intel chat/embedding step ids).
 * - Currency: must be an explicit ISO 4217 code matching the call; no FX network,
 *   no numeric mix across currencies.
 * - Reservation: ONLY via paidRequest BEGIN IMMEDIATE claim (pending attempt).
 *   aggregatePaidMonthSpend is a query helper used INSIDE that claim — never a
 *   standalone execution gate.
 *
 * ADR-011 Search/Fetch (deepseek_search / deepseek_fetch) keep independent
 * per-capability budgets and must omit sharedBudget on PaidRequestContext.
 *
 * Pool limit reuses translation.monthlyBudget + TRANSLATION_CURRENCY until a
 * dedicated Settings field is authorized; isolated tests inject fake amounts only.
 */
import type { Database } from "db0"
import { BudgetAggregateError, aggregatePaidMonthSpend } from "#/intel/llm/budget-aggregate"
import { type PaidBudgetCode, decidePaidBudget } from "#/services/paid-budget"
import { TRANSLATION_CURRENCY } from "#/services/translation-settings"

const CURRENCY_RE = /^[A-Z]{3}$/

/** Capabilities that share one monthly pool when sharedBudget is attached to paidRequest. */
export const SHARED_LLM_BUDGET_CAPABILITIES = [
  "translation",
  "llm_test_chat",
  "llm_test_embedding",
  "intel_prefilter",
  "intel_extract",
  "intel_group",
  "intel_group_second_opinion",
  "intel_summary",
  "intel_daily_report",
  "intel_embeddings",
] as const

export type SharedLlmBudgetCapability = (typeof SHARED_LLM_BUDGET_CAPABILITIES)[number]

export interface SharedLlmBudgetGate {
  /** Pool limit (same decidePaidBudget semantics). null/undefined/NaN → unconfigured. */
  monthlyBudget: number | null | undefined
  /** ISO 4217; must equal PaidRequestContext.currency. */
  currency: string
  /** Explicit capability domain; defaults to SHARED_LLM_BUDGET_CAPABILITIES. */
  capabilities?: readonly string[]
}

export type SharedBudgetGateCode =
  | PaidBudgetCode
  | "budget_currency_mismatch"
  | "budget_currency_mixed"
  | "budget_currency_unknown"
  | "budget_scope_invalid"

export class SharedBudgetGateError extends Error {
  readonly code: SharedBudgetGateCode
  constructor(code: SharedBudgetGateCode, message?: string) {
    super(message ?? code)
    this.name = "SharedBudgetGateError"
    this.code = code
  }
}

export function sharedLlmBudgetCapabilities(): readonly string[] {
  return SHARED_LLM_BUDGET_CAPABILITIES
}

/** Resolve the shared pool from translation settings (isolated/fake amounts in tests). */
export function resolveSharedLlmBudgetFromTranslation(monthlyBudget: number | null | undefined, currency: string = TRANSLATION_CURRENCY): SharedLlmBudgetGate {
  return {
    monthlyBudget,
    currency,
    capabilities: SHARED_LLM_BUDGET_CAPABILITIES,
  }
}

/**
 * Atomic shared-pool check for use INSIDE paidRequest's BEGIN IMMEDIATE claim.
 * Callers outside that transaction must not treat a prior helper read as a gate.
 */
export async function assertSharedLlmBudgetInTransaction(
  db: Database,
  gate: SharedLlmBudgetGate,
  callCurrency: string,
  nextEstimate: number,
  now: Date = new Date(),
): Promise<void> {
  if (typeof callCurrency !== "string" || !CURRENCY_RE.test(callCurrency)) {
    throw new SharedBudgetGateError("budget_currency_unknown", `call currency invalid: ${String(callCurrency)}`)
  }
  if (typeof gate.currency !== "string" || !CURRENCY_RE.test(gate.currency)) {
    throw new SharedBudgetGateError("budget_currency_unknown", `shared budget currency invalid: ${String(gate.currency)}`)
  }
  if (gate.currency !== callCurrency) {
    throw new SharedBudgetGateError("budget_currency_mismatch", `shared ${gate.currency} != call ${callCurrency}`)
  }
  const capabilities = gate.capabilities?.length ? gate.capabilities : SHARED_LLM_BUDGET_CAPABILITIES
  if (capabilities.some(c => typeof c !== "string" || !c)) {
    throw new SharedBudgetGateError("budget_scope_invalid", "capabilities must be non-empty strings")
  }
  let total: number
  try {
    const agg = await aggregatePaidMonthSpend(db, { currency: gate.currency, capabilities }, now)
    total = agg.total
  } catch (error) {
    if (error instanceof BudgetAggregateError) {
      if (error.code === "budget_currency_mixed") throw new SharedBudgetGateError("budget_currency_mixed", error.message)
      if (error.code === "budget_currency_unknown") throw new SharedBudgetGateError("budget_currency_unknown", error.message)
      throw new SharedBudgetGateError("budget_scope_invalid", error.message)
    }
    throw error
  }
  const code = decidePaidBudget(gate.monthlyBudget, total, nextEstimate)
  if (code) throw new SharedBudgetGateError(code)
}
