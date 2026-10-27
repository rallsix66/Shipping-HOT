/**
 * Shared LLM budget + translation paid path (R3-1 / ADR-007).
 * Offline only: fake transport / fake translation provider, isolated SQLite.
 * Proves the execution gate is paidRequest(sharedBudget), not aggregate helper alone.
 */
import NativeDatabase from "better-sqlite3"
import { createDatabase } from "db0"
import { afterEach, describe, expect, it } from "vitest"
import type { ShippingSettings } from "@shared/shipping"
import type { SecretStore } from "#/providers/contracts"
import { ProviderError } from "#/providers/contracts"
import { FakeTranslationProvider } from "#/providers/translation/fake-provider"
import { initShippingTables } from "#/database/shipping"
import { LlmRegistryRepository, llmSecretRefForProviderId } from "#/database/llm-registry"
import { RuntimeRepository } from "#/database/runtime-jobs"
import {
  PaidGateError,
  type ReceiptRequest,
  markPendingReceiptsUnknownAtExclusiveStartup,
  paidRequest,
} from "#/intel/llm/receipts"
import { SHARED_LLM_BUDGET_CAPABILITIES, resolveSharedLlmBudgetFromTranslation } from "#/intel/llm/shared-budget"
import { runLlmTestConnection } from "#/intel/llm/test-connection"
import { createMockOpenAiTransport } from "#/intel/llm/openai-compatible.mock"
import { executeTranslationViaPaidRequest } from "#/services/translation-paid"
import { runTranslationTest } from "#/services/translation-test-service"
import { defaultShippingSettings } from "#/database/runtime"
import { TranslationService } from "#/services/translation-service"
import {
  TRANSLATION_CAPABILITY,
  TRANSLATION_CURRENCY,
  TRANSLATION_MODEL,
  TRANSLATION_PROVIDER_ID,
} from "#/services/translation-settings"
import { paidBudgetWindow } from "#/services/paid-budget"

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

function secrets(values?: Record<string, string>): SecretStore {
  const defaults: Record<string, string> = {
    "deepseek": "test-placeholder",
    [llmSecretRefForProviderId("fixture-chat")]: "test-placeholder",
    "fixture-chat": "test-placeholder",
  }
  const map = new Map(Object.entries({ ...defaults, ...(values ?? {}) }))
  return {
    get: async id => map.get(id),
    set: async (id, value) => void map.set(id, value),
    delete: async id => void map.delete(id),
    has: async id => map.has(id),
    source: async id => (map.has(id) ? "file" : "missing") as never,
  }
}

function sharedCtx(db: Awaited<ReturnType<typeof setup>>["db"], monthlyBudget: number | null | undefined, currency = TRANSLATION_CURRENCY) {
  return {
    db,
    secretStore: secrets(),
    monthlyBudget,
    currency,
    sharedBudget: resolveSharedLlmBudgetFromTranslation(monthlyBudget, currency),
    now: () => T0,
  }
}

