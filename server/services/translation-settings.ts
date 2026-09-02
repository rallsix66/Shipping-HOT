import type { Database } from "db0"
import { type ShippingSettings, type TranslationSettings, defaultTranslationSettings } from "@shared/shipping"
import { TranslationRepository } from "#/database/translation"
import { RuntimeRepository } from "#/database/runtime-jobs"
import { canonicalLanguage } from "#/services/translation-service"
import type { SecretSource, SecretStore } from "#/providers/contracts"

export const TRANSLATION_CAPABILITY = "translation"
export const TRANSLATION_PROVIDER_ID = "deepseek"
export const TRANSLATION_MODEL = "deepseek-v4-flash"
export const TRANSLATION_CURRENCY = "USD"

export type TranslationGateCode = "translation_disabled" | "translation_provider_not_allowed" | "translation_model_not_allowed" | "translation_budget_zero" | "translation_budget_exhausted" | "translation_secret_missing"

export class TranslationGateError extends Error {
  readonly code: TranslationGateCode
  readonly statusCode: number

  constructor(code: TranslationGateCode, statusCode = code === "translation_budget_exhausted" ? 429 : code === "translation_secret_missing" ? 503 : 409) {
    super(code)
    this.name = "TranslationGateError"
    this.code = code
    this.statusCode = statusCode
  }
}

export interface TranslationUsageAggregate {
  requestCount: number
  successCount: number
  failureCount: number
  cacheHitCount: number
  charactersIn: number
  charactersOut: number
  tokensIn: number
  tokensOut: number
  estimatedCost: number
  currency: string
}

export interface TranslationStatus {
  enabled: boolean
  providerId: typeof TRANSLATION_PROVIDER_ID
  model: typeof TRANSLATION_MODEL
  targetLanguage: string
  configured: boolean
  secretSource: SecretSource
  maskedLast4?: string
  monthlyBudget: number
  estimatedMonthSpend: number
  currency: string
  cache: {
    total: number
    succeeded: number
    pending: number
    failed: number
  }
  usage: TranslationUsageAggregate
  lastCallAt?: string
  lastErrorCode?: string
  state: "disabled" | "budget_zero" | "budget_exhausted" | "secret_missing" | "ready"
  gateCode?: TranslationGateCode
}

export function normalizeTranslationSettings(value?: Partial<TranslationSettings> | null): TranslationSettings {
  const candidate = value ?? {}
  return {
    enabled: candidate.enabled === true,
    providerId: "deepseek",
    model: "deepseek-v4-flash",
    targetLanguage: canonicalLanguage(candidate.targetLanguage, defaultTranslationSettings.targetLanguage),
    monthlyBudget: typeof candidate.monthlyBudget === "number" && Number.isFinite(candidate.monthlyBudget) && candidate.monthlyBudget >= 0
      ? candidate.monthlyBudget
      : defaultTranslationSettings.monthlyBudget,
  }
}

export function mergeTranslationSettings(current: TranslationSettings | undefined, patch: Partial<TranslationSettings>): TranslationSettings {
  return normalizeTranslationSettings({ ...current, ...patch })
}

export function translationBudgetWindow(now = new Date()): { from: string, to: string } {
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
  const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1))
  return { from: from.toISOString(), to: to.toISOString() }
}

function emptyUsage(): TranslationUsageAggregate {
  return { requestCount: 0, successCount: 0, failureCount: 0, cacheHitCount: 0, charactersIn: 0, charactersOut: 0, tokensIn: 0, tokensOut: 0, estimatedCost: 0, currency: TRANSLATION_CURRENCY }
}

