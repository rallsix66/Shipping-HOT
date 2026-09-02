import NativeDatabase from "better-sqlite3"
import { createDatabase } from "db0"
import { describe, expect, it } from "vitest"
import type { FeedItem, ShippingEvent } from "@shared/shipping"
import {
  DEFAULT_TRANSLATION_TARGET_LANGUAGE,
  FEED_TRANSLATABLE_FIELDS,
  TranslationService,
  feedTranslationSources,
  isFeedItemTranslationEligible,
  normalizeTranslationText,
  translationSourceHash,
} from "./translation-service"
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
    expect(translationSourceHash(base)).toBe(translationSourceHash(normalized))
    expect(translationSourceHash({ ...base, contractVersion: "translation-faithful-v2" })).not.toBe(translationSourceHash(base))
    expect(translationSourceHash({ ...base, entityId: "feed-1", provider: "provider-one", model: "model-one" })).toBe(translationSourceHash({ ...base, entityId: "feed-2", provider: "provider-two", model: "model-two" }))
    expect(translationSourceHash({ ...base, sourceText: "Port changed" })).not.toBe(translationSourceHash(base))
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

  it("keeps historical cache on provider/model changes and never selects pending or failed rows", async () => {
    const { database, native } = createNativeDatabase()
    await initShippingTables(database, "mock")
    const repository = new TranslationRepository(database)
    const first = new FakeTranslationProvider({ providerId: "provider-one", model: "model-one", translateText: () => "历史译文" })
    const second = new FakeTranslationProvider({ providerId: "provider-two", model: "model-two", translateText: () => "新译文" })
    const source = { entityType: "feed_item", entityId: "feed-1", fieldName: "title", sourceText: "Port delay", targetLanguage: "zh-CN" }
    const firstService = new TranslationService(repository, first, { now: () => "2026-09-02T00:00:00.000Z" })
    await firstService.translate(source)

    const secondService = new TranslationService(repository, second, { now: () => "2026-09-02T00:01:00.000Z" })
    await expect(secondService.translate(source)).resolves.toMatchObject({ status: "succeeded", translatedText: "历史译文" })
    expect(second.calls).toHaveLength(0)

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

  it("has a provider-free cache read path", async () => {
    const { database, native } = createNativeDatabase()
    await initShippingTables(database, "mock")
    const provider = new FakeTranslationProvider()
    const repository = new TranslationRepository(database)
    const service = new TranslationService(repository, provider)
    const source = { entityType: "feed_item", entityId: "feed-1", fieldName: "title", sourceText: "Port delay", targetLanguage: "zh-CN" }
    await service.translate(source)
    const callsBeforeRead = provider.calls.length
    await expect(service.getCachedTranslation(source)).resolves.toMatchObject({ status: "succeeded", translatedText: "[zh-CN] Port delay" })
    expect(provider.calls).toHaveLength(callsBeforeRead)
    native.close()
  })
})
