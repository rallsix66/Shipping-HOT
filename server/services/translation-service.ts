import { createHash } from "node:crypto"
import type { FeedItem } from "@shared/shipping"
import { ProviderError } from "#/providers/contracts"
import type { TranslationCacheRecord, TranslationProvider, TranslationUsage } from "#/providers/contracts"
import type { TranslationCacheExactLookup, TranslationCacheLookup, TranslationRepository } from "#/database/translation"
import { protectTranslationText, restoreAndValidateProtectedTranslation } from "#/services/translation-protection"

export const TRANSLATION_CONTRACT_VERSION = "translation-faithful-v1"
export const DEFAULT_TRANSLATION_TARGET_LANGUAGE = "zh-CN"
export const FEED_TRANSLATABLE_FIELDS = ["title", "summary"] as const

export type FeedTranslatableField = typeof FEED_TRANSLATABLE_FIELDS[number]
export type TranslationOutcomeStatus = "succeeded" | "original" | "failed" | "unconfigured"

export interface TranslationSource {
  entityType: string
  entityId: string
  fieldName: string
  sourceText: string
  sourceLanguage?: string
  targetLanguage?: string
  protectedTerms?: string[]
}

export interface TranslationOutcome {
  sourceText: string
  translatedText: string
  sourceHash: string
  status: TranslationOutcomeStatus
  cache?: TranslationCacheRecord
  usage?: TranslationUsage
  errorCode?: string
  errorMessage?: string
  providerCalled?: boolean
}

export interface PreparedTranslationSource extends TranslationSource {
  sourceLanguage: string
  targetLanguage: string
  sourceHash: string
}

export interface TranslationExecutionResult {
  sourceText: string
  translatedText: string
  sourceHash: string
  status: "succeeded" | "failed" | "unconfigured"
  usage?: TranslationUsage
  errorCode?: string
  errorMessage?: string
  providerCalled: boolean
}

export interface TranslationServiceOptions {
  targetLanguage?: string
  sourceLanguage?: string
  contractVersion?: string
  preference?: TranslationPreference
  now?: () => string
}

