import NativeDatabase from "better-sqlite3"
import { createDatabase } from "db0"
import { describe, expect, it } from "vitest"
import type { FeedItem, ShippingEvent } from "@shared/shipping"
import {
  DEFAULT_TRANSLATION_TARGET_LANGUAGE,
  FEED_TRANSLATABLE_FIELDS,
  TranslationService,
  canonicalLanguage,
  feedTranslationSources,
  isFeedItemTranslationEligible,
  normalizeTranslationText,
  translationSourceHash,
} from "./translation-service"
import type { TranslationRequest } from "#/providers/contracts"
import { initShippingTables } from "#/database/shipping"
import { TranslationRepository } from "#/database/translation"
import { FakeTranslationProvider } from "#/providers/translation/fake-provider"

function createNativeDatabase() {
  const native = new NativeDatabase(":memory:")
  const database = createDatabase({
    name: "sqlite",
    dialect: "sqlite",
    getInstance: () => native,
    exec: (sql: string) => native.exec(sql),
    prepare: (sql: string) => {
      const statement = native.prepare(sql)
      return {
        all: async (...params: (string | number | boolean | null | undefined)[]) => statement.all(...params),
        get: async (...params: (string | number | boolean | null | undefined)[]) => statement.get(...params),
        run: async (...params: (string | number | boolean | null | undefined)[]) => {
          const result = statement.run(...params)
          return { success: result.changes > 0, changes: result.changes, lastInsertRowid: result.lastInsertRowid }
        },
      }
    },
    dispose: () => native.close(),
  } as never)
  return { database, native }
}

function feed(overrides: Partial<FeedItem> = {}): FeedItem {
  return {
    id: "feed-1",
    sourceId: "public-feed",
    category: "shipping_news",
    type: "news",
    title: "Port delay",
    summary: "Ships are delayed.",
    sourceUrl: "https://example.com/feed-1",
    publishedAt: "2026-09-02T00:00:00.000Z",
    currentUntil: "2026-09-03T00:00:00.000Z",
    visibility: "current",
    stale: false,
    sourceStatus: "healthy",
    severity: "warning",
    relatedPortIds: [],
    relatedVesselIds: [],
    relatedVoyageIds: [],
    ...overrides,
  }
}

function event(): ShippingEvent {
  return {
    id: "event-1",
    type: "port_delay",
    severity: "warning",
    status: "active",
    title: "Original event title",
    summary: "Original event summary",
    occurredAt: "2026-09-02T00:00:00.000Z",
    detectedAt: "2026-09-02T00:00:00.000Z",
    dedupeKey: "event-1",
    firstDetectedAt: "2026-09-02T00:00:00.000Z",
    lastDetectedAt: "2026-09-02T00:00:00.000Z",
    evidenceJson: { source: "feed-1" },
    sourceStatus: "healthy",
  }
}

