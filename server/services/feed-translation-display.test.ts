import NativeDatabase from "better-sqlite3"
import { createDatabase } from "db0"
import { describe, expect, it } from "vitest"
import { createMockSnapshot } from "@shared/shipping-fixtures"
import type { FeedItem, FeedItemDisplay, HotItem, TranslationSettings } from "@shared/shipping"
import { initShippingTables } from "#/database/shipping"
import { TranslationRepository } from "#/database/translation"
import { mapFeedItemsForDisplay, mapHotItemsForDisplay } from "#/services/feed-translation-display"
import { TranslationService } from "#/services/translation-service"

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

function cacheRecord(source: ReturnType<TranslationService["prepare"]>, translatedText: string, overrides: Record<string, unknown> = {}) {
  return {
    id: `translation:${source.entityId}:${source.fieldName}:${source.sourceHash}`,
    entityType: source.entityType,
    entityId: source.entityId,
    fieldName: source.fieldName,
    sourceText: source.sourceText,
    sourceHash: source.sourceHash,
    sourceLanguage: source.sourceLanguage,
    targetLanguage: source.targetLanguage,
    provider: "deepseek",
    model: "deepseek-v4-flash",
    translatedText,
    translatedAt: "2026-09-03T00:00:00.000Z",
    status: "succeeded" as const,
    preferred: true,
    createdAt: "2026-09-03T00:00:00.000Z",
    updatedAt: "2026-09-03T00:00:00.000Z",
    ...overrides,
  }
}

const enabledTranslation: TranslationSettings = { enabled: true, providerId: "deepseek", model: "deepseek-v4-flash", targetLanguage: "zh-CN", monthlyBudget: 1 }
const disabledTranslation: TranslationSettings = { ...enabledTranslation, enabled: false, monthlyBudget: 0 }

function feedHot(item: FeedItem, overrides: Partial<HotItem> = {}): HotItem {
  return {
    id: `hot:${item.id}`,
    kind: "feed",
    title: item.title,
    summary: item.summary,
    severity: item.severity,
    freshness: "fresh",
    sourceStatus: "healthy",
    occurredAt: item.publishedAt,
    feedItemId: item.id,
    ...overrides,
  }
}

