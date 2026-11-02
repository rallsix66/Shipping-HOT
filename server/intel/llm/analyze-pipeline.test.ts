import { createHash } from "node:crypto"
import { afterEach, describe, expect, it } from "vitest"
import NativeDatabase from "better-sqlite3"
import { createDatabase } from "db0"
import { initShippingTables } from "#/database/shipping"
import { IntelRepository } from "#/database/intel"
import { IntelAnalysisRepository } from "#/database/intel-analysis"
import { LlmRegistryRepository } from "#/database/llm-registry"
import { licensedBlocks } from "#/intel/content-license"
import { intelSourceSeeds } from "#/intel/sources"
import { resolveSharedLlmBudgetGate } from "#/intel/llm/shared-budget"
import {
  parseExtractOutput,
  parsePrefilterDecision,
  parseSeverityScoreOutput,
  runOfflineAnalyze,
} from "#/intel/llm/analyze-pipeline"
import { computeSeverity, median3 } from "#/intel/industry/selection"
import { EXTRACT_PROMPT, PREFILTER_PROMPT, SEVERITY_SCORE_PROMPT } from "#/intel/industry/prompts"
import type { OpenAiChatRequest, OpenAiChatResponse, OpenAiCompatibleTransport, OpenAiEmbeddingRequest, OpenAiEmbeddingResponse } from "#/intel/llm/openai-compatible"
import type { SecretStore } from "#/providers/contracts"
import { createPaidClaimBudgetResolver } from "#/services/shared-llm-budget-settings"

const NOW = "2026-11-02T02:00:00.000Z"
const T0 = new Date(NOW)
const source = intelSourceSeeds[0]!
const url = "https://www.tmd.go.th/synthetic/analyze?id=1"
const body = "Westports announces berth suspension for 3 days due to congestion. DelayDays: 3. ".repeat(20)
const hash = (text: string) => createHash("sha256").update(text).digest("hex")

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

function secrets(values: Record<string, string> = {}): SecretStore {
  const map = new Map(Object.entries(values))
  return {
    get: async id => map.get(id),
    set: async (id, value) => void map.set(id, value),
    delete: async id => void map.delete(id),
    has: async id => map.has(id),
    source: async id => (map.has(id) ? "file" : "missing") as never,
  }
}

interface ScriptedState {
  chatHits: number
  embeddingHits: number
  scripts: string[]
  failOnHit?: number
}

function createScriptedTransport(state: ScriptedState): OpenAiCompatibleTransport & { state: ScriptedState } {
  return {
    state,
    async chat(_baseUrl: string, _apiKey: string, body: OpenAiChatRequest): Promise<OpenAiChatResponse> {
      state.chatHits++
      if (state.failOnHit === state.chatHits) {
        throw Object.assign(new Error("provider_rejected_scripted"), { name: "ProviderRejectedError" })
      }
      const content = state.scripts[state.chatHits - 1] ?? state.scripts[state.scripts.length - 1] ?? "{}"
      return {
        id: `scripted-chat-${state.chatHits}`,
        model: body.model,
        choices: [{ message: { role: "assistant", content } }],
        usage: { prompt_tokens: 40, completion_tokens: 20, total_tokens: 60 },
      }
    },
    async embeddings(_baseUrl: string, _apiKey: string, body: OpenAiEmbeddingRequest): Promise<OpenAiEmbeddingResponse> {
      state.embeddingHits++
      const inputs = Array.isArray(body.input) ? body.input : [body.input]
      return {
        model: body.model,
        data: inputs.map((_, index) => ({ index, embedding: [0.01, 0.02, 0.03] })),
        usage: { prompt_tokens: 4, total_tokens: 4 },
      }
    },
  }
}

const extractJson = JSON.stringify({
  eventType: "port_congestion",
  countries: ["MY"],
  ports: ["MYPKG"],
  cities: ["Port Klang"],
  chainStages: ["port"],
  namedEntity: "Westports",
  occurredAt: null,
  effectiveFrom: "2026-11-01",
  effectiveUntil: null,
  numbers: { delayDays: "3 days", waitingDays: null },
  isOfficialStatement: false,
  isFirstParty: true,
  dimensions: { impact: 7, scope: 5, urgency: 6, actionability: 4 },
})

