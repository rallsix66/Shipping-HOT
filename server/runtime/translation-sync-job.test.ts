import NativeDatabase from "better-sqlite3"
import { createDatabase } from "db0"
import { describe, expect, it } from "vitest"
import type { FeedItem, ShippingSettings } from "@shared/shipping"
import { ShippingRepository, initShippingTables } from "#/database/shipping"
import { RuntimeRepository, isProviderCircuitBlocked } from "#/database/runtime-jobs"
import { TranslationRepository } from "#/database/translation"
import { ProviderError, type SecretSource, type SecretStore, type TranslationRequest } from "#/providers/contracts"
import { FakeTranslationProvider } from "#/providers/translation/fake-provider"
import { BackgroundRuntime } from "#/runtime/background-runtime"
import { TRANSLATION_PROVIDER_TIMEOUT_MS, createTranslationSyncJob } from "#/runtime/translation-sync-job"
import { translationRetryBackoffMs } from "#/services/translation-failure-policy"
import { mapFeedItemsForDisplay } from "#/services/feed-translation-display"
import { runTranslationTest } from "#/services/translation-test-service"
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

class TestSecretStore implements SecretStore {
  constructor(private value = "test-secret") {}

  async get() {
    return this.value
  }

  async set() {}
  async delete() {}
  async has() {
    return Boolean(this.value)
  }

  async source(): Promise<SecretSource> {
    return this.value ? "environment" : "missing"
  }

  setValue(value: string) {
    this.value = value
  }
}

function settings(enabled = true): ShippingSettings {
  return {
    refreshInterval: 15,
    sourceEnabled: true,
    providerEnabled: true,
    eventThresholds: { anchoredHours: 24, delayMinutes: 120, congestionLevel: "high" },
    retentionDays: 30,
    translation: { enabled, providerId: "deepseek", model: "deepseek-v4-flash", targetLanguage: "zh-CN", monthlyBudget: 1 },
  }
}

function feed(overrides: Partial<FeedItem> = {}): FeedItem {
  return {
    id: "feed-runtime-1",
    sourceId: "public-feed",
    category: "shipping_news",
    type: "news",
    title: "Port delay",
    summary: "Ships are delayed.",
    sourceUrl: "https://example.com/feed-runtime-1",
    publishedAt: "2026-09-02T00:00:00.000Z",
    currentUntil: "2026-09-03T00:00:00.000Z",
    visibility: "current",
    stale: false,
    sourceStatus: "healthy",
    severity: "warning",
    relatedPortIds: [],
    relatedVesselIds: [],
    relatedVoyageIds: [],
    provenance: { sourceType: "official", dataNature: "reported", sourceId: "public-feed", verified: false },
    source_type: "real",
    ...overrides,
  }
}

async function preparedState(inputFeed = feed(), dataMode: "mock" | "real" = "real") {
  const state = createNativeDatabase()
  await initShippingTables(state.database, dataMode)
  const shippingRepository = new ShippingRepository(state.database, dataMode)
  await shippingRepository.saveSettings(settings())
  await shippingRepository.upsertFeedItem(inputFeed)
  return { ...state, shippingRepository, translationRepository: new TranslationRepository(state.database), runtimeRepository: new RuntimeRepository(state.database) }
}

function translationProvider(translateText: (request: TranslationRequest) => string): FakeTranslationProvider {
  return new FakeTranslationProvider({ providerId: "deepseek", model: "deepseek-v4-flash", translateText })
}

