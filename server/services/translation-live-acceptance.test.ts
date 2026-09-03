import { mkdtempSync, rmSync } from "node:fs"
import { join } from "node:path"
import NativeDatabase from "better-sqlite3"
import { createDatabase } from "db0"
import { describe, expect, it } from "vitest"
import type { FeedItem, ShippingSettings } from "@shared/shipping"
import {
  TRANSLATION_LIVE_ACCEPTANCE_INPUT,
  TRANSLATION_LIVE_ACCEPTANCE_MAX_EXTERNAL_CALLS,
  type TranslationAcceptanceBrowserEvidence,
  buildTranslationAcceptanceEvidence,
  buildTranslationAcceptancePlan,
  finalizeTranslationAcceptanceEvidence,
  isDiagnosticUsageScope,
  runTranslationLiveAcceptance,
} from "./translation-live-acceptance"
import type { SecretSource, SecretStore, TranslationProvider, TranslationRequest, TranslationResult, TranslationUsage } from "#/providers/contracts"
import { ProviderError } from "#/providers/contracts"
import { ShippingRepository, initShippingTables } from "#/database/shipping"
import { RuntimeRepository } from "#/database/runtime-jobs"
import { TranslationRepository } from "#/database/translation"
import { translationRetryBackoffMs } from "#/services/translation-failure-policy"
import { TranslationService } from "#/services/translation-service"

const now = new Date("2026-09-03T12:00:00.000Z")
const enabledTranslation = { enabled: true, providerId: "deepseek" as const, model: "deepseek-v4-flash" as const, targetLanguage: "zh-CN", monthlyBudget: 1 }

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

class TestSecretStore implements SecretStore {
  getCalls = 0

  constructor(private readonly secret?: string) {}

  async get() {
    this.getCalls += 1
    return this.secret
  }

  async set() {}
  async delete() {}
  async has() {
    return Boolean(this.secret)
  }

  async source(): Promise<SecretSource> {
    return this.secret ? "environment" : "missing"
  }
}

const validUsage: TranslationUsage = {
  promptTokens: 7,
  promptCacheHitTokens: 1,
  promptCacheMissTokens: 6,
  completionTokens: 3,
  totalTokens: 10,
}

class AcceptanceProvider implements TranslationProvider {
  readonly providerId = "deepseek"
  readonly model = "deepseek-v4-flash"
  readonly calls: TranslationRequest[] = []

  constructor(private readonly behavior: (request: TranslationRequest, call: number) => TranslationResult | Promise<TranslationResult> = request => ({ translatedText: `[中文] ${request.sourceText}`, usage: validUsage })) {}

  async translate(request: TranslationRequest): Promise<TranslationResult> {
    this.calls.push(structuredClone(request))
    return this.behavior(request, this.calls.length)
  }
}

function shippingSettings(translation = enabledTranslation): ShippingSettings {
  return {
    refreshInterval: 15,
    sourceEnabled: true,
    providerEnabled: true,
    eventThresholds: { anchoredHours: 24, delayMinutes: 120, congestionLevel: "high" },
    retentionDays: 30,
    translation,
  }
}

function feedItem(overrides: Partial<FeedItem> = {}): FeedItem {
  return {
    id: "feed-live-1",
    sourceId: "shipping-feed",
    source_type: "real",
    category: "shipping_news",
    type: "news",
    title: "Port delay for AB123 at SGSIN",
    summary: "Operational notice remains current.",
    sourceUrl: "https://example.com/feed/live-1",
    publishedAt: "2026-09-03T10:00:00.000Z",
    fetchedAt: "2026-09-03T10:01:00.000Z",
    currentUntil: "2026-09-04T00:00:00.000Z",
    visibility: "current",
    eventEligibility: true,
    severity: "watch",
    stale: false,
    sourceStatus: "healthy",
    relatedPortIds: [],
    relatedVesselIds: [],
    relatedVoyageIds: [],
    ...overrides,
  }
}

async function initializedDatabase(dataMode: "real" | "mock" = "real", translation = enabledTranslation) {
  const state = createNativeDatabase()
  await initShippingTables(state.database, dataMode)
  await new ShippingRepository(state.database, dataMode).saveSettings(shippingSettings(translation))
  return state
}

async function seedFeed(database: ReturnType<typeof createNativeDatabase>["database"], item = feedItem(), dataMode: "real" | "mock" = "real") {
  await new ShippingRepository(database, dataMode).upsertFeedItem(item)
  return item
}

