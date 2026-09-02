import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import NativeDatabase from "better-sqlite3"
import { createDatabase } from "db0"
import { describe, expect, it } from "vitest"
import { initShippingTables } from "./shipping"
import { TranslationRepository } from "./translation"
import type { TranslationCacheRecord } from "#/providers/contracts"

function createNativeDatabase(path = ":memory:") {
  const native = new NativeDatabase(path)
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

function record(overrides: Partial<TranslationCacheRecord> = {}): TranslationCacheRecord {
  return {
    id: "translation:test",
    entityType: "feed_item",
    entityId: "feed-1",
    fieldName: "title",
    sourceText: "Port delay",
    sourceHash: "hash-1",
    sourceLanguage: "en",
    targetLanguage: "zh-CN",
    provider: "fake-one",
    model: "fake-v1",
    status: "succeeded",
    translatedText: "港口延误",
    translatedAt: "2026-09-02T00:00:00.000Z",
    preferred: false,
    createdAt: "2026-09-02T00:00:00.000Z",
    updatedAt: "2026-09-02T00:00:00.000Z",
    ...overrides,
  }
}

describe("translation repository", () => {
  it("persists success, pending and failure rows without requiring a migration", async () => {
    const { database, native } = createNativeDatabase()
    await initShippingTables(database, "mock")
    const repository = new TranslationRepository(database)

    await repository.save(record({ status: "pending", translatedText: undefined, translatedAt: undefined }))
    await repository.save(record({ status: "failed", translatedText: undefined, translatedAt: undefined, errorMessage: "provider unavailable" }))
    await repository.save(record({ status: "succeeded", translatedText: "港口延误", translatedAt: "2026-09-02T00:01:00.000Z" }))

    expect(native.prepare("SELECT COUNT(*) AS count FROM translation_cache").get()).toEqual({ count: 1 })
    await expect(repository.findHistoricalSuccessful({ entityType: "feed_item", entityId: "feed-1", fieldName: "title", sourceHash: "hash-1", targetLanguage: "zh-CN" })).resolves.toMatchObject({
      status: "succeeded",
      translatedText: "港口延误",
    })
    expect(native.prepare("SELECT version FROM schema_migrations ORDER BY version DESC LIMIT 1").get()).toEqual({ version: 11 })
    native.close()
  })

  it("selects the exact provider/model first and then a deterministic historical success", async () => {
    const { database, native } = createNativeDatabase()
    await initShippingTables(database, "mock")
    const repository = new TranslationRepository(database)
    const lookup = { entityType: "feed_item", entityId: "feed-1", fieldName: "title", sourceHash: "hash-1", targetLanguage: "zh-CN" }

    await repository.save(record({ provider: "z-provider", model: "z-model", translatedAt: "2026-09-02T00:00:00.000Z", translatedText: "较早" }))
    await repository.save(record({ id: "translation:failed", provider: "a-provider", model: "a-model", status: "failed", translatedText: undefined, translatedAt: undefined }))
    await repository.save(record({ id: "translation:exact", provider: "current", model: "current-v2", translatedAt: "2026-09-02T00:02:00.000Z", translatedText: "当前" }))

    await expect(repository.findExactSuccessful({ ...lookup, provider: "current", model: "current-v2" })).resolves.toMatchObject({ translatedText: "当前" })
    await expect(repository.findHistoricalSuccessful(lookup)).resolves.toMatchObject({ translatedText: "当前" })

    await repository.save(record({ id: "translation:exact", provider: "current", model: "current-v2", status: "failed", translatedText: undefined, translatedAt: undefined }))
    await expect(repository.findExactSuccessful({ ...lookup, provider: "current", model: "current-v2" })).resolves.toBeUndefined()
    await expect(repository.findHistoricalSuccessful(lookup)).resolves.toMatchObject({ provider: "z-provider", translatedText: "较早" })
    native.close()
  })

  it("uses translated_at, provider and model for deterministic historical ordering, never updated_at", async () => {
    const { database, native } = createNativeDatabase()
    await initShippingTables(database, "mock")
    const repository = new TranslationRepository(database)
    const lookup = { entityType: "feed_item", entityId: "feed-1", fieldName: "title", sourceHash: "hash-1", targetLanguage: "zh-CN" }
    const translatedAt = "2026-09-02T00:00:00.000Z"

    await repository.save(record({ id: "translation:provider-b", provider: "provider-b", model: "model-a", translatedAt, updatedAt: "2026-09-02T00:02:00.000Z", translatedText: "B" }))
    await repository.save(record({ id: "translation:provider-a", provider: "provider-a", model: "model-z", translatedAt, updatedAt: "2026-09-02T00:01:00.000Z", translatedText: "A" }))
    await expect(repository.findHistoricalSuccessful(lookup)).resolves.toMatchObject({ provider: "provider-a", model: "model-z", translatedText: "A" })

    await repository.save(record({ id: "translation:provider-b", provider: "provider-b", model: "model-a", translatedAt, updatedAt: "2026-09-02T00:03:00.000Z", translatedText: "B updated" }))
    await expect(repository.findHistoricalSuccessful(lookup)).resolves.toMatchObject({ provider: "provider-a", model: "model-z", translatedText: "A" })
    native.close()
  })

  it("survives a database restart", async () => {
    const directory = mkdtempSync(join(tmpdir(), "shipping-hot-translation-"))
    const path = join(directory, "translation.sqlite3")
    const first = createNativeDatabase(path)
    await initShippingTables(first.database, "mock")
    await new TranslationRepository(first.database).save(record())
    first.native.close()

    const restarted = createNativeDatabase(path)
    await initShippingTables(restarted.database, "mock")
    await expect(new TranslationRepository(restarted.database).findHistoricalSuccessful({ entityType: "feed_item", entityId: "feed-1", fieldName: "title", sourceHash: "hash-1", targetLanguage: "zh-CN" })).resolves.toMatchObject({ translatedText: "港口延误" })
    restarted.native.close()
    rmSync(directory, { recursive: true, force: true })
  })
})