describe("translation T3A Runtime Foundation", () => {
  it("scans only eligible Feed title/summary fields, bounds work, and hits exact cache without Provider calls", async () => {
    const state = await preparedState()
    const provider = translationProvider(request => `translated:${request.sourceText}`)
    const clock = new Date("2026-09-02T00:30:00.000Z")
    const job = createTranslationSyncJob({ database: state.database, dataMode: "real", provider, secretStore: new TestSecretStore(), now: () => clock })

    await expect(job.run()).resolves.toMatchObject({ status: "success", recordsRead: 2, recordsWritten: 2 })
    expect(provider.calls).toHaveLength(2)
    await expect(state.translationRepository.getStatistics("deepseek")).resolves.toEqual({ total: 2, succeeded: 2, pending: 0, failed: 0 })
    await expect(state.runtimeRepository.aggregateProviderUsage({ providerId: "deepseek", capability: "translation" })).resolves.toMatchObject({ requestCount: 2, successCount: 2, recordsCount: 2 })

    await expect(job.run()).resolves.toMatchObject({ status: "success", recordsWritten: 0 })
    expect(provider.calls).toHaveLength(2)
    await expect(state.runtimeRepository.aggregateProviderUsage({ providerId: "deepseek", capability: "translation" })).resolves.toMatchObject({ requestCount: 2, successCount: 2 })
    await expect(state.shippingRepository.listFeedItems({ now: clock, view: "current" })).resolves.toMatchObject([{ title: "Port delay", summary: "Ships are delayed." }])
    state.native.close()
  })

  it("caps one run at five fields and keeps deterministic newest-first ordering", async () => {
    const state = await preparedState()
    await state.shippingRepository.upsertFeedItem(feed({ id: "feed-runtime-2", title: "Second notice", summary: "Second summary", publishedAt: "2026-09-02T00:10:00.000Z", sourceUrl: "https://example.com/feed-runtime-2" }))
    await state.shippingRepository.upsertFeedItem(feed({ id: "feed-runtime-3", title: "Third notice", summary: "Third summary", publishedAt: "2026-09-02T00:20:00.000Z", sourceUrl: "https://example.com/feed-runtime-3" }))
    const provider = translationProvider(request => `translated:${request.sourceText}`)
    const job = createTranslationSyncJob({ database: state.database, dataMode: "real", provider, secretStore: new TestSecretStore(), now: () => new Date("2026-09-02T00:30:00.000Z") })
    await expect(job.run()).resolves.toMatchObject({ status: "success", recordsRead: 6, recordsWritten: 5 })
    expect(provider.calls.map(call => call.sourceText)).toEqual(["Third notice", "Third summary", "Second notice", "Second summary", "Port delay"])
    state.native.close()
  })

  it("assigns a complete independent lease to each field with an advancing clock", async () => {
    const state = await preparedState(feed({ summary: "First summary" }))
    await state.shippingRepository.upsertFeedItem(feed({ id: "feed-runtime-2", title: "Second notice", summary: "Second summary", publishedAt: "2026-09-02T00:10:00.000Z", sourceUrl: "https://example.com/feed-runtime-2" }))
    let nowMs = Date.parse("2026-09-02T00:30:00.000Z")
    const leaseDurations: number[] = []
    const provider = translationProvider((request) => {
      const row = state.native.prepare("SELECT lease_until FROM translation_cache WHERE status = 'pending' AND source_text = ?").get(request.sourceText) as { lease_until?: string }
      leaseDurations.push(Date.parse(row.lease_until ?? "") - nowMs)
      nowMs += 19_000
      return `translated:${request.sourceText}`
    })
    const job = createTranslationSyncJob({ database: state.database, dataMode: "real", provider, secretStore: new TestSecretStore(), now: () => new Date(nowMs), maxFieldsPerRun: 3 })

    await expect(job.run()).resolves.toMatchObject({ status: "success", recordsWritten: 3 })
    expect(provider.calls).toHaveLength(3)
    expect(leaseDurations).toEqual([45_000, 45_000, 45_000])
    expect(TRANSLATION_PROVIDER_TIMEOUT_MS).toBe(20_000)
    state.native.close()
  })

  it("persists transient failure, applies backoff, and recovers after the retry window", async () => {
    const state = await preparedState(feed({ summary: "" }))
    let shouldFail = true
    const provider = translationProvider((request) => {
      if (shouldFail) throw new ProviderError("rate_limited", "provider rate limited")
      return `translated:${request.sourceText}`
    })
    let clock = new Date("2026-09-02T00:30:00.000Z")
    const job = createTranslationSyncJob({ database: state.database, dataMode: "real", provider, secretStore: new TestSecretStore(), now: () => clock })

    await expect(job.run()).resolves.toMatchObject({ status: "failed", recordsWritten: 0, errorCode: "rate_limited" })
    expect(provider.calls).toHaveLength(1)
    const rows = state.native.prepare("SELECT status, retry_count, retryable, next_retry_at, last_error_code FROM translation_cache").all()
    expect(rows).toEqual([{ status: "failed", retry_count: 1, retryable: 1, next_retry_at: new Date(clock.getTime() + translationRetryBackoffMs(0)).toISOString(), last_error_code: "rate_limited" }])
    await expect(state.runtimeRepository.getProviderRuntime("deepseek", "translation")).resolves.toBeUndefined()

    clock = new Date("2026-09-02T00:31:01.000Z")
    shouldFail = false
    await expect(job.run()).resolves.toMatchObject({ status: "success", recordsWritten: 1 })
    expect(provider.calls).toHaveLength(2)
    await expect(state.translationRepository.getStatistics("deepseek")).resolves.toEqual({ total: 1, succeeded: 1, pending: 0, failed: 0 })
    await expect(state.runtimeRepository.aggregateProviderUsage({ providerId: "deepseek", capability: "translation" })).resolves.toMatchObject({ requestCount: 2, successCount: 1, failureCount: 1 })
    state.native.close()
  })

  it("opens a permanent provider circuit, blocks subsequent runtime work, and permits fixed diagnostic work while blocked", async () => {
    const state = await preparedState(feed({ summary: "" }))
    let shouldFail = true
    const provider = translationProvider((request) => {
      if (shouldFail) throw new ProviderError("auth_failed", "credential rejected")
      return `translated:${request.sourceText}`
    })
    const clock = new Date("2026-09-02T00:30:00.000Z")
    const secretStore = new TestSecretStore()
    const job = createTranslationSyncJob({ database: state.database, dataMode: "real", provider, secretStore, now: () => clock })
    const runtime = new BackgroundRuntime(state.runtimeRepository, { now: () => clock })
    runtime.register(job)
    await runtime.start()

    await expect(runtime.runNow("translation-sync")).resolves.toMatchObject({ status: "failed", errorCode: "auth_failed" })
    runtime.stop()
    await expect(state.runtimeRepository.getProviderRuntime("deepseek", "translation")).resolves.toMatchObject({ status: "failed", errorCode: "auth_failed" })
    const callsAfterFailure = provider.calls.length
    await expect(job.run()).resolves.toMatchObject({ status: "skipped", errorCode: "auth_failed" })
    expect(provider.calls).toHaveLength(callsAfterFailure)
    await expect(state.runtimeRepository.aggregateProviderUsage({ providerId: "deepseek", capability: "translation" })).resolves.toMatchObject({ requestCount: 1, failureCount: 1 })

    shouldFail = false
    await expect(runTranslationTest({ database: state.database, settings: settings(), secretStore, provider, now: clock })).resolves.toMatchObject({ ok: true, cacheHit: false })
    expect(provider.calls).toHaveLength(callsAfterFailure + 1)
    await expect(state.runtimeRepository.getProviderRuntime("deepseek", "translation")).resolves.toMatchObject({ status: "failed", errorCode: "auth_failed" })
    state.native.close()
  })

  it("keeps placeholder corruption at row level and continues with another Feed on the next run", async () => {
    const state = await preparedState(feed({ id: "feed-placeholder-a", title: "Notice 2026-09-02", summary: "", publishedAt: "2026-09-02T00:20:00.000Z", sourceUrl: "https://example.com/feed-placeholder-a" }))
    await state.shippingRepository.upsertFeedItem(feed({ id: "feed-placeholder-b", title: "Normal notice", summary: "", publishedAt: "2026-09-02T00:10:00.000Z", sourceUrl: "https://example.com/feed-placeholder-b" }))
    const provider = translationProvider(request => request.entityId === "feed-placeholder-a" ? request.sourceText.replace(/__SH/g, "__SX") : `translated:${request.sourceText}`)
    const now = new Date("2026-09-02T00:30:00.000Z")
    const job = createTranslationSyncJob({ database: state.database, dataMode: "mock", provider, secretStore: new TestSecretStore(), now: () => now, maxFieldsPerRun: 1 })

    await expect(job.run()).resolves.toMatchObject({ status: "failed", recordsWritten: 0, errorCode: "translation_placeholder_changed" })
    await expect(state.translationRepository.findWork({ entityType: "feed_item", entityId: "feed-placeholder-a", fieldName: "title", sourceHash: new TranslationService(state.translationRepository, provider).prepare({ entityType: "feed_item", entityId: "feed-placeholder-a", fieldName: "title", sourceText: "Notice 2026-09-02", targetLanguage: "zh-CN" }).sourceHash, targetLanguage: "zh-CN", provider: "deepseek", model: "deepseek-v4-flash" })).resolves.toMatchObject({ status: "failed", lastErrorCode: "translation_placeholder_changed", errorMessage: "translation placeholders changed", retryable: false, nextRetryAt: undefined })
    await expect(job.run()).resolves.toMatchObject({ status: "success", recordsWritten: 1 })
    expect(provider.calls.map(call => call.entityId)).toEqual(["feed-placeholder-a", "feed-placeholder-b"])
    await expect(state.translationRepository.getStatistics("deepseek")).resolves.toEqual({ total: 2, succeeded: 1, pending: 0, failed: 1 })
    await expect(state.runtimeRepository.aggregateProviderUsage({ providerId: "deepseek", capability: "translation" })).resolves.toMatchObject({ requestCount: 2, successCount: 1, failureCount: 1, recordsCount: 1 })
    await expect(state.runtimeRepository.getProviderRuntime("deepseek", "translation")).resolves.toBeUndefined()
    state.native.close()
  })

  it("keeps true Provider contract failures circuit-blocking", async () => {
    const state = await preparedState(feed({ summary: "" }))
    const provider = translationProvider(() => {
      throw new ProviderError("provider_contract_changed", "DeepSeek response choices are invalid")
    })
    const now = new Date("2026-09-02T00:30:00.000Z")
    const job = createTranslationSyncJob({ database: state.database, dataMode: "real", provider, secretStore: new TestSecretStore(), now: () => now })

    await expect(job.run()).resolves.toMatchObject({ status: "failed", errorCode: "provider_contract_changed" })
    await expect(state.runtimeRepository.getProviderRuntime("deepseek", "translation")).resolves.toMatchObject({ status: "failed", errorCode: "provider_contract_changed", errorMessage: "DeepSeek response choices are invalid" })
    const runtime = await state.runtimeRepository.getProviderRuntime("deepseek", "translation")
    expect(isProviderCircuitBlocked(runtime)).toBe(true)
    state.native.close()
  })

  it("preserves a blocked circuit error message through periodic skipped runs", async () => {
    const state = await preparedState(feed({ summary: "" }))
    const now = new Date("2026-09-02T00:30:00.000Z")
    await state.runtimeRepository.blockProviderCircuit({ providerId: "deepseek", capability: "translation", errorCode: "provider_contract_changed", errorMessage: "translation placeholders changed", updatedAt: now.toISOString() })
    const provider = translationProvider(request => `translated:${request.sourceText}`)
    const job = createTranslationSyncJob({ database: state.database, dataMode: "real", provider, secretStore: new TestSecretStore(), now: () => now })
    const runtime = new BackgroundRuntime(state.runtimeRepository, { now: () => now })
    runtime.register(job)
    await runtime.start()
    await expect(runtime.runNow("translation-sync")).resolves.toMatchObject({ status: "skipped", errorCode: "provider_contract_changed", errorMessage: "translation placeholders changed" })
    runtime.stop()

    expect(provider.calls).toHaveLength(0)
    await expect(state.runtimeRepository.getProviderRuntime("deepseek", "translation")).resolves.toMatchObject({ errorCode: "provider_contract_changed", errorMessage: "translation placeholders changed" })
    await expect(state.runtimeRepository.listSyncRuns("deepseek")).resolves.toMatchObject([{ status: "skipped", errorCode: "provider_contract_changed", errorMessage: "translation placeholders changed" }])
    state.native.close()
  })

  it("keeps blocked diagnostic placeholder failure row-free and non-circuit-blocking", async () => {
    const state = await preparedState(feed({ summary: "" }))
    const now = new Date("2026-09-02T00:30:00.000Z")
    await state.runtimeRepository.blockProviderCircuit({ providerId: "deepseek", capability: "translation", errorCode: "provider_contract_changed", errorMessage: "existing provider contract failure", updatedAt: now.toISOString() })
    const provider = translationProvider(request => request.sourceText.replace(/__SH/g, "__SX"))

    await expect(runTranslationTest({ database: state.database, settings: settings(), secretStore: new TestSecretStore(), provider, now })).resolves.toMatchObject({ ok: false, diagnosticMode: true, providerCalled: true, cacheHit: false, errorCode: "translation_placeholder_changed" })
    await expect(state.translationRepository.getStatistics("deepseek")).resolves.toEqual({ total: 0, succeeded: 0, pending: 0, failed: 0 })
    await expect(state.runtimeRepository.aggregateProviderUsage({ providerId: "deepseek", capability: "translation" })).resolves.toMatchObject({ requestCount: 1, successCount: 0, failureCount: 1 })
    await expect(state.runtimeRepository.getProviderRuntime("deepseek", "translation")).resolves.toMatchObject({ errorCode: "provider_contract_changed", errorMessage: "existing provider contract failure" })
    state.native.close()
  })

  it("clears the provider circuit and explicitly requeues the blocked row without auto-requeue", async () => {
    const state = await preparedState(feed({ summary: "" }))
    let shouldFail = true
    const provider = translationProvider((request) => {
      if (shouldFail) throw new ProviderError("provider_forbidden", "forbidden")
      return `translated:${request.sourceText}`
    })
    const now = new Date("2026-09-02T00:30:00.000Z")
    const secretStore = new TestSecretStore()
    const job = createTranslationSyncJob({ database: state.database, dataMode: "real", provider, secretStore, now: () => now })
    await job.run()
    const source = new TranslationService(state.translationRepository, provider).prepare({ entityType: "feed_item", entityId: "feed-runtime-1", fieldName: "title", sourceText: "Port delay", targetLanguage: "zh-CN" })
    const identity = { entityType: source.entityType, entityId: source.entityId, fieldName: source.fieldName, sourceHash: source.sourceHash, targetLanguage: source.targetLanguage, provider: "deepseek", model: "deepseek-v4-flash" }
    await expect(state.translationRepository.requeueTranslationFailures({ provider: "deepseek", model: "deepseek-v4-flash", eligibleIdentities: [identity], errorCodes: ["provider_forbidden"], reason: "manual recovery", now: now.toISOString() })).resolves.toMatchObject({ requeued: 1 })
    shouldFail = false
    await expect(job.run()).resolves.toMatchObject({ status: "skipped", errorCode: "provider_forbidden" })
    expect(provider.calls).toHaveLength(1)
    await state.runtimeRepository.clearProviderCircuit({ providerId: "deepseek", capability: "translation", reason: "manual recovery", updatedAt: now.toISOString() })
    await expect(job.run()).resolves.toMatchObject({ status: "success", recordsWritten: 1 })
    expect(provider.calls).toHaveLength(2)
    await expect(state.translationRepository.findWork(identity)).resolves.toMatchObject({ status: "succeeded" })
    state.native.close()
  })

  it("hard-gates disabled and Mock Mode work before any Provider call", async () => {
    const state = await preparedState()
    await state.shippingRepository.saveSettings(settings(false))
    const provider = translationProvider(request => `translated:${request.sourceText}`)
    const disabledJob = createTranslationSyncJob({ database: state.database, dataMode: "real", provider, secretStore: new TestSecretStore(), now: () => new Date("2026-09-02T00:30:00.000Z") })
    await expect(disabledJob.run()).resolves.toMatchObject({ status: "skipped", errorCode: "translation_disabled" })
    expect(provider.calls).toHaveLength(0)
    const mockJob = createTranslationSyncJob({ database: state.database, dataMode: "mock", provider, secretStore: new TestSecretStore(), now: () => new Date("2026-09-02T00:30:00.000Z") })
    await expect(mockJob.run()).resolves.toMatchObject({ status: "skipped", errorCode: "translation_disabled" })
    expect(provider.calls).toHaveLength(0)
    state.native.close()
  })

  it("registers and runs in Mock Mode without ever sending a Mock Feed to the Provider", async () => {
    const state = await preparedState(feed({
      sourceId: "mock-port-notice",
      provenance: { sourceType: "mock", dataNature: "reported", sourceId: "mock-port-notice", verified: false },
      source_type: "mock",
    }), "mock")
    const provider = translationProvider(request => `translated:${request.sourceText}`)
    const job = createTranslationSyncJob({ database: state.database, dataMode: "mock", provider, secretStore: new TestSecretStore(), now: () => new Date("2026-09-02T00:30:00.000Z") })

    expect(job).toMatchObject({ id: "translation-sync", intervalMs: 60_000, enabled: true })
    await expect(job.run()).resolves.toMatchObject({ status: "success", recordsRead: 0, recordsWritten: 0 })
    expect(provider.calls).toHaveLength(0)
    await expect(state.translationRepository.getStatistics("deepseek")).resolves.toEqual({ total: 0, succeeded: 0, pending: 0, failed: 0 })
    await expect(state.runtimeRepository.aggregateProviderUsage({ providerId: "deepseek", capability: "translation" })).resolves.toMatchObject({ requestCount: 0, successCount: 0, failureCount: 0, recordsCount: 0 })
    expect(state.native.prepare("SELECT COUNT(*) AS count FROM translation_cache WHERE status = 'pending'").get()).toEqual({ count: 0 })
    state.native.close()
  })

  it("translates an explicitly non-mock Feed while the global Shipping mode is Mock", async () => {
    const state = await preparedState(feed({ source_type: "real" }), "mock")
    const provider = translationProvider(request => `translated:${request.sourceText}`)
    const now = new Date("2026-09-02T00:30:00.000Z")
    const job = createTranslationSyncJob({ database: state.database, dataMode: "mock", provider, secretStore: new TestSecretStore(), now: () => now })

    await expect(job.run()).resolves.toMatchObject({ status: "success", recordsRead: 2, recordsWritten: 2 })
    expect(provider.calls).toHaveLength(2)
    await expect(state.translationRepository.getStatistics("deepseek")).resolves.toMatchObject({ total: 2, succeeded: 2, pending: 0, failed: 0 })
    await expect(state.runtimeRepository.aggregateProviderUsage({ providerId: "deepseek", capability: "translation" })).resolves.toMatchObject({ requestCount: 2, successCount: 2, recordsCount: 2 })
    const items = await state.shippingRepository.listFeedItems({ now, view: "current" })
    expect(items).toMatchObject([{ title: "Port delay", summary: "Ships are delayed." }])
    await expect(mapFeedItemsForDisplay(state.database, items, settings(true).translation, now)).resolves.toMatchObject([{
      displayTitle: "translated:Port delay",
      displaySummary: "translated:Ships are delayed.",
      translation: { title: "translated", summary: "translated" },
    }])
    state.native.close()
  })

  it("filters newer Mock Feed rows before ordering and max-field accounting", async () => {
    const state = await preparedState(feed({
      id: "feed-mock-newer",
      sourceId: "mock-port-notice",
      title: "Mock notice",
      summary: "Mock summary",
      publishedAt: "2026-09-02T00:20:00.000Z",
      sourceUrl: "https://example.com/mock-newer",
      provenance: { sourceType: "mock", dataNature: "reported", sourceId: "mock-port-notice", verified: false },
      source_type: "mock",
    }), "mock")
    await state.shippingRepository.upsertFeedItem(feed({
      id: "feed-non-mock-older",
      publishedAt: "2026-09-02T00:10:00.000Z",
      sourceUrl: "https://example.com/non-mock-older",
      source_type: "real",
    }))
    const provider = translationProvider(request => `translated:${request.sourceText}`)
    const job = createTranslationSyncJob({ database: state.database, dataMode: "mock", provider, secretStore: new TestSecretStore(), now: () => new Date("2026-09-02T00:30:00.000Z"), maxFieldsPerRun: 2 })

    await expect(job.run()).resolves.toMatchObject({ status: "success", recordsRead: 2, recordsWritten: 2 })
    expect(provider.calls.map(call => call.sourceText)).toEqual(["Port delay", "Ships are delayed."])
    expect(state.native.prepare("SELECT COUNT(*) AS count FROM translation_cache WHERE entity_id = 'feed-mock-newer'").get()).toEqual({ count: 0 })
    state.native.close()
  })

  it("re-reads settings, budget, and SecretStore on the same Job instance", async () => {
    const state = await preparedState(feed({ summary: "Dynamic summary" }), "mock")
    const secretStore = new TestSecretStore("")
    const provider = translationProvider(request => `translated:${request.sourceText}`)
    const clock = () => new Date("2026-09-02T00:30:00.000Z")
    const job = createTranslationSyncJob({ database: state.database, dataMode: "mock", provider, secretStore, now: clock })

    await state.shippingRepository.saveSettings(settings(false))
    await expect(job.run()).resolves.toMatchObject({ status: "skipped", errorCode: "translation_disabled" })
    await state.shippingRepository.saveSettings(settings(true))
    await expect(job.run()).resolves.toMatchObject({ status: "skipped", errorCode: "translation_secret_missing" })
    secretStore.setValue("test-secret")
    await expect(job.run()).resolves.toMatchObject({ status: "success", recordsWritten: 2 })
    expect(provider.calls).toHaveLength(2)
    state.native.close()
  })

  it("re-reads a zero monthly budget on the same Job instance", async () => {
    const state = await preparedState(feed(), "mock")
    const provider = translationProvider(request => `translated:${request.sourceText}`)
    const job = createTranslationSyncJob({ database: state.database, dataMode: "mock", provider, secretStore: new TestSecretStore(), now: () => new Date("2026-09-02T00:30:00.000Z") })

    await state.shippingRepository.saveSettings({ ...settings(true), translation: { ...settings(true).translation!, monthlyBudget: 0 } })
    await expect(job.run()).resolves.toMatchObject({ status: "skipped", errorCode: "translation_budget_zero" })
    await state.shippingRepository.saveSettings(settings(true))
    await expect(job.run()).resolves.toMatchObject({ status: "success", recordsWritten: 2 })
    expect(provider.calls).toHaveLength(2)
    state.native.close()
  })

  it("does not double-count per-field Translation usage through BackgroundRuntime", async () => {
    const state = await preparedState()
    const provider = translationProvider(request => `translated:${request.sourceText}`)
    const job = createTranslationSyncJob({ database: state.database, dataMode: "real", provider, secretStore: new TestSecretStore(), now: () => new Date("2026-09-02T00:30:00.000Z") })
    const runtime = new BackgroundRuntime(state.runtimeRepository, { now: () => new Date("2026-09-02T00:30:00.000Z") })
    runtime.register(job)
    await runtime.start()
    await expect(runtime.runNow("translation-sync")).resolves.toMatchObject({ status: "success", recordsWritten: 2 })
    runtime.stop()
    await expect(state.runtimeRepository.aggregateProviderUsage({ providerId: "deepseek", capability: "translation" })).resolves.toMatchObject({ requestCount: 2, successCount: 2, recordsCount: 2 })
    await expect(state.runtimeRepository.listSyncRuns("deepseek")).resolves.toHaveLength(1)
    state.native.close()
  })
})
