import NativeDatabase from "better-sqlite3"
import { createDatabase } from "db0"
import { describe, expect, it } from "vitest"
import type { ShippingSettings } from "@shared/shipping"
import { assertTranslationReady, currentTranslationUsage, readTranslationStatus, translationBudgetWindow } from "./translation-settings"
import { TRANSLATION_TEST_SOURCE_TEXT, isAllowedTranslationTestBody, runTranslationTest } from "./translation-test-service"
import type { SecretSource, SecretStore } from "#/providers/contracts"
import { FakeTranslationProvider } from "#/providers/translation/fake-provider"
import { initShippingTables } from "#/database/shipping"
import { RuntimeRepository } from "#/database/runtime-jobs"

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
    const provider = new FakeTranslationProvider({ providerId: "deepseek", model: "deepseek-v4-flash", translateText: request => `[zh] ${request.sourceText}` })
    const input = { database, settings: settings(), secretStore: new TestSecretStore("secret-value"), provider, now: new Date("2026-09-02T12:00:00.000Z") }
    const first = await runTranslationTest(input)
    expect(first).toMatchObject({ ok: true, sourceText: TRANSLATION_TEST_SOURCE_TEXT, cacheHit: false, estimatedCost: 0 })
    expect(first.translatedText).toContain("AB123")
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
    expect(await new RuntimeRepository(database).listProviderUsage({ providerId: "deepseek", capability: "translation", windowStartFrom: window.from, windowStartTo: window.to })).toMatchObject([{ estimatedCost: 0.25, sourceScope: "translation_test" }])
    native.close()
  })
})