async function seedSuccessfulFeedCache(database: ReturnType<typeof createNativeDatabase>["database"], item: FeedItem, fieldName: "title" | "summary") {
  const provider = new AcceptanceProvider()
  const service = new TranslationService(new TranslationRepository(database), provider, { targetLanguage: "zh-CN" })
  const prepared = service.prepare({ entityType: "feed_item", entityId: item.id, fieldName, sourceText: item[fieldName], targetLanguage: "zh-CN" })
  const timestamp = "2026-09-03T11:00:00.000Z"
  await new TranslationRepository(database).save({
    id: `seed:${item.id}:${fieldName}`,
    entityType: prepared.entityType,
    entityId: prepared.entityId,
    fieldName: prepared.fieldName,
    sourceText: prepared.sourceText,
    sourceHash: prepared.sourceHash,
    sourceLanguage: prepared.sourceLanguage,
    targetLanguage: prepared.targetLanguage,
    provider: "deepseek",
    model: "deepseek-v4-flash",
    translatedText: `已有${fieldName === "title" ? "标题" : "摘要"}译文`,
    translatedAt: timestamp,
    status: "succeeded",
    retryCount: 0,
    nextRetryAt: null,
    retryable: false,
    leaseUntil: null,
    lastErrorCode: null,
    preferred: true,
    createdAt: timestamp,
    updatedAt: timestamp,
  })
  return prepared
}

function runnerOptions(database: ReturnType<typeof createNativeDatabase>["database"], provider: TranslationProvider, secretStore = new TestSecretStore("secret")) {
  return {
    database,
    dataMode: "real" as const,
    provider,
    secretStore,
    allowExternalCalls: true,
    now: () => new Date(now),
  }
}

describe("translation T3D bounded acceptance planning and evidence", () => {
  it("blocks external work unless every gate and explicit authorization passes", () => {
    const plan = buildTranslationAcceptancePlan({ settings: enabledTranslation, configured: true, estimatedMonthSpend: 0, allowExternalCalls: false })
    expect(plan.allowed).toBe(false)
    expect(plan.maxExternalCalls).toBe(0)
    expect(plan.checks.fixedInputOnly).toBe(true)
    expect(plan.checks.backlogExcluded).toBe(true)
    expect(plan.blockers).toContain("external_call_not_authorized_for_this_run")
    expect(buildTranslationAcceptanceEvidence(plan).liveVerification).toBe("pending")
  })

  it("blocks disabled, zero-budget, missing-secret, mock-mode and circuit-blocked states", () => {
    const plan = buildTranslationAcceptancePlan({
      settings: { ...enabledTranslation, enabled: false, monthlyBudget: 0 },
      configured: false,
      estimatedMonthSpend: 0,
      runtime: { providerId: "deepseek", capability: "translation", status: "failed", errorCode: "auth_failed", consecutiveFailures: 1, updatedAt: "2026-09-03T00:00:00.000Z" },
      allowExternalCalls: true,
      realFeedMode: false,
    })
    expect(plan.allowed).toBe(false)
    expect(plan.maxExternalCalls).toBe(0)
    expect(plan.blockers).toEqual(expect.arrayContaining(["translation_settings_invalid_or_disabled", "translation_secret_missing", "translation_budget_zero", "translation_provider_circuit_blocked", "translation_real_mode_required"]))
  })

  it("plans exactly two external calls and keeps the pure builder unable to claim a live run", () => {
    const plan = buildTranslationAcceptancePlan({ settings: enabledTranslation, configured: true, estimatedMonthSpend: 0, allowExternalCalls: true })
    expect(plan.allowed).toBe(true)
    expect(plan.maxExternalCalls).toBe(TRANSLATION_LIVE_ACCEPTANCE_MAX_EXTERNAL_CALLS)
    expect(buildTranslationAcceptanceEvidence(plan, { externalCalls: 2, providerCalled: true }).serverAcceptance).toBe("pending")
    expect(buildTranslationAcceptanceEvidence(plan, { externalCalls: 0 }).externalCalls).toBe(0)
  })

  it.each([
    ["translation_test", true],
    ["mixed", true],
    ["feed", false],
    [undefined, false],
    ["arbitrary", false],
  ])("accepts only a diagnostic-compatible aggregate source scope: %s", (scope, expected) => {
    expect(isDiagnosticUsageScope(scope)).toBe(expected)
  })
})