export interface TranslationPreference {
  providerId?: string
  model?: string
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0).map(([key, child]) => `${JSON.stringify(key)}:${stableJson(child)}`).join(",")}}`
  }
  return JSON.stringify(value)
}

export function normalizeTranslationText(sourceText: string): string {
  return sourceText.normalize("NFKC").replace(/\r\n?/g, "\n")
}

export function canonicalLanguage(language: string | undefined, fallback = "auto"): string {
  const candidate = language?.trim().replace(/_/g, "-")
  if (!candidate) return canonicalLanguageFallback(fallback)
  const sentinel = candidate.toLowerCase()
  if (sentinel === "auto" || sentinel === "unknown") return sentinel
  try {
    return Intl.getCanonicalLocales(candidate)[0] ?? canonicalLanguageFallback(fallback)
  } catch {
    return canonicalLanguageFallback(fallback)
  }
}

function canonicalLanguageFallback(fallback: string): string {
  const candidate = fallback.trim().replace(/_/g, "-")
  if (!candidate) return "auto"
  const sentinel = candidate.toLowerCase()
  if (sentinel === "auto" || sentinel === "unknown") return sentinel
  try {
    return Intl.getCanonicalLocales(candidate)[0] ?? candidate
  } catch {
    return candidate
  }
}

export interface TranslationHashInput {
  contractVersion?: string
  entityType: string
  fieldName: string
  /** Accepted for audit callers but intentionally excluded from the payload. */
  entityId?: string
  /** Accepted for audit callers but intentionally excluded from the payload. */
  provider?: string
  /** Accepted for audit callers but intentionally excluded from the payload. */
  model?: string
  sourceLanguage?: string
  targetLanguage: string
  sourceText: string
}

export function translationSourceHash(input: TranslationHashInput): string {
  const payload = {
    contractVersion: input.contractVersion ?? TRANSLATION_CONTRACT_VERSION,
    entityType: input.entityType,
    fieldName: input.fieldName,
    sourceLanguage: canonicalLanguage(input.sourceLanguage),
    targetLanguage: canonicalLanguage(input.targetLanguage, DEFAULT_TRANSLATION_TARGET_LANGUAGE),
    sourceText: normalizeTranslationText(input.sourceText),
  }
  return createHash("sha256").update(stableJson(payload), "utf8").digest("hex")
}

function cacheIdentity(input: TranslationSource, sourceHash: string, targetLanguage: string, provider: TranslationProvider): string {
  return [input.entityType, input.entityId, input.fieldName, sourceHash, targetLanguage, provider.providerId, provider.model].join("\u0000")
}

function nowFor(options: TranslationServiceOptions): string {
  return options.now?.() ?? new Date().toISOString()
}

function errorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return message.replace(/\b(?:api[-_ ]?key|authorization|bearer|token|secret)\b[^\r\n]{0,256}/gi, "[redacted]").slice(0, 500)
}

const explicitTranslationWrappers = [
  /^\s*Translation\s*:\s*/i,
  /^\s*Here is (?:the )?translation\s*:\s*/i,
  /^\s*Translated text\s*:\s*/i,
  /^\s*翻译如下[:：]\s*/,
  /^\s*译文[:：]\s*/,
]

function hasExplicitTranslationWrapper(value: string): boolean {
  return explicitTranslationWrappers.some(pattern => pattern.test(value))
}

function emptyOutcome(sourceText: string, sourceHash: string, status: Exclude<TranslationOutcomeStatus, "succeeded">): TranslationOutcome {
  return { sourceText, translatedText: sourceText, sourceHash, status, providerCalled: false }
}

export function isFeedItemTranslationEligible(item: FeedItem, now = new Date()): boolean {
  if (item.visibility !== "current") return false
  const nowMs = now.getTime()
  for (const timestamp of [item.effectiveAt, item.expiresAt, item.currentUntil]) {
    if (!timestamp) continue
    const parsed = Date.parse(timestamp)
    if (!Number.isFinite(parsed)) continue
    if (timestamp === item.effectiveAt && parsed > nowMs) return false
    if (timestamp !== item.effectiveAt && parsed <= nowMs) return false
  }
  return true
}

export function feedTranslationSources(item: FeedItem, targetLanguage = DEFAULT_TRANSLATION_TARGET_LANGUAGE, sourceLanguage?: string, now = new Date()): TranslationSource[] {
  if (!isFeedItemTranslationEligible(item, now)) return []
  return FEED_TRANSLATABLE_FIELDS
    .map(fieldName => ({
      entityType: "feed_item",
      entityId: item.id,
      fieldName,
      sourceText: item[fieldName],
      sourceLanguage,
      targetLanguage,
    }))
    .filter(source => source.sourceText.trim().length > 0)
}

export class TranslationService {
  private readonly inFlight = new Map<string, Promise<TranslationOutcome>>()

  constructor(
    private readonly repository: TranslationRepository,
    private readonly provider: TranslationProvider | undefined,
    private readonly options: TranslationServiceOptions = {},
  ) {}

  public prepare(input: TranslationSource): PreparedTranslationSource {
    const sourceLanguage = canonicalLanguage(input.sourceLanguage ?? this.options.sourceLanguage)
    const targetLanguage = canonicalLanguage(input.targetLanguage ?? this.options.targetLanguage, DEFAULT_TRANSLATION_TARGET_LANGUAGE)
    const sourceHash = translationSourceHash({
      contractVersion: this.options.contractVersion,
      entityType: input.entityType,
      fieldName: input.fieldName,
      sourceLanguage,
      targetLanguage,
      sourceText: input.sourceText,
    })
    return { ...input, sourceLanguage, targetLanguage, sourceHash }
  }

  private lookup(input: PreparedTranslationSource): TranslationCacheLookup {
    return {
      entityType: input.entityType,
      entityId: input.entityId,
      fieldName: input.fieldName,
      sourceHash: input.sourceHash,
      targetLanguage: input.targetLanguage,
    }
  }

  private exactLookup(input: PreparedTranslationSource, provider: TranslationProvider): TranslationCacheExactLookup {
    return {
      ...this.lookup(input),
      provider: provider.providerId,
      model: provider.model,
    }
  }

  private readPreference(): TranslationPreference | undefined {
    if (this.options.preference) return this.options.preference
    if (!this.provider) return undefined
    return { providerId: this.provider.providerId, model: this.provider.model }
  }

  private cacheOutcome(input: PreparedTranslationSource, cache: TranslationCacheRecord | undefined): TranslationOutcome {
    return cache
      ? { sourceText: input.sourceText, translatedText: cache.translatedText ?? input.sourceText, sourceHash: input.sourceHash, status: "succeeded", cache, providerCalled: false }
      : emptyOutcome(input.sourceText, input.sourceHash, "original")
  }

  /** Provider-free read path. Failed/pending cache rows are intentionally ignored. */
  async getCachedTranslation(input: TranslationSource): Promise<TranslationOutcome> {
    const prepared = this.prepare(input)
    const lookup = this.lookup(prepared)
    const preference = this.readPreference()
    const exact = preference?.providerId && preference.model
      ? await this.repository.findExactSuccessful({ ...lookup, provider: preference.providerId, model: preference.model })
      : undefined
    const cache = exact ?? await this.repository.findHistoricalSuccessful(lookup)
    return this.cacheOutcome(prepared, cache)
  }

  async translate(input: TranslationSource): Promise<TranslationOutcome> {
    const prepared = this.prepare(input)
    if (!prepared.sourceText.trim()) return emptyOutcome(prepared.sourceText, prepared.sourceHash, "original")
    const provider = this.provider
    const exact = provider
      ? await this.repository.findExactSuccessful(this.exactLookup(prepared, provider))
      : undefined
    if (exact) return this.cacheOutcome(prepared, exact)
    if (!provider) return emptyOutcome(prepared.sourceText, prepared.sourceHash, "unconfigured")

    const identity = cacheIdentity(prepared, prepared.sourceHash, prepared.targetLanguage, provider)
    const running = this.inFlight.get(identity)
    if (running) return running
    const task = this.translateAndPersist(prepared)
    this.inFlight.set(identity, task)
    try {
      return await task
    } finally {
      this.inFlight.delete(identity)
    }
  }

  /**
   * Provider execution only. Durable work state belongs to Translation Runtime + Repository.
   * This method never claims, leases, persists cache/usage, retries or changes provider runtime.
   */
  async execute(input: TranslationSource): Promise<TranslationExecutionResult> {
    return this.executePrepared(this.prepare(input))
  }

  private async executePrepared(input: PreparedTranslationSource): Promise<TranslationExecutionResult> {
    const provider = this.provider
    if (!provider) return { sourceText: input.sourceText, translatedText: input.sourceText, sourceHash: input.sourceHash, status: "unconfigured", providerCalled: false }
    try {
      const protectedSource = protectTranslationText(input.sourceText, input.protectedTerms)
      const result = await provider.translate({
        sourceText: protectedSource.protectedText,
        sourceLanguage: input.sourceLanguage,
        targetLanguage: input.targetLanguage,
        entityType: input.entityType,
        entityId: input.entityId,
        fieldName: input.fieldName,
      })
      if (!result.translatedText.trim()) throw new ProviderError("provider_contract_changed", "translation_provider_empty_result")
      if (hasExplicitTranslationWrapper(result.translatedText)) throw new ProviderError("provider_contract_changed", "translation_provider_wrapper_output")
      const translatedText = restoreAndValidateProtectedTranslation(protectedSource, result.translatedText)
      return { sourceText: input.sourceText, translatedText, sourceHash: input.sourceHash, status: "succeeded", usage: result.usage, providerCalled: true }
    } catch (error) {
      const errorCode = error instanceof ProviderError
        ? error.code
        : error && typeof error === "object" && "code" in error && typeof (error as { code?: unknown }).code === "string"
          ? (error as { code: string }).code
          : "provider_unavailable"
      return {
        sourceText: input.sourceText,
        translatedText: input.sourceText,
        sourceHash: input.sourceHash,
        status: "failed",
        errorCode,
        errorMessage: errorMessage(error),
        providerCalled: true,
      }
    }
  }

  private async translateAndPersist(input: PreparedTranslationSource): Promise<TranslationOutcome> {
    const provider = this.provider
    if (!provider) return emptyOutcome(input.sourceText, input.sourceHash, "unconfigured")
    const createdAt = nowFor(this.options)
    const base: TranslationCacheRecord = {
      id: `translation:${createHash("sha256").update(cacheIdentity(input, input.sourceHash, input.targetLanguage, provider)).digest("hex")}`,
      entityType: input.entityType,
      entityId: input.entityId,
      fieldName: input.fieldName,
      sourceText: input.sourceText,
      sourceHash: input.sourceHash,
      sourceLanguage: input.sourceLanguage,
      targetLanguage: input.targetLanguage,
      provider: provider.providerId,
      model: provider.model,
      status: "pending",
      retryCount: 0,
      nextRetryAt: null,
      retryable: false,
      leaseUntil: null,
      lastErrorCode: null,
      preferred: false,
      createdAt,
      updatedAt: createdAt,
    }
    await this.repository.save(base)
    const execution = await this.executePrepared(input)
    if (execution.status === "succeeded") {
      const now = nowFor(this.options)
      const saved = await this.repository.save({
        ...base,
        translatedText: execution.translatedText,
        translatedAt: now,
        status: "succeeded",
        retryable: false,
        nextRetryAt: null,
        leaseUntil: null,
        lastErrorCode: null,
        preferred: true,
        updatedAt: now,
      })
      return { sourceText: input.sourceText, translatedText: execution.translatedText, sourceHash: input.sourceHash, status: "succeeded", cache: saved, usage: execution.usage, providerCalled: true }
    }
    const saved = await this.repository.save({
      ...base,
      status: "failed",
      errorMessage: execution.errorMessage,
      lastErrorCode: execution.errorCode,
      updatedAt: nowFor(this.options),
    })
    return { sourceText: input.sourceText, translatedText: input.sourceText, sourceHash: input.sourceHash, status: "failed", cache: saved, errorCode: execution.errorCode, errorMessage: execution.errorMessage, providerCalled: true }
  }
}