describe("feed translation display mapper", () => {
  it("reads exact and historical successes while preserving original Feed facts", async () => {
    const { database, native } = createNativeDatabase()
    await initShippingTables(database, "mock")
    const item = { ...createMockSnapshot().feedItems[0], visibility: "current" as const }
    const service = new TranslationService(new TranslationRepository(database), undefined, { targetLanguage: "zh-CN" })
    const title = service.prepare({ entityType: "feed_item", entityId: item.id, fieldName: "title", sourceText: item.title, targetLanguage: "zh-CN" })
    const summary = service.prepare({ entityType: "feed_item", entityId: item.id, fieldName: "summary", sourceText: item.summary, targetLanguage: "zh-CN" })
    const repository = new TranslationRepository(database)
    await repository.save(cacheRecord(title, "蛇口港作业窗口提醒"))
    await repository.save(cacheRecord(summary, "码头建议预留缓冲时间", { provider: "legacy", model: "legacy-v1" }))

    const [display] = await mapFeedItemsForDisplay(database, [item], enabledTranslation, new Date())
    expect(display).toMatchObject({ title: item.title, summary: item.summary, displayTitle: "蛇口港作业窗口提醒", displaySummary: "码头建议预留缓冲时间", translation: { title: "translated", summary: "historical" } })
    native.close()
  })

  it("falls back to original text and exposes pending/failed without selecting them", async () => {
    const { database, native } = createNativeDatabase()
    await initShippingTables(database, "mock")
    const item = { ...createMockSnapshot().feedItems[0], visibility: "current" as const }
    const service = new TranslationService(new TranslationRepository(database), undefined, { targetLanguage: "zh-CN" })
    const title = service.prepare({ entityType: "feed_item", entityId: item.id, fieldName: "title", sourceText: item.title, targetLanguage: "zh-CN" })
    const summary = service.prepare({ entityType: "feed_item", entityId: item.id, fieldName: "summary", sourceText: item.summary, targetLanguage: "zh-CN" })
    const repository = new TranslationRepository(database)
    await repository.save(cacheRecord(title, "", { status: "pending", translatedText: undefined, translatedAt: undefined }))
    await repository.save(cacheRecord(summary, "", { status: "failed", translatedText: undefined, translatedAt: undefined }))

    const [display] = await mapFeedItemsForDisplay(database, [item], enabledTranslation, new Date())
    expect(display.displayTitle).toBe(item.title)
    expect(display.displaySummary).toBe(item.summary)
    expect(display.translation).toEqual({ title: "pending", summary: "unavailable" })
    expect(JSON.stringify(display)).not.toContain("provider_contract_changed")
    native.close()
  })

  it("does not reuse a historical row after the source changes and reads cache while disabled", async () => {
    const { database, native } = createNativeDatabase()
    await initShippingTables(database, "mock")
    const item = { ...createMockSnapshot().feedItems[0], visibility: "current" as const }
    const service = new TranslationService(new TranslationRepository(database), undefined, { targetLanguage: "zh-CN" })
    const original = service.prepare({ entityType: "feed_item", entityId: item.id, fieldName: "title", sourceText: item.title, targetLanguage: "zh-CN" })
    await new TranslationRepository(database).save(cacheRecord(original, "旧标题"))
    const changed: FeedItem = { ...item, title: `${item.title}（更新）` }
    const [display] = await mapFeedItemsForDisplay(database, [changed], disabledTranslation, new Date())
    expect(display.displayTitle).toBe(changed.title)
    expect(display.translation.title).toBe("original")

    const [cachedDisplay] = await mapFeedItemsForDisplay(database, [item], disabledTranslation, new Date())
    expect(cachedDisplay.displayTitle).toBe("旧标题")
    expect(cachedDisplay.translation.title).toBe("translated")
    native.close()
  })

  it("enriches Feed HOT title and summary from the existing display batch only", () => {
    const item = createMockSnapshot().feedItems[0]
    const display: FeedItemDisplay = { ...item, displayTitle: "中文标题", displaySummary: "中文摘要", translation: { title: "translated", summary: "translated" } }
    const event: HotItem = {
      id: "event-hot",
      kind: "event",
      title: "事件原文",
      summary: "事件摘要",
      severity: "critical",
      freshness: "fresh",
      sourceStatus: "healthy",
      occurredAt: item.publishedAt,
      eventId: "event-1",
    }
    const hot = [feedHot(item), event]

    expect(mapHotItemsForDisplay(hot, [display])).toEqual([
      { ...hot[0], title: "中文标题", summary: "中文摘要" },
      event,
    ])
  })

  it.each([
    ["title only", { displayTitle: "中文标题", displaySummary: "原始摘要" }, "中文标题", "原始摘要"],
    ["summary only", { displayTitle: "原始标题", displaySummary: "中文摘要" }, "原始标题", "中文摘要"],
    ["no success", { displayTitle: "原始标题", displaySummary: "原始摘要" }, "原始标题", "原始摘要"],
    ["pending", { displayTitle: "原始标题", displaySummary: "原始摘要" }, "原始标题", "原始摘要"],
    ["failed", { displayTitle: "原始标题", displaySummary: "原始摘要" }, "原始标题", "原始摘要"],
    ["source changed", { displayTitle: "更新后的原始标题", displaySummary: "更新后的原始摘要" }, "更新后的原始标题", "更新后的原始摘要"],
  ] as const)("falls back safely for %s display state", (_, displayValues, expectedTitle, expectedSummary) => {
    const item = createMockSnapshot().feedItems[0]
    const display: FeedItemDisplay = { ...item, ...displayValues, translation: { title: "original", summary: "original" } }
    const [result] = mapHotItemsForDisplay([feedHot(item)], [display])
    expect(result).toMatchObject({ title: expectedTitle, summary: expectedSummary })
  })

  it("keeps HOT order, severity and dedupe identity independent from display text", () => {
    const items = createMockSnapshot().feedItems.slice(0, 2)
    const hot = [
      feedHot(items[0], { id: "hot-a", severity: "critical" }),
      feedHot(items[1], { id: "hot-b", severity: "warning" }),
    ]
    const display = items.map((item, index) => ({ ...item, displayTitle: `完全不同的翻译标题 ${index}`, displaySummary: `完全不同的翻译摘要 ${index}`, translation: { title: "translated" as const, summary: "translated" as const } }))
    const result = mapHotItemsForDisplay(hot, display)

    expect(result.map(item => item.id)).toEqual(hot.map(item => item.id))
    expect(result.map(item => item.severity)).toEqual(hot.map(item => item.severity))
    expect(result.map(item => item.feedItemId)).toEqual(hot.map(item => item.feedItemId))
  })
})