export async function currentTranslationUsage(database: Database, now = new Date()): Promise<TranslationUsageAggregate> {
  const window = translationBudgetWindow(now)
  const rows = await new RuntimeRepository(database).listProviderUsage({ providerId: TRANSLATION_PROVIDER_ID, capability: TRANSLATION_CAPABILITY, windowStartFrom: window.from, windowStartTo: window.to })
  return rows.reduce((aggregate, row) => ({
    requestCount: aggregate.requestCount + row.requestCount,
    successCount: aggregate.successCount + row.successCount,
    failureCount: aggregate.failureCount + row.failureCount,
    cacheHitCount: aggregate.cacheHitCount + row.cacheHitCount,
    charactersIn: aggregate.charactersIn + (row.charactersIn ?? 0),
    charactersOut: aggregate.charactersOut + (row.charactersOut ?? 0),
    tokensIn: aggregate.tokensIn + (row.tokensIn ?? 0),
    tokensOut: aggregate.tokensOut + (row.tokensOut ?? 0),
    estimatedCost: aggregate.estimatedCost + (row.estimatedCost ?? 0),
    currency: row.currency ?? aggregate.currency,
  }), emptyUsage())
}

async function secretMetadata(secretStore: SecretStore) {
  const secret = await secretStore.get(TRANSLATION_PROVIDER_ID)
  const source = await secretStore.source(TRANSLATION_PROVIDER_ID)
  return {
    configured: Boolean(secret),
    source,
    maskedLast4: secret ? `****${secret.slice(-4)}` : undefined,
  }
}

export async function assertTranslationReady(settingsValue: TranslationSettings | undefined, secretStore: SecretStore, monthSpend: number): Promise<{ settings: TranslationSettings, apiKey: string }> {
  const raw = settingsValue as Partial<TranslationSettings> | undefined
  if (raw?.enabled !== true) throw new TranslationGateError("translation_disabled")
  if (raw?.providerId !== undefined && raw.providerId !== TRANSLATION_PROVIDER_ID) throw new TranslationGateError("translation_provider_not_allowed")
  if (raw?.model !== undefined && raw.model !== TRANSLATION_MODEL) throw new TranslationGateError("translation_model_not_allowed")
  const settings = normalizeTranslationSettings(settingsValue)
  if (settings.monthlyBudget <= 0) throw new TranslationGateError("translation_budget_zero")
  if (monthSpend >= settings.monthlyBudget) throw new TranslationGateError("translation_budget_exhausted")
  const apiKey = (await secretStore.get(TRANSLATION_PROVIDER_ID))?.trim()
  if (!apiKey) throw new TranslationGateError("translation_secret_missing")
  return { settings, apiKey }
}

export async function readTranslationStatus(database: Database, settingsValue: ShippingSettings | undefined, secretStore: SecretStore, now = new Date()): Promise<TranslationStatus> {
  const raw = settingsValue?.translation
  const settings = normalizeTranslationSettings(raw)
  const usage = await currentTranslationUsage(database, now)
  const cache = await new TranslationRepository(database).getStatistics(TRANSLATION_PROVIDER_ID)
  const metadata = await secretMetadata(secretStore)
  let state: TranslationStatus["state"] = "ready"
  let gateCode: TranslationGateCode | undefined
  if (!settings.enabled) {
    state = "disabled"
    gateCode = "translation_disabled"
  } else if (settings.monthlyBudget <= 0) {
    state = "budget_zero"
    gateCode = "translation_budget_zero"
  } else if (usage.estimatedCost >= settings.monthlyBudget) {
    state = "budget_exhausted"
    gateCode = "translation_budget_exhausted"
  } else if (!metadata.configured) {
    state = "secret_missing"
    gateCode = "translation_secret_missing"
  }
  const rows = await new RuntimeRepository(database).listProviderUsage({ providerId: TRANSLATION_PROVIDER_ID, capability: TRANSLATION_CAPABILITY, limit: 5000 })
  const lastErrorCode = rows.find(row => row.errorCode)?.errorCode
  const lastCallAt = rows.map(row => row.lastCalledAt).filter((value): value is string => Boolean(value)).sort().at(-1)
  return {
    enabled: settings.enabled,
    providerId: TRANSLATION_PROVIDER_ID,
    model: TRANSLATION_MODEL,
    targetLanguage: settings.targetLanguage,
    configured: metadata.configured,
    secretSource: metadata.source,
    maskedLast4: metadata.maskedLast4,
    monthlyBudget: settings.monthlyBudget,
    estimatedMonthSpend: usage.estimatedCost,
    currency: usage.currency,
    cache,
    usage,
    lastCallAt,
    lastErrorCode,
    state,
    gateCode,
  }
}
