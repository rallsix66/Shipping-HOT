/**
 * A1 offline analyze → policy orchestration coverage (fake Provider + isolated DB).
 * Production triggers remain absent; ExactVersion license still injected (A2 not connected).
 */
import { createHash } from "node:crypto"
import { afterEach, describe, expect, it } from "vitest"
import NativeDatabase from "better-sqlite3"
import { createDatabase } from "db0"
import { initShippingTables } from "#/database/shipping"
import { IntelRepository } from "#/database/intel"
import { IntelAnalysisRepository } from "#/database/intel-analysis"
import { LlmRegistryRepository } from "#/database/llm-registry"
import { PolicyRepository } from "#/database/policy"
import { licensedBlocks } from "#/intel/content-license"
import { intelSourceSeeds } from "#/intel/sources"
import { resolveSharedLlmBudgetGate } from "#/intel/llm/shared-budget"
import type { ExactVersionModelLicense } from "#/intel/llm/model-payload-gate"
import type { OpenAiChatRequest, OpenAiChatResponse, OpenAiCompatibleTransport, OpenAiEmbeddingRequest, OpenAiEmbeddingResponse } from "#/intel/llm/openai-compatible"
import type { SecretStore } from "#/providers/contracts"
import { createPaidClaimBudgetResolver } from "#/services/shared-llm-budget-settings"
import {
  PolicyAutoService,
  policyAutoInvokeCount,
  resetPolicyAutoInvokeCount,
} from "#/intel/policy-auto"
import {
  decidePolicyApplyAfterAnalyze,
  retryPolicyApplyFromExactRun,
  runOfflineAnalyzeThenPolicy,
  verifyPersistedExactRunAnalyzeSuccess,
} from "#/intel/llm/offline-analyze-policy"

const NOW = "2026-11-02T08:00:00.000Z"
const T0 = new Date(NOW)
const source = { ...intelSourceSeeds[0]!, persistence: "full" as const }
const url = "https://example.org/fixture/a1-offline-policy"
const body = "Fixture customs notice for A1 offline orchestration. Document AUTO-A1-001. ".repeat(12)
const hash = (text: string) => createHash("sha256").update(text).digest("hex")