describe("translation T3D executable acceptance runner", () => {
  it("runs one fixed diagnostic and one current Feed title, persists usage atomically, and keeps originals unchanged", async () => {
    const state = await initializedDatabase()
    const item = await seedFeed(state.database)
    const provider = new AcceptanceProvider()
    const result = await runTranslationLiveAcceptance({ ...runnerOptions(state.database, provider), reopenDatabase: async () => ({ database: state.database }) })
    expect(provider.calls).toHaveLength(2)
    expect(provider.calls[0].entityType).toBe("translation_test")
    expect(provider.calls[1]).toMatchObject({ entityType: "feed_item", entityId: item.id, fieldName: "title", targetLanguage: "zh-CN" })
    expect(result.evidence).toMatchObject({ serverAcceptance: "verified", liveVerification: "pending", feedUiReadback: "pending", externalCalls: 2 })
    expect(result.evidence.phase1).toMatchObject({ status: "succeeded", sourceScope: "translation_test", usageContract: "verified", placeholderPreserved: "verified", cacheIsolation: "verified" })
    expect(result.evidence.phase2).toMatchObject({ status: "succeeded", originalFactsPreserved: "verified", cachePersistence: "verified", providerUsagePersisted: "verified", retryStateCleared: "verified", feedReadback: "verified", restartReadback: "verified", providerFreeRead: "verified" })
    expect(state.native.prepare("SELECT COUNT(*) AS count FROM translation_cache WHERE entity_type = 'translation_test'").get()).toEqual({ count: 0 })
    await expect(new ShippingRepository(state.database, "real").listFeedItems({ now, view: "current" })).resolves.toMatchObject([{ id: item.id, title: item.title, summary: item.summary }])
    await expect(new TranslationRepository(state.database).findExactSuccessful({ entityType: "feed_item", entityId: item.id, fieldName: "title", sourceHash: result.evidence.candidate?.sourceHash as string, targetLanguage: "zh-CN", provider: "deepseek", model: "deepseek-v4-flash" })).resolves.toMatchObject({ status: "succeeded", translatedText: expect.stringContaining("中文") })
    await expect(new RuntimeRepository(state.database).aggregateProviderUsage({ providerId: "deepseek", capability: "translation" })).resolves.toMatchObject({ requestCount: 2, successCount: 2, failureCount: 0, recordsCount: 1 })
    expect(state.native.prepare("SELECT source_scope FROM provider_usage WHERE provider_id = 'deepseek' AND capability = 'translation'").get()).toEqual({ source_scope: "mixed" })
    state.native.close()
  })

  it("accepts a mixed aggregate scope when a same-hour Feed usage already exists and continues to Phase 2", async () => {
    const state = await initializedDatabase()
    const item = await seedFeed(state.database)
    await new RuntimeRepository(state.database).recordProviderUsage({
      providerId: "deepseek",
      capability: "translation",
      request: true,
      succeeded: true,
      records: 1,
      estimatedCost: 0.01,
      currency: "USD",
      sourceScope: "feed",
      calledAt: now.toISOString(),
    })
    const result = await runTranslationLiveAcceptance({ ...runnerOptions(state.database, new AcceptanceProvider()), reopenDatabase: async () => ({ database: state.database }) })
    expect(result.evidence.phase1).toMatchObject({ status: "succeeded", usageContract: "verified", providerUsagePersisted: "verified" })
    expect(result.evidence.phase2).toMatchObject({ attempted: true, status: "succeeded" })
    expect(result.evidence.externalCalls).toBe(2)
    expect(result.evidence.candidate?.feedItemId).toBe(item.id)
    await expect(new RuntimeRepository(state.database).aggregateProviderUsage({ providerId: "deepseek", capability: "translation" })).resolves.toMatchObject({ requestCount: 3, successCount: 3, recordsCount: 2 })
    expect(state.native.prepare("SELECT source_scope FROM provider_usage WHERE provider_id = 'deepseek' AND capability = 'translation'").get()).toEqual({ source_scope: "mixed" })
    state.native.close()
  })

  it("never treats server DTO evidence as UI evidence and only the matching browser finalizer can complete it", async () => {
    const state = await initializedDatabase()
    await seedFeed(state.database)
    const result = await runTranslationLiveAcceptance({ ...runnerOptions(state.database, new AcceptanceProvider()), reopenDatabase: async () => ({ database: state.database }) })
    if (!result.evidence.candidate) throw new Error("acceptance candidate missing")
    const browserEvidence: TranslationAcceptanceBrowserEvidence = {
      feedItemId: result.evidence.candidate.feedItemId,
      fieldName: result.evidence.candidate.fieldName,
      sourceHash: result.evidence.candidate.sourceHash,
      uiReadback: "verified",
      originalDisclosure: "verified",
      consoleErrors: 0,
      externalCalls: 0,
    }
    expect(finalizeTranslationAcceptanceEvidence(result.evidence, { ...browserEvidence, sourceHash: "wrong" }).liveVerification).toBe("pending")
    expect(finalizeTranslationAcceptanceEvidence(result.evidence, { ...browserEvidence, consoleErrors: 1 }).liveVerification).toBe("pending")
    expect(finalizeTranslationAcceptanceEvidence(result.evidence, browserEvidence)).toMatchObject({ liveVerification: "verified_live", feedUiReadback: "verified" })
    state.native.close()
  })

  it("stops after one call when Phase 1 auth fails and leaves Feed untouched", async () => {
    const state = await initializedDatabase()
    const item = await seedFeed(state.database)
    const provider = new AcceptanceProvider(() => {
      throw new ProviderError("auth_failed", "credential rejected")
    })
    const result = await runTranslationLiveAcceptance(runnerOptions(state.database, provider))
    expect(provider.calls).toHaveLength(1)
    expect(result.evidence).toMatchObject({ liveVerification: "pending", externalCalls: 1, reason: "auth_failed" })
    expect(result.evidence.phase2.attempted).toBe(false)
    await expect(new ShippingRepository(state.database, "real").listFeedItems({ now, view: "current" })).resolves.toMatchObject([{ id: item.id, title: item.title, summary: item.summary }])
    await expect(new RuntimeRepository(state.database).aggregateProviderUsage({ providerId: "deepseek", capability: "translation" })).resolves.toMatchObject({ requestCount: 1, failureCount: 1 })
    await expect(new RuntimeRepository(state.database).getProviderRuntime("deepseek", "translation")).resolves.toMatchObject({ status: "failed", errorCode: "auth_failed" })
    state.native.close()
  })

  it.each(["provider_forbidden", "entitlement_missing"] as const)("opens the Phase 1 circuit for %s and stops before Feed", async (code) => {
    const state = await initializedDatabase()
    await seedFeed(state.database)
    const provider = new AcceptanceProvider(() => {
      throw new ProviderError(code, "provider rejected the request")
    })
    const result = await runTranslationLiveAcceptance(runnerOptions(state.database, provider))
    expect(provider.calls).toHaveLength(1)
    expect(result.evidence).toMatchObject({ externalCalls: 1, reason: code })
    expect(result.evidence.phase2.attempted).toBe(false)
    await expect(new RuntimeRepository(state.database).getProviderRuntime("deepseek", "translation")).resolves.toMatchObject({ status: "failed", errorCode: code })
    state.native.close()
  })

  it.each([
    ["wrapper output", () => ({ translatedText: `Translation: ${TRANSLATION_LIVE_ACCEPTANCE_INPUT}`, usage: validUsage })],
    ["invalid usage", () => ({ translatedText: `[中文] ${TRANSLATION_LIVE_ACCEPTANCE_INPUT}`, usage: { promptTokens: 2, promptCacheHitTokens: 1, promptCacheMissTokens: 1, completionTokens: 4, totalTokens: 99 } })],
  ])("stops after one call on Phase 1 %s contract failure", async (_label, resultFor) => {
    const state = await initializedDatabase()
    await seedFeed(state.database)
    const provider = new AcceptanceProvider((request) => {
      const result = resultFor()
      return result.translatedText.startsWith("[中文]") ? { ...result, translatedText: `[中文] ${request.sourceText}` } : result
    })
    const result = await runTranslationLiveAcceptance(runnerOptions(state.database, provider))
    expect(provider.calls).toHaveLength(1)
    expect(result.evidence.phase1).toMatchObject({ status: "failed", providerUsagePersisted: "verified", cacheIsolation: "verified" })
    expect(result.evidence.phase2.attempted).toBe(false)
    await expect(new RuntimeRepository(state.database).getProviderRuntime("deepseek", "translation")).resolves.toMatchObject({ status: "failed", errorCode: "provider_contract_changed" })
    state.native.close()
  })

  it.each(["rate_limited", "provider_timeout", "provider_unavailable"] as const)("does not open a permanent circuit for Phase 1 %s", async (code) => {
    const state = await initializedDatabase()
    await seedFeed(state.database)
    const provider = new AcceptanceProvider(() => {
      throw new ProviderError(code, "transient provider failure")
    })
    const result = await runTranslationLiveAcceptance(runnerOptions(state.database, provider))
    expect(provider.calls).toHaveLength(1)
    expect(result.evidence).toMatchObject({ externalCalls: 1, reason: code })
    expect(result.evidence.phase2.attempted).toBe(false)
    await expect(new RuntimeRepository(state.database).getProviderRuntime("deepseek", "translation")).resolves.toBeUndefined()
    state.native.close()
  })

  it("does only the diagnostic call when no uncached current Feed candidate exists", async () => {
    const state = await initializedDatabase()
    const result = await runTranslationLiveAcceptance(runnerOptions(state.database, new AcceptanceProvider()))
    expect(result.evidence).toMatchObject({ externalCalls: 1, reason: "no_uncached_current_feed_candidate" })
    expect(result.evidence.phase2.attempted).toBe(false)
    state.native.close()
  })

  it("skips exact-success candidates and never deletes or changes their cache", async () => {
    const state = await initializedDatabase()
    const item = await seedFeed(state.database)
    const preparedTitle = await seedSuccessfulFeedCache(state.database, item, "title")
    await seedSuccessfulFeedCache(state.database, item, "summary")
    const before = state.native.prepare("SELECT id, source_hash, translated_text, status FROM translation_cache ORDER BY id").all()
    const provider = new AcceptanceProvider()
    const result = await runTranslationLiveAcceptance(runnerOptions(state.database, provider))
    expect(provider.calls).toHaveLength(1)
    expect(result.evidence.reason).toBe("no_uncached_current_feed_candidate")
    expect(state.native.prepare("SELECT id, source_hash, translated_text, status FROM translation_cache ORDER BY id").all()).toEqual(before)
    expect(preparedTitle.sourceHash).toBeTruthy()
    state.native.close()
  })

  it("re-gates budget after Phase 1 and performs no Feed call when the diagnostic consumes the budget", async () => {
    const state = await initializedDatabase()
    await seedFeed(state.database)
    const expensiveUsage: TranslationUsage = { promptTokens: 10_000_000, promptCacheHitTokens: 0, promptCacheMissTokens: 10_000_000, completionTokens: 0, totalTokens: 10_000_000 }
    const provider = new AcceptanceProvider(request => ({ translatedText: `[中文] ${request.sourceText}`, usage: expensiveUsage }))
    const result = await runTranslationLiveAcceptance(runnerOptions(state.database, provider))
    expect(provider.calls).toHaveLength(1)
    expect(result.evidence.phase2.attempted).toBe(false)
    expect(result.evidence.reason).toBe("translation_gate_changed")
    state.native.close()
  })

  it("rechecks the source hash after claim and stops without a second Provider call when Feed changes", async () => {
    const state = await initializedDatabase()
    const item = await seedFeed(state.database)
    const repository = new ShippingRepository(state.database, "real")
    const result = await runTranslationLiveAcceptance({
      ...runnerOptions(state.database, new AcceptanceProvider()),
      beforePhase2Gate: async () => repository.upsertFeedItem({ ...item, title: "Changed after claim" }),
    })
    expect(result.evidence.externalCalls).toBe(1)
    expect(result.evidence.reason).toBe("translation_source_changed")
    expect(result.evidence.phase2.attempted).toBe(false)
    await expect(new TranslationRepository(state.database).findWork({ entityType: "feed_item", entityId: item.id, fieldName: "title", sourceHash: result.evidence.candidate?.sourceHash as string, targetLanguage: "zh-CN", provider: "deepseek", model: "deepseek-v4-flash" })).resolves.toMatchObject({ status: "failed", lastErrorCode: "translation_source_changed", retryable: false })
    state.native.close()
  })

  it("persists a Phase 2 retryable failure with no retry or third call", async () => {
    const state = await initializedDatabase()
    const item = await seedFeed(state.database)
    const provider = new AcceptanceProvider((request, call) => call === 2 ? Promise.reject(new ProviderError("rate_limited", "slow down")) : { translatedText: `[中文] ${request.sourceText}`, usage: validUsage })
    const result = await runTranslationLiveAcceptance(runnerOptions(state.database, provider))
    expect(provider.calls).toHaveLength(2)
    expect(result.evidence).toMatchObject({ externalCalls: 2, liveVerification: "pending" })
    expect(result.evidence.phase2).toMatchObject({ status: "failed", cachePersistence: "verified", providerUsagePersisted: "verified", errorCode: "rate_limited" })
    await expect(new TranslationRepository(state.database).findWork({ entityType: "feed_item", entityId: item.id, fieldName: "title", sourceHash: result.evidence.candidate?.sourceHash as string, targetLanguage: "zh-CN", provider: "deepseek", model: "deepseek-v4-flash" })).resolves.toMatchObject({ status: "failed", retryable: true, lastErrorCode: "rate_limited", leaseUntil: undefined })
    await expect(new RuntimeRepository(state.database).aggregateProviderUsage({ providerId: "deepseek", capability: "translation" })).resolves.toMatchObject({ requestCount: 2, successCount: 1, failureCount: 1, recordsCount: 0 })
    await expect(new RuntimeRepository(state.database).getProviderRuntime("deepseek", "translation")).resolves.toBeUndefined()
    state.native.close()
  })

  it("uses the shared T3A backoff policy for an existing retry count and the failure completion time", async () => {
    const state = await initializedDatabase()
    const item = await seedFeed(state.database)
    const service = new TranslationService(new TranslationRepository(state.database), new AcceptanceProvider(), { targetLanguage: "zh-CN" })
    const prepared = service.prepare({ entityType: "feed_item", entityId: item.id, fieldName: "title", sourceText: item.title, targetLanguage: "zh-CN" })
    const timestamp = "2026-09-03T11:00:00.000Z"
    await new TranslationRepository(state.database).save({
      id: "retry-seed",
      entityType: prepared.entityType,
      entityId: prepared.entityId,
      fieldName: prepared.fieldName,
      sourceText: prepared.sourceText,
      sourceHash: prepared.sourceHash,
      sourceLanguage: prepared.sourceLanguage,
      targetLanguage: prepared.targetLanguage,
      provider: "deepseek",
      model: "deepseek-v4-flash",
      translatedText: undefined,
      translatedAt: undefined,
      status: "failed",
      retryCount: 1,
      nextRetryAt: "2026-09-03T11:59:00.000Z",
      retryable: true,
      leaseUntil: null,
      lastErrorCode: "rate_limited",
      preferred: false,
      createdAt: timestamp,
      updatedAt: timestamp,
    })
    const provider = new AcceptanceProvider((_request, call) => call === 2 ? Promise.reject(new ProviderError("rate_limited", "slow down")) : { translatedText: `[中文] ${_request.sourceText}`, usage: validUsage })
    const result = await runTranslationLiveAcceptance(runnerOptions(state.database, provider))
    const failed = await new TranslationRepository(state.database).findWork({ entityType: "feed_item", entityId: item.id, fieldName: "title", sourceHash: prepared.sourceHash, targetLanguage: "zh-CN", provider: "deepseek", model: "deepseek-v4-flash" })
    expect(result.evidence.phase2.errorCode).toBe("rate_limited")
    expect(failed).toMatchObject({ status: "failed", retryCount: 2, retryable: true, nextRetryAt: new Date(now.getTime() + translationRetryBackoffMs(1)).toISOString() })
    state.native.close()
  })

  it("reads successful cache and Feed display after a real database reopen", async () => {
    const directory = mkdtempSync(join(process.cwd(), ".tmp", "translation-t3d-"))
    const path = join(directory, "acceptance.sqlite3")
    const first = createNativeDatabase(path)
    await initShippingTables(first.database, "real")
    await new ShippingRepository(first.database, "real").saveSettings(shippingSettings())
    await seedFeed(first.database)
    let reopenCount = 0
    const result = await runTranslationLiveAcceptance({
      ...runnerOptions(first.database, new AcceptanceProvider()),
      reopenDatabase: async () => {
        reopenCount += 1
        const reopened = createNativeDatabase(path)
        await initShippingTables(reopened.database, "real")
        return { database: reopened.database, close: () => reopened.native.close() }
      },
    })
    expect(reopenCount).toBe(1)
    expect(result.evidence.phase2.restartReadback).toBe("verified")
    expect(result.evidence.serverAcceptance).toBe("verified")
    first.native.close()
    rmSync(directory, { recursive: true, force: true })
  })
})
