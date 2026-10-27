/**
 * Shared LLM pool Settings (R3-1 / ADR-007).
 *
 * Dedicated ShippingSettings.sharedLlmBudget — NOT translation.monthlyBudget.
 * Old JSON missing the field => unconfigured fail-closed; never invent spend
 * authorization from the translation sub-limit; never rewrite missing fields
 * on unrelated settings patches.
 *
 * Coverage (same pool): registry chat/embedding test, translation sync/test,
 * reserved intel chat/embedding step ids. Search/Fetch stay independent (ADR-011).
 * Translation.monthlyBudget remains a stricter sub-limit inside the claim.
 */
import type { Database } from "db0"
import type { SharedLlmBudgetSettings, ShippingSettings } from "@shared/shipping"
import { BudgetAggregateError, aggregatePaidMonthSpend } from "#/intel/llm/budget-aggregate"
import {
  SHARED_LLM_BUDGET_CAPABILITIES,
  type SharedBudgetGateCode,
  type SharedLlmBudgetGate,
} from "#/intel/llm/shared-budget"
import { decidePaidBudget, paidBudgetWindow } from "#/services/paid-budget"

const CURRENCY_RE = /^[A-Z]{3}$/

export class SharedLlmBudgetSettingsError extends Error {
  readonly code: "shared_llm_budget_invalid"
  constructor(message: string) {
    super(message)
    this.name = "SharedLlmBudgetSettingsError"
    this.code = "shared_llm_budget_invalid"
  }
}

/**
 * Read-path view: missing/partial/illegal => unconfigured (nulls).
 * Does NOT persist and must not be used to rewrite old JSON.
 */
export function readSharedLlmBudgetSettings(
  value?: Partial<SharedLlmBudgetSettings> | null,
): { configured: false, monthlyBudget: null, currency: null } | { configured: true, monthlyBudget: number, currency: string } {
  if (!value || typeof value !== "object") {
    return { configured: false, monthlyBudget: null, currency: null }
  }
  const monthlyBudget = value.monthlyBudget
  const currency = value.currency
  if (typeof monthlyBudget !== "number" || !Number.isFinite(monthlyBudget) || monthlyBudget < 0) {
    return { configured: false, monthlyBudget: null, currency: null }
  }
  if (typeof currency !== "string" || !CURRENCY_RE.test(currency)) {
    return { configured: false, monthlyBudget: null, currency: null }
  }
  return { configured: true, monthlyBudget, currency }
}

/** Save-path complete validation. Rejects partial / illegal patches. */
export function validateSharedLlmBudgetForSave(
  value: unknown,
  current?: SharedLlmBudgetSettings | null,
): SharedLlmBudgetSettings {
  if (value === null) {
    throw new SharedLlmBudgetSettingsError("sharedLlmBudget cannot be null; omit the key to preserve, or send a complete object")
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new SharedLlmBudgetSettingsError("sharedLlmBudget must be an object")
  }
  const patch = value as Partial<SharedLlmBudgetSettings>
  const merged = {
    monthlyBudget: patch.monthlyBudget !== undefined ? patch.monthlyBudget : current?.monthlyBudget,
    currency: patch.currency !== undefined ? patch.currency : current?.currency,
  }
  if (typeof merged.monthlyBudget !== "number" || !Number.isFinite(merged.monthlyBudget) || merged.monthlyBudget < 0) {
    throw new SharedLlmBudgetSettingsError("sharedLlmBudget.monthlyBudget must be a finite number >= 0")
  }
  if (typeof merged.currency !== "string" || !CURRENCY_RE.test(merged.currency)) {
    throw new SharedLlmBudgetSettingsError("sharedLlmBudget.currency must be ISO 4217 (A-Z x3)")
  }
  return { monthlyBudget: merged.monthlyBudget, currency: merged.currency }
}

/** Gate object for paidRequest.sharedBudget — never copies translation.monthlyBudget. */
export function resolveSharedLlmBudgetFromSettings(
  settings: ShippingSettings | SharedLlmBudgetSettings | null | undefined,
): SharedLlmBudgetGate {
  const raw = settings && typeof settings === "object" && "sharedLlmBudget" in settings
    ? (settings as ShippingSettings).sharedLlmBudget
    : settings as SharedLlmBudgetSettings | null | undefined
  const viewed = readSharedLlmBudgetSettings(raw)
  return {
    monthlyBudget: viewed.monthlyBudget,
    currency: viewed.currency ?? "",
    capabilities: SHARED_LLM_BUDGET_CAPABILITIES,
  }
}

export type SharedLlmBudgetStatusState =
  | "unconfigured"
  | "budget_zero"
  | "budget_exhausted"
  | "currency_invalid"
  | "ready"

