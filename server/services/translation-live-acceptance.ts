import type { Database } from "db0"
import type { ShippingSettings, TranslationSettings } from "@shared/shipping"
import type { ProviderRuntimeRecord, SecretStore } from "#/providers/contracts"
import { RuntimeRepository, isProviderCircuitBlocked } from "#/database/runtime-jobs"
import { normalizeTranslationSettings, readTranslationStatus } from "#/services/translation-settings"
import { TRANSLATION_TEST_SOURCE_TEXT } from "#/services/translation-test-service"
import { DEEPSEEK_CHAT_COMPLETIONS_ENDPOINT } from "#/providers/translation/deepseek-provider"

export const TRANSLATION_LIVE_ACCEPTANCE_MAX_EXTERNAL_CALLS = 1 as const
export const TRANSLATION_LIVE_ACCEPTANCE_INPUT = TRANSLATION_TEST_SOURCE_TEXT

export interface TranslationAcceptanceChecks {
  settingsValid: boolean
  secretConfigured: boolean
  budgetAvailable: boolean
  circuitClear: boolean
  fixedInputOnly: true
  backlogExcluded: true
}

export interface TranslationAcceptancePlan {
  providerId: "deepseek"
  model: "deepseek-v4-flash"
  endpoint: typeof DEEPSEEK_CHAT_COMPLETIONS_ENDPOINT
  fixedInput: string
  maxExternalCalls: 0 | 1
  allowed: boolean
  checks: TranslationAcceptanceChecks
  blockers: string[]
}

export type TranslationAcceptanceObservationState = "verified" | "pending"

export interface TranslationAcceptanceEvidence {
  plan: TranslationAcceptancePlan
  liveVerification: "verified_live" | "pending"
  externalCalls: number
  diagnostic: {
    attempted: boolean
    providerCalled: boolean
    usageContract: TranslationAcceptanceObservationState
    placeholderPreserved: TranslationAcceptanceObservationState
  }
  cachePersistence: TranslationAcceptanceObservationState
  restartReadback: TranslationAcceptanceObservationState
  feedApiReadback: TranslationAcceptanceObservationState
  feedUiReadback: TranslationAcceptanceObservationState
  reason?: string
}

export interface TranslationAcceptancePreflightInput {
  settings?: Partial<TranslationSettings> | null
  configured: boolean
  estimatedMonthSpend: number
  runtime?: ProviderRuntimeRecord
  allowExternalCalls?: boolean
}

export function buildTranslationAcceptancePlan(input: TranslationAcceptancePreflightInput): TranslationAcceptancePlan {
  const raw = input.settings
  const settings = normalizeTranslationSettings(raw)
  const settingsValid = raw?.enabled === true
    && (raw.providerId === undefined || raw.providerId === "deepseek")
    && (raw.model === undefined || raw.model === "deepseek-v4-flash")
  const budgetAvailable = settings.monthlyBudget > 0 && input.estimatedMonthSpend < settings.monthlyBudget
  const circuitClear = !isProviderCircuitBlocked(input.runtime)
  const checks: TranslationAcceptanceChecks = {
    settingsValid,
    secretConfigured: input.configured,
    budgetAvailable,
    circuitClear,
    fixedInputOnly: true,
    backlogExcluded: true,
  }
  const blockers: string[] = []
  if (!settingsValid) blockers.push("translation_settings_invalid_or_disabled")
  if (!input.configured) blockers.push("translation_secret_missing")
  if (!budgetAvailable) blockers.push(settings.monthlyBudget > 0 ? "translation_budget_exhausted" : "translation_budget_zero")
  if (!circuitClear) blockers.push("translation_provider_circuit_blocked")
  if (input.allowExternalCalls !== true) blockers.push("external_call_not_authorized_for_this_run")
  return {
    providerId: "deepseek",
    model: "deepseek-v4-flash",
    endpoint: DEEPSEEK_CHAT_COMPLETIONS_ENDPOINT,
    fixedInput: TRANSLATION_LIVE_ACCEPTANCE_INPUT,
    maxExternalCalls: blockers.length === 0 ? TRANSLATION_LIVE_ACCEPTANCE_MAX_EXTERNAL_CALLS : 0,
    allowed: blockers.length === 0,
    checks,
    blockers,
  }
}

export interface TranslationAcceptanceObservation {
  externalCalls?: number
  providerCalled?: boolean
  usageContract?: TranslationAcceptanceObservationState
  placeholderPreserved?: TranslationAcceptanceObservationState
  cachePersistence?: TranslationAcceptanceObservationState
  restartReadback?: TranslationAcceptanceObservationState
  feedApiReadback?: TranslationAcceptanceObservationState
  feedUiReadback?: TranslationAcceptanceObservationState
}

export function buildTranslationAcceptanceEvidence(plan: TranslationAcceptancePlan, observation: TranslationAcceptanceObservation = {}): TranslationAcceptanceEvidence {
  const externalCalls = Math.max(0, Math.floor(observation.externalCalls ?? 0))
  const diagnostic = {
    attempted: externalCalls > 0 || observation.providerCalled === true,
    providerCalled: observation.providerCalled === true,
    usageContract: observation.usageContract ?? "pending",
    placeholderPreserved: observation.placeholderPreserved ?? "pending",
  }
  const complete = plan.allowed
    && externalCalls === TRANSLATION_LIVE_ACCEPTANCE_MAX_EXTERNAL_CALLS
    && diagnostic.providerCalled
    && diagnostic.usageContract === "verified"
    && diagnostic.placeholderPreserved === "verified"
    && observation.cachePersistence === "verified"
    && observation.restartReadback === "verified"
    && observation.feedApiReadback === "verified"
    && observation.feedUiReadback === "verified"
  return {
    plan,
    liveVerification: complete ? "verified_live" : "pending",
    externalCalls,
    diagnostic,
    cachePersistence: observation.cachePersistence ?? "pending",
    restartReadback: observation.restartReadback ?? "pending",
    feedApiReadback: observation.feedApiReadback ?? "pending",
    feedUiReadback: observation.feedUiReadback ?? "pending",
    reason: complete ? undefined : plan.blockers.join(", ") || "acceptance_evidence_incomplete",
  }
}

/** Read-only preflight. It never constructs a Provider and never calls DeepSeek. */
export async function readTranslationAcceptancePreflight(
  database: Database,
  settings: TranslationSettings | undefined,
  secretStore: SecretStore,
  now = new Date(),
): Promise<TranslationAcceptanceEvidence> {
  const status = await readTranslationStatus(database, { translation: settings } as ShippingSettings, secretStore, now)
  const runtime = await new RuntimeRepository(database).getProviderRuntime("deepseek", "translation")
  const plan = buildTranslationAcceptancePlan({
    settings,
    configured: status.configured,
    estimatedMonthSpend: status.estimatedMonthSpend,
    runtime,
    allowExternalCalls: false,
  })
  return buildTranslationAcceptanceEvidence(plan)
}
