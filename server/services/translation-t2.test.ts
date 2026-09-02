import NativeDatabase from "better-sqlite3"
import { createDatabase } from "db0"
import { describe, expect, it } from "vitest"
import type { ShippingSettings } from "@shared/shipping"
import { assertTranslationReady, currentTranslationUsage, readTranslationStatus, translationBudgetWindow } from "./translation-settings"
import { TRANSLATION_TEST_SOURCE_TEXT, isAllowedTranslationTestBody, runTranslationTest } from "./translation-test-service"
import type { SecretSource, SecretStore, TranslationRequest } from "#/providers/contracts"
import { FakeTranslationProvider } from "#/providers/translation/fake-provider"
import { initShippingTables } from "#/database/shipping"
import { RuntimeRepository } from "#/database/runtime-jobs"
import { TranslationRepository } from "#/database/translation"
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
  constructor(private readonly secret?: string, private readonly secretSource: SecretSource = "environment") {}
  async get() {
    return this.secret
  }

  async set() {}
  async delete() {}
  async has() {
    return Boolean(this.secret)
  }

  async source() {
    return this.secret ? this.secretSource : "missing" as const
  }
}

function settings(translation: ShippingSettings["translation"] = { enabled: true, providerId: "deepseek", model: "deepseek-v4-flash", targetLanguage: "zh-CN", monthlyBudget: 1 }): ShippingSettings {
  return {
    refreshInterval: 15,
    sourceEnabled: true,
    providerEnabled: true,
    eventThresholds: { anchoredHours: 24, delayMinutes: 120, congestionLevel: "high" },
    retentionDays: 30,
    translation,
  }
}