export interface SharedLlmBudgetStatus {
  configured: boolean
  monthlyBudget: number | null
  currency: string | null
  /** Estimated booked usage (provider_usage) in the UTC month — not a provider invoice. */
  estimatedUsage: number
  /** Pending + unknown reservations not yet booked into usage. */
  pendingUnknownReserve: number
  estimatedTotal: number
  windowFrom: string
  windowTo: string
  capabilities: readonly string[]
  state: SharedLlmBudgetStatusState
  gateCode?: SharedBudgetGateCode
  /** Operator-facing refusal reason when not ready. */
  rejectionReason?: string
  /**
   * Honest control disclaimer: pool gates estimated spend + reservations;
   * it is not an absolute hard cap on real vendor charges.
   */
  controlBasis: "estimated_usage_plus_pending_unknown_reserve"
  notAHardInvoiceCap: true
}

export async function readSharedLlmBudgetStatus(
  database: Database,
  settingsValue: ShippingSettings | undefined,
  now = new Date(),
): Promise<SharedLlmBudgetStatus> {
  const viewed = readSharedLlmBudgetSettings(settingsValue?.sharedLlmBudget)
  const window = paidBudgetWindow(now)
  const base = {
    capabilities: SHARED_LLM_BUDGET_CAPABILITIES,
    windowFrom: window.from,
    windowTo: window.to,
    controlBasis: "estimated_usage_plus_pending_unknown_reserve" as const,
    notAHardInvoiceCap: true as const,
  }

  if (!viewed.configured) {
    const raw = settingsValue?.sharedLlmBudget
    const currencyLooksBad = Boolean(
      raw
      && typeof raw === "object"
      && "currency" in raw
      && raw.currency != null
      && (typeof raw.currency !== "string" || !CURRENCY_RE.test(raw.currency)),
    )
    if (currencyLooksBad) {
      return {
        ...base,
        configured: false,
        monthlyBudget: typeof raw?.monthlyBudget === "number" ? raw.monthlyBudget : null,
        currency: typeof raw?.currency === "string" ? raw.currency : null,
        estimatedUsage: 0,
        pendingUnknownReserve: 0,
        estimatedTotal: 0,
        state: "currency_invalid",
        gateCode: "budget_currency_unknown",
        rejectionReason: "shared_llm_budget_currency_invalid",
      }
    }
    return {
      ...base,
      configured: false,
      monthlyBudget: null,
      currency: null,
      estimatedUsage: 0,
      pendingUnknownReserve: 0,
      estimatedTotal: 0,
      state: "unconfigured",
      gateCode: "budget_unconfigured",
      rejectionReason: "shared_llm_budget_unconfigured",
    }
  }

  let estimatedUsage = 0
  let pendingUnknownReserve = 0
  let estimatedTotal = 0
  let aggregateError: SharedBudgetGateCode | undefined
  try {
    const agg = await aggregatePaidMonthSpend(
      database,
      { currency: viewed.currency, capabilities: SHARED_LLM_BUDGET_CAPABILITIES },
      now,
    )
    estimatedUsage = agg.usageSpend
    pendingUnknownReserve = agg.pendingReserve
    estimatedTotal = agg.total
  } catch (error) {
    if (error instanceof BudgetAggregateError) {
      aggregateError = error.code
    } else {
      throw error
    }
  }

  if (aggregateError) {
    return {
      ...base,
      configured: true,
      monthlyBudget: viewed.monthlyBudget,
      currency: viewed.currency,
      estimatedUsage,
      pendingUnknownReserve,
      estimatedTotal,
      state: aggregateError === "budget_currency_unknown" ? "currency_invalid" : "unconfigured",
      gateCode: aggregateError,
      rejectionReason: `shared_llm_budget_${aggregateError}`,
    }
  }

  const decision = decidePaidBudget(viewed.monthlyBudget, estimatedTotal, 0)
  if (decision === "budget_zero") {
    return {
      ...base,
      configured: true,
      monthlyBudget: viewed.monthlyBudget,
      currency: viewed.currency,
      estimatedUsage,
      pendingUnknownReserve,
      estimatedTotal,
      state: "budget_zero",
      gateCode: "budget_zero",
      rejectionReason: "shared_llm_budget_zero",
    }
  }
  if (decision === "budget_exhausted") {
    return {
      ...base,
      configured: true,
      monthlyBudget: viewed.monthlyBudget,
      currency: viewed.currency,
      estimatedUsage,
      pendingUnknownReserve,
      estimatedTotal,
      state: "budget_exhausted",
      gateCode: "budget_exhausted",
      rejectionReason: "shared_llm_budget_exhausted",
    }
  }
  if (decision === "budget_unconfigured") {
    return {
      ...base,
      configured: false,
      monthlyBudget: null,
      currency: viewed.currency,
      estimatedUsage,
      pendingUnknownReserve,
      estimatedTotal,
      state: "unconfigured",
      gateCode: "budget_unconfigured",
      rejectionReason: "shared_llm_budget_unconfigured",
    }
  }

  return {
    ...base,
    configured: true,
    monthlyBudget: viewed.monthlyBudget,
    currency: viewed.currency,
    estimatedUsage,
    pendingUnknownReserve,
    estimatedTotal,
    state: "ready",
  }
}
