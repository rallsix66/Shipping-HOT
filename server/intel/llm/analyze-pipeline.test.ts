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
  buildAnalysisReuseKey,
  parseExtractOutput,
  parsePrefilterDecision,
  parseSeverityScoreOutput,
  runOfflineAnalyze,
} from "#/intel/llm/analyze-pipeline"
import type { ExactVersionModelLicense } from "#/intel/llm/model-payload-gate"
import { aggregateMedianSeverity, computeSeverity, median3 } from "#/intel/industry/selection"
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
  chainStages: ["①"],
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

function licenseFor(saved: { itemId: string, versionId: string }, contentHash: string): ExactVersionModelLicense {
  return { itemId: saved.itemId, versionId: saved.versionId, contentHash, permitted: true as const }
}

describe("industry selection helpers", () => {
  it("caps only routine holiday/advisory; major holiday_notice stays high; median aggregate keeps all evidence", () => {
    const majorHoliday = computeSeverity("holiday_notice", { impact: 9, scope: 9, urgency: 9, actionability: 9 })
    expect(majorHoliday.severity).toBeGreaterThan(1)
    expect(majorHoliday.capsApplied).not.toContain("routine_notice_max_1")

    const routineHoliday = computeSeverity(
      "holiday_notice",
      { impact: 1, scope: 1, urgency: 1, actionability: 1 },
      { routineNotice: true },
    )
    expect(routineHoliday.severity).toBe(1)
    expect(routineHoliday.capsApplied).toContain("routine_notice_max_1")

    const lowDimHoliday = computeSeverity("holiday_notice", { impact: 2, scope: 1, urgency: 1, actionability: 1 })
    expect(lowDimHoliday.severity).toBe(1)

    const rumour = computeSeverity("other", { impact: 9, scope: 9, urgency: 9, actionability: 9 }, { rumourOnly: true })
    expect(rumour.severity).toBe(2)
    expect(median3(1, 5, 3)).toBe(3)

    const a = computeSeverity("port_congestion", { impact: 2, scope: 2, urgency: 2, actionability: 2 }, {}, { attemptIndex: 1 })
    const b = computeSeverity("port_congestion", { impact: 9, scope: 9, urgency: 9, actionability: 9 }, {}, { attemptIndex: 2 })
    const c = computeSeverity("port_congestion", { impact: 1, scope: 1, urgency: 1, actionability: 1 }, {}, { attemptIndex: 3 })
    // severities roughly [2?,5?,1?] — aggregate must not hang attempt-3 dims when median is from another attempt
    const agg = aggregateMedianSeverity("port_congestion", [a, b, c])
    expect(agg.aggregation).toBe("median3")
    expect(agg.capsApplied).toContain("median3")
    expect(agg.evidence).toHaveLength(3)
    expect(agg.severity).toBe(median3(a.severity, b.severity, c.severity))
    const match = [a, b, c].find(x => x.severity === agg.severity)!
    expect(agg.dimensions).toEqual(match.dimensions)
    expect(agg.beforeCap).toBe(match.beforeCap)
  })

  it("keeps prompt hashes stable", () => {
    expect(PREFILTER_PROMPT.hash).toMatch(/^[a-f0-9]{64}$/)
    expect(EXTRACT_PROMPT.hash).toMatch(/^[a-f0-9]{64}$/)
    expect(SEVERITY_SCORE_PROMPT.hash).toMatch(/^[a-f0-9]{64}$/)
    expect(EXTRACT_PROMPT.text).toContain("isOfficialStatement")
    expect(EXTRACT_PROMPT.text).toContain("isFirstParty")
    expect(EXTRACT_PROMPT.text).toContain("do not conflate")
    expect(EXTRACT_PROMPT.text).toContain("government or regulator")
    expect(EXTRACT_PROMPT.text).toContain("Carrier/port/platform self-announcements are NOT official")
    expect(EXTRACT_PROMPT.text).toContain("UN/LOCODE")
    expect(EXTRACT_PROMPT.text).toContain("①|②|③|④|⑤|⑥")
    expect(EXTRACT_PROMPT.text).toMatch(/海关总署公告/)
    expect(EXTRACT_PROMPT.text).toMatch(/船公司自身停航通告/)
  })

  it("strict-parses extract/severity; rejects silent coerces", () => {
    expect(parsePrefilterDecision(prefilterPass, false)).toBe("PASS")
    expect(parsePrefilterDecision(prefilterBlock, true)).toBe("UNKNOWN")
    expect(parseExtractOutput(extractJson)?.numbers.delayDays).toBe("3 days")
    expect(parseExtractOutput(extractJson)?.occurredAt).toBeNull()
    expect(parseSeverityScoreOutput(scoreAgree)?.dimensions.impact).toBe(7)

    // countries=123 / ports=string / bool='yes' / numbers=[] / float dims must fail
    expect(parseExtractOutput(JSON.stringify({
      ...JSON.parse(extractJson),
      countries: 123,
    }))).toBeNull()
    expect(parseExtractOutput(JSON.stringify({
      ...JSON.parse(extractJson),
      ports: "MYPKG",
    }))).toBeNull()
    expect(parseExtractOutput(JSON.stringify({
      ...JSON.parse(extractJson),
      isOfficialStatement: "yes",
    }))).toBeNull()
    expect(parseExtractOutput(JSON.stringify({
      ...JSON.parse(extractJson),
      numbers: [],
    }))).toBeNull()
    expect(parseExtractOutput(JSON.stringify({
      ...JSON.parse(extractJson),
      dimensions: { impact: 10.4, scope: 5, urgency: 6, actionability: 4 },
    }))).toBeNull()
    expect(parseExtractOutput(JSON.stringify({
      ...JSON.parse(extractJson),
      dimensions: { impact: -0.4, scope: 5, urgency: 6, actionability: 4 },
    }))).toBeNull()
    expect(parseSeverityScoreOutput(JSON.stringify({
      dimensions: { impact: 7.2, scope: 5, urgency: 6, actionability: 4 },
      rumourOnly: false,
    }))).toBeNull()
    expect(parseSeverityScoreOutput(JSON.stringify({
      dimensions: { impact: 7, scope: 5, urgency: 6, actionability: 4 },
      rumourOnly: "yes",
    }))).toBeNull()

    // numbers oversize must fail (no silent truncate)
    expect(parseExtractOutput(JSON.stringify({
      ...JSON.parse(extractJson),
      numbers: { delayDays: "x".repeat(9000) },
    }))).toBeNull()
    // full wording under limit is preserved
    const longOk = "约 ".concat("3".repeat(100), " 天延误（原文）")
    expect(parseExtractOutput(JSON.stringify({
      ...JSON.parse(extractJson),
      numbers: { delayDays: longOk },
    }))?.numbers.delayDays).toBe(longOk)

    // impossible calendar date
    expect(parseExtractOutput(JSON.stringify({
      ...JSON.parse(extractJson),
      occurredAt: "2026-99-99",
    }))).toBeNull()
    expect(parseExtractOutput(JSON.stringify({
      ...JSON.parse(extractJson),
      occurredAt: "2026-02-30",
    }))).toBeNull()
    expect(parseExtractOutput(JSON.stringify({
      ...JSON.parse(extractJson),
      occurredAt: "2026-11-02",
    }))?.occurredAt).toBe("2026-11-02")

    // ports must be UN/LOCODE; free-text / bad length fail
    expect(parseExtractOutput(JSON.stringify({
      ...JSON.parse(extractJson),
      ports: ["Port Klang"],
    }))).toBeNull()
    expect(parseExtractOutput(JSON.stringify({
      ...JSON.parse(extractJson),
      ports: ["MYPK"],
    }))).toBeNull()
    expect(parseExtractOutput(JSON.stringify({
      ...JSON.parse(extractJson),
      ports: ["mypkg"],
    }))?.ports).toEqual(["MYPKG"])

    // chainStages only ①–⑥
    expect(parseExtractOutput(JSON.stringify({
      ...JSON.parse(extractJson),
      chainStages: ["port"],
    }))).toBeNull()
    expect(parseExtractOutput(JSON.stringify({
      ...JSON.parse(extractJson),
      chainStages: ["⑦"],
    }))).toBeNull()
    expect(parseExtractOutput(JSON.stringify({
      ...JSON.parse(extractJson),
      chainStages: ["①", "④"],
    }))?.chainStages).toEqual(["①", "④"])
  })
})