const cleanups: Array<() => void> = []
afterEach(() => {
  while (cleanups.length) cleanups.pop()!()
  resetPolicyAutoInvokeCount()
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

const prefilterPass = JSON.stringify({ decision: "PASS", reason: "policy ops" })
const prefilterBlock = JSON.stringify({ decision: "BLOCK", reason: "unrelated" })
const prefilterUnknown = JSON.stringify({ decision: "UNKNOWN", reason: "ambiguous" })
const scoreAgree = JSON.stringify({ dimensions: { impact: 7, scope: 5, urgency: 6, actionability: 4 }, rumourOnly: false })

function extractJson(over: Record<string, unknown> = {}) {
  return JSON.stringify({
    eventType: "customs_rule",
    countries: ["VN"],
    ports: [],
    cities: [],
    chainStages: [],
    namedEntity: null,
    occurredAt: "2026-10-01",
    effectiveFrom: "2026-11-01",
    effectiveUntil: null,
    numbers: {},
    isOfficialStatement: true,
    isFirstParty: true,
    publisher: "示例机关（fixture）",
    documentNumber: "AUTO-A1-001",
    status: "published",
    platform: null,
    dimensions: { impact: 7, scope: 5, urgency: 6, actionability: 4 },
    ...over,
  })
}

async function setupRegistry(db: ReturnType<typeof wrap>, store: SecretStore) {
  const repo = new LlmRegistryRepository(db)
  const provider = await repo.createProvider({
    id: "fixture-vendor-a1",
    name: "Fixture Vendor A1",
    baseUrl: "https://api.fixture-vendor-a1.example/v1",
  })
  await store.set(provider.secretRef, "sk-fixture-a1")
  const model = await repo.createModel({
    providerId: provider.id,
    modelName: "fixture-chat-a1",
    purpose: "chat",
    unitPriceIn: 1,
    unitPriceOut: 2,
    currency: "USD",
  })
  await repo.upsertBinding({ step: "prefilter", modelId: model.id, updatedBy: "tester" })
  await repo.upsertBinding({ step: "extract", modelId: model.id, updatedBy: "tester" })
  return { provider, model, repo }
}

async function seedMaterial(intel: IntelRepository, over: { url?: string, body?: string, title?: string } = {}) {
  await intel.upsertSource(source, NOW)
  const text = over.body ?? body
  return intel.writeEntry({
    sourceId: source.id,
    canonicalUrl: over.url ?? url,
    title: over.title ?? "[FIXTURE] A1 customs material",
    contentHash: hash(text),
    contentScope: "full_text",
    extractorVersion: "a1-offline-v1",
    blocks: licensedBlocks("full_text", over.title ?? "[FIXTURE] A1 customs material", text),
    fetchedAt: NOW,
    publishedAt: "2026-10-01T00:00:00.000Z",
  })
}

function licenseFor(saved: { itemId: string, versionId: string }, contentHash: string): ExactVersionModelLicense {
  return { itemId: saved.itemId, versionId: saved.versionId, contentHash, permitted: true as const }
}

async function openHarness(scripts: string[]) {
  const native = new NativeDatabase(":memory:")
  cleanups.push(() => native.close())
  const db = wrap(native)
  await initShippingTables(db, "real")
  const store = secrets()
  await setupRegistry(db, store)
  const intel = new IntelRepository(db)
  const analysis = new IntelAnalysisRepository(db)
  const policies = new PolicyRepository(db)
  const policyAuto = new PolicyAutoService(db, policies)
  const saved = await seedMaterial(intel)
  const shared = resolveSharedLlmBudgetGate(50, "USD")
  const transportState: ScriptedState = { chatHits: 0, embeddingHits: 0, scripts }
  const transport = createScriptedTransport(transportState)
  const baseInput = {
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
    policies,
    policyAuto,
    enteredBy: "a1-test",
    isFixture: true,
  }
  return { db, native, intel, analysis, policies, policyAuto, saved, transportState, baseInput, contentHash: hash(body) }
}

describe("decidePolicyApplyAfterAnalyze", () => {
  it("default closed; BLOCK and non-policy skip", () => {
    const baseOk = {
      ok: true as const,
      status: "completed" as const,
      itemId: "i",
      versionId: "v",
      contentHash: "h",
      prefilter: "PASS" as const,
      extract: {
        eventType: "customs_rule" as const,
        countries: ["VN"],
        ports: [] as string[],
        cities: [] as string[],
        chainStages: [] as string[],
        namedEntity: null,
        occurredAt: null,
        effectiveFrom: null,
        effectiveUntil: null,
        numbers: {},
        isOfficialStatement: true,
        isFirstParty: true,
        publisher: "p",
        documentNumber: "d",
        status: "published" as const,
        platform: null,
        dimensions: { impact: 1, scope: 1, urgency: 1, actionability: 1 },
      },
      severity: null,
      severityScores: [] as number[],
      analyses: [{ itemId: "i", versionId: "v", contentHash: "h", runId: "r1" }],
      receiptIds: [] as string[],
    }
    expect(decidePolicyApplyAfterAnalyze(undefined, baseOk as never)).toEqual({ apply: false, reason: "policy_auto_disabled" })
    expect(decidePolicyApplyAfterAnalyze(false, baseOk as never)).toEqual({ apply: false, reason: "policy_auto_disabled" })
    expect(decidePolicyApplyAfterAnalyze(true, { ...baseOk, status: "skipped_block", extract: null } as never)).toEqual({
      apply: false,
      reason: "prefilter_blocked",
    })
    expect(decidePolicyApplyAfterAnalyze(true, {
      ...baseOk,
      extract: { ...baseOk.extract, eventType: "port_congestion" },
    } as never)).toEqual({ apply: false, reason: "event_type_not_policy" })
    expect(decidePolicyApplyAfterAnalyze(true, baseOk as never)).toEqual({ apply: true, runId: "r1" })
  })
})

describe("runOfflineAnalyzeThenPolicy A1 orchestration", () => {
  it("default off: analyze may succeed but policy not invoked", async () => {
    const { baseInput, transportState, policies } = await openHarness([
      prefilterPass,
      extractJson(),
      scoreAgree,
      scoreAgree,
    ])
    const before = policyAutoInvokeCount()
    const result = await runOfflineAnalyzeThenPolicy({ ...baseInput, enablePolicyAuto: false })
    expect(result.analyze.ok).toBe(true)
    expect(result.policy).toBeNull()
    expect(result.policySkippedReason).toBe("policy_auto_disabled")
    expect(policyAutoInvokeCount()).toBe(before)
    expect((await policies.list({}, T0)).length).toBe(0)
    expect(transportState.chatHits).toBeGreaterThan(0)
  })

  it("explicit on + policy extract → created; repeat run reuses analyze and does not duplicate policy version", async () => {
    const h = await openHarness([
      prefilterPass,
      extractJson(),
      scoreAgree,
      scoreAgree,
    ])
    const first = await runOfflineAnalyzeThenPolicy({ ...h.baseInput, enablePolicyAuto: true })
    expect(first.analyze.ok).toBe(true)
    if (!first.analyze.ok) throw new Error("unreachable")
    expect(first.policy?.outcome).toBe("created")
    expect(first.policyError).toBeNull()
    const hitsAfterFirst = h.transportState.chatHits
    expect(hitsAfterFirst).toBeGreaterThan(0)
    const policiesAfterFirst = await h.policies.list({}, T0)
    expect(policiesAfterFirst).toHaveLength(1)
    const versionId = first.policy?.versionId

    const second = await runOfflineAnalyzeThenPolicy({ ...h.baseInput, enablePolicyAuto: true })
    // DEBUG
    expect(second.analyze.ok).toBe(true)
    if (!second.analyze.ok) throw new Error("unreachable")
    expect(second.analyze.status).toBe("reused")
    expect(h.transportState.chatHits).toBe(hitsAfterFirst)
    // Same intelVersionId+contentHash source-op replays prior result (often outcome "created")
    // without rewriting / duplicating the policy record, and without new Provider hits.
    expect(second.policy).not.toBeNull()
    expect(second.policyError).toBeNull()
    expect(second.policySkippedReason).toBeNull()
    expect(["created", "unchanged", "updated"]).toContain(second.policy!.outcome)
    expect(second.policy!.policyId).toBe(first.policy!.policyId)
    expect(second.policy!.versionId).toBe(versionId)
    expect((await h.policies.list({}, T0))).toHaveLength(1)
  })

  it("non-policy extract skips policy apply", async () => {
    const h = await openHarness([
      prefilterPass,
      extractJson({ eventType: "port_congestion", documentNumber: null, publisher: null, countries: ["MY"] }),
      scoreAgree,
      scoreAgree,
    ])
    const result = await runOfflineAnalyzeThenPolicy({ ...h.baseInput, enablePolicyAuto: true })
    expect(result.analyze.ok).toBe(true)
    expect(result.policy).toBeNull()
    expect(result.policySkippedReason).toBe("event_type_not_policy")
    expect((await h.policies.list({}, T0)).length).toBe(0)
  })

  it("prefilter BLOCK skips policy; analyze reports skipped_block", async () => {
    const h = await openHarness([prefilterBlock])
    const result = await runOfflineAnalyzeThenPolicy({ ...h.baseInput, enablePolicyAuto: true })
    expect(result.analyze.ok).toBe(true)
    if (!result.analyze.ok) throw new Error("unreachable")
    expect(result.analyze.status).toBe("skipped_block")
    expect(result.policy).toBeNull()
    expect(result.policySkippedReason).toBe("prefilter_blocked")
    expect((await h.policies.list({}, T0)).length).toBe(0)
  })

  it("provider failure does not policy-入库 and does not fake chain complete", async () => {
    const h = await openHarness([prefilterPass])
    h.transportState.failOnHit = 2
    h.transportState.scripts = [prefilterPass, "{}"]
    const result = await runOfflineAnalyzeThenPolicy({ ...h.baseInput, enablePolicyAuto: true })
    expect(result.analyze.ok).toBe(false)
    expect(result.policy).toBeNull()
    expect(result.policySkippedReason?.startsWith("analyze_not_ok:")).toBe(true)
    expect((await h.policies.list({}, T0)).length).toBe(0)
  })

  it("missing document number → needs_human_confirm pending, not silent invent", async () => {
    const h = await openHarness([
      prefilterPass,
      extractJson({ documentNumber: null, publisher: "示例机关（fixture）" }),
      scoreAgree,
      scoreAgree,
    ])
    const result = await runOfflineAnalyzeThenPolicy({ ...h.baseInput, enablePolicyAuto: true })
    expect(result.analyze.ok).toBe(true)
    expect(result.policy?.outcome).toBe("needs_human_confirm")
    expect((await h.policies.list({}, T0)).length).toBe(0)
  })

  it("policy write fault leaves analyze; retryPolicyApplyFromExactRun succeeds without new Provider hits", async () => {
    const h = await openHarness([
      prefilterPass,
      extractJson(),
      scoreAgree,
      scoreAgree,
    ])
    let failOnce = true
    const real = h.policyAuto
    const flaky = {
      applyFromExactIntel: async (
        deps: Parameters<PolicyAutoService["applyFromExactIntel"]>[0],
        input: Parameters<PolicyAutoService["applyFromExactIntel"]>[1],
        now: Date,
      ) => {
        if (failOnce) {
          failOnce = false
          throw new Error("simulated_policy_write_fault")
        }
        return real.applyFromExactIntel(deps, input, now)
      },
    } as PolicyAutoService

    const failed = await runOfflineAnalyzeThenPolicy({
      ...h.baseInput,
      enablePolicyAuto: true,
      policyAuto: flaky,
    })
    expect(failed.analyze.ok).toBe(true)
    if (!failed.analyze.ok) throw new Error("unreachable")
    expect(failed.policy).toBeNull()
    expect(failed.policyError).toBe("simulated_policy_write_fault")
    const hits = h.transportState.chatHits
    expect(hits).toBeGreaterThan(0)
    const runId = failed.analyze.analyses[0]?.runId
    expect(runId).toBeTruthy()

    const retried = await retryPolicyApplyFromExactRun({
      db: h.db,
      intelRepo: h.intel,
      analysisRepo: h.analysis,
      policyAuto: real,
      itemId: failed.analyze.itemId,
      versionId: failed.analyze.versionId,
      contentHash: failed.analyze.contentHash,
      runId: runId!,
      isFixture: true,
      enteredBy: "a1-retry",
      now: () => T0,
    })
    expect(retried.outcome).toBe("created")
    expect(h.transportState.chatHits).toBe(hits)
    expect((await h.policies.list({}, T0))).toHaveLength(1)
  })

  it("contrast: UNKNOWN full success → policy write fault → retry succeeds; Provider hits unchanged", async () => {
    const h = await openHarness([
      prefilterUnknown,
      extractJson(),
      scoreAgree,
      scoreAgree,
    ])
    let failOnce = true
    const real = h.policyAuto
    const flaky = {
      applyFromExactIntel: async (
        deps: Parameters<PolicyAutoService["applyFromExactIntel"]>[0],
        input: Parameters<PolicyAutoService["applyFromExactIntel"]>[1],
        now: Date,
      ) => {
        if (failOnce) {
          failOnce = false
          throw new Error("simulated_policy_write_fault_unknown")
        }
        return real.applyFromExactIntel(deps, input, now)
      },
    } as PolicyAutoService

    const failed = await runOfflineAnalyzeThenPolicy({
      ...h.baseInput,
      enablePolicyAuto: true,
      policyAuto: flaky,
    })
    expect(failed.analyze.ok).toBe(true)
    if (!failed.analyze.ok) throw new Error("unreachable")
    expect(failed.analyze.prefilter).toBe("UNKNOWN")
    expect(failed.policy).toBeNull()
    expect(failed.policyError).toBe("simulated_policy_write_fault_unknown")
    const hits = h.transportState.chatHits
    expect(hits).toBeGreaterThan(0)
    const runId = failed.analyze.analyses[0]?.runId
    expect(runId).toBeTruthy()

    const gate = verifyPersistedExactRunAnalyzeSuccess(
      await h.analysis.listForVersion(failed.analyze.itemId, failed.analyze.versionId),
      {
        itemId: failed.analyze.itemId,
        versionId: failed.analyze.versionId,
        contentHash: failed.analyze.contentHash,
        runId: runId!,
      },
    )
    expect(gate).toEqual({ ok: true })

    const retried = await retryPolicyApplyFromExactRun({
      db: h.db,
      intelRepo: h.intel,
      analysisRepo: h.analysis,
      policyAuto: real,
      itemId: failed.analyze.itemId,
      versionId: failed.analyze.versionId,
      contentHash: failed.analyze.contentHash,
      runId: runId!,
      isFixture: true,
      enteredBy: "a1-retry-unknown",
      now: () => T0,
    })
    expect(retried.outcome).toBe("created")
    expect(h.transportState.chatHits).toBe(hits)
    expect((await h.policies.list({}, T0))).toHaveLength(1)
  })

  it("contrast: empty/wrong runId → retry refuses (no apply)", async () => {
    const h = await openHarness([
      prefilterPass,
      extractJson(),
      scoreAgree,
      scoreAgree,
    ])
    const result = await runOfflineAnalyzeThenPolicy({ ...h.baseInput, enablePolicyAuto: true })
    expect(result.analyze.ok).toBe(true)
    if (!result.analyze.ok) throw new Error("unreachable")
    expect(result.policy?.outcome).toBe("created")
    const hits = h.transportState.chatHits
    const realRunId = result.analyze.analyses[0]?.runId
    expect(realRunId).toBeTruthy()

    const empty = await retryPolicyApplyFromExactRun({
      db: h.db,
      intelRepo: h.intel,
      analysisRepo: h.analysis,
      itemId: result.analyze.itemId,
      versionId: result.analyze.versionId,
      contentHash: result.analyze.contentHash,
      runId: "",
      isFixture: true,
      now: () => T0,
    })
    expect(empty.outcome).toBe("rejected")
    expect(empty.reason).toBe("analyze_success_unverified:invalid_exact_identity")

    const wrong = await retryPolicyApplyFromExactRun({
      db: h.db,
      intelRepo: h.intel,
      analysisRepo: h.analysis,
      itemId: result.analyze.itemId,
      versionId: result.analyze.versionId,
      contentHash: result.analyze.contentHash,
      runId: "not-this-run",
      isFixture: true,
      now: () => T0,
    })
    expect(wrong.outcome).toBe("rejected")
    expect(wrong.reason).toBe("analyze_success_unverified:run_not_found")
    expect(h.transportState.chatHits).toBe(hits)
    expect((await h.policies.list({}, T0))).toHaveLength(1)
  })

  it("contrast: duplicate retry after success → version not bumped; Provider hits unchanged", async () => {
    const h = await openHarness([
      prefilterPass,
      extractJson(),
      scoreAgree,
      scoreAgree,
    ])
    let failOnce = true
    const real = h.policyAuto
    const flaky = {
      applyFromExactIntel: async (
        deps: Parameters<PolicyAutoService["applyFromExactIntel"]>[0],
        input: Parameters<PolicyAutoService["applyFromExactIntel"]>[1],
        now: Date,
      ) => {
        if (failOnce) {
          failOnce = false
          throw new Error("simulated_policy_write_fault_dup")
        }
        return real.applyFromExactIntel(deps, input, now)
      },
    } as PolicyAutoService

    const failed = await runOfflineAnalyzeThenPolicy({
      ...h.baseInput,
      enablePolicyAuto: true,
      policyAuto: flaky,
    })
    expect(failed.analyze.ok).toBe(true)
    if (!failed.analyze.ok) throw new Error("unreachable")
    const hits = h.transportState.chatHits
    const runId = failed.analyze.analyses[0]?.runId
    expect(runId).toBeTruthy()

    const first = await retryPolicyApplyFromExactRun({
      db: h.db,
      intelRepo: h.intel,
      analysisRepo: h.analysis,
      policyAuto: real,
      itemId: failed.analyze.itemId,
      versionId: failed.analyze.versionId,
      contentHash: failed.analyze.contentHash,
      runId: runId!,
      isFixture: true,
      enteredBy: "a1-retry-dup",
      now: () => T0,
    })
    expect(first.outcome).toBe("created")
    const policyId = first.policyId!
    const versionId = first.versionId!
    const detailAfterFirst = await h.policies.detail(policyId, T0)
    expect(detailAfterFirst?.versions).toHaveLength(1)

    const second = await retryPolicyApplyFromExactRun({
      db: h.db,
      intelRepo: h.intel,
      analysisRepo: h.analysis,
      policyAuto: real,
      itemId: failed.analyze.itemId,
      versionId: failed.analyze.versionId,
      contentHash: failed.analyze.contentHash,
      runId: runId!,
      isFixture: true,
      enteredBy: "a1-retry-dup",
      now: () => T0,
    })
    expect(["created", "unchanged", "updated"]).toContain(second.outcome)
    expect(second.policyId).toBe(policyId)
    expect(second.versionId).toBe(versionId)
    const detailAfterSecond = await h.policies.detail(policyId, T0)
    expect(detailAfterSecond?.versions).toHaveLength(1)
    expect(h.transportState.chatHits).toBe(hits)
    expect((await h.policies.list({}, T0))).toHaveLength(1)
  })
  it("contrast: severity-1 fail (failOnHit=3) — main no入库; retry same runId refuses (no extract-only bypass)", async () => {
    const h = await openHarness([
      prefilterPass,
      extractJson(),
      scoreAgree,
      scoreAgree,
    ])
    h.transportState.failOnHit = 3
    const result = await runOfflineAnalyzeThenPolicy({ ...h.baseInput, enablePolicyAuto: true })
    expect(result.analyze.ok).toBe(false)
    if (result.analyze.ok) throw new Error("unreachable")
    expect(result.analyze.code).toBe("severity_failed")
    expect(result.policy).toBeNull()
    expect((await h.policies.list({}, T0)).length).toBe(0)

    const runId = result.analyze.analyses[0]?.runId
    expect(runId).toBeTruthy()
    // Persist proves extract succeeded — verify must still refuse incomplete/failed severity.
    const persisted = await h.analysis.listForVersion(result.analyze.itemId, result.analyze.versionId)
    const gate = verifyPersistedExactRunAnalyzeSuccess(persisted, {
      itemId: result.analyze.itemId,
      versionId: result.analyze.versionId,
      contentHash: h.contentHash,
      runId: runId!,
    })
    expect(gate.ok).toBe(false)
    if (gate.ok) throw new Error("unreachable")
    expect(gate.reason).toMatch(/analyze_failed:severity|analyze_incomplete:severity/)

    const hits = h.transportState.chatHits
    const retried = await retryPolicyApplyFromExactRun({
      db: h.db,
      intelRepo: h.intel,
      analysisRepo: h.analysis,
      policyAuto: h.policyAuto,
      itemId: result.analyze.itemId,
      versionId: result.analyze.versionId,
      contentHash: h.contentHash,
      runId: runId!,
      isFixture: true,
      now: () => T0,
    })
    expect(retried.outcome).toBe("rejected")
    expect(retried.reason?.startsWith("analyze_success_unverified:")).toBe(true)
    expect(h.transportState.chatHits).toBe(hits)
    expect((await h.policies.list({}, T0)).length).toBe(0)
  })

  it("contrast: severity-2 fail (failOnHit=4) — dual severity incomplete; retry refuses", async () => {
    const h = await openHarness([
      prefilterPass,
      extractJson(),
      scoreAgree,
      scoreAgree,
    ])
    h.transportState.failOnHit = 4
    const result = await runOfflineAnalyzeThenPolicy({ ...h.baseInput, enablePolicyAuto: true })
    expect(result.analyze.ok).toBe(false)
    if (result.analyze.ok) throw new Error("unreachable")
    expect(result.analyze.code).toBe("severity_failed")
    expect((await h.policies.list({}, T0)).length).toBe(0)

    const runId = result.analyze.analyses[0]?.runId
    expect(runId).toBeTruthy()
    const hits = h.transportState.chatHits
    const retried = await retryPolicyApplyFromExactRun({
      db: h.db,
      intelRepo: h.intel,
      analysisRepo: h.analysis,
      itemId: result.analyze.itemId,
      versionId: result.analyze.versionId,
      contentHash: h.contentHash,
      runId: runId!,
      isFixture: true,
      now: () => T0,
    })
    expect(retried.outcome).toBe("rejected")
    expect(retried.reason).toContain("analyze_success_unverified:")
    expect(h.transportState.chatHits).toBe(hits)
    expect((await h.policies.list({}, T0)).length).toBe(0)
  })

  it("contrast: BLOCK run — retry refuses prefilter_blocked (not extract-gated create)", async () => {
    const h = await openHarness([prefilterBlock])
    const result = await runOfflineAnalyzeThenPolicy({ ...h.baseInput, enablePolicyAuto: true })
    expect(result.analyze.ok).toBe(true)
    if (!result.analyze.ok) throw new Error("unreachable")
    expect(result.analyze.status).toBe("skipped_block")
    const runId = result.analyze.analyses[0]?.runId
    expect(runId).toBeTruthy()

    const retried = await retryPolicyApplyFromExactRun({
      db: h.db,
      intelRepo: h.intel,
      analysisRepo: h.analysis,
      itemId: result.analyze.itemId,
      versionId: result.analyze.versionId,
      contentHash: result.analyze.contentHash,
      runId: runId!,
      isFixture: true,
      now: () => T0,
    })
    expect(retried.outcome).toBe("rejected")
    expect(retried.reason).toBe("analyze_success_unverified:prefilter_blocked")
    expect((await h.policies.list({}, T0)).length).toBe(0)
  })

  it("contrast: non-policy full success — retry refuses event_type_not_policy", async () => {
    const h = await openHarness([
      prefilterPass,
      extractJson({ eventType: "port_congestion", documentNumber: null, publisher: null, countries: ["MY"] }),
      scoreAgree,
      scoreAgree,
    ])
    const result = await runOfflineAnalyzeThenPolicy({ ...h.baseInput, enablePolicyAuto: true })
    expect(result.analyze.ok).toBe(true)
    if (!result.analyze.ok) throw new Error("unreachable")
    expect(result.policySkippedReason).toBe("event_type_not_policy")
    const runId = result.analyze.analyses[0]?.runId
    expect(runId).toBeTruthy()

    const retried = await retryPolicyApplyFromExactRun({
      db: h.db,
      intelRepo: h.intel,
      analysisRepo: h.analysis,
      itemId: result.analyze.itemId,
      versionId: result.analyze.versionId,
      contentHash: result.analyze.contentHash,
      runId: runId!,
      isFixture: true,
      now: () => T0,
    })
    expect(retried.outcome).toBe("rejected")
    expect(retried.reason).toBe("analyze_success_unverified:event_type_not_policy")
    expect((await h.policies.list({}, T0)).length).toBe(0)
  })

  it("wrong contentHash license → denied before Provider", async () => {
    const h = await openHarness([prefilterPass, extractJson(), scoreAgree, scoreAgree])
    const result = await runOfflineAnalyzeThenPolicy({
      ...h.baseInput,
      enablePolicyAuto: true,
      modelUseLicense: licenseFor(h.saved, "deadbeef".repeat(8)),
    })
    expect(result.analyze.ok).toBe(false)
    expect(h.transportState.chatHits).toBe(0)
    expect(result.policySkippedReason?.startsWith("analyze_not_ok:")).toBe(true)
  })

  it("no budget → denied before Provider", async () => {
    const h = await openHarness([prefilterPass, extractJson(), scoreAgree, scoreAgree])
    const closed = resolveSharedLlmBudgetGate(null, "USD")
    const result = await runOfflineAnalyzeThenPolicy({
      ...h.baseInput,
      enablePolicyAuto: true,
      sharedBudget: closed,
      resolveClaimConfig: createPaidClaimBudgetResolver({ mode: "registry", overridePool: closed }),
    })
    expect(result.analyze.ok).toBe(false)
    expect(h.transportState.chatHits).toBe(0)
    expect(result.policy).toBeNull()
  })

  it("mismatched ExactVersion itemId → denied before Provider (A2 issuer not claimed)", async () => {
    const h = await openHarness([prefilterPass, extractJson(), scoreAgree, scoreAgree])
    const result = await runOfflineAnalyzeThenPolicy({
      ...h.baseInput,
      enablePolicyAuto: true,
      modelUseLicense: {
        itemId: "other-item",
        versionId: h.saved.versionId,
        contentHash: h.contentHash,
        permitted: true as const,
      },
    })
    expect(result.analyze.ok).toBe(false)
    expect(h.transportState.chatHits).toBe(0)
  })
})