describe("translation service T1 foundation", () => {
  it("computes a deterministic versioned hash with normalized text and no entity/provider/model identity", () => {
    const base = { contractVersion: "translation-faithful-v1", entityType: "feed_item", fieldName: "title", sourceLanguage: "EN_us", targetLanguage: "zh_cn", sourceText: "Port\r\ndelay" }
    const normalized = { ...base, sourceText: "Port\ndelay", sourceLanguage: "en-US", targetLanguage: "zh-CN" }
    expect(normalizeTranslationText("Ａ\r\nB\rC")).toBe("A\nB\nC")
    expect(canonicalLanguage("EN_us")).toBe("en-US")
    expect(canonicalLanguage("zh-hans-cn")).toBe("zh-Hans-CN")
    expect(canonicalLanguage("en__US", "auto")).toBe("auto")
    expect(canonicalLanguage("en__US", DEFAULT_TRANSLATION_TARGET_LANGUAGE)).toBe(DEFAULT_TRANSLATION_TARGET_LANGUAGE)
    expect(translationSourceHash(base)).toBe(translationSourceHash(normalized))
    expect(translationSourceHash({ ...base, contractVersion: "translation-faithful-v2" })).not.toBe(translationSourceHash(base))
    expect(translationSourceHash({ ...base, entityId: "feed-1", provider: "provider-one", model: "model-one" })).toBe(translationSourceHash({ ...base, entityId: "feed-2", provider: "provider-two", model: "model-two" }))
    expect(translationSourceHash({ ...base, sourceText: "Port changed" })).not.toBe(translationSourceHash(base))
    expect(translationSourceHash({ ...base, sourceLanguage: "en__US", targetLanguage: "en__US" })).toBe(translationSourceHash({ ...base, sourceLanguage: "auto", targetLanguage: DEFAULT_TRANSLATION_TARGET_LANGUAGE }))
  })

  it("limits automatic Feed scope to eligible current title and summary", () => {
    const now = new Date("2026-09-02T12:00:00.000Z")
    expect(FEED_TRANSLATABLE_FIELDS).toEqual(["title", "summary"])
    expect(isFeedItemTranslationEligible(feed(), now)).toBe(true)
    expect(feedTranslationSources(feed(), DEFAULT_TRANSLATION_TARGET_LANGUAGE, undefined, now)).toEqual([
      expect.objectContaining({ entityType: "feed_item", entityId: "feed-1", fieldName: "title", sourceText: "Port delay" }),
      expect.objectContaining({ fieldName: "summary", sourceText: "Ships are delayed." }),
    ])
    expect(feedTranslationSources(feed({ visibility: "history" }), DEFAULT_TRANSLATION_TARGET_LANGUAGE, undefined, now)).toEqual([])
    expect(feedTranslationSources(feed({ visibility: "quarantine" }), DEFAULT_TRANSLATION_TARGET_LANGUAGE, undefined, now)).toEqual([])
    expect(feedTranslationSources(feed({ currentUntil: "2026-09-02T11:59:00.000Z" }), DEFAULT_TRANSLATION_TARGET_LANGUAGE, undefined, now)).toEqual([])
    expect(feedTranslationSources(feed({ effectiveAt: "2026-09-02T13:00:00.000Z" }), DEFAULT_TRANSLATION_TARGET_LANGUAGE, undefined, now)).toEqual([])
    expect(feedTranslationSources(feed({ title: "", summary: "" }), DEFAULT_TRANSLATION_TARGET_LANGUAGE, undefined, now)).toEqual([])
  })

  it("persists success, returns exact cache hits without calling the provider, and falls back to original", async () => {
    const { database, native } = createNativeDatabase()
    await initShippingTables(database, "mock")
    const provider = new FakeTranslationProvider({ translateText: request => `translated:${request.sourceText}` })
    const service = new TranslationService(new TranslationRepository(database), provider, { now: () => "2026-09-02T00:00:00.000Z" })
    const source = { entityType: "feed_item", entityId: "feed-1", fieldName: "title", sourceText: "Port delay", targetLanguage: "zh-CN" }

    await expect(service.translate(source)).resolves.toMatchObject({ status: "succeeded", translatedText: "translated:Port delay" })
    expect(provider.calls).toHaveLength(1)
    await expect(service.translate(source)).resolves.toMatchObject({ status: "succeeded", translatedText: "translated:Port delay" })
    expect(provider.calls).toHaveLength(1)

    const changed = await service.translate({ ...source, sourceText: "Port delay changed" })
    expect(changed).toMatchObject({ status: "succeeded", translatedText: "translated:Port delay changed" })
    expect(changed.sourceHash).not.toBe((await service.getCachedTranslation(source)).sourceHash)

    const noProvider = new TranslationService(new TranslationRepository(database), undefined)
    await expect(noProvider.translate({ ...source, fieldName: "summary", sourceText: "No cache" })).resolves.toMatchObject({ status: "unconfigured", translatedText: "No cache" })
    native.close()
  })

  it("separates historical display fallback from provider/model translation execution", async () => {
    const { database, native } = createNativeDatabase()
    await initShippingTables(database, "mock")
    const repository = new TranslationRepository(database)
    const first = new FakeTranslationProvider({ providerId: "provider-one", model: "model-one", translateText: () => "历史译文" })
    const second = new FakeTranslationProvider({ providerId: "provider-two", model: "model-two", translateText: () => "新译文" })
    const source = { entityType: "feed_item", entityId: "feed-1", fieldName: "title", sourceText: "Port delay", targetLanguage: "zh-CN" }
    const firstService = new TranslationService(repository, first, { now: () => "2026-09-02T00:00:00.000Z" })
    await firstService.translate(source)

    const secondService = new TranslationService(repository, second, { now: () => "2026-09-02T00:01:00.000Z" })
    const providerFreeHistoricalRead = new TranslationService(repository, undefined, { preference: { providerId: "provider-two", model: "model-two" } })
    await expect(providerFreeHistoricalRead.getCachedTranslation(source)).resolves.toMatchObject({ status: "succeeded", translatedText: "历史译文", cache: { provider: "provider-one", model: "model-one" } })
    await expect(secondService.translate(source)).resolves.toMatchObject({ status: "succeeded", translatedText: "新译文", cache: { provider: "provider-two", model: "model-two" } })
    expect(second.calls).toHaveLength(1)
    await expect(repository.findExactSuccessful({ entityType: source.entityType, entityId: source.entityId, fieldName: source.fieldName, sourceHash: (await firstService.getCachedTranslation(source)).sourceHash, targetLanguage: source.targetLanguage, provider: "provider-one", model: "model-one" })).resolves.toMatchObject({ translatedText: "历史译文" })
    await expect(secondService.translate(source)).resolves.toMatchObject({ translatedText: "新译文" })
    expect(second.calls).toHaveLength(1)

    const newerModel = new FakeTranslationProvider({ providerId: "provider-two", model: "model-three", translateText: () => "更新模型译文" })
    const newerModelService = new TranslationService(repository, newerModel, { now: () => "2026-09-02T00:02:00.000Z" })
    const newerModelRead = new TranslationService(repository, undefined, { preference: { providerId: "provider-two", model: "model-three" } })
    await expect(newerModelRead.getCachedTranslation(source)).resolves.toMatchObject({ translatedText: "新译文", cache: { model: "model-two" } })
    await expect(newerModelService.translate(source)).resolves.toMatchObject({ translatedText: "更新模型译文", cache: { provider: "provider-two", model: "model-three" } })
    expect(newerModel.calls).toHaveLength(1)

    const failedProvider = new FakeTranslationProvider({
      providerId: "provider-failed",
      model: "model-failed",
      translateText: () => {
        throw new Error("provider unavailable")
      },
    })
    const failedService = new TranslationService(repository, failedProvider, { now: () => "2026-09-02T00:02:00.000Z" })
    const failedSource = { ...source, fieldName: "summary", sourceText: "No successful translation" }
    await expect(failedService.translate(failedSource)).resolves.toMatchObject({ status: "failed", translatedText: failedSource.sourceText, cache: { status: "failed" } })
    await expect(new TranslationService(repository, undefined).getCachedTranslation(failedSource)).resolves.toMatchObject({ status: "original", translatedText: failedSource.sourceText })
    native.close()
  })

  it("deduplicates concurrent misses, sanitizes persisted failures, and keeps facts untouched", async () => {
    const { database, native } = createNativeDatabase()
    await initShippingTables(database, "mock")
    const provider = new FakeTranslationProvider({
      translateText: () => {
        throw new Error("authorization=secret-value")
      },
    })
    const service = new TranslationService(new TranslationRepository(database), provider, { now: () => "2026-09-02T00:00:00.000Z" })
    const source = { entityType: "feed_item", entityId: "feed-1", fieldName: "title", sourceText: "Port delay", targetLanguage: "zh-CN" }
    const item = feed()
    const originalItem = structuredClone(item)
    const originalEvent = event()
    const originalEventCopy = structuredClone(originalEvent)
    const [first, second] = await Promise.all([service.translate(source), service.translate(source)])
    expect(first).toMatchObject({ status: "failed", translatedText: "Port delay", cache: { errorMessage: "[redacted]" } })
    expect(second).toEqual(first)
    expect(provider.calls).toHaveLength(1)
    expect(item).toEqual(originalItem)
    expect(originalEvent).toEqual(originalEventCopy)
    native.close()
  })

  it("protects literals at the Provider boundary while hashing and persisting the original source", async () => {
    const { database, native } = createNativeDatabase()
    await initShippingTables(database, "mock")
    const calls: string[] = []
    const provider = {
      providerId: "deepseek",
      model: "deepseek-v4-flash",
      translate: async (request: TranslationRequest) => {
        calls.push(request.sourceText)
        return { translatedText: `译文 ${request.sourceText}`, usage: { promptTokens: 12, completionTokens: 5, totalTokens: 17 } }
      },
    }
    const source = { entityType: "feed_item", entityId: "feed-1", fieldName: "title", sourceText: "Voyage AB123 reaches SGSIN: https://example.com/1", targetLanguage: "zh-CN" }
    const service = new TranslationService(new TranslationRepository(database), provider, { now: () => "2026-09-02T00:00:00.000Z" })
    const result = await service.translate(source)
    expect(result).toMatchObject({ status: "succeeded", translatedText: `译文 ${source.sourceText}`, providerCalled: true, usage: { promptTokens: 12, completionTokens: 5 } })
    expect(calls).toHaveLength(1)
    expect(calls[0]).not.toContain("AB123")
    expect(calls[0]).not.toContain("https://example.com/1")
    expect(result.sourceHash).toBe(translationSourceHash({ ...source, sourceText: source.sourceText }))
    native.close()
  })

  it.each(["Translation: translated text", "Here is the translation: translated text", "Translated text: translated text", "翻译如下：译文", "译文：译文"])("rejects the explicit provider wrapper %s", async (wrapper) => {
    const { database, native } = createNativeDatabase()
    await initShippingTables(database, "mock")
    const provider = new FakeTranslationProvider({ translateText: () => wrapper })
    const source = { entityType: "feed_item", entityId: "feed-1", fieldName: "title", sourceText: "Port delay", targetLanguage: "zh-CN" }
    const result = await new TranslationService(new TranslationRepository(database), provider).translate(source)
    expect(result).toMatchObject({ status: "failed", translatedText: source.sourceText, errorCode: "provider_contract_changed", cache: { status: "failed" } })
    native.close()
  })

  it("has a provider-free cache read path", async () => {
    const { database, native } = createNativeDatabase()
    await initShippingTables(database, "mock")
    const repository = new TranslationRepository(database)
    const source = { entityType: "feed_item", entityId: "feed-1", fieldName: "title", sourceText: "Port delay", targetLanguage: "zh-CN" }
    const sourceHash = translationSourceHash({ entityType: source.entityType, entityId: source.entityId, fieldName: source.fieldName, sourceLanguage: "auto", targetLanguage: source.targetLanguage, sourceText: source.sourceText })
    await repository.save({
      id: "translation:provider-a",
      entityType: source.entityType,
      entityId: source.entityId,
      fieldName: source.fieldName,
      sourceText: source.sourceText,
      sourceHash,
      sourceLanguage: "auto",
      targetLanguage: source.targetLanguage,
      provider: "provider-a",
      model: "model-a",
      translatedText: "A exact",
      translatedAt: "2026-09-02T00:00:00.000Z",
      status: "succeeded",
      preferred: false,
      createdAt: "2026-09-02T00:00:00.000Z",
      updatedAt: "2026-09-02T00:00:00.000Z",
    })
    await repository.save({
      id: "translation:provider-b",
      entityType: source.entityType,
      entityId: source.entityId,
      fieldName: source.fieldName,
      sourceText: source.sourceText,
      sourceHash,
      sourceLanguage: "auto",
      targetLanguage: source.targetLanguage,
      provider: "provider-b",
      model: "model-b",
      translatedText: "B historical",
      translatedAt: "2026-09-02T00:01:00.000Z",
      status: "succeeded",
      preferred: false,
      createdAt: "2026-09-02T00:01:00.000Z",
      updatedAt: "2026-09-02T00:01:00.000Z",
    })
    const exactRead = new TranslationService(repository, undefined, { preference: { providerId: "provider-a", model: "model-a" } })
    await expect(exactRead.getCachedTranslation(source)).resolves.toMatchObject({ status: "succeeded", translatedText: "A exact" })
    const historicalRead = new TranslationService(repository, undefined, { preference: { providerId: "provider-c", model: "model-c" } })
    await expect(historicalRead.getCachedTranslation(source)).resolves.toMatchObject({ status: "succeeded", translatedText: "B historical" })
    native.close()
  })
})
