/**
 * Translation paid bridge (R3-1 / ADR-007).
 *
 * Routes a translation Provider call through paidRequest + shared LLM budget
 * so registry chat/embedding and translation share one same-currency pool.
 * Reservation ownership stays on paid_receipt (BEGIN IMMEDIATE); this module
 * does not invent a second ledger. Search/Fetch omit sharedBudget (ADR-011).
 *
 * Billing branches:
 * - Clear unpaid reject (auth/entitlement/forbidden/rate_limit) -> ProviderRejected -> 0-cost release, retryable.
 * - HTTP success with usage but business validation fail -> book usage/cost, rejectReceived (no free release, no auto-resend of same received body).
 * - Ambiguous / no usage on post-call failure -> unknown, keep reservation.
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
  rejectReceivedResponse,
} from "#/intel/llm/receipts"
import { resolveSharedLlmBudgetFromTranslation } from "#/intel/llm/shared-budget"
import { TranslationValidationError, protectTranslationText, restoreAndValidateProtectedTranslation } from "#/services/translation-protection"
import {
  type PreparedTranslationSource,
  type TranslationExecutionResult,
  hasExplicitTranslationWrapper,
} from "#/services/translation-service"
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

/** Business validation failed after the provider returned, but usage was absent — billing unknown. */
class TranslationBusinessUnknownError extends Error {
  readonly translationCode: string
  constructor(code: string, message: string) {
    super(message)
    this.name = "TranslationBusinessUnknownError"
    this.translationCode = code
  }
}

/** Explicit unpaid / not-accepted rejects only — model output quality is never this. */
const UNPAID_PROVIDER_REJECT_CODES = new Set([
  "auth_failed",
  "entitlement_missing",
  "provider_forbidden",
  "rate_limited",
])

interface TranslationPaidResponse {
  translatedText: string
  usage?: TranslationUsage
  businessFailure?: { code: string, message: string }
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
  /** Distinguishes diagnostic retries from durable cache receipts (paidRequest logical key). */
  attemptTag?: string
}

export type PaidTranslationResult = TranslationExecutionResult & {
  receiptId?: string
  reused?: boolean
  /** True when paidRequest already wrote provider_usage (skip cost on finalize). */
  usageRecordedByPaidRequest: boolean
  paidGateCode?: string
}

function unpaidProviderReject(error: ProviderError): boolean {
  return UNPAID_PROVIDER_REJECT_CODES.has(error.code)
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
        attemptTag: options.attemptTag,
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
          if (error instanceof ProviderError && unpaidProviderReject(error)) {
            throw new TranslationPaidReject(
              error.code,
              error.message,
              error.code === "rate_limited" ? 429 : (error.status ?? 400),
              error.code === "rate_limited",
            )
          }
          // Timeouts, 5xx, contract-parse failures without a usable body, etc.:
          // billing may already have happened -> unknown (keep reservation).
          throw error
        }

        const usage = result.usage
        const estimated = estimateDeepSeekCost(usage, clock())
        const usagePayload = usage
          ? { tokensIn: usage.promptTokens, tokensOut: usage.completionTokens }
          : undefined
        const costPayload = usage && estimated > 0
          ? { amount: estimated, currency: TRANSLATION_CURRENCY, basis: "estimated" as const }
          : undefined

        let businessFailure: { code: string, message: string } | undefined
        let translatedText = result.translatedText
        if (!result.translatedText.trim()) {
          businessFailure = { code: "provider_contract_changed", message: "translation_provider_empty_result" }
        } else if (hasExplicitTranslationWrapper(result.translatedText)) {
          businessFailure = { code: "provider_contract_changed", message: "translation_provider_wrapper_output" }
        } else {
          try {
            translatedText = restoreAndValidateProtectedTranslation(
              protectedSource,
              result.translatedText,
              source.protectedTerms ?? [],
            )
          } catch (error) {
            if (error instanceof TranslationValidationError) {
              businessFailure = { code: error.code, message: error.message }
            } else {
              throw error
            }
          }
        }

        if (businessFailure) {
          // With usage: book real cost then mark received unusable (no free release).
          // Without usage: cannot tell if billed -> unknown, keep reservation.
          if (!usage) {
            throw new TranslationBusinessUnknownError(businessFailure.code, businessFailure.message)
          }
          return {
            response: {
              translatedText: source.sourceText,
              usage,
              businessFailure,
            } satisfies TranslationPaidResponse,
            usage: usagePayload,
            cost: costPayload ?? { amount: options.estimatedCost, currency: TRANSLATION_CURRENCY, basis: "estimated" },
          }
        }

        const outcome: {
          response: TranslationPaidResponse
          usage?: { tokensIn?: number, tokensOut?: number }
          cost?: { amount: number, currency: string, basis: "estimated" }
        } = {
          response: { translatedText, usage },
          usage: usagePayload,
        }
        if (costPayload) outcome.cost = costPayload
        return outcome
      },
    )

    const payload = paid.response as TranslationPaidResponse | null
    if (payload?.businessFailure) {
      if (!paid.reused) {
        await rejectReceivedResponse(options.db, paid.receiptId, payload.businessFailure.message, clock())
      }
      return {
        sourceText: source.sourceText,
        translatedText: source.sourceText,
        sourceHash: source.sourceHash,
        status: "failed",
        errorCode: payload.businessFailure.code,
        errorMessage: payload.businessFailure.message,
        usage: payload.usage,
        providerCalled: !paid.reused,
        receiptId: paid.receiptId,
        reused: paid.reused,
        usageRecordedByPaidRequest: true,
      }
    }

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
    if (error instanceof ProviderError) {
      return {
        sourceText: source.sourceText,
        translatedText: source.sourceText,
        sourceHash: source.sourceHash,
        status: "failed",
        errorCode: error.code,
        errorMessage: error.message,
        providerCalled: true,
        usageRecordedByPaidRequest: true,
      }
    }
    if (error instanceof TranslationBusinessUnknownError) {
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
    const message = error instanceof Error ? error.message : String(error)
    const errorCode = error && typeof error === "object" && "code" in error && typeof (error as { code?: unknown }).code === "string"
      ? (error as { code: string }).code
      : "provider_unavailable"
    return {
      sourceText: source.sourceText,
      translatedText: source.sourceText,
      sourceHash: source.sourceHash,
      status: "failed",
      errorCode,
      errorMessage: message,
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