describe("translation T2 settings, budget, usage, and safe test runner", () => {
  it("accepts only the fixed test body shape and rejects arbitrary prompts", () => {
    expect(isAllowedTranslationTestBody(undefined)).toBe(true)
    expect(isAllowedTranslationTestBody(null)).toBe(true)
    expect(isAllowedTranslationTestBody({})).toBe(true)
    expect(isAllowedTranslationTestBody({ prompt: "translate this" })).toBe(false)
    expect(isAllowedTranslationTestBody({ sourceText: "business content" })).toBe(false)
    expect(isAllowedTranslationTestBody("translate this")).toBe(false)
  })

  it("defaults disabled and gates before any provider can be called", async () => {
    const { database, native } = createNativeDatabase()
    await initShippingTables(database, "mock")
    const provider = new FakeTranslationProvider()
    await expect(runTranslationTest({ database, settings: settings({ enabled: false, providerId: "deepseek", model: "deepseek-v4-flash", targetLanguage: "zh-CN", monthlyBudget: 1 }), secretStore: new TestSecretStore("secret"), provider })).rejects.toMatchObject({ code: "translation_disabled" })
    expect(provider.calls).toHaveLength(0)
    native.close()
  })

  it("runs the fixed test only with positive budget and records success, then hits cache without provider work", async () => {
    const { database, native } = createNativeDatabase()
    await initShippingTables(database, "mock")
    let protectedRequest: TranslationRequest | undefined
    const provider = new FakeTranslationProvider({ providerId: "deepseek", model: "deepseek-v4-flash", translateText: (request) => {
      protectedRequest = request
      return `[zh] ${request.sourceText}`
    } })
    const input = { database, settings: settings(), secretStore: new TestSecretStore("secret-value"), provider, now: new Date("2026-09-02T12:00:00.000Z") }
    const first = await runTranslationTest(input)
    expect(first).toMatchObject({ ok: true, sourceText: TRANSLATION_TEST_SOURCE_TEXT, cacheHit: false, estimatedCost: 0 })
    expect(first.translatedText).toContain("AB123")
    expect(first.translatedText).toContain("TEST STAR")
    expect(protectedRequest?.sourceText).not.toContain("TEST STAR")
    expect(provider.calls).toHaveLength(1)
    const second = await runTranslationTest(input)
    expect(second).toMatchObject({ ok: true, cacheHit: true, translatedText: first.translatedText })
    expect(provider.calls).toHaveLength(1)
    expect(await currentTranslationUsage(database, input.now)).toMatchObject({ requestCount: 1, successCount: 1, failureCount: 0, cacheHitCount: 1 })
    const status = await readTranslationStatus(database, input.settings, input.secretStore, input.now)
    expect(status).toMatchObject({ enabled: true, configured: true, secretSource: "environment", maskedLast4: "****alue", state: "ready", cache: { succeeded: 1, failed: 0 } })
    expect(JSON.stringify(status)).not.toContain("secret-value")
    native.close()
  })

  it("aggregates the complete month in SQL beyond the bounded detail-list limit and gates before a call", async () => {
    const { database, native } = createNativeDatabase()
    await initShippingTables(database, "mock")
    const repository = new RuntimeRepository(database)
    await repository.recordProviderUsage({ providerId: "deepseek", capability: "translation", calledAt: "2026-08-31T23:00:00.000Z", request: true, succeeded: true, estimatedCost: 10, currency: "USD", sourceScope: "translation_test" })
    await repository.recordProviderUsage({ providerId: "deepseek", capability: "translation", calledAt: "2026-10-01T00:00:00.000Z", request: true, succeeded: true, estimatedCost: 10, currency: "USD", sourceScope: "translation_test" })
    for (let index = 0; index < 600; index += 1) {
      await repository.recordProviderUsage({
        providerId: "deepseek",
        capability: "translation",
        calledAt: new Date(Date.UTC(2026, 8, 1, index)).toISOString(),
        request: true,
        succeeded: true,
        estimatedCost: 0.25,
        currency: "USD",
        sourceScope: "translation_test",
      })
    }
    const window = translationBudgetWindow(new Date("2026-09-20T12:00:00.000Z"))
    const detailRows = await repository.listProviderUsage({ providerId: "deepseek", capability: "translation", windowStartFrom: window.from, windowStartTo: window.to })
    const aggregate = await repository.aggregateProviderUsage({ providerId: "deepseek", capability: "translation", windowStartFrom: window.from, windowStartTo: window.to })
    expect(detailRows).toHaveLength(500)
    expect(aggregate).toMatchObject({ requestCount: 600, successCount: 600, failureCount: 0, estimatedCost: 150, currency: "USD" })
    expect(await currentTranslationUsage(database, new Date("2026-09-20T12:00:00.000Z"))).toMatchObject({ requestCount: 600, successCount: 600, estimatedCost: 150 })

    const provider = new FakeTranslationProvider({ providerId: "deepseek", model: "deepseek-v4-flash" })
    await expect(runTranslationTest({
      database,
      settings: settings({ enabled: true, providerId: "deepseek", model: "deepseek-v4-flash", targetLanguage: "zh-CN", monthlyBudget: 150 }),
      secretStore: new TestSecretStore("secret-value"),
      provider,
      now: new Date("2026-09-20T12:00:00.000Z"),
    })).rejects.toMatchObject({ code: "translation_budget_exhausted" })
    expect(provider.calls).toHaveLength(0)
    native.close()
  })

  it("keeps provider-free successful cache readable after budget exhaustion while the fixed test gate stays closed", async () => {
    const { database, native } = createNativeDatabase()
    await initShippingTables(database, "mock")
    const provider = new FakeTranslationProvider({ providerId: "deepseek", model: "deepseek-v4-flash" })
    const now = new Date("2026-09-20T12:00:00.000Z")
    const input = { database, settings: settings({ enabled: true, providerId: "deepseek", model: "deepseek-v4-flash", targetLanguage: "zh-CN", monthlyBudget: 1 }), secretStore: new TestSecretStore("secret-value"), provider, now }
    const first = await runTranslationTest(input)
    await new RuntimeRepository(database).recordProviderUsage({ providerId: "deepseek", capability: "translation", calledAt: now.toISOString(), request: true, succeeded: true, estimatedCost: 1, currency: "USD", sourceScope: "translation_test" })
    const cacheRead = await new TranslationService(
      new TranslationRepository(database),
      undefined,
      { preference: { providerId: "deepseek", model: "deepseek-v4-flash" } },
    ).getCachedTranslation({ entityType: "translation_test", entityId: "shipping-hot-translation-test", fieldName: "summary", sourceText: first.sourceText, targetLanguage: "zh-CN" })
    expect(cacheRead).toMatchObject({ status: "succeeded", translatedText: first.translatedText, providerCalled: false })

    const secondProvider = new FakeTranslationProvider({ providerId: "deepseek", model: "deepseek-v4-flash" })
    await expect(runTranslationTest({ ...input, provider: secondProvider })).rejects.toMatchObject({ code: "translation_budget_exhausted" })
    expect(secondProvider.calls).toHaveLength(0)
    native.close()
  })

  it("persists failures as usage and cache while returning the original text", async () => {
    const { database, native } = createNativeDatabase()
    await initShippingTables(database, "mock")
    const provider = new FakeTranslationProvider({ providerId: "deepseek", model: "deepseek-v4-flash", translateText: () => {
      throw new Error("provider unavailable")
    } })
    const result = await runTranslationTest({ database, settings: settings(), secretStore: new TestSecretStore("secret-value"), provider, now: new Date("2026-09-02T12:00:00.000Z") })
    expect(result).toMatchObject({ ok: false, translatedText: TRANSLATION_TEST_SOURCE_TEXT })
    expect(await currentTranslationUsage(database, new Date("2026-09-02T12:00:00.000Z"))).toMatchObject({ requestCount: 1, successCount: 0, failureCount: 1 })
    expect((await readTranslationStatus(database, settings(), new TestSecretStore("secret-value"))).cache).toMatchObject({ failed: 1, succeeded: 0, pending: 0 })
    native.close()
  })

  it("rejects zero or exhausted budgets and does not expose secret values", async () => {
    const { database, native } = createNativeDatabase()
    await initShippingTables(database, "mock")
    const secretStore = new TestSecretStore("secret-value")
    await expect(assertTranslationReady(settings({ enabled: true, providerId: "deepseek", model: "deepseek-v4-flash", targetLanguage: "zh-CN", monthlyBudget: 0 }).translation, secretStore, 0)).rejects.toMatchObject({ code: "translation_budget_zero" })
    await expect(assertTranslationReady(settings({ enabled: true, providerId: "deepseek", model: "deepseek-v4-flash", targetLanguage: "zh-CN", monthlyBudget: 1 }).translation, secretStore, 1)).rejects.toMatchObject({ code: "translation_budget_exhausted" })
    await expect(assertTranslationReady(settings().translation, new TestSecretStore(), 0)).rejects.toMatchObject({ code: "translation_secret_missing" })
    const window = translationBudgetWindow(new Date("2026-09-02T12:00:00.000Z"))
    await new RuntimeRepository(database).recordProviderUsage({ providerId: "deepseek", capability: "translation", calledAt: "2026-09-02T12:00:00.000Z", succeeded: true, estimatedCost: 0.25, currency: "USD", sourceScope: "translation_test" })
    const repository = new RuntimeRepository(database)
    expect(await repository.listProviderUsage({ providerId: "deepseek", capability: "translation", windowStartFrom: window.from, windowStartTo: window.to })).toMatchObject([{ estimatedCost: 0.25, sourceScope: "translation_test" }])
    expect(native.prepare("SELECT source_scope FROM provider_usage WHERE provider_id = 'deepseek'").get()).toEqual({ source_scope: "translation_test" })
    native.prepare("INSERT INTO provider_usage (id, provider_id, capability, window_start, source_scope) VALUES (?, ?, ?, ?, ?)").run("legacy-usage", "deepseek", "translation", "2026-09-02T13:00:00.000Z", JSON.stringify({ sourceScope: "translation_test", promptCacheHitTokens: 4, promptCacheMissTokens: 6 }))
    const legacy = (await repository.listProviderUsage({ providerId: "deepseek", capability: "translation", windowStartFrom: window.from, windowStartTo: window.to })).find(row => row.id === "legacy-usage")
    expect(legacy).toMatchObject({ sourceScope: "translation_test" })
    expect(legacy).not.toHaveProperty("promptCacheHitTokens")
    expect(legacy).not.toHaveProperty("promptCacheMissTokens")
    native.close()
  })
})
