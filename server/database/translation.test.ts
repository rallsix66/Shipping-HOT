import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import NativeDatabase from "better-sqlite3"
import { createDatabase } from "db0"
import { describe, expect, it } from "vitest"
import { initShippingTables } from "./shipping"
import { TranslationRepository } from "./translation"
import { RuntimeRepository } from "./runtime-jobs"
import type { TranslationCacheRecord } from "#/providers/contracts"

function createNativeDatabase(path = ":memory:", onPrepare?: (sql: string) => void) {
  const native = new NativeDatabase(path)
  const database = createDatabase({
    name: "sqlite",
    dialect: "sqlite",
    getInstance: () => native,
    exec: (sql: string) => native.exec(sql),
    prepare: (sql: string) => {
      onPrepare?.(sql)
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
    expect(native.prepare("SELECT version FROM schema_migrations ORDER BY version DESC LIMIT 1").get()).toEqual({ version: 12 })
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

  it("selects batch cache candidates with exact, historical, pending and failed states", async () => {
    const { database, native } = createNativeDatabase()
    await initShippingTables(database, "mock")
    const repository = new TranslationRepository(database)
    const preference = { providerId: "current", model: "current-v2" }
    const exact = { entityType: "feed_item", entityId: "feed-exact", fieldName: "title", sourceHash: "hash-exact", targetLanguage: "zh-CN" }
    const historical = { entityType: "feed_item", entityId: "feed-history", fieldName: "title", sourceHash: "hash-history", targetLanguage: "zh-CN" }
    const pending = { entityType: "feed_item", entityId: "feed-pending", fieldName: "title", sourceHash: "hash-pending", targetLanguage: "zh-CN" }
    const failed = { entityType: "feed_item", entityId: "feed-failed", fieldName: "title", sourceHash: "hash-failed", targetLanguage: "zh-CN" }

    await repository.save(record({ id: "translation:batch-exact", ...exact, provider: "current", model: "current-v2", translatedText: "当前译文" }))
    await repository.save(record({ id: "translation:batch-history", ...historical, provider: "old", model: "old-v1", translatedText: "历史译文" }))
    await repository.save(record({ id: "translation:batch-pending", ...pending, provider: "current", model: "current-v2", status: "pending", translatedText: undefined, translatedAt: undefined }))
    await repository.save(record({ id: "translation:batch-failed", ...failed, provider: "current", model: "current-v2", status: "failed", translatedText: undefined, translatedAt: undefined }))

    const result = await repository.findSuccessfulBatch([exact, historical, pending, failed], preference)
    expect(result.get(JSON.stringify([exact.entityType, exact.entityId, exact.fieldName, exact.sourceHash, exact.targetLanguage]))).toMatchObject({ cache: { translatedText: "当前译文" }, pending: false, failed: false })
    expect(result.get(JSON.stringify([historical.entityType, historical.entityId, historical.fieldName, historical.sourceHash, historical.targetLanguage]))).toMatchObject({ cache: { translatedText: "历史译文", provider: "old" }, pending: false, failed: false })
    expect(result.get(JSON.stringify([pending.entityType, pending.entityId, pending.fieldName, pending.sourceHash, pending.targetLanguage]))).toEqual({ pending: true, failed: false })
    expect(result.get(JSON.stringify([failed.entityType, failed.entityId, failed.fieldName, failed.sourceHash, failed.targetLanguage]))).toEqual({ pending: false, failed: true })
    native.close()
  })

  it("bounds batch reads instead of issuing one query per Feed field", async () => {
    let translationSelects = 0
    const { database, native } = createNativeDatabase(":memory:", (sql) => {
      if (sql.includes("FROM translation_cache")) translationSelects += 1
    })
    await initShippingTables(database, "mock")
    translationSelects = 0
    const inputs = Array.from({ length: 200 }, (_, index) => ({
      entityType: "feed_item",
      entityId: `feed-${index}`,
      fieldName: index % 2 ? "summary" : "title",
      sourceHash: `hash-${index}`,
      targetLanguage: "zh-CN",
    }))
    const result = await new TranslationRepository(database).findSuccessfulBatch(inputs, { providerId: "deepseek", model: "deepseek-v4-flash" })
    expect(result.size).toBe(200)
    expect(translationSelects).toBe(2)
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

  it("claims one active owner, finalizes success atomically with usage, and skips the second claimant", async () => {
    const { database, native } = createNativeDatabase()
    await initShippingTables(database, "real")
    const repository = new TranslationRepository(database)
    const identity = {
      entityType: "feed_item",
      entityId: "feed-work-1",
      fieldName: "title",
      sourceHash: "hash-work-1",
      targetLanguage: "zh-CN",
      provider: "deepseek",
      model: "deepseek-v4-flash",
    }
    const claims = await Promise.all([
      repository.claimTranslationWork({ ...identity, sourceText: "Port delay", sourceLanguage: "en", now: "2026-09-02T00:00:00.000Z", leaseUntil: "2026-09-02T00:01:00.000Z" }),
      repository.claimTranslationWork({ ...identity, sourceText: "Port delay", sourceLanguage: "en", now: "2026-09-02T00:00:00.000Z", leaseUntil: "2026-09-02T00:02:00.000Z" }),
    ])
    expect(claims.filter(Boolean)).toHaveLength(1)
    const claimed = claims.find(Boolean)
    if (!claimed?.leaseUntil) throw new Error("translation claim missing lease")

    await expect(repository.completeTranslationSuccess({
      ...identity,
      leaseUntil: claimed.leaseUntil,
      translatedText: "港口延误",
      translatedAt: "2026-09-02T00:00:30.000Z",
      now: "2026-09-02T00:00:30.000Z",
      providerUsage: {
        providerId: "deepseek",
        capability: "translation",
        request: true,
        succeeded: true,
        records: 1,
        sourceScope: "feed",
        calledAt: "2026-09-02T00:00:30.000Z",
      },
    })).resolves.toMatchObject({ status: "succeeded", retryCount: 0, retryable: false, leaseUntil: undefined, lastErrorCode: undefined })
    await expect(new RuntimeRepository(database).aggregateProviderUsage({ providerId: "deepseek", capability: "translation" })).resolves.toMatchObject({ requestCount: 1, successCount: 1, recordsCount: 1 })
    expect(native.prepare("SELECT status, lease_until, last_error_code FROM translation_cache WHERE entity_id = 'feed-work-1'").get()).toEqual({ status: "succeeded", lease_until: null, last_error_code: null })
    native.close()
  })

  it("persists retryable failures, respects next retry, blocks non-retryable rows, and supports explicit requeue", async () => {
    const { database, native } = createNativeDatabase()
    await initShippingTables(database, "real")
    const repository = new TranslationRepository(database)
    const identity = {
      entityType: "feed_item",
      entityId: "feed-work-2",
      fieldName: "summary",
      sourceHash: "hash-work-2",
      targetLanguage: "zh-CN",
      provider: "deepseek",
      model: "deepseek-v4-flash",
    }
    const first = await repository.claimTranslationWork({ ...identity, sourceText: "Port storm", now: "2026-09-02T00:00:00.000Z", leaseUntil: "2026-09-02T00:01:00.000Z" })
    if (!first?.leaseUntil) throw new Error("translation claim missing lease")
    await repository.completeRetryableFailure({
      ...identity,
      leaseUntil: first.leaseUntil,
      errorCode: "rate_limited",
      errorMessage: "provider rate limited",
      nextRetryAt: "2026-09-02T00:02:00.000Z",
      now: "2026-09-02T00:00:01.000Z",
      providerUsage: { providerId: "deepseek", capability: "translation", request: true, failed: true, sourceScope: "feed", calledAt: "2026-09-02T00:00:01.000Z", errorCode: "rate_limited" },
    })
    await expect(repository.claimTranslationWork({ ...identity, sourceText: "Port storm", now: "2026-09-02T00:01:00.000Z", leaseUntil: "2026-09-02T00:03:00.000Z" })).resolves.toBeUndefined()
    const second = await repository.claimTranslationWork({ ...identity, sourceText: "Port storm", now: "2026-09-02T00:02:00.000Z", leaseUntil: "2026-09-02T00:03:00.000Z" })
    if (!second?.leaseUntil) throw new Error("translation retry claim missing lease")
    await repository.completeNonRetryableFailure({ ...identity, leaseUntil: second.leaseUntil, errorCode: "auth_failed", errorMessage: "credential rejected", now: "2026-09-02T00:02:01.000Z" })
    await expect(repository.claimTranslationWork({ ...identity, sourceText: "Port storm", now: "2026-09-02T00:03:00.000Z", leaseUntil: "2026-09-02T00:04:00.000Z" })).resolves.toBeUndefined()
    await expect(repository.findWork(identity)).resolves.toMatchObject({ status: "failed", retryCount: 1, retryable: false, lastErrorCode: "auth_failed", nextRetryAt: undefined })

    await expect(repository.requeueTranslationFailures({
      provider: "deepseek",
      model: "deepseek-v4-flash",
      eligibleIdentities: [identity],
      errorCodes: ["auth_failed"],
      reason: "credential repaired",
      now: "2026-09-02T00:05:00.000Z",
    })).resolves.toMatchObject({ selected: 1, requeued: 1, skipped: 0 })
    await expect(repository.findWork(identity)).resolves.toMatchObject({ status: "failed", retryCount: 0, retryable: true, nextRetryAt: "2026-09-02T00:05:00.000Z" })
    await expect(new RuntimeRepository(database).aggregateProviderUsage({ providerId: "deepseek", capability: "translation" })).resolves.toMatchObject({ requestCount: 1, failureCount: 1 })
    native.close()
  })

  it("marks expired pending work as provider-attempt-unknown without opening a provider circuit", async () => {
    const { database, native } = createNativeDatabase()
    await initShippingTables(database, "real")
    const repository = new TranslationRepository(database)
    const identity = { entityType: "feed_item", entityId: "feed-work-3", fieldName: "title", sourceHash: "hash-work-3", targetLanguage: "zh-CN", provider: "deepseek", model: "deepseek-v4-flash" }
    await repository.claimTranslationWork({ ...identity, sourceText: "Port unknown", now: "2026-09-02T00:00:00.000Z", leaseUntil: "2026-09-02T00:01:00.000Z" })
    await expect(repository.recoverStaleLease({ ...identity, now: "2026-09-02T00:02:00.000Z" })).resolves.toBe(true)
    await expect(repository.findWork(identity)).resolves.toMatchObject({ status: "failed", retryable: false, lastErrorCode: "provider_attempt_unknown" })
    await expect(new RuntimeRepository(database).getProviderRuntime("deepseek", "translation")).resolves.toBeUndefined()
    native.close()
  })

  it("restores retryable durable work after a database restart", async () => {
    const directory = mkdtempSync(join(tmpdir(), "shipping-hot-translation-work-"))
    const path = join(directory, "translation.sqlite3")
    const identity = { entityType: "feed_item", entityId: "feed-restart", fieldName: "title", sourceHash: "hash-restart", targetLanguage: "zh-CN", provider: "deepseek", model: "deepseek-v4-flash" }
    const first = createNativeDatabase(path)
    await initShippingTables(first.database, "real")
    const firstRepository = new TranslationRepository(first.database)
    const claimed = await firstRepository.claimTranslationWork({ ...identity, sourceText: "Port restart", now: "2026-09-02T00:00:00.000Z", leaseUntil: "2026-09-02T00:01:00.000Z" })
    if (!claimed?.leaseUntil) throw new Error("translation restart claim missing lease")
    await firstRepository.completeRetryableFailure({ ...identity, leaseUntil: claimed.leaseUntil, errorCode: "provider_timeout", errorMessage: "timeout", nextRetryAt: "2026-09-02T00:02:00.000Z", now: "2026-09-02T00:00:01.000Z" })
    first.native.close()

    const restarted = createNativeDatabase(path)
    await initShippingTables(restarted.database, "real")
    const restartedRepository = new TranslationRepository(restarted.database)
    await expect(restartedRepository.findWork(identity)).resolves.toMatchObject({ status: "failed", retryCount: 1, retryable: true, nextRetryAt: "2026-09-02T00:02:00.000Z", lastErrorCode: "provider_timeout" })
    await expect(restartedRepository.claimTranslationWork({ ...identity, sourceText: "Port restart", now: "2026-09-02T00:02:00.000Z", leaseUntil: "2026-09-02T00:03:00.000Z" })).resolves.toMatchObject({ status: "pending", retryCount: 1 })
    restarted.native.close()
    rmSync(directory, { recursive: true, force: true })
  })
})
