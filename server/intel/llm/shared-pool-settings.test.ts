/**
 * Dedicated shared LLM pool Settings (R3-1).
 * Offline only: isolated SQLite, fake transport; no live keys.
 */
import NativeDatabase from "better-sqlite3"
import { createDatabase } from "db0"
import { afterEach, describe, expect, it } from "vitest"
import type { ShippingSettings } from "@shared/shipping"
import { initShippingTables } from "#/database/shipping"
import { LlmRegistryRepository, llmSecretRefForProviderId } from "#/database/llm-registry"
import { defaultShippingSettings } from "#/database/runtime"
import { paidRequest } from "#/intel/llm/receipts"
import { resolveSharedLlmBudgetGate } from "#/intel/llm/shared-budget"
import { createMockOpenAiTransport } from "#/intel/llm/openai-compatible.mock"
import { runLlmTestConnection } from "#/intel/llm/test-connection"
import {
  readSharedLlmBudgetSettings,
  readSharedLlmBudgetStatus,
  resolveSharedLlmBudgetFromSettings,
  validateSharedLlmBudgetForSave,
} from "#/services/shared-llm-budget-settings"
import { executeTranslationViaPaidRequest } from "#/services/translation-paid"
import { FakeTranslationProvider } from "#/providers/translation/fake-provider"
import { TranslationService } from "#/services/translation-service"
import {
  TRANSLATION_CURRENCY,
  TRANSLATION_MODEL,
  TRANSLATION_PROVIDER_ID,
} from "#/services/translation-settings"
import type { SecretStore } from "#/providers/contracts"

const T0 = new Date("2026-10-12T08:00:00.000Z")
const cleanups: Array<() => void> = []
afterEach(() => {
  while (cleanups.length) cleanups.pop()!()
})

type Native = InstanceType<typeof NativeDatabase>