describe("runOfflineAnalyze offline chain", () => {
  it("denies private_material / bare-true / mismatched license before any provider hit", async () => {
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
    const shared = resolveSharedLlmBudgetGate(10, "USD")

    const denied = await runOfflineAnalyze({
      db,
      intelRepo: intel,
      secretStore: store,
      itemId: saved.itemId,
      versionId: saved.versionId,
      modelUseLicense: {
        itemId: saved.itemId,
        versionId: saved.versionId,
        contentHash: "wrong-hash",
        permitted: true,
      },
      transport,
      sharedBudget: shared,
      resolveClaimConfig: createPaidClaimBudgetResolver({ mode: "registry", overridePool: shared }),
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
    const shared = resolveSharedLlmBudgetGate(10, "USD")
    const result = await runOfflineAnalyze({
      db,
      intelRepo: intel,
      secretStore: store,
      itemId: saved.itemId,
      versionId: saved.versionId,
      modelUseLicense: licenseFor(saved, hash(body)),
      transport,
      sharedBudget: shared,
      resolveClaimConfig: createPaidClaimBudgetResolver({ mode: "registry", overridePool: shared }),
      now: () => T0,
    })
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error("expected binding miss")
    expect(result.code).toBe("binding_missing")
    expect(state.chatHits).toBe(0)
  })

  it("completes PASS -> extract -> dual severity without tiebreak when scores agree", async () => {
    const native = new NativeDatabase(":memory:")
    cleanups.push(() => native.close())
    const db = wrap(native)
    await initShippingTables(db, "mock")
    expect((await import("#/database/runtime")).latestSchemaVersion).toBe(33)
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
      modelUseLicense: licenseFor(saved, hash(body)),
      transport,
      sharedBudget: shared,
      resolveClaimConfig: createPaidClaimBudgetResolver({ mode: "registry", overridePool: shared }),
      now: () => T0,
    })
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(result.reason)
    expect(result.status).toBe("completed")
    expect(result.prefilter).toBe("PASS")
    expect(result.extract?.numbers.delayDays).toBe("3 days")
    expect(result.severityScores).toHaveLength(2)
    expect(state.chatHits).toBe(4)
    expect(result.severity?.aggregation).toBe("single")
    const rows = await analysis.listForVersion(saved.itemId, saved.versionId)
    expect(rows.some(r => r.reuseKey && r.reuseKey.length === 64)).toBe(true)
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
    const shared = resolveSharedLlmBudgetGate(50, "USD")
    const resolver = createPaidClaimBudgetResolver({ mode: "registry", overridePool: shared })

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
      modelUseLicense: licenseFor(saved, hash(body)),
      transport: createScriptedTransport(unknownState),
      sharedBudget: shared,
      resolveClaimConfig: resolver,
      now: () => T0,
    })
    expect(unknownResult.ok).toBe(true)
    if (!unknownResult.ok) throw new Error(unknownResult.reason)
    expect(unknownResult.prefilter).toBe("UNKNOWN")
    expect(unknownState.chatHits).toBe(4)

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
      modelUseLicense: licenseFor(blocked, hash(blockedBody)),
      transport: createScriptedTransport(blockState),
      sharedBudget: shared,
      resolveClaimConfig: resolver,
      now: () => T0,
    })
    expect(blockedResult.ok).toBe(true)
    if (!blockedResult.ok) throw new Error(blockedResult.reason)
    expect(blockedResult.status).toBe("skipped_block")
    expect(blockState.chatHits).toBe(1)

    const mismatch = await runOfflineAnalyze({
      db,
      intelRepo: intel,
      secretStore: store,
      itemId: saved.itemId,
      versionId: blocked.versionId,
      modelUseLicense: licenseFor(saved, hash(body)),
      transport: createScriptedTransport({ chatHits: 0, embeddingHits: 0, scripts: [] }),
      sharedBudget: shared,
      resolveClaimConfig: resolver,
      now: () => T0,
    })
    expect(mismatch.ok).toBe(false)
    if (mismatch.ok) throw new Error("expected mismatch")
    expect(mismatch.code).toBe("version_mismatch")
  })

  it("runs third median when |diff|>1; keeps three evidences; does not forge complete when tiebreak fails", async () => {
    const native = new NativeDatabase(":memory:")
    cleanups.push(() => native.close())
    const db = wrap(native)
    await initShippingTables(db, "mock")
    const store = secrets()
    await setupRegistry(db, store)
    const intel = new IntelRepository(db)
    const saved = await seedMaterial(intel)
    const shared = resolveSharedLlmBudgetGate(50, "USD")
    const resolver = createPaidClaimBudgetResolver({ mode: "registry", overridePool: shared })

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
      modelUseLicense: licenseFor(saved, hash(body)),
      transport: createScriptedTransport(tieState),
      sharedBudget: shared,
      resolveClaimConfig: resolver,
      now: () => T0,
    })
    expect(tied.ok).toBe(true)
    if (!tied.ok) throw new Error(tied.reason)
    expect(tied.severityScores).toHaveLength(3)
    expect(tieState.chatHits).toBe(5)
    expect(tied.severity?.capsApplied).toContain("median3")
    expect(tied.severity?.aggregation).toBe("median3")
    expect(tied.severity?.evidence).toHaveLength(3)

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
      modelUseLicense: licenseFor(failSaved, hash(failBody)),
      transport: createScriptedTransport(failState),
      sharedBudget: shared,
      resolveClaimConfig: resolver,
      now: () => T0,
    })
    expect(failed.ok).toBe(false)
    if (failed.ok) throw new Error("expected tiebreak fail")
    expect(failed.code).toBe("severity_failed")
    expect(failed.reason).toBe("severity_tiebreak_failed")
    expect(failed.analyses.some(a => a.step === "severity_tiebreak" && a.status === "failed")).toBe(true)
  })

  it("reuses completed analysis on repeat; in-place modelName edit must NOT reuse", async () => {
    const native = new NativeDatabase(":memory:")
    cleanups.push(() => native.close())
    const db = wrap(native)
    await initShippingTables(db, "mock")
    const store = secrets()
    const { model, repo } = await setupRegistry(db, store)
    const intel = new IntelRepository(db)
    const analysis = new IntelAnalysisRepository(db)
    const saved = await seedMaterial(intel)
    const state: ScriptedState = {
      chatHits: 0,
      embeddingHits: 0,
      // First run (4) + post-rename re-pay (4); second run reuses with zero hits.
      scripts: [
        prefilterPass,
        extractJson,
        scoreAgree,
        scoreAgree,
        prefilterPass,
        extractJson,
        scoreAgree,
        scoreAgree,
      ],
    }
    const transport = createScriptedTransport(state)
    const shared = resolveSharedLlmBudgetGate(50, "USD")
    const resolver = createPaidClaimBudgetResolver({ mode: "registry", overridePool: shared })
    const first = await runOfflineAnalyze({
      db,
      intelRepo: intel,
      analysisRepo: analysis,
      secretStore: store,
      itemId: saved.itemId,
      versionId: saved.versionId,
      modelUseLicense: licenseFor(saved, hash(body)),
      transport,
      sharedBudget: shared,
      resolveClaimConfig: resolver,
      now: () => T0,
    })
    expect(first.ok).toBe(true)
    const hitsAfterFirst = state.chatHits
    expect(hitsAfterFirst).toBe(4)

    const second = await runOfflineAnalyze({
      db,
      intelRepo: intel,
      analysisRepo: analysis,
      secretStore: store,
      itemId: saved.itemId,
      versionId: saved.versionId,
      modelUseLicense: licenseFor(saved, hash(body)),
      transport,
      sharedBudget: shared,
      resolveClaimConfig: resolver,
      now: () => T0,
    })
    expect(second.ok).toBe(true)
    if (!second.ok) throw new Error(second.reason)
    expect(state.chatHits).toBe(hitsAfterFirst)
    expect(second.analyses.some(a => a.status === "reused" && a.step === "prefilter")).toBe(true)
    expect(second.analyses.some(a => a.status === "reused" && a.step === "extract")).toBe(true)

    // In-place modelName edit: same modelId, new name => reuse_key miss => re-pay
    await repo.updateModel(model.id, { modelName: "fixture-chat-renamed" })
    const third = await runOfflineAnalyze({
      db,
      intelRepo: intel,
      analysisRepo: analysis,
      secretStore: store,
      itemId: saved.itemId,
      versionId: saved.versionId,
      modelUseLicense: licenseFor(saved, hash(body)),
      transport,
      sharedBudget: shared,
      resolveClaimConfig: resolver,
      now: () => T0,
    })
    expect(third.ok).toBe(true)
    if (!third.ok) throw new Error(third.reason)
    expect(state.chatHits).toBeGreaterThan(hitsAfterFirst)
    expect(third.analyses.some(a => a.status === "completed" && a.step === "prefilter" && a.modelName === "fixture-chat-renamed")).toBe(true)
  })

  it("rejects CNY pool + USD model before provider (zero attempt); empty/disabled pool denies", async () => {
    const native = new NativeDatabase(":memory:")
    cleanups.push(() => native.close())
    const db = wrap(native)
    await initShippingTables(db, "mock")
    const store = secrets()
    await setupRegistry(db, store)
    const intel = new IntelRepository(db)
    const saved = await seedMaterial(intel)
    const state: ScriptedState = { chatHits: 0, embeddingHits: 0, scripts: [prefilterPass] }
    const cnyPool = resolveSharedLlmBudgetGate(50, "CNY")
    const mismatch = await runOfflineAnalyze({
      db,
      intelRepo: intel,
      secretStore: store,
      itemId: saved.itemId,
      versionId: saved.versionId,
      modelUseLicense: licenseFor(saved, hash(body)),
      transport: createScriptedTransport(state),
      sharedBudget: cnyPool,
      resolveClaimConfig: createPaidClaimBudgetResolver({ mode: "registry", overridePool: cnyPool }),
      now: () => T0,
    })
    expect(mismatch.ok).toBe(false)
    if (mismatch.ok) throw new Error("expected currency deny")
    expect(mismatch.code).toBe("budget_denied")
    expect(String(mismatch.reason)).toMatch(/currency/i)
    expect(state.chatHits).toBe(0)

    const emptyState: ScriptedState = { chatHits: 0, embeddingHits: 0, scripts: [prefilterPass] }
    const empty = await runOfflineAnalyze({
      db,
      intelRepo: intel,
      secretStore: store,
      itemId: saved.itemId,
      versionId: saved.versionId,
      modelUseLicense: licenseFor(saved, hash(body)),
      transport: createScriptedTransport(emptyState),
      sharedBudget: resolveSharedLlmBudgetGate(null, "USD"),
      resolveClaimConfig: createPaidClaimBudgetResolver({
        mode: "registry",
        overridePool: resolveSharedLlmBudgetGate(null, "USD"),
      }),
      now: () => T0,
    })
    expect(empty.ok).toBe(false)
    if (empty.ok) throw new Error("expected empty deny")
    expect(empty.code).toBe("budget_denied")
    expect(emptyState.chatHits).toBe(0)
  })

  it("illegal extract output stays failed (not completed) and does not re-bill as success", async () => {
    const native = new NativeDatabase(":memory:")
    cleanups.push(() => native.close())
    const db = wrap(native)
    await initShippingTables(db, "mock")
    const store = secrets()
    await setupRegistry(db, store)
    const intel = new IntelRepository(db)
    const analysis = new IntelAnalysisRepository(db)
    const saved = await seedMaterial(intel)
    const badExtract = JSON.stringify({
      eventType: "port_congestion",
      countries: 123,
      ports: ["MYPKG"],
      cities: [],
      chainStages: [],
      namedEntity: null,
      occurredAt: null,
      effectiveFrom: null,
      effectiveUntil: null,
      numbers: {},
      isOfficialStatement: false,
      isFirstParty: true,
      dimensions: { impact: 7, scope: 5, urgency: 6, actionability: 4 },
    })
    const state: ScriptedState = { chatHits: 0, embeddingHits: 0, scripts: [prefilterPass, badExtract] }
    const shared = resolveSharedLlmBudgetGate(50, "USD")
    const failed = await runOfflineAnalyze({
      db,
      intelRepo: intel,
      analysisRepo: analysis,
      secretStore: store,
      itemId: saved.itemId,
      versionId: saved.versionId,
      modelUseLicense: licenseFor(saved, hash(body)),
      transport: createScriptedTransport(state),
      sharedBudget: shared,
      resolveClaimConfig: createPaidClaimBudgetResolver({ mode: "registry", overridePool: shared }),
      now: () => T0,
    })
    expect(failed.ok).toBe(false)
    if (failed.ok) throw new Error("expected extract fail")
    expect(failed.code).toBe("extract_failed")
    expect(failed.analyses.some(a => a.step === "extract" && a.status === "failed")).toBe(true)
    expect(failed.analyses.some(a => a.step === "extract" && a.status === "completed")).toBe(false)
  })

  it("third severity budget deny is distinct from bad JSON parse fail", async () => {
    const native = new NativeDatabase(":memory:")
    cleanups.push(() => native.close())
    const db = wrap(native)
    await initShippingTables(db, "mock")
    const store = secrets()
    const repo = new LlmRegistryRepository(db)
    const provider = await repo.createProvider({
      id: "fixture-vendor-budget",
      name: "Fixture Vendor Budget",
      baseUrl: "https://api.fixture-budget.example/v1",
    })
    await store.set(provider.secretRef, "sk-fixture-budget")
    // High unit prices so estimate (400/200) = 0.6 and actual (40/20) = 0.06.
    const model = await repo.createModel({
      providerId: provider.id,
      modelName: "fixture-chat-budget",
      purpose: "chat",
      unitPriceIn: 1000,
      unitPriceOut: 1000,
      currency: "USD",
    })
    await repo.upsertBinding({ step: "prefilter", modelId: model.id, updatedBy: "tester" })
    await repo.upsertBinding({ step: "extract", modelId: model.id, updatedBy: "tester" })
    const intel = new IntelRepository(db)
    const saved = await seedMaterial(intel)
    // budget in [0.78, 0.84): 4th estimate succeeds, 5th (tiebreak) denied.
    const shared = resolveSharedLlmBudgetGate(0.80, "USD")
    const state: ScriptedState = {
      chatHits: 0,
      embeddingHits: 0,
      scripts: [prefilterPass, extractJson, scoreHigh, scoreLow, scoreMid],
    }
    const result = await runOfflineAnalyze({
      db,
      intelRepo: intel,
      secretStore: store,
      itemId: saved.itemId,
      versionId: saved.versionId,
      modelUseLicense: licenseFor(saved, hash(body)),
      transport: createScriptedTransport(state),
      sharedBudget: shared,
      resolveClaimConfig: createPaidClaimBudgetResolver({ mode: "registry", overridePool: shared }),
      now: () => T0,
    })
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error("expected budget fail on tiebreak")
    expect(result.code).toBe("severity_failed")
    expect(result.analyses.some(a => a.step === "severity_tiebreak" && a.status === "denied" && a.errorCode === "budget_denied")).toBe(true)
    expect(result.analyses.some(a => a.errorCode === "invalid_severity_score")).toBe(false)
    expect(state.chatHits).toBe(4)
  })

  it("buildAnalysisReuseKey changes when modelName or endpoint changes", () => {
    const base = {
      step: "extract" as const,
      providerId: "p",
      baseUrl: "https://a.example/v1",
      modelId: "m1",
      modelName: "chat-a",
      unitPriceIn: 1,
      unitPriceOut: 2,
      currency: "USD",
      promptHash: "abc",
      contentHash: "def",
      stepInputFingerprint: "ghi",
    }
    const k1 = buildAnalysisReuseKey(base)
    const k2 = buildAnalysisReuseKey({ ...base, modelName: "chat-b" })
    const k3 = buildAnalysisReuseKey({ ...base, baseUrl: "https://b.example/v1" })
    expect(k1).not.toBe(k2)
    expect(k1).not.toBe(k3)
    expect(k1).toBe(buildAnalysisReuseKey(base))
  })
})
