import type { Database } from "db0"
import type { ShippingSettings } from "@shared/shipping"
import { TranslationRepository } from "#/database/translation"
import { RuntimeRepository } from "#/database/runtime-jobs"
import type { SecretStore, TranslationProvider, TranslationUsage } from "#/providers/contracts"
import { createDeepSeekTranslationProvider, estimateDeepSeekCost } from "#/providers/translation/deepseek-provider"
import { TranslationService } from "#/services/translation-service"
import { withTranslationExecutor } from "#/services/translation-executor"
import { TRANSLATION_CAPABILITY, TRANSLATION_CURRENCY, TRANSLATION_PROVIDER_ID, assertTranslationReady, currentTranslationUsage } from "#/services/translation-settings"

export const TRANSLATION_TEST_SOURCE_TEXT = "Vessel TEST STAR voyage AB123 arrived at SGSIN on 2026-09-02. Details: https://example.com/status"
export const TRANSLATION_TEST_ENTITY_ID = "shipping-hot-translation-test"

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
  usage?: TranslationUsage
  estimatedCost: number
  currency: string
  pricingReference: string
  errorCode?: string
}

async function runTranslationTestUnlocked(input: TranslationTestInput): Promise<TranslationTestResult> {
  const now = input.now ?? new Date()
  const currentUsage = await currentTranslationUsage(input.database, now)
  const gate = await assertTranslationReady(input.settings.translation, input.secretStore, currentUsage.estimatedCost)
  const provider = input.provider ?? createDeepSeekTranslationProvider({ apiKey: gate.apiKey })
  const service = new TranslationService(new TranslationRepository(input.database), provider, {
    targetLanguage: gate.settings.targetLanguage,
    preference: { providerId: provider.providerId, model: provider.model },
    now: () => now.toISOString(),
  })
  const outcome = await service.translate({
    entityType: "translation_test",
    entityId: TRANSLATION_TEST_ENTITY_ID,
    fieldName: "summary",
    sourceText: TRANSLATION_TEST_SOURCE_TEXT,
    targetLanguage: gate.settings.targetLanguage,
    protectedTerms: ["TEST STAR"],
  })
  const estimatedCost = outcome.providerCalled ? estimateDeepSeekCost(outcome.usage, now) : 0
  await new RuntimeRepository(input.database).recordProviderUsage({
    providerId: TRANSLATION_PROVIDER_ID,
    capability: TRANSLATION_CAPABILITY,
    request: Boolean(outcome.providerCalled),
    cacheHit: !outcome.providerCalled && outcome.status === "succeeded",
    succeeded: outcome.providerCalled && outcome.status === "succeeded",
    failed: outcome.providerCalled && outcome.status === "failed",
    charactersIn: outcome.providerCalled ? TRANSLATION_TEST_SOURCE_TEXT.length : undefined,
    charactersOut: outcome.providerCalled ? outcome.translatedText.length : undefined,
    tokensIn: outcome.usage?.promptTokens,
    tokensOut: outcome.usage?.completionTokens,
    estimatedCost,
    currency: TRANSLATION_CURRENCY,
    pricingReference: "deepseek-official-2026-09-02",
    sourceScope: "translation_test",
    calledAt: now.toISOString(),
    errorCode: outcome.errorCode,
  })
  return {
    ok: outcome.status === "succeeded",
    sourceText: outcome.sourceText,
    sourceHash: outcome.sourceHash,
    translatedText: outcome.translatedText,
    providerId: provider.providerId,
    model: provider.model,
    targetLanguage: gate.settings.targetLanguage,
    cacheHit: !outcome.providerCalled && outcome.status === "succeeded",
    usage: outcome.usage,
    estimatedCost,
    currency: TRANSLATION_CURRENCY,
    pricingReference: "deepseek-official-2026-09-02",
    errorCode: outcome.errorCode,
  }
}

export async function runTranslationTest(input: TranslationTestInput): Promise<TranslationTestResult> {
  return withTranslationExecutor(() => runTranslationTestUnlocked(input))
}
