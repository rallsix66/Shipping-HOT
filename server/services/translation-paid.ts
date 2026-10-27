/**
 * Translation paid bridge (R3-1 / ADR-007).
 *
 * Routes a translation Provider call through paidRequest + shared LLM budget
 * so registry chat/embedding and translation share one same-currency pool.
 * Reservation ownership stays on paid_receipt (BEGIN IMMEDIATE); this module
 * does not invent a second ledger. Search/Fetch omit sharedBudget (ADR-011).
 *
 * Usage: paidRequest records provider_usage once on success/unknown/reject.
 * Callers that still pass a finalize providerUsage patch must use request:false
 * and estimatedCost 0 (characters metadata only) to avoid double-billing.
 */
import type { Database } from "db0"
import type { SecretStore, TranslationProvider, TranslationUsage } from "#/providers/contracts"
import { ProviderError } from "#/providers/contracts"
import { estimateDeepSeekCost } from "#/providers/translation/deepseek-provider"
import {
  PaidGateError,
  ProviderRejectedError,
  ReceiptBusyError,
  ReceiptUnknownError,
  paidRequest,
} from "#/intel/llm/receipts"
import { resolveSharedLlmBudgetFromTranslation } from "#/intel/llm/shared-budget"
import { TranslationValidationError, protectTranslationText, restoreAndValidateProtectedTranslation } from "#/services/translation-protection"
import type { PreparedTranslationSource, TranslationExecutionResult } from "#/services/translation-service"
import {
  TRANSLATION_CAPABILITY,
  TRANSLATION_CURRENCY,
  TRANSLATION_MODEL,
  TRANSLATION_PROVIDER_ID,
} from "#/services/translation-settings"

class TranslationPaidReject extends ProviderRejectedError {
  readonly translationCode: string
  constructor(code: string, message: string, status: number | null, retryable: boolean) {
    super(message, status, retryable)
    this.name = "TranslationPaidReject"
    this.translationCode = code
  }
}

const WRAPPER_RE = /^\s*Translated text\s*:\s*/i

function hasExplicitTranslationWrapper(text: string): boolean {
  return WRAPPER_RE.test(text)
}

export interface PaidTranslationOptions {
  db: Database
  secretStore: SecretStore
  /** Pool limit from translation.monthlyBudget (isolated/fake amounts in tests). */
  monthlyBudget: number | null | undefined
  provider: TranslationProvider
  source: PreparedTranslationSource
  /** Pre-call reserve; must be finite >= 0. */
  estimatedCost: number
  now?: () => Date
  timeoutMs?: number
}

export type PaidTranslationResult = TranslationExecutionResult & {
  receiptId?: string
  reused?: boolean
  /** True when paidRequest already wrote provider_usage (skip cost on finalize). */
  usageRecordedByPaidRequest: boolean
  paidGateCode?: string
}

/**
 * Execute one translation field via paidRequest + sharedBudget.
 * Cache hits and same-language short-circuits belong outside this helper.
 */
