import { createHash } from "node:crypto"
import type { Database } from "db0"
import type { ShippingSettings } from "@shared/shipping"
import { TranslationRepository } from "#/database/translation"
import { RuntimeRepository, isProviderCircuitBlocked } from "#/database/runtime-jobs"
import type { SecretStore, TranslationCacheRecord, TranslationProvider, TranslationUsage } from "#/providers/contracts"
import { createDeepSeekTranslationProvider, estimateDeepSeekCost } from "#/providers/translation/deepseek-provider"
import { articleConservativeProjectedCostUsd } from "#/services/article-translation-source"
import { executeTranslationViaPaidRequest } from "#/services/translation-paid"
import { type PreparedTranslationSource, TranslationService } from "#/services/translation-service"
import { withTranslationExecutor } from "#/services/translation-executor"
import { TRANSLATION_CAPABILITY, TRANSLATION_CURRENCY, TRANSLATION_PROVIDER_ID, assertTranslationReady, currentTranslationUsage } from "#/services/translation-settings"

export const TRANSLATION_TEST_SOURCE_TEXT = "Port of Singapore (SGSIN) issued an operational notice on 2026-09-02. Details: https://example.com/status"
export const TRANSLATION_TEST_ENTITY_ID = "shipping-hot-translation-test"
export const TRANSLATION_TEST_PROTECTED_TERMS = ["TEST STAR"] as const

export function isAllowedTranslationTestBody(body: unknown): boolean {
  return body === undefined || body === null || (typeof body === "object" && !Array.isArray(body) && Object.keys(body).length === 0)
}

export interface TranslationTestInput {
  database: Database
  settings: ShippingSettings
  secretStore: SecretStore
  now?: Date
  provider?: TranslationProvider
}

export interface TranslationTestResult {
  ok: boolean
  sourceText: string
  sourceHash: string
  translatedText: string
  providerId: string
  model: string
  targetLanguage: string
  cacheHit: boolean
  diagnosticMode: boolean
  providerCalled: boolean
  usage?: TranslationUsage
  estimatedCost: number
  currency: string
  pricingReference: string
  errorCode?: string
}

function cacheRowId(prepared: PreparedTranslationSource, provider: TranslationProvider): string {
  const identity = [
    prepared.entityType,
    prepared.entityId,
    prepared.fieldName,
    prepared.sourceHash,
    prepared.targetLanguage,
    provider.providerId,
    provider.model,
  ].join("\0")
  return `translation:${createHash("sha256").update(identity).digest("hex")}`
}

async function persistTestCache(
  repository: TranslationRepository,
  prepared: PreparedTranslationSource,
  provider: TranslationProvider,
  outcome: { status: string, translatedText: string, errorCode?: string, errorMessage?: string },
  nowIso: string,
): Promise<void> {
  const base: TranslationCacheRecord = {
    id: cacheRowId(prepared, provider),
    entityType: prepared.entityType,
    entityId: prepared.entityId,
    fieldName: prepared.fieldName,
    sourceText: prepared.sourceText,
    sourceHash: prepared.sourceHash,
    sourceLanguage: prepared.sourceLanguage,
    targetLanguage: prepared.targetLanguage,
    provider: provider.providerId,
    model: provider.model,
    status: "pending",
    retryCount: 0,
    nextRetryAt: null,
    retryable: false,
    leaseUntil: null,
    lastErrorCode: null,
    preferred: false,
    createdAt: nowIso,
    updatedAt: nowIso,
  }
  await repository.save(base)
  if (outcome.status === "succeeded") {
    await repository.save({
      ...base,
      translatedText: outcome.translatedText,
      translatedAt: nowIso,
      status: "succeeded",
      retryable: false,
      nextRetryAt: null,
      leaseUntil: null,
      lastErrorCode: null,
      preferred: true,
      updatedAt: nowIso,
    })
    return
  }
  await repository.save({
    ...base,
    status: "failed",
    errorMessage: outcome.errorMessage,
    lastErrorCode: outcome.errorCode ?? null,
    updatedAt: nowIso,
  })
}