function wrap(native: Native) {
  return createDatabase({
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
}

async function setup() {
  const native = new NativeDatabase(":memory:")
  cleanups.push(() => native.close())
  const db = wrap(native)
  await initShippingTables(db, "mock")
  return { db, native }
}

function secrets(): SecretStore {
  const map = new Map<string, string>([
    ["deepseek", "test-placeholder"],
    [llmSecretRefForProviderId("fixture-chat"), "test-placeholder"],
    ["fixture-chat", "test-placeholder"],
  ])
  return {
    get: async id => map.get(id),
    set: async (id, value) => void map.set(id, value),
    delete: async id => void map.delete(id),
    has: async id => map.has(id),
    source: async id => (map.has(id) ? "file" : "missing") as never,
  }
}

async function seedChatModel(db: Awaited<ReturnType<typeof setup>>["db"]) {
  const repo = new LlmRegistryRepository(db)
  await repo.createProvider({
    id: "fixture-chat",
    name: "Fixture Chat",
    baseUrl: "https://api.example.com/v1",
    apiCompat: "openai",
    enabled: true,
  })
  await repo.createModel({
    id: "fixture-chat-model",
    providerId: "fixture-chat",
    modelName: "fixture-chat-model",
    purpose: "chat",
    unitPriceIn: 0.0000015,
    unitPriceOut: 0.0000025,
    currency: "USD",
    enabled: true,
  })
}

function prepared(text = "Port congestion update") {
  const service = new TranslationService(
    { save: async () => {
      throw new Error("unused")
    } } as never,
    new FakeTranslationProvider({ providerId: TRANSLATION_PROVIDER_ID, model: TRANSLATION_MODEL }),
    { targetLanguage: "zh-CN", preference: { providerId: TRANSLATION_PROVIDER_ID, model: TRANSLATION_MODEL } },
  )
  return service.prepare({
    entityType: "feed_item",
    entityId: "feed-1",
    fieldName: "title",
    sourceText: text,
    sourceLanguage: "en",
    targetLanguage: "zh-CN",
  })
}

describe("shared LLM pool Settings (dedicated field)", () => {
  it("old JSON missing sharedLlmBudget reads as unconfigured and does not invent from translation", () => {
    const settings: ShippingSettings = {
      ...structuredClone(defaultShippingSettings),
      translation: {
        enabled: true,
        providerId: "deepseek",
        model: "deepseek-v4-flash",
        targetLanguage: "zh-CN",
        monthlyBudget: 99,
      },
    }
    expect(settings.sharedLlmBudget).toBeUndefined()
    const viewed = readSharedLlmBudgetSettings(settings.sharedLlmBudget)
    expect(viewed.configured).toBe(false)
    const gate = resolveSharedLlmBudgetFromSettings(settings)
    expect(gate.monthlyBudget).toBeNull()
  })

  it("save validation requires complete budget + ISO currency; rejects illegal currency", () => {
    expect(() => validateSharedLlmBudgetForSave({ monthlyBudget: 1 })).toThrow(/currency/)
    expect(() => validateSharedLlmBudgetForSave({ monthlyBudget: 1, currency: "usd" })).toThrow(/currency/)
    expect(() => validateSharedLlmBudgetForSave({ monthlyBudget: -1, currency: "USD" })).toThrow(/monthlyBudget/)
    expect(validateSharedLlmBudgetForSave({ monthlyBudget: 0, currency: "USD" })).toEqual({ monthlyBudget: 0, currency: "USD" })
    expect(validateSharedLlmBudgetForSave({ currency: "EUR" }, { monthlyBudget: 3, currency: "USD" })).toEqual({
      monthlyBudget: 3,
      currency: "EUR",
    })
  })

  it("fail-closed: missing / zero / bad currency pool blocks registry test with zero transport", async () => {
    const { db } = await setup()
    await seedChatModel(db)
    const transport = createMockOpenAiTransport()

    const missing = await runLlmTestConnection({
      db,
      secretStore: secrets(),
      sharedLlmBudget: undefined,
      providerId: "fixture-chat",
      modelId: "fixture-chat-model",
      transport,
      now: () => T0,
    })
    expect(missing.ok).toBe(false)
    if (!missing.ok) expect(missing.code).toMatch(/budget_unconfigured|budget_currency/)
    expect(transport.state.chatHits).toBe(0)

    const zero = await runLlmTestConnection({
      db,
      secretStore: secrets(),
      sharedPoolMonthlyBudget: 0,
      sharedPoolCurrency: "USD",
      providerId: "fixture-chat",
      modelId: "fixture-chat-model",
      transport,
      now: () => T0,
    })
    expect(zero.ok).toBe(false)
    if (!zero.ok) expect(zero.code).toBe("paid_budget_zero")
    expect(transport.state.chatHits).toBe(0)

    const badFx = await runLlmTestConnection({
      db,
      secretStore: secrets(),
      sharedPoolMonthlyBudget: 5,
      sharedPoolCurrency: "CNY",
      providerId: "fixture-chat",
      modelId: "fixture-chat-model",
      transport,
      now: () => T0,
    })
    expect(badFx.ok).toBe(false)
    if (!badFx.ok) expect(badFx.code).toMatch(/currency/)
    expect(transport.state.chatHits).toBe(0)
  })

  it("gET status is provider-free and distinguishes estimated usage vs pending/unknown", async () => {
    const { db } = await setup()
    await seedChatModel(db)
    const settings: ShippingSettings = {
      ...structuredClone(defaultShippingSettings),
      sharedLlmBudget: { monthlyBudget: 1, currency: "USD" },
    }
    const before = await readSharedLlmBudgetStatus(db, settings, T0)
    expect(before.state).toBe("ready")
    expect(before.estimatedUsage).toBe(0)
    expect(before.pendingUnknownReserve).toBe(0)
    expect(before.notAHardInvoiceCap).toBe(true)
    expect(before.controlBasis).toBe("estimated_usage_plus_pending_unknown_reserve")

    await paidRequest(
      {
        db,
        secretStore: secrets(),
        monthlyBudget: undefined,
        currency: "USD",
        sharedBudget: resolveSharedLlmBudgetGate(1, "USD"),
        now: () => T0,
      },
      {
        providerId: "fixture-chat",
        capability: "llm_test_chat",
        model: "fixture-chat-model",
        purpose: "shared_pool_status",
        subject: "status-1",
        identity: { subject: "status-1", kind: "chat" },
        estimatedCost: 0.2,
      },
      async () => ({
        response: { ok: true },
        usage: { tokensIn: 10, tokensOut: 2 },
        cost: { amount: 0.2, currency: "USD", basis: "estimated" },
      }),
    )

    const after = await readSharedLlmBudgetStatus(db, settings, T0)
    expect(after.estimatedUsage).toBeGreaterThan(0)
    expect(after.estimatedTotal).toBe(after.estimatedUsage + after.pendingUnknownReserve)
  })

  it("dual gate: shared pool ok but translation sub-limit exhausted still blocks inside claim", async () => {
    const { db } = await setup()
    const fake = new FakeTranslationProvider({
      providerId: TRANSLATION_PROVIDER_ID,
      model: TRANSLATION_MODEL,
      translateText: () => "港口拥堵更新",
      usage: {
        promptTokens: 20,
        promptCacheHitTokens: 0,
        promptCacheMissTokens: 20,
        completionTokens: 10,
        totalTokens: 30,
      },
    })
    // First call fills translation sub-limit of 0.03 under a large shared pool.
    const first = await executeTranslationViaPaidRequest({
      db,
      secretStore: secrets(),
      monthlyBudget: 0.03,
      sharedPoolMonthlyBudget: 5,
      sharedPoolCurrency: TRANSLATION_CURRENCY,
      provider: fake,
      source: prepared("fill-sub"),
      estimatedCost: 0.03,
      now: () => T0,
    })
    expect(first.status).toBe("succeeded")
    expect(fake.calls).toHaveLength(1)

    const second = await executeTranslationViaPaidRequest({
      db,
      secretStore: secrets(),
      monthlyBudget: 0.03,
      sharedPoolMonthlyBudget: 5,
      sharedPoolCurrency: TRANSLATION_CURRENCY,
      provider: fake,
      source: prepared("blocked-by-sub"),
      estimatedCost: 0.03,
      now: () => T0,
    })
    expect(second.providerCalled).toBe(false)
    expect(second.paidGateCode).toBe("paid_budget_exhausted")
    expect(fake.calls).toHaveLength(1)
  })

  it("dual gate: translation sub-limit ok but shared pool exhausted still blocks", async () => {
    const { db } = await setup()
    await seedChatModel(db)
    // Exhaust shared pool via registry.
    await paidRequest(
      {
        db,
        secretStore: secrets(),
        monthlyBudget: undefined,
        currency: "USD",
        sharedBudget: resolveSharedLlmBudgetGate(0.05, "USD"),
        now: () => T0,
      },
      {
        providerId: "fixture-chat",
        capability: "llm_test_chat",
        model: "fixture-chat-model",
        purpose: "fill-pool",
        subject: "fill",
        identity: { subject: "fill", kind: "chat" },
        estimatedCost: 0.05,
      },
      async () => ({
        response: { ok: true },
        usage: { tokensIn: 5, tokensOut: 1 },
        cost: { amount: 0.05, currency: "USD", basis: "estimated" },
      }),
    )

    const fake = new FakeTranslationProvider({
      providerId: TRANSLATION_PROVIDER_ID,
      model: TRANSLATION_MODEL,
      translateText: () => "不应调用",
    })
    const blocked = await executeTranslationViaPaidRequest({
      db,
      secretStore: secrets(),
      monthlyBudget: 5,
      sharedPoolMonthlyBudget: 0.05,
      sharedPoolCurrency: TRANSLATION_CURRENCY,
      provider: fake,
      source: prepared("pool-exhausted"),
      estimatedCost: 0.03,
      now: () => T0,
    })
    expect(blocked.providerCalled).toBe(false)
    expect(blocked.paidGateCode).toBe("paid_budget_exhausted")
    expect(fake.calls).toHaveLength(0)
  })

  it("model price PATCH round-trips precise unit prices via API readback shape", async () => {
    const { db } = await setup()
    await seedChatModel(db)
    const repo = new LlmRegistryRepository(db)
    const updated = await repo.updateModel("fixture-chat-model", {
      unitPriceIn: 0.0000015,
      unitPriceOut: 0.0000025,
    })
    expect(updated.unitPriceIn).toBe(0.0000015)
    expect(updated.unitPriceOut).toBe(0.0000025)
    const again = await repo.getModel("fixture-chat-model")
    expect(again?.unitPriceIn).toBe(0.0000015)
    expect(again?.unitPriceOut).toBe(0.0000025)
  })
})