const prefilterPass = JSON.stringify({ decision: "PASS", reason: "port ops" })
const prefilterBlock = JSON.stringify({ decision: "BLOCK", reason: "unrelated" })
const prefilterUnknown = JSON.stringify({ decision: "UNKNOWN", reason: "ambiguous" })
const scoreHigh = JSON.stringify({ dimensions: { impact: 9, scope: 8, urgency: 8, actionability: 5 }, rumourOnly: false })
const scoreLow = JSON.stringify({ dimensions: { impact: 2, scope: 2, urgency: 2, actionability: 2 }, rumourOnly: false })
const scoreMid = JSON.stringify({ dimensions: { impact: 5, scope: 5, urgency: 5, actionability: 4 }, rumourOnly: false })
const scoreAgree = JSON.stringify({ dimensions: { impact: 7, scope: 5, urgency: 6, actionability: 4 }, rumourOnly: false })

async function setupRegistry(db: ReturnType<typeof wrap>, store: SecretStore) {
  const repo = new LlmRegistryRepository(db)
  const provider = await repo.createProvider({
    id: "fixture-vendor-a",
    name: "Fixture Vendor A",
    baseUrl: "https://api.fixture-vendor-a.example/v1",
  })
  await store.set(provider.secretRef, "sk-fixture-analyze")
  const model = await repo.createModel({
    providerId: provider.id,
    modelName: "fixture-chat",
    purpose: "chat",
    unitPriceIn: 1,
    unitPriceOut: 2,
    currency: "USD",
  })
  await repo.upsertBinding({ step: "prefilter", modelId: model.id, updatedBy: "tester" })
  await repo.upsertBinding({ step: "extract", modelId: model.id, updatedBy: "tester" })
  return { provider, model, repo }
}

async function seedMaterial(intel: IntelRepository) {
  await intel.upsertSource(source, NOW)
  return intel.writeEntry({
    sourceId: source.id,
    canonicalUrl: url,
    title: "Westports berth suspension",
    contentHash: hash(body),
    contentScope: "full_text",
    extractorVersion: "synthetic-analyze-v1",
    blocks: licensedBlocks("full_text", "Westports berth suspension", body),
    fetchedAt: NOW,
  })
}

describe("industry selection helpers", () => {
  it("applies routine and rumour caps and median3", () => {
    const holiday = computeSeverity("holiday_notice", { impact: 9, scope: 9, urgency: 9, actionability: 9 })
    expect(holiday.severity).toBe(1)
    expect(holiday.capsApplied).toContain("routine_notice_max_1")
    const rumour = computeSeverity("other", { impact: 9, scope: 9, urgency: 9, actionability: 9 }, { rumourOnly: true })
    expect(rumour.severity).toBe(2)
    expect(median3(1, 5, 3)).toBe(3)
  })

  it("keeps prompt hashes stable", () => {
    expect(PREFILTER_PROMPT.hash).toMatch(/^[a-f0-9]{64}$/)
    expect(EXTRACT_PROMPT.hash).toMatch(/^[a-f0-9]{64}$/)
    expect(SEVERITY_SCORE_PROMPT.hash).toMatch(/^[a-f0-9]{64}$/)
  })

  it("parses prefilter/extract/severity and demotes BLOCK when content missing", () => {
    expect(parsePrefilterDecision(prefilterPass, false)).toBe("PASS")
    expect(parsePrefilterDecision(prefilterBlock, true)).toBe("UNKNOWN")
    expect(parsePrefilterDecision(prefilterUnknown, false)).toBe("UNKNOWN")
    const extracted = parseExtractOutput(extractJson)
    expect(extracted?.numbers.delayDays).toBe("3 days")
    expect(extracted?.numbers.waitingDays).toBeNull()
    expect(extracted?.occurredAt).toBeNull()
    expect(parseSeverityScoreOutput(scoreAgree)?.dimensions.impact).toBe(7)
  })
})