async function runTranslationTestUnlocked(input: TranslationTestInput): Promise<TranslationTestResult> {
  const now = input.now ?? new Date()
  const nowIso = now.toISOString()
  const runtimeRepository = new RuntimeRepository(input.database)
  const translationRepository = new TranslationRepository(input.database)
  const diagnosticMode = isProviderCircuitBlocked(await runtimeRepository.getProviderRuntime(TRANSLATION_PROVIDER_ID, TRANSLATION_CAPABILITY))
  const currentUsage = await currentTranslationUsage(input.database, now)
  const gate = await assertTranslationReady(input.settings.translation, input.secretStore, currentUsage.estimatedCost)
  const provider = input.provider ?? createDeepSeekTranslationProvider({ apiKey: gate.apiKey })
  const service = new TranslationService(translationRepository, provider, {
    targetLanguage: gate.settings.targetLanguage,
    preference: { providerId: provider.providerId, model: provider.model },
    now: () => nowIso,
  })
  const fixedSource = {
    entityType: "translation_test",
    entityId: TRANSLATION_TEST_ENTITY_ID,
    fieldName: "summary",
    sourceText: TRANSLATION_TEST_SOURCE_TEXT,
    targetLanguage: gate.settings.targetLanguage,
    protectedTerms: [...TRANSLATION_TEST_PROTECTED_TERMS],
  }
  const prepared = service.prepare(fixedSource)

  // Non-diagnostic: reuse successful cache (same as TranslationService.translate).
  // Diagnostic recovery must bypass cache and never mutate it (same as service.execute).
  if (!diagnosticMode) {
    const exact = await translationRepository.findExactSuccessful({
      entityType: prepared.entityType,
      entityId: prepared.entityId,
      fieldName: prepared.fieldName,
      sourceHash: prepared.sourceHash,
      targetLanguage: prepared.targetLanguage,
      provider: provider.providerId,
      model: provider.model,
    })
    if (exact?.translatedText) {
      await runtimeRepository.recordProviderUsage({
        providerId: TRANSLATION_PROVIDER_ID,
        capability: TRANSLATION_CAPABILITY,
        request: false,
        cacheHit: true,
        succeeded: false,
        failed: false,
        estimatedCost: 0,
        currency: TRANSLATION_CURRENCY,
        pricingReference: "deepseek-official-2026-09-02",
        sourceScope: "translation_test",
        calledAt: nowIso,
      })
      return {
        ok: true,
        sourceText: prepared.sourceText,
        sourceHash: prepared.sourceHash,
        translatedText: exact.translatedText,
        providerId: provider.providerId,
        model: provider.model,
        targetLanguage: gate.settings.targetLanguage,
        cacheHit: true,
        diagnosticMode,
        providerCalled: false,
        estimatedCost: 0,
        currency: TRANSLATION_CURRENCY,
        pricingReference: "deepseek-official-2026-09-02",
      }
    }
  }

  // Real execution through paidRequest + sharedBudget (closes the test-entrance leak).
  const estimatedCost = articleConservativeProjectedCostUsd(
    prepared.sourceText,
    prepared.targetLanguage,
    prepared.maxTokens,
    prepared.protectedTerms ?? [],
  )
  const outcome = await executeTranslationViaPaidRequest({
    db: input.database,
    secretStore: input.secretStore,
    monthlyBudget: gate.settings.monthlyBudget,
    provider,
    source: prepared,
    estimatedCost,
    now: () => now,
    // Diagnostic recovery must not reuse a prior successful receipt; each click re-verifies the provider under the shared budget.
    attemptTag: diagnosticMode ? `diagnostic:${nowIso}` : undefined,
  })

  // Persist cache only on the non-diagnostic path (execute never writes cache).
  const shouldPersistCache = !diagnosticMode
    && !outcome.paidGateCode
    && outcome.errorCode !== "paid_receipt_busy"
  if (shouldPersistCache) {
    await persistTestCache(translationRepository, prepared, provider, outcome, nowIso)
  }

  // Avoid double-billing: paidRequest already wrote cost/tokens when usageRecordedByPaidRequest.
  if (!outcome.usageRecordedByPaidRequest) {
    // Gate/busy short-circuit: no provider spend. Do not invent a request row.
  } else if (outcome.status === "succeeded") {
    await runtimeRepository.recordProviderUsage({
      providerId: TRANSLATION_PROVIDER_ID,
      capability: TRANSLATION_CAPABILITY,
      request: false,
      succeeded: false,
      failed: false,
      records: 1,
      charactersIn: TRANSLATION_TEST_SOURCE_TEXT.length,
      charactersOut: outcome.translatedText.length,
      estimatedCost: 0,
      currency: TRANSLATION_CURRENCY,
      pricingReference: "deepseek-official-2026-09-02",
      sourceScope: "translation_test",
      calledAt: nowIso,
    })
  }

  const providerCalled = Boolean(outcome.providerCalled)
  return {
    ok: outcome.status === "succeeded",
    sourceText: outcome.sourceText,
    sourceHash: outcome.sourceHash,
    translatedText: outcome.translatedText,
    providerId: provider.providerId,
    model: provider.model,
    targetLanguage: gate.settings.targetLanguage,
    cacheHit: false,
    diagnosticMode,
    providerCalled,
    usage: outcome.usage,
    estimatedCost: providerCalled ? estimateDeepSeekCost(outcome.usage, now) : 0,
    currency: TRANSLATION_CURRENCY,
    pricingReference: "deepseek-official-2026-09-02",
    errorCode: outcome.errorCode ?? outcome.paidGateCode,
  }
}

export async function runTranslationTest(input: TranslationTestInput): Promise<TranslationTestResult> {
  return withTranslationExecutor(() => runTranslationTestUnlocked(input))
}