export async function executeTranslationViaPaidRequest(options: PaidTranslationOptions): Promise<PaidTranslationResult> {
  const clock = options.now ?? (() => new Date())
  const source = options.source
  const provider = options.provider
  const sharedBudget = resolveSharedLlmBudgetFromTranslation(options.monthlyBudget, TRANSLATION_CURRENCY)

  try {
    const paid = await paidRequest(
      {
        db: options.db,
        secretStore: options.secretStore,
        monthlyBudget: options.monthlyBudget,
        currency: TRANSLATION_CURRENCY,
        sharedBudget,
        now: clock,
        timeoutMs: options.timeoutMs,
      },
      {
        providerId: TRANSLATION_PROVIDER_ID,
        capability: TRANSLATION_CAPABILITY,
        model: TRANSLATION_MODEL,
        purpose: "translation",
        subject: `${source.entityType}:${source.entityId}:${source.fieldName}`,
        identity: {
          entityType: source.entityType,
          entityId: source.entityId,
          fieldName: source.fieldName,
          sourceHash: source.sourceHash,
          targetLanguage: source.targetLanguage,
          provider: TRANSLATION_PROVIDER_ID,
          model: TRANSLATION_MODEL,
        },
        requestSummary: {
          entityType: source.entityType,
          fieldName: source.fieldName,
          targetLanguage: source.targetLanguage,
          sourceChars: source.sourceText.length,
        },
        estimatedCost: options.estimatedCost,
      },
      async (_apiKey) => {
        const protectedSource = protectTranslationText(source.sourceText, source.protectedTerms)
        let result
        try {
          result = await provider.translate({
            sourceText: protectedSource.protectedText,
            sourceLanguage: source.sourceLanguage,
            targetLanguage: source.targetLanguage,
            entityType: source.entityType,
            entityId: source.entityId,
            fieldName: source.fieldName,
            maxTokens: source.maxTokens,
          })
        } catch (error) {
          if (error instanceof ProviderError) {
            const rejected = error.code === "auth_failed"
              || error.code === "entitlement_missing"
              || error.code === "provider_forbidden"
              || error.code === "rate_limited"
              || error.code === "provider_contract_changed"
            if (rejected) {
              throw new TranslationPaidReject(
                error.code,
                error.message,
                error.code === "rate_limited" ? 429 : (error.status ?? 400),
                error.code === "rate_limited",
              )
            }
          }
          if (error instanceof TranslationValidationError) {
            throw new TranslationPaidReject(error.code, error.message, 422, false)
          }
          throw error
        }
        if (!result.translatedText.trim()) {
          throw new TranslationPaidReject("provider_contract_changed", "translation_provider_empty_result", 422, false)
        }
        if (hasExplicitTranslationWrapper(result.translatedText)) {
          throw new TranslationPaidReject("provider_contract_changed", "translation_provider_wrapper_output", 422, false)
        }
        let translatedText: string
        try {
          translatedText = restoreAndValidateProtectedTranslation(
            protectedSource,
            result.translatedText,
            source.protectedTerms ?? [],
          )
        } catch (error) {
          if (error instanceof TranslationValidationError) {
            throw new TranslationPaidReject(error.code, error.message, 422, false)
          }
          throw error
        }
        const usage = result.usage
        const estimated = estimateDeepSeekCost(usage, clock())
        const outcome: {
          response: { translatedText: string, usage?: TranslationUsage }
          usage?: { tokensIn?: number, tokensOut?: number }
          cost?: { amount: number, currency: string, basis: "estimated" }
        } = {
          response: { translatedText, usage },
          usage: usage
            ? { tokensIn: usage.promptTokens, tokensOut: usage.completionTokens }
            : undefined,
        }
        // Prefer real usage-based estimate when present; otherwise keep the reserved estimate.
        if (usage && estimated > 0) {
          outcome.cost = { amount: estimated, currency: TRANSLATION_CURRENCY, basis: "estimated" }
        }
        return outcome
      },
    )

    const payload = paid.response as { translatedText?: string, usage?: TranslationUsage } | null
    const translatedText = typeof payload?.translatedText === "string" ? payload.translatedText : source.sourceText
    return {
      sourceText: source.sourceText,
      translatedText,
      sourceHash: source.sourceHash,
      status: "succeeded",
      usage: payload?.usage,
      providerCalled: !paid.reused,
      receiptId: paid.receiptId,
      reused: paid.reused,
      usageRecordedByPaidRequest: true,
    }
  } catch (error) {
    if (error instanceof PaidGateError) {
      return {
        sourceText: source.sourceText,
        translatedText: source.sourceText,
        sourceHash: source.sourceHash,
        status: "failed",
        errorCode: error.code,
        errorMessage: error.message,
        providerCalled: false,
        usageRecordedByPaidRequest: false,
        paidGateCode: error.code,
      }
    }
    if (error instanceof ReceiptUnknownError) {
      return {
        sourceText: source.sourceText,
        translatedText: source.sourceText,
        sourceHash: source.sourceHash,
        status: "failed",
        errorCode: "paid_result_unknown",
        errorMessage: error.message,
        providerCalled: true,
        usageRecordedByPaidRequest: true,
        receiptId: error.receiptId,
      }
    }
    if (error instanceof ReceiptBusyError) {
      return {
        sourceText: source.sourceText,
        translatedText: source.sourceText,
        sourceHash: source.sourceHash,
        status: "failed",
        errorCode: "paid_receipt_busy",
        errorMessage: error.message,
        providerCalled: false,
        usageRecordedByPaidRequest: false,
        receiptId: error.receiptId,
      }
    }
    if (error instanceof TranslationPaidReject) {
      return {
        sourceText: source.sourceText,
        translatedText: source.sourceText,
        sourceHash: source.sourceHash,
        status: "failed",
        errorCode: error.translationCode,
        errorMessage: error.message,
        providerCalled: true,
        usageRecordedByPaidRequest: true,
      }
    }
    if (error instanceof ProviderRejectedError) {
      return {
        sourceText: source.sourceText,
        translatedText: source.sourceText,
        sourceHash: source.sourceHash,
        status: "failed",
        errorCode: error.message,
        errorMessage: error.message,
        providerCalled: true,
        usageRecordedByPaidRequest: true,
      }
    }
    const errorCode = error instanceof ProviderError
      ? error.code
      : error && typeof error === "object" && "code" in error && typeof (error as { code?: unknown }).code === "string"
        ? (error as { code: string }).code
        : "provider_unavailable"
    return {
      sourceText: source.sourceText,
      translatedText: source.sourceText,
      sourceHash: source.sourceHash,
      status: "failed",
      errorCode,
      errorMessage: error instanceof Error ? error.message : String(error),
      providerCalled: true,
      usageRecordedByPaidRequest: true,
    }
  }
}

/** Characters-only usage patch after paidRequest already booked cost (no double-bill). */
export function translationCharactersUsagePatch(input: {
  sourceText: string
  translatedText: string
  scope: "feed" | "article"
  now: string
}): {
    providerId: string
    capability: string
    request: false
    succeeded: false
    failed: false
    records: 1
    charactersIn: number
    charactersOut: number
    estimatedCost: 0
    currency: string
    sourceScope: "feed" | "article"
    calledAt: string
  } {
  return {
    providerId: TRANSLATION_PROVIDER_ID,
    capability: TRANSLATION_CAPABILITY,
    request: false,
    succeeded: false,
    failed: false,
    records: 1,
    charactersIn: input.sourceText.length,
    charactersOut: input.translatedText.length,
    estimatedCost: 0,
    currency: TRANSLATION_CURRENCY,
    sourceScope: input.scope,
    calledAt: input.now,
  }
}
