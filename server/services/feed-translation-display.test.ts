import NativeDatabase from "better-sqlite3"
import { createDatabase } from "db0"
import { describe, expect, it } from "vitest"
import { createMockSnapshot } from "@shared/shipping-fixtures"
import type { FeedItem, TranslationSettings } from "@shared/shipping"
import { initShippingTables } from "#/database/shipping"
import { TranslationRepository } from "#/database/translation"
import { mapFeedItemsForDisplay } from "#/services/feed-translation-display"
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
})
