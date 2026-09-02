import { createHash } from "node:crypto"
import type { FeedItem } from "@shared/shipping"
import type { TranslationCacheRecord, TranslationProvider } from "#/providers/contracts"
import type { TranslationCacheLookup, TranslationRepository } from "#/database/translation"

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
}

export interface TranslationOutcome {
  sourceText: string
  translatedText: string
  sourceHash: string
  status: TranslationOutcomeStatus
  cache?: TranslationCacheRecord
}

export interface TranslationServiceOptions {
  targetLanguage?: string
  sourceLanguage?: string
  contractVersion?: string
  now?: () => string
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)).map(([key, child]) => `${JSON.stringify(key)}:${stableJson(child)}`).join(",")}}`
  }
  return JSON.stringify(value)
}

export function normalizeTranslationText(sourceText: string): string {
  return sourceText.normalize("NFKC").replace(/\r\n?/g, "\n")
}

export function canonicalLanguage(language: string | undefined, fallback = "auto"): string {
  const value = (language?.trim() || fallback).replace(/_/g, "-")
  const parts = value.split("-").filter(Boolean)
  if (!parts.length) return fallback
  return parts.map((part, index) => index === 0 ? part.toLocaleLowerCase() : /^[a-z]{2}$/i.test(part) ? part.toLocaleUpperCase() : part).join("-")
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

function emptyOutcome(sourceText: string, sourceHash: string, status: Exclude<TranslationOutcomeStatus, "succeeded">): TranslationOutcome {
  return { sourceText, translatedText: sourceText, sourceHash, status }
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

  private prepared(input: TranslationSource) {
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

  private lookup(input: ReturnType<TranslationService["prepared"]>): TranslationCacheLookup {
    return {
      entityType: input.entityType,
      entityId: input.entityId,
      fieldName: input.fieldName,
      sourceHash: input.sourceHash,
      targetLanguage: input.targetLanguage,
    }
  }

  /** Provider-free read path. Failed/pending cache rows are intentionally ignored. */
  async getCachedTranslation(input: TranslationSource): Promise<TranslationOutcome> {
    const prepared = this.prepared(input)
    const lookup = this.lookup(prepared)
    const exact = await this.repository.findSuccessful({
      ...lookup,
      provider: this.provider?.providerId,
      model: this.provider?.model,
    })
    const cache = exact ?? await this.repository.findSuccessful(lookup)
    return cache
      ? { sourceText: prepared.sourceText, translatedText: cache.translatedText ?? prepared.sourceText, sourceHash: prepared.sourceHash, status: "succeeded", cache }
      : emptyOutcome(prepared.sourceText, prepared.sourceHash, "original")
  }

  async translate(input: TranslationSource): Promise<TranslationOutcome> {
    const prepared = this.prepared(input)
    if (!prepared.sourceText.trim()) return emptyOutcome(prepared.sourceText, prepared.sourceHash, "original")
    const cached = await this.getCachedTranslation(prepared)
    if (cached.status === "succeeded") return cached
    if (!this.provider) return emptyOutcome(prepared.sourceText, prepared.sourceHash, "unconfigured")

    const identity = cacheIdentity(prepared, prepared.sourceHash, prepared.targetLanguage, this.provider)
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

  private async translateAndPersist(input: ReturnType<TranslationService["prepared"]>): Promise<TranslationOutcome> {
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
      preferred: false,
      createdAt,
      updatedAt: createdAt,
    }
    await this.repository.save(base)
    try {
      const result = await provider.translate({
        sourceText: input.sourceText,
        sourceLanguage: input.sourceLanguage,
        targetLanguage: input.targetLanguage,
        entityType: input.entityType,
        entityId: input.entityId,
        fieldName: input.fieldName,
      })
      if (!result.translatedText.trim()) throw new Error("translation_provider_empty_result")
      const saved = await this.repository.save({
        ...base,
        translatedText: result.translatedText,
        translatedAt: nowFor(this.options),
        status: "succeeded",
        preferred: true,
        updatedAt: nowFor(this.options),
      })
      return { sourceText: input.sourceText, translatedText: result.translatedText, sourceHash: input.sourceHash, status: "succeeded", cache: saved }
    } catch (error) {
      const saved = await this.repository.save({
        ...base,
        status: "failed",
        errorMessage: errorMessage(error),
        updatedAt: nowFor(this.options),
      })
      return { sourceText: input.sourceText, translatedText: input.sourceText, sourceHash: input.sourceHash, status: "failed", cache: saved }
    }
  }
}