describe("runOfflineAnalyze offline chain", () => {
  it("denies private_material / missing permission before any provider hit", async () => {
    const native = new NativeDatabase(":memory:")
    cleanups.push(() => native.close())
    const db = wrap(native)
    await initShippingTables(db, "mock")
    const store = secrets()
    await setupRegistry(db, store)
    const intel = new IntelRepository(db)
    const saved = await seedMaterial(intel)
    const state: ScriptedState = { chatHits: 0, embeddingHits: 0, scripts: [prefilterPass] }
    const transport = createScriptedTransport(state)

    const denied = await runOfflineAnalyze({
      db,
      intelRepo: intel,
      secretStore: store,
      itemId: saved.itemId,
      versionId: saved.versionId,
      modelUsePermitted: false,
      transport,
      currency: "USD",
      monthlyBudget: undefined,
      sharedBudget: resolveSharedLlmBudgetGate(10, "USD"),
      resolveClaimConfig: createPaidClaimBudgetResolver({
        mode: "registry",
        overridePool: resolveSharedLlmBudgetGate(10, "USD"),
      }),
      now: () => T0,
    })
    expect(denied.ok).toBe(false)
    if (denied.ok) throw new Error("expected deny")
    expect(denied.code).toBe("payload_denied")
    expect(state.chatHits).toBe(0)
    expect(denied.analyses[0]?.status).toBe("denied")
  })

  it("stops before provider when binding missing", async () => {
    const native = new NativeDatabase(":memory:")
    cleanups.push(() => native.close())
    const db = wrap(native)
    await initShippingTables(db, "mock")
    const store = secrets()
    // provider/model exist but no bindings
    const repo = new LlmRegistryRepository(db)
    const provider = await repo.createProvider({
      id: "fixture-vendor-b",
      name: "Fixture Vendor B",
      baseUrl: "https://api.fixture-vendor-b.example/v1",
    })
    await store.set(provider.secretRef, "sk-fixture-b")
    await repo.createModel({
      providerId: provider.id,
      modelName: "fixture-chat-b",
      purpose: "chat",
      unitPriceIn: 1,
      unitPriceOut: 2,
      currency: "USD",
    })
    const intel = new IntelRepository(db)
    const saved = await seedMaterial(intel)
    const state: ScriptedState = { chatHits: 0, embeddingHits: 0, scripts: [] }
    const transport = createScriptedTransport(state)
    const result = await runOfflineAnalyze({
      db,
      intelRepo: intel,
      secretStore: store,
      itemId: saved.itemId,
      versionId: saved.versionId,
      modelUsePermitted: true,
      transport,
      currency: "USD",
      sharedBudget: resolveSharedLlmBudgetGate(10, "USD"),
      resolveClaimConfig: createPaidClaimBudgetResolver({
        mode: "registry",
        overridePool: resolveSharedLlmBudgetGate(10, "USD"),
      }),
      now: () => T0,
    })
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error("expected binding miss")
    expect(result.code).toBe("binding_missing")
    expect(state.chatHits).toBe(0)
  })

  it("completes PASS → extract → dual severity without tiebreak when scores agree", async () => {
    const native = new NativeDatabase(":memory:")
    cleanups.push(() => native.close())
    const db = wrap(native)
    await initShippingTables(db, "mock")
    expect((await import("#/database/runtime")).latestSchemaVersion).toBe(32)
    const store = secrets()
    await setupRegistry(db, store)
    const intel = new IntelRepository(db)
    const analysis = new IntelAnalysisRepository(db)
    const saved = await seedMaterial(intel)
    const state: ScriptedState = {
      chatHits: 0,
      embeddingHits: 0,
      scripts: [prefilterPass, extractJson, scoreAgree, scoreAgree],
    }
    const transport = createScriptedTransport(state)
    const shared = resolveSharedLlmBudgetGate(50, "USD")
    const result = await runOfflineAnalyze({
      db,
      intelRepo: intel,
      analysisRepo: analysis,
      secretStore: store,
      itemId: saved.itemId,
      versionId: saved.versionId,
      modelUsePermitted: true,
      transport,
      currency: "USD",
      sharedBudget: shared,
      resolveClaimConfig: createPaidClaimBudgetResolver({ mode: "registry", overridePool: shared }),
      now: () => T0,
    })
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(result.reason)
    expect(result.status).toBe("completed")
    expect(result.prefilter).toBe("PASS")
    expect(result.extract?.numbers.delayDays).toBe("3 days")
    expect(result.extract?.numbers.waitingDays).toBeNull()
    expect(result.severityScores).toHaveLength(2)
    expect(state.chatHits).toBe(4)
    expect(result.receiptIds.length).toBeGreaterThanOrEqual(4)
    const rows = await analysis.listForVersion(saved.itemId, saved.versionId)
    expect(rows.some(r => r.step === "prefilter" && r.promptHash === PREFILTER_PROMPT.hash)).toBe(true)
    expect(rows.some(r => r.step === "extract" && r.modelName === "fixture-chat")).toBe(true)
    expect(rows.filter(r => r.step === "severity")).toHaveLength(2)
    expect(rows.every(r => r.versionId === saved.versionId)).toBe(true)
  })

  it("unknown prefilter continues; BLOCK skips extract; wrong version denied", async () => {
    const native = new NativeDatabase(":memory:")
    cleanups.push(() => native.close())
    const db = wrap(native)
    await initShippingTables(db, "mock")
    const store = secrets()
    await setupRegistry(db, store)
    const intel = new IntelRepository(db)
    const saved = await seedMaterial(intel)

    const unknownState: ScriptedState = {
      chatHits: 0,
      embeddingHits: 0,
      scripts: [prefilterUnknown, extractJson, scoreAgree, scoreAgree],
    }
    const unknownResult = await runOfflineAnalyze({
      db,
      intelRepo: intel,
      secretStore: store,
      itemId: saved.itemId,
      versionId: saved.versionId,
      modelUsePermitted: true,
      transport: createScriptedTransport(unknownState),
      currency: "USD",
      sharedBudget: resolveSharedLlmBudgetGate(50, "USD"),
      resolveClaimConfig: createPaidClaimBudgetResolver({
        mode: "registry",
        overridePool: resolveSharedLlmBudgetGate(50, "USD"),
      }),
      now: () => T0,
    })
    expect(unknownResult.ok).toBe(true)
    if (!unknownResult.ok) throw new Error(unknownResult.reason)
    expect(unknownResult.prefilter).toBe("UNKNOWN")
    expect(unknownResult.extract).not.toBeNull()
    expect(unknownState.chatHits).toBe(4)

    // Fresh DB path for BLOCK using a second item/version
    const blockedBody = "Totally unrelated cooking recipe ".repeat(10)
    const blocked = await intel.writeEntry({
      sourceId: source.id,
      canonicalUrl: "https://www.tmd.go.th/synthetic/analyze?id=block",
      title: "Cooking",
      contentHash: hash(blockedBody),
      contentScope: "full_text",
      extractorVersion: "synthetic-analyze-v1",
      blocks: licensedBlocks("full_text", "Cooking", blockedBody),
      fetchedAt: NOW,
    })
    const blockState: ScriptedState = { chatHits: 0, embeddingHits: 0, scripts: [prefilterBlock] }
    const blockedResult = await runOfflineAnalyze({
      db,
      intelRepo: intel,
      secretStore: store,
      itemId: blocked.itemId,
      versionId: blocked.versionId,
      modelUsePermitted: true,
      transport: createScriptedTransport(blockState),
      currency: "USD",
      sharedBudget: resolveSharedLlmBudgetGate(50, "USD"),
      resolveClaimConfig: createPaidClaimBudgetResolver({
        mode: "registry",
        overridePool: resolveSharedLlmBudgetGate(50, "USD"),
      }),
      now: () => T0,
    })
    expect(blockedResult.ok).toBe(true)
    if (!blockedResult.ok) throw new Error(blockedResult.reason)
    expect(blockedResult.status).toBe("skipped_block")
    expect(blockedResult.extract).toBeNull()
    expect(blockState.chatHits).toBe(1)

    const mismatch = await runOfflineAnalyze({
      db,
      intelRepo: intel,
      secretStore: store,
      itemId: saved.itemId,
      versionId: blocked.versionId,
      modelUsePermitted: true,
      transport: createScriptedTransport({ chatHits: 0, embeddingHits: 0, scripts: [] }),
      currency: "USD",
      sharedBudget: resolveSharedLlmBudgetGate(50, "USD"),
      resolveClaimConfig: createPaidClaimBudgetResolver({
        mode: "registry",
        overridePool: resolveSharedLlmBudgetGate(50, "USD"),
      }),
      now: () => T0,
    })
    expect(mismatch.ok).toBe(false)
    if (mismatch.ok) throw new Error("expected mismatch")
    expect(mismatch.code).toBe("version_mismatch")
  })

  it("runs third median when |diff|>1 and does not forge complete when tiebreak fails", async () => {
    const native = new NativeDatabase(":memory:")
    cleanups.push(() => native.close())
    const db = wrap(native)
    await initShippingTables(db, "mock")
    const store = secrets()
    await setupRegistry(db, store)
    const intel = new IntelRepository(db)
    const saved = await seedMaterial(intel)

    const tieState: ScriptedState = {
      chatHits: 0,
      embeddingHits: 0,
      scripts: [prefilterPass, extractJson, scoreHigh, scoreLow, scoreMid],
    }
    const tied = await runOfflineAnalyze({
      db,
      intelRepo: intel,
      secretStore: store,
      itemId: saved.itemId,
      versionId: saved.versionId,
      modelUsePermitted: true,
      transport: createScriptedTransport(tieState),
      currency: "USD",
      sharedBudget: resolveSharedLlmBudgetGate(50, "USD"),
      resolveClaimConfig: createPaidClaimBudgetResolver({
        mode: "registry",
        overridePool: resolveSharedLlmBudgetGate(50, "USD"),
      }),
      now: () => T0,
    })
    expect(tied.ok).toBe(true)
    if (!tied.ok) throw new Error(tied.reason)
    expect(tied.severityScores).toHaveLength(3)
    expect(tieState.chatHits).toBe(5)
    expect(tied.severity?.capsApplied).toContain("median3")

    const failBody = "Another fixture port notice ".repeat(15)
    const failSaved = await intel.writeEntry({
      sourceId: source.id,
      canonicalUrl: "https://www.tmd.go.th/synthetic/analyze?id=tie-fail",
      title: "Tie fail",
      contentHash: hash(failBody),
      contentScope: "full_text",
      extractorVersion: "synthetic-analyze-v1",
      blocks: licensedBlocks("full_text", "Tie fail", failBody),
      fetchedAt: NOW,
    })
    const failState: ScriptedState = {
      chatHits: 0,
      embeddingHits: 0,
      scripts: [prefilterPass, extractJson, scoreHigh, scoreLow, "{not-json"],
    }
    const failed = await runOfflineAnalyze({
      db,
      intelRepo: intel,
      secretStore: store,
      itemId: failSaved.itemId,
      versionId: failSaved.versionId,
      modelUsePermitted: true,
      transport: createScriptedTransport(failState),
      currency: "USD",
      sharedBudget: resolveSharedLlmBudgetGate(50, "USD"),
      resolveClaimConfig: createPaidClaimBudgetResolver({
        mode: "registry",
        overridePool: resolveSharedLlmBudgetGate(50, "USD"),
      }),
      now: () => T0,
    })
    expect(failed.ok).toBe(false)
    if (failed.ok) throw new Error("expected tiebreak fail")
    expect(failed.code).toBe("severity_failed")
    expect(failed.reason).toBe("severity_tiebreak_failed")
    expect(failed.analyses.some(a => a.step === "severity_tiebreak" && a.status === "failed")).toBe(true)
  })

  it("reuses completed analysis on repeat without extra provider hits (no double-pay)", async () => {
    const native = new NativeDatabase(":memory:")
    cleanups.push(() => native.close())
    const db = wrap(native)
    await initShippingTables(db, "mock")
    const store = secrets()
    await setupRegistry(db, store)
    const intel = new IntelRepository(db)
    const analysis = new IntelAnalysisRepository(db)
    const saved = await seedMaterial(intel)
    const state: ScriptedState = {
      chatHits: 0,
      embeddingHits: 0,
      scripts: [prefilterPass, extractJson, scoreAgree, scoreAgree],
    }
    const transport = createScriptedTransport(state)
    const shared = resolveSharedLlmBudgetGate(50, "USD")
    const first = await runOfflineAnalyze({
      db,
      intelRepo: intel,
      analysisRepo: analysis,
      secretStore: store,
      itemId: saved.itemId,
      versionId: saved.versionId,
      modelUsePermitted: true,
      transport,
      currency: "USD",
      sharedBudget: shared,
      resolveClaimConfig: createPaidClaimBudgetResolver({ mode: "registry", overridePool: shared }),
      now: () => T0,
    })
    expect(first.ok).toBe(true)
    const hitsAfterFirst = state.chatHits
    expect(hitsAfterFirst).toBe(4)

    // Second run: prefilter+extract reuse from intel_analysis; severity still calls
    // (severity attempts intentionally not deduped across runs beyond paidRequest logical key).
    // For no-double-pay on the same logical paidRequest identity, re-call with same transport
    // should reuse receipts via paidRequest for identical identity keys.
    const second = await runOfflineAnalyze({
      db,
      intelRepo: intel,
      analysisRepo: analysis,
      secretStore: store,
      itemId: saved.itemId,
      versionId: saved.versionId,
      modelUsePermitted: true,
      transport,
      currency: "USD",
      sharedBudget: shared,
      resolveClaimConfig: createPaidClaimBudgetResolver({ mode: "registry", overridePool: shared }),
      now: () => T0,
    })
    expect(second.ok).toBe(true)
    if (!second.ok) throw new Error(second.reason)
    // prefilter+extract should be analysis-repo reused (no new chat for those two)
    // severity attempts still go through paidRequest; receipt reuse means chat may still be invoked
    // by our call wrapper only when claim decides to call — paidRequest short-circuits before call on reuse.
    // So chatHits should stay at 4 if all four logical keys reuse.
    expect(state.chatHits).toBe(hitsAfterFirst)
    expect(second.analyses.some(a => a.status === "reused" && a.step === "prefilter")).toBe(true)
    expect(second.analyses.some(a => a.status === "reused" && a.step === "extract")).toBe(true)
  })

  it("denies when shared budget is unconfigured / exhausted before provider", async () => {
    const native = new NativeDatabase(":memory:")
    cleanups.push(() => native.close())
    const db = wrap(native)
    await initShippingTables(db, "mock")
    const store = secrets()
    await setupRegistry(db, store)
    const intel = new IntelRepository(db)
    const saved = await seedMaterial(intel)
    const state: ScriptedState = { chatHits: 0, embeddingHits: 0, scripts: [prefilterPass] }
    const unconfigured = await runOfflineAnalyze({
      db,
      intelRepo: intel,
      secretStore: store,
      itemId: saved.itemId,
      versionId: saved.versionId,
      modelUsePermitted: true,
      transport: createScriptedTransport(state),
      currency: "USD",
      // no sharedBudget / resolveClaimConfig → paidRequest fail-closed for shared-capable path
      // Actually without sharedBudget, monthlyBudget undefined may still fail differently.
      // Use explicit null shared pool via resolver.
      sharedBudget: resolveSharedLlmBudgetGate(null, "USD"),
      resolveClaimConfig: createPaidClaimBudgetResolver({
        mode: "registry",
        overridePool: resolveSharedLlmBudgetGate(null, "USD"),
      }),
      now: () => T0,
    })
    expect(unconfigured.ok).toBe(false)
    if (unconfigured.ok) throw new Error("expected budget deny")
    expect(unconfigured.code).toBe("budget_denied")
    expect(state.chatHits).toBe(0)
  })
})