function chatReq(subject: string, estimatedCost: number, providerId = "fixture-chat"): ReceiptRequest {
  return {
    providerId,
    capability: "llm_test_chat",
    model: "fixture-chat-model",
    purpose: "shared_budget_test",
    subject,
    identity: { subject, kind: "chat" },
    estimatedCost,
  }
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

async function seedChatModel(db: Awaited<ReturnType<typeof setup>>["db"]) {
  const repo = new LlmRegistryRepository(db)
  const provider = await repo.createProvider({
    id: "fixture-chat",
    name: "Fixture Chat",
    baseUrl: "https://api.fixture-chat.example/v1",
  })
  const model = await repo.createModel({
    id: "fixture-chat-model",
    providerId: provider.id,
    modelName: "fixture-chat-model",
    purpose: "chat",
    unitPriceIn: 0.1,
    unitPriceOut: 0.2,
    currency: "USD",
  })
  return { provider, model }
}

describe("shared LLM budget gate on paidRequest (not helper-alone)", () => {
  it("same-currency chat + translation contend for the last unit; sequential follow-ups cannot exceed total", async () => {
    const { db } = await setup()
    const fake = new FakeTranslationProvider({ providerId: TRANSLATION_PROVIDER_ID, model: TRANSLATION_MODEL })
    const source = prepared("Alpha title for shared budget")
    // Reserve most of a 0.05 pool with a chat call (0.03), leave 0.02.
    await paidRequest(sharedCtx(db, 0.05), chatReq("chat-first", 0.03), async () => ({
      response: { ok: true },
      usage: { tokensIn: 10, tokensOut: 2 },
      cost: { amount: 0.03, currency: "USD", basis: "estimated" },
    }))
    // Translation estimate 0.02 fits exactly once.
    const ok = await executeTranslationViaPaidRequest({
      db,
      secretStore: secrets(),
      monthlyBudget: 0.05,
      provider: fake,
      source,
      estimatedCost: 0.02,
      now: () => T0,
    })
    expect(ok.status).toBe("succeeded")
    expect(fake.calls).toHaveLength(1)
    expect(ok.usageRecordedByPaidRequest).toBe(true)

    // Another chat 0.02 must fail-closed (pool exhausted).
    await expect(
      paidRequest(sharedCtx(db, 0.05), chatReq("chat-second", 0.02), async () => ({ response: { ok: true } })),
    ).rejects.toMatchObject({ name: "PaidGateError", code: "paid_budget_exhausted" })

    // Another translation also fail-closed; zero extra provider calls.
    const denied = await executeTranslationViaPaidRequest({
      db,
      secretStore: secrets(),
      monthlyBudget: 0.05,
      provider: fake,
      source: prepared("Beta title"),
      estimatedCost: 0.02,
      now: () => T0,
    })
    expect(denied.status).toBe("failed")
    expect(denied.paidGateCode).toBe("paid_budget_exhausted")
    expect(fake.calls).toHaveLength(1)
  })

  it("mixed / mismatched currency fail-closed; no numeric mix", async () => {
    const { db } = await setup()
    await expect(
      paidRequest(
        {
          ...sharedCtx(db, 1, "USD"),
          currency: "CNY",
        },
        { ...chatReq("mix", 0.01), capability: "llm_test_chat" },
        async () => ({ response: { ok: true } }),
      ),
    ).rejects.toMatchObject({ code: "paid_budget_currency_mismatch" })

    // Seed a CNY usage row inside shared capability domain → mixed when aggregating USD.
    const window = paidBudgetWindow(T0)
    await db.prepare(`
      INSERT INTO provider_usage (id, provider_id, capability, window_start, request_count, success_count, failure_count, estimated_cost, currency)
      VALUES ('u-cny', 'p-x', 'llm_test_chat', ?, 1, 1, 0, 1.0, 'CNY')
    `).run(window.from)
    await expect(
      paidRequest(sharedCtx(db, 10, "USD"), chatReq("after-cny", 0.01), async () => ({ response: { ok: true } })),
    ).rejects.toMatchObject({ code: "paid_budget_currency_mixed" })
  })

  it("pending/unknown stay reserved; success books once; reuse is zero-call", async () => {
    const { db } = await setup()
    let hits = 0
    const hang = new Promise<never>(() => undefined)
    void paidRequest(sharedCtx(db, 1), chatReq("held", 0.6), async () => {
      hits += 1
      return hang
    }).catch(() => undefined)
    await new Promise(r => setTimeout(r, 30))
    await expect(
      paidRequest(sharedCtx(db, 1), chatReq("other", 0.5), async () => {
        hits += 1
        return { response: { ok: true } }
      }),
    ).rejects.toMatchObject({ code: "paid_budget_exhausted" })
    expect(hits).toBe(1)

    // Fresh DB path: success once, then reuse
    const { db: db2 } = await setup()
    const fake = new FakeTranslationProvider({ providerId: TRANSLATION_PROVIDER_ID, model: TRANSLATION_MODEL })
    const source = prepared("Reuse me")
    const first = await executeTranslationViaPaidRequest({
      db: db2,
      secretStore: secrets(),
      monthlyBudget: 1,
      provider: fake,
      source,
      estimatedCost: 0.01,
      now: () => T0,
    })
    expect(first.status).toBe("succeeded")
    expect(first.reused).toBe(false)
    const second = await executeTranslationViaPaidRequest({
      db: db2,
      secretStore: secrets(),
      monthlyBudget: 1,
      provider: fake,
      source,
      estimatedCost: 0.01,
      now: () => T0,
    })
    expect(second.status).toBe("succeeded")
    expect(second.reused).toBe(true)
    expect(fake.calls).toHaveLength(1)

    const runtime = new RuntimeRepository(db2)
    const agg = await runtime.aggregateProviderUsage({
      providerId: TRANSLATION_PROVIDER_ID,
      capability: TRANSLATION_CAPABILITY,
      windowStartFrom: paidBudgetWindow(T0).from,
      windowStartTo: paidBudgetWindow(T0).to,
    })
    expect(agg.requestCount).toBe(1)
    expect(agg.successCount).toBe(1)
  })

  it("zero / unconfigured shared budget fail-closed before transport", async () => {
    const { db } = await setup()
    const transport = createMockOpenAiTransport()
    await seedChatModel(db)
    const zero = await runLlmTestConnection({
      db,
      secretStore: secrets(),
      monthlyBudget: 0,
      providerId: "fixture-chat",
      modelId: "fixture-chat-model",
      transport,
      now: () => T0,
    })
    expect(zero.ok).toBe(false)
    if (!zero.ok) expect(zero.code).toBe("paid_budget_zero")
    expect(transport.state.chatHits).toBe(0)

    const unset = await runLlmTestConnection({
      db,
      secretStore: secrets(),
      monthlyBudget: undefined,
      providerId: "fixture-chat",
      modelId: "fixture-chat-model",
      transport,
      now: () => T0,
    })
    expect(unset.ok).toBe(false)
    if (!unset.ok) expect(unset.code).toBe("paid_budget_unconfigured")
    expect(transport.state.chatHits).toBe(0)
  })

  it("test-connection mock transport goes through sharedBudget; Search/Fetch capabilities stay out of shared list", async () => {
    const { db } = await setup()
    await seedChatModel(db)
    const transport = createMockOpenAiTransport()
    const ok = await runLlmTestConnection({
      db,
      secretStore: secrets(),
      monthlyBudget: 5,
      providerId: "fixture-chat",
      modelId: "fixture-chat-model",
      transport,
      now: () => T0,
    })
    expect(ok.ok).toBe(true)
    expect(transport.state.chatHits).toBe(1)
    expect(SHARED_LLM_BUDGET_CAPABILITIES).toContain("translation")
    expect(SHARED_LLM_BUDGET_CAPABILITIES).toContain("llm_test_chat")
    expect(SHARED_LLM_BUDGET_CAPABILITIES).not.toContain("deepseek_search")
    expect(SHARED_LLM_BUDGET_CAPABILITIES).not.toContain("deepseek_fetch")
    expect(SHARED_LLM_BUDGET_CAPABILITIES).not.toContain("search")
    expect(SHARED_LLM_BUDGET_CAPABILITIES).not.toContain("fetch")
  })

  it("provider rejected failure records once and does not retry automatically via receipt reuse of failed", async () => {
    const { db } = await setup()
    let calls = 0
    const provider: FakeTranslationProvider = new FakeTranslationProvider({
      providerId: TRANSLATION_PROVIDER_ID,
      model: TRANSLATION_MODEL,
      translateText: () => {
        calls += 1
        throw new ProviderError("rate_limited", "slow down")
      },
    })
    const source = prepared("Fail once")
    const first = await executeTranslationViaPaidRequest({
      db,
      secretStore: secrets(),
      monthlyBudget: 1,
      provider,
      source,
      estimatedCost: 0.01,
      now: () => T0,
    })
    expect(first.status).toBe("failed")
    expect(first.errorCode).toBe("rate_limited")
    expect(calls).toBe(1)
    // Failed receipt allows a new attempt (not unknown); second call happens when asked.
    const second = await executeTranslationViaPaidRequest({
      db,
      secretStore: secrets(),
      monthlyBudget: 1,
      provider,
      source,
      estimatedCost: 0.01,
      now: () => T0,
    })
    expect(second.status).toBe("failed")
    expect(calls).toBe(2)
  })
})

describe("aDR-011 Search/Fetch independent when sharedBudget omitted", () => {
  it("per-capability gate still applies without sharedBudget", async () => {
    const { db } = await setup()
    const ctx = {
      db,
      secretStore: secrets({ deepseek: "test-placeholder" }),
      monthlyBudget: 1,
      currency: "CNY",
      now: () => T0,
    }
    await paidRequest(ctx, {
      providerId: "deepseek",
      capability: "deepseek_search",
      purpose: "search_test",
      identity: { q: "a" },
      estimatedCost: 0.6,
    }, async () => ({ response: { ok: true }, cost: { amount: 0.6, currency: "CNY", basis: "estimated" } }))
    // Same capability exhausted
    await expect(paidRequest(ctx, {
      providerId: "deepseek",
      capability: "deepseek_search",
      purpose: "search_test",
      identity: { q: "b" },
      estimatedCost: 0.6,
    }, async () => ({ response: { ok: true } }))).rejects.toBeInstanceOf(PaidGateError)
    // Fetch independent budget still open
    await expect(paidRequest(ctx, {
      providerId: "deepseek",
      capability: "deepseek_fetch",
      purpose: "fetch_test",
      identity: { url: "https://example.test/x" },
      estimatedCost: 0.6,
    }, async () => ({ response: { ok: true }, cost: { amount: 0.6, currency: "CNY", basis: "estimated" } }))).resolves.toMatchObject({ reused: false })
  })
})

describe("billing classification: HTTP 200 + usage + bad output keeps spend", () => {
  const usageTokens = {
    promptTokens: 100,
    promptCacheHitTokens: 0,
    promptCacheMissTokens: 100,
    completionTokens: 50,
    totalTokens: 150,
  }

  it.each([
    "Translation: 港口拥堵更新",
    "Here is the translation: 港口拥堵更新",
    "Translated text: 港口拥堵更新",
    "翻译如下：港口拥堵更新",
    "译文：港口拥堵更新",
  ])("wrapper %s books usage cost and does not zero-release", async (wrapper) => {
    const { db } = await setup()
    const fake = new FakeTranslationProvider({
      providerId: TRANSLATION_PROVIDER_ID,
      model: TRANSLATION_MODEL,
      translateText: () => wrapper,
      usage: usageTokens,
    })
    const source = prepared(`wrapper-case-${wrapper.slice(0, 12)}`)
    const first = await executeTranslationViaPaidRequest({
      db,
      secretStore: secrets(),
      monthlyBudget: 0.05,
      provider: fake,
      source,
      estimatedCost: 0.03,
      now: () => T0,
    })
    expect(first.status).toBe("failed")
    expect(first.errorCode).toBe("provider_contract_changed")
    expect(first.usageRecordedByPaidRequest).toBe(true)
    expect(fake.calls).toHaveLength(1)

    const runtime = new RuntimeRepository(db)
    const window = paidBudgetWindow(T0)
    const agg = await runtime.aggregateProviderUsage({
      providerId: TRANSLATION_PROVIDER_ID,
      capability: TRANSLATION_CAPABILITY,
      windowStartFrom: window.from,
      windowStartTo: window.to,
    })
    // Must keep booked spend (reserved estimate when token estimate is tiny) — not free-release to 0.
    expect(agg.estimatedCost).toBeGreaterThan(0)
    expect(agg.requestCount).toBe(1)

    // Full-budget follow-up only fits if the first call free-released to 0; any retained spend blocks it.
    const second = await executeTranslationViaPaidRequest({
      db,
      secretStore: secrets(),
      monthlyBudget: 0.05,
      provider: fake,
      source: prepared(`after-wrapper-${wrapper.slice(0, 8)}`),
      estimatedCost: 0.05,
      now: () => T0,
    })
    expect(second.status).toBe("failed")
    expect(second.paidGateCode).toBe("paid_budget_exhausted")
    expect(fake.calls).toHaveLength(1)
  })

  it("same sourceHash business failure reuses completed payload: provider.calls=1, requestCount=1, no success cache", async () => {
    const { db } = await setup()
    const usageTokens = {
      promptTokens: 100,
      promptCacheHitTokens: 0,
      promptCacheMissTokens: 100,
      completionTokens: 50,
      totalTokens: 150,
    }
    const fake = new FakeTranslationProvider({
      providerId: TRANSLATION_PROVIDER_ID,
      model: TRANSLATION_MODEL,
      translateText: () => "Translation: 港口拥堵更新",
      usage: usageTokens,
    })
    // Identical identity twice (same prepare text => same sourceHash).
    const source = prepared("same-key-no-retry Port congestion")
    const first = await executeTranslationViaPaidRequest({
      db,
      secretStore: secrets(),
      monthlyBudget: 5,
      provider: fake,
      source,
      estimatedCost: 0.03,
      now: () => T0,
    })
    expect(first.status).toBe("failed")
    expect(first.errorCode).toBe("provider_contract_changed")
    expect(first.reused).toBe(false)
    expect(first.providerCalled).toBe(true)
    expect(fake.calls).toHaveLength(1)

    const second = await executeTranslationViaPaidRequest({
      db,
      secretStore: secrets(),
      monthlyBudget: 5,
      provider: fake,
      source,
      estimatedCost: 0.03,
      now: () => T0,
    })
    expect(second.status).toBe("failed")
    expect(second.errorCode).toBe("provider_contract_changed")
    expect(second.errorMessage).toBe(first.errorMessage)
    expect(second.reused).toBe(true)
    expect(second.providerCalled).toBe(false)
    expect(fake.calls).toHaveLength(1)

    const runtime = new RuntimeRepository(db)
    const window = paidBudgetWindow(T0)
    const agg = await runtime.aggregateProviderUsage({
      providerId: TRANSLATION_PROVIDER_ID,
      capability: TRANSLATION_CAPABILITY,
      windowStartFrom: window.from,
      windowStartTo: window.to,
    })
    expect(agg.requestCount).toBe(1)
    expect(agg.estimatedCost).toBeGreaterThan(0)

    // Business failure must not land a succeeded translation_cache row.
    const cacheHits = await db.prepare(
      "SELECT COUNT(*) AS n FROM translation_cache WHERE status = 'succeeded' AND source_hash = ?",
    ).get(source.sourceHash) as { n: number }
    expect(Number(cacheHits.n)).toBe(0)

    // Explicit diagnostic attemptTag is a new logical key and must re-gate + call Provider.
    const tagged = await executeTranslationViaPaidRequest({
      db,
      secretStore: secrets(),
      monthlyBudget: 5,
      provider: fake,
      source,
      estimatedCost: 0.03,
      now: () => T0,
      attemptTag: "diagnostic:2026-10-12T08:00:00.000Z",
    })
    expect(tagged.status).toBe("failed")
    expect(tagged.reused).toBe(false)
    expect(tagged.providerCalled).toBe(true)
    expect(fake.calls).toHaveLength(2)
    const aggAfterTag = await runtime.aggregateProviderUsage({
      providerId: TRANSLATION_PROVIDER_ID,
      capability: TRANSLATION_CAPABILITY,
      windowStartFrom: window.from,
      windowStartTo: window.to,
    })
    expect(aggAfterTag.requestCount).toBe(2)
  })

  it("protected-term validation failure with usage keeps spend (not ProviderRejected free release)", async () => {
    const { db } = await setup()
    const service = new TranslationService(
      { save: async () => {
        throw new Error("unused")
      } } as never,
      new FakeTranslationProvider({ providerId: TRANSLATION_PROVIDER_ID, model: TRANSLATION_MODEL }),
      { targetLanguage: "zh-CN", preference: { providerId: TRANSLATION_PROVIDER_ID, model: TRANSLATION_MODEL } },
    )
    const source = service.prepare({
      entityType: "feed_item",
      entityId: "feed-protected",
      fieldName: "title",
      sourceText: "Notice TEST STAR update",
      sourceLanguage: "en",
      targetLanguage: "zh-CN",
      protectedTerms: ["TEST STAR"],
    })
    const fake = new FakeTranslationProvider({
      providerId: TRANSLATION_PROVIDER_ID,
      model: TRANSLATION_MODEL,
      // Inject the protected literal instead of the marker — validation must fail.
      translateText: () => "通知 TEST STAR 更新",
      usage: usageTokens,
    })
    const first = await executeTranslationViaPaidRequest({
      db,
      secretStore: secrets(),
      monthlyBudget: 0.05,
      provider: fake,
      source,
      estimatedCost: 0.03,
      now: () => T0,
    })
    expect(first.status).toBe("failed")
    expect(first.errorCode).toBe("translation_placeholder_changed")
    expect(first.usageRecordedByPaidRequest).toBe(true)

    const runtime = new RuntimeRepository(db)
    const window = paidBudgetWindow(T0)
    const agg = await runtime.aggregateProviderUsage({
      providerId: TRANSLATION_PROVIDER_ID,
      capability: TRANSLATION_CAPABILITY,
      windowStartFrom: window.from,
      windowStartTo: window.to,
    })
    expect(agg.estimatedCost).toBeGreaterThan(0)

    const second = await executeTranslationViaPaidRequest({
      db,
      secretStore: secrets(),
      monthlyBudget: 0.05,
      provider: fake,
      source: prepared("after-protected"),
      estimatedCost: 0.05,
      now: () => T0,
    })
    expect(second.paidGateCode).toBe("paid_budget_exhausted")
    expect(fake.calls).toHaveLength(1)
  })
})

describe("translation test entrance shares paidRequest + sharedBudget", () => {
  function enabledSettings(monthlyBudget: number): ShippingSettings {
    return {
      ...structuredClone(defaultShippingSettings),
      translation: {
        enabled: true,
        providerId: TRANSLATION_PROVIDER_ID,
        model: TRANSLATION_MODEL,
        targetLanguage: "zh-CN",
        monthlyBudget,
      },
    }
  }

  it("registry filling the shared pool makes diagnostic zero-call", async () => {
    const { db } = await setup()
    await seedChatModel(db)
    // Exhaust shared pool via registry chat.
    await paidRequest(sharedCtx(db, 0.05), chatReq("fill", 0.05), async () => ({
      response: { ok: true },
      usage: { tokensIn: 10, tokensOut: 2 },
      cost: { amount: 0.05, currency: "USD", basis: "estimated" },
    }))

    const fake = new FakeTranslationProvider({
      providerId: TRANSLATION_PROVIDER_ID,
      model: TRANSLATION_MODEL,
      translateText: () => "不应被调用",
      usage: {
        promptTokens: 10,
        promptCacheHitTokens: 0,
        promptCacheMissTokens: 10,
        completionTokens: 5,
        totalTokens: 15,
      },
    })
    const result = await runTranslationTest({
      database: db,
      settings: enabledSettings(0.05),
      secretStore: secrets(),
      now: T0,
      provider: fake,
    })
    expect(result.ok).toBe(false)
    expect(result.providerCalled).toBe(false)
    expect(result.errorCode).toBe("paid_budget_exhausted")
    expect(fake.calls).toHaveLength(0)
  })

  it("diagnostic vs registry race the last unit via Promise.all start barrier", async () => {
    const { db } = await setup()
    await seedChatModel(db)
    const unit = 0.02
    const fake = new FakeTranslationProvider({
      providerId: TRANSLATION_PROVIDER_ID,
      model: TRANSLATION_MODEL,
      translateText: () => "港口更新",
      usage: {
        promptTokens: 20,
        promptCacheHitTokens: 0,
        promptCacheMissTokens: 20,
        completionTokens: 10,
        totalTokens: 30,
      },
    })

    let release!: () => void
    const startBarrier = new Promise<void>((resolve) => {
      release = resolve
    })

    const registryRace = startBarrier.then(() => paidRequest(
      sharedCtx(db, unit),
      chatReq("race-chat", unit),
      async () => ({
        response: { ok: true },
        usage: { tokensIn: 5, tokensOut: 1 },
        cost: { amount: unit, currency: "USD", basis: "estimated" },
      }),
    ))
    const diagnosticRace = startBarrier.then(() => runTranslationTest({
      database: db,
      settings: enabledSettings(unit),
      secretStore: secrets(),
      now: T0,
      provider: fake,
    }))

    release()
    const settled = await Promise.allSettled([registryRace, diagnosticRace])
    const registryOk = settled[0].status === "fulfilled"
    const diagnostic = settled[1].status === "fulfilled" ? settled[1].value : null
    const diagnosticOk = Boolean(diagnostic?.ok && diagnostic.providerCalled)
    // Exactly one consumer may spend the last unit; the other must fail closed.
    expect(Number(registryOk) + Number(diagnosticOk)).toBe(1)
    if (!diagnosticOk) {
      expect(diagnostic?.providerCalled ?? false).toBe(false)
      expect(diagnostic?.errorCode === "paid_budget_exhausted" || settled[1].status === "rejected").toBe(true)
    }
    // Fake provider called at most once (only if diagnostic won).
    expect(fake.calls.length).toBeLessThanOrEqual(1)
    if (!registryOk) {
      expect(settled[0].status).toBe("rejected")
      if (settled[0].status === "rejected") {
        expect(settled[0].reason).toMatchObject({ name: "PaidGateError", code: "paid_budget_exhausted" })
      }
    }
  })
})

describe("unknown recovery vs pending (shared pool)", () => {
  it("exclusive startup unknown keeps reservation; another key stays blocked (not a pending-only assert)", async () => {
    const { db } = await setup()
    const hang = new Promise<never>(() => undefined)
    void paidRequest(sharedCtx(db, 1), chatReq("held-unknown", 0.6), async () => hang).catch(() => undefined)
    await new Promise(r => setTimeout(r, 30))
    // Authority for the three recovery shapes remains receipts.test.ts; this asserts
    // the shared-budget path specifically: pending -> exclusive startup unknown keeps spend.
    const recovered = await markPendingReceiptsUnknownAtExclusiveStartup(db, new Date(T0.getTime() + 60_000))
    expect(recovered).toBeGreaterThanOrEqual(1)
    await expect(
      paidRequest(sharedCtx(db, 1), chatReq("other-after-unknown", 0.5), async () => ({ response: { ok: true } })),
    ).rejects.toMatchObject({ code: "paid_budget_exhausted" })
  })
})
