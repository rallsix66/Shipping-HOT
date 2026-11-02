import { createHash } from "node:crypto"
import NativeDatabase from "better-sqlite3"
import { createDatabase } from "db0"
import { afterEach, describe, expect, it } from "vitest"
import { initShippingTables } from "#/database/shipping"
import { IntelRepository } from "#/database/intel"
import { IntelAnalysisRepository } from "#/database/intel-analysis"
import { licensedBlocks } from "#/intel/content-license"
import { intelSourceSeeds } from "#/intel/sources"
import { LabelService, aiPrelabelHasSelectableRun, decisionFromAnalysisOutputs, selectConsistentAnalysisRun, stepConfigsConflict } from "#/intel/label-service"

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

const NOW = "2026-11-02T03:00:00.000Z"
const source = intelSourceSeeds[0]!
const body = "Westports announces berth suspension for labeling rights tests. ".repeat(8)
const hash = (text: string) => createHash("sha256").update(text).digest("hex")

describe("aiPrelabelHasSelectableRun", () => {
  it("rejects missing ids, empty analysisIds, and legacy NULL run_id groups", () => {
    expect(aiPrelabelHasSelectableRun(null, [])).toBe(false)
    expect(aiPrelabelHasSelectableRun({ analysisIds: [] }, [])).toBe(false)
    const legacy = [
      { id: "a1", step: "prefilter", createdAt: "t1", runId: null },
      { id: "a2", step: "extract", createdAt: "t2", runId: null },
    ]
    expect(aiPrelabelHasSelectableRun({ analysisIds: ["a1", "a2"] }, legacy)).toBe(false)
    expect(aiPrelabelHasSelectableRun({ analysisIds: ["a1", "missing"] }, legacy)).toBe(false)
  })

  it("accepts only when every linked id shares one complete run_id", () => {
    const rows = [
      { id: "a1", step: "prefilter", createdAt: "t1", runId: "run-1" },
      { id: "a2", step: "extract", createdAt: "t2", runId: "run-1" },
      { id: "b1", step: "prefilter", createdAt: "t3", runId: "run-2" },
    ]
    expect(aiPrelabelHasSelectableRun({ analysisIds: ["a1", "a2"] }, rows)).toBe(true)
    expect(aiPrelabelHasSelectableRun({ analysisIds: ["a1", "nope"] }, rows)).toBe(false)
  })

  it("rejects mixed run_id groups and NULL-mixed sets (selector would otherwise pick one)", () => {
    const mixed = [
      { id: "a1", createdAt: "2026-11-01T00:00:00.000Z", runId: "run-a", step: "extract" as const },
      { id: "a2", createdAt: "2026-11-01T00:00:01.000Z", runId: "run-b", step: "extract" as const },
    ]
    expect(aiPrelabelHasSelectableRun({ analysisIds: ["a1", "a2"] }, mixed)).toBe(false)
    // selector alone would still pick a run from mixed:
    expect(selectConsistentAnalysisRun(mixed).runId).toBeTruthy()

    const nullMixed = [
      { id: "a1", createdAt: "2026-11-01T00:00:00.000Z", runId: "run-a", step: "extract" as const },
      { id: "a2", createdAt: "2026-11-01T00:00:01.000Z", runId: null, step: "extract" as const },
    ]
    expect(aiPrelabelHasSelectableRun({ analysisIds: ["a1", "a2"] }, nullMixed)).toBe(false)
    expect(selectConsistentAnalysisRun(nullMixed).complete && selectConsistentAnalysisRun(nullMixed).runId).toBeTruthy()
  })
})

describe("label-service projection + live rights", () => {
  const cleanups: Array<() => void> = []
  afterEach(() => {
    while (cleanups.length) {
      try {
        cleanups.pop()!()
      } catch { /* ignore */ }
    }
  })

  async function fresh() {
    const native = new NativeDatabase(":memory:")
    cleanups.push(() => native.close())
    const db = wrap(native)
    await initShippingTables(db, "mock")
    return { native, db, service: new LabelService(db), intel: new IntelRepository(db), analysis: new IntelAnalysisRepository(db) }
  }

  it("decisionFromAnalysisOutputs reads real {decision}/{extract} shapes; ignores legacy keep/shouldKeep", () => {
    const legacyOnly = decisionFromAnalysisOutputs([
      { step: "prefilter", status: "completed", output: { keep: true, shouldKeep: true, content: "x" } },
      { step: "extract", status: "completed", output: { eventType: "port_closure", countries: ["MY"] } },
    ])
    expect(legacyOnly.projected).toBe(false)
    expect(legacyOnly.decision.prefilterKeep).toBeNull()
    expect(legacyOnly.decision.eventType).toBeNull()

    const real = decisionFromAnalysisOutputs([
      { step: "prefilter", status: "completed", output: { decision: "PASS", content: "raw" } },
      {
        step: "extract",
        status: "reused",
        output: {
          extract: {
            eventType: "port_congestion",
            countries: ["MY"],
            ports: ["MYPKG"],
            effectiveFrom: "2026-11-01",
            isOfficialStatement: false,
          },
          content: "raw-extract",
        },
      },
    ])
    expect(real.projected).toBe(true)
    expect(real.decision.prefilterKeep).toBe(true)
    expect(real.decision.eventType).toBe("port_congestion")
    expect(real.decision.countries).toEqual(["MY"])
    expect(real.decision.ports).toEqual(["MYPKG"])
    expect(real.decision.effectiveFrom).toBe("2026-11-01")
    expect(real.decision.isOfficialStatement).toBe(false)

    const unknown = decisionFromAnalysisOutputs([
      { step: "prefilter", status: "completed", output: { decision: "UNKNOWN", content: "u" } },
    ])
    expect(unknown.decision.prefilterKeep).toBeNull()
    expect(unknown.projected).toBe(true)
  })

  it("enrollFromExisting projects real analysis outputs and preserves identities", async () => {
    const { service, intel, analysis } = await fresh()
    await intel.upsertSource(source, NOW)
    const saved = await intel.writeEntry({
      sourceId: source.id,
      canonicalUrl: "https://example.test/label-proj",
      title: "Projection fixture",
      contentHash: hash(body),
      contentScope: "full_text",
      extractorVersion: "label-service-test-v1",
      blocks: licensedBlocks("full_text", "Projection fixture", body),
      fetchedAt: NOW,
    })
    await analysis.insert({
      itemId: saved.itemId,
      versionId: saved.versionId,
      contentHash: hash(body),
      step: "prefilter",
      status: "completed",
      provenance: "ai",
      basis: "fixture",
      runId: "run-proj-1",
      modelId: "model-pre",
      modelName: "fixture-pre",
      promptHash: "prompt-pre",
      output: { decision: "PASS", content: "ok" },
    })
    await analysis.insert({
      itemId: saved.itemId,
      versionId: saved.versionId,
      contentHash: hash(body),
      step: "extract",
      status: "completed",
      provenance: "ai",
      basis: "fixture",
      runId: "run-proj-1",
      modelId: "model-ex",
      modelName: "fixture-ex",
      promptHash: "prompt-ex",
      output: {
        extract: {
          eventType: "port_closure",
          countries: ["MY"],
          ports: ["MYPKG"],
          effectiveFrom: "2026-11-02",
          isOfficialStatement: true,
        },
        content: "extract-raw",
      },
    })

    const enrolled = await service.enrollFromExisting({
      itemId: saved.itemId,
      versionId: saved.versionId,
    })
    expect(enrolled.queueStatus).toBe("ai_prelabeled")
    const detail = await service.detail(enrolled.id)
    expect(detail.aiPrelabel?.decision.prefilterKeep).toBe(true)
    expect(detail.aiPrelabel?.decision.eventType).toBe("port_closure")
    expect(detail.aiPrelabel?.decision.isOfficialStatement).toBe(true)
    expect(detail.aiPrelabel?.modelId).toBe("extract:model-ex|prefilter:model-pre")
    expect(detail.aiPrelabel?.promptHash).toBe("extract:prompt-ex|prefilter:prompt-pre")
    expect(detail.aiPrelabel?.analysisIds.length).toBe(2)
    expect(detail.material.excerpt).toBeTruthy()
    expect(detail.material.materialReadFailed).toBe(false)
  })

  it("list redacts excerpts; detail never falls back to cached excerpt when material unread or metadata-only", async () => {
    const { service, intel, native } = await fresh()
    await intel.upsertSource(source, NOW)
    const saved = await intel.writeEntry({
      sourceId: source.id,
      canonicalUrl: "https://example.test/label-rights",
      title: "Rights fixture",
      contentHash: hash(`${body}-r`),
      contentScope: "full_text",
      extractorVersion: "label-service-test-v1",
      blocks: licensedBlocks("full_text", "Rights fixture", body),
      fetchedAt: NOW,
    })
    const enrolled = await service.enrollFromExisting({
      itemId: saved.itemId,
      versionId: saved.versionId,
    })
    // Force a cached excerpt on the label row (simulates earlier wider rights).
    native.prepare("UPDATE intel_label_item SET excerpt = ? WHERE id = ?").run(
      "CACHED LEAKED EXCERPT THAT MUST NOT APPEAR",
      enrolled.id,
    )

    const listed = await service.list({ limit: 10, offset: 0 })
    expect(listed.items.every(i => i.excerpt === null)).toBe(true)

    const okDetail = await service.detail(enrolled.id)
    expect(okDetail.item.excerpt).not.toBe("CACHED LEAKED EXCERPT THAT MUST NOT APPEAR")
    expect(okDetail.material.excerpt).toBeTruthy()

    // Narrow source persistence → metadata_only live rights.
    native.prepare("UPDATE intel_source SET persistence = ? WHERE id = ?").run("disallowed", source.id)
    const narrowed = await service.detail(enrolled.id)
    expect(narrowed.material.contentScope).toBe("metadata_only")
    expect(narrowed.material.excerpt).toBeNull()
    expect(narrowed.item.excerpt).toBeNull()
    expect(narrowed.material.materialReadFailed).toBe(false)

    // Unreadable material: point label at a missing version → read fails, no cache fallback.
    native.prepare("UPDATE intel_label_item SET version_id = ? WHERE id = ?").run("ver_missing_rights", enrolled.id)
    const failed = await service.detail(enrolled.id)
    expect(failed.material.materialReadFailed).toBe(true)
    expect(failed.material.excerpt).toBeNull()
    expect(failed.item.excerpt).toBeNull()
    expect(failed.item.id).toBe(enrolled.id)
  })

  it("selectConsistentAnalysisRun picks latest run_id group including failed; legacy incomplete", () => {
    const rows = [
      { id: "p1", step: "prefilter", status: "completed", createdAt: "2026-11-01T01:00:00.000Z", attemptIndex: 0, runId: "run-A", modelId: "A", promptHash: "pa" },
      { id: "e1", step: "extract", status: "completed", createdAt: "2026-11-01T02:00:00.000Z", attemptIndex: 0, runId: "run-A", modelId: "A", promptHash: "ea" },
      { id: "p2", step: "prefilter", status: "completed", createdAt: "2026-11-01T03:00:00.000Z", attemptIndex: 0, runId: "run-B", modelId: "B", promptHash: "pb" },
      { id: "e2", step: "extract", status: "failed", createdAt: "2026-11-01T04:00:00.000Z", attemptIndex: 0, runId: "run-B", modelId: "B", promptHash: "eb" },
    ]
    const selected = selectConsistentAnalysisRun(rows)
    expect(selected.complete).toBe(true)
    expect(selected.runId).toBe("run-B")
    expect(selected.rows.map(r => r.id)).toEqual(["p2", "e2"])
    const legacy = selectConsistentAnalysisRun([
      { id: "p1", step: "prefilter", status: "completed", createdAt: "2026-11-01T01:00:00.000Z", attemptIndex: 0, modelId: "A", promptHash: "pa" },
    ])
    expect(legacy.complete).toBe(false)
    expect(legacy.rows).toEqual([])
  })

  it("stepConfigsConflict: same-config PASS+BLOCK ok; same-step different model refuses", () => {
    const passFp = {
      modelId: "extract:m1|prefilter:m1",
      promptHash: "extract:pe|prefilter:pp",
      modelName: "extract:N|prefilter:N",
    }
    const blockFp = {
      modelId: "prefilter:m1",
      promptHash: "prefilter:pp",
      modelName: "prefilter:N",
    }
    expect(stepConfigsConflict(passFp, blockFp)).toBe(false)
    const otherPre = {
      modelId: "prefilter:m2",
      promptHash: "prefilter:pp",
      modelName: "prefilter:N",
    }
    expect(stepConfigsConflict(passFp, otherPre)).toBe(true)
  })

  it("a then B re-analysis enrolls B projection/ids/fingerprint; old receipts excluded; human kept", async () => {
    const { service, intel, analysis } = await fresh()
    await intel.upsertSource(source, NOW)
    const saved = await intel.writeEntry({
      sourceId: source.id,
      canonicalUrl: "https://example.test/label-ab",
      title: "A then B",
      contentHash: hash(body),
      contentScope: "full_text",
      extractorVersion: "label-service-test-v1",
      blocks: licensedBlocks("full_text", "A then B", body),
      fetchedAt: NOW,
    })
    const aPre = await analysis.insert({
      itemId: saved.itemId,
      versionId: saved.versionId,
      contentHash: hash(body),
      step: "prefilter",
      status: "completed",
      provenance: "ai",
      basis: "fixture",
      modelId: "model-A",
      modelName: "A",
      promptHash: "prompt-A-pre",
      runId: "run-A",
      receiptId: "rcpt-old",
      createdAt: "2026-11-01T01:00:00.000Z",
      output: { decision: "PASS", content: "a-pre" },
    })
    const aEx = await analysis.insert({
      itemId: saved.itemId,
      versionId: saved.versionId,
      contentHash: hash(body),
      step: "extract",
      status: "completed",
      provenance: "ai",
      basis: "fixture",
      modelId: "model-A",
      modelName: "A",
      promptHash: "prompt-A-ex",
      runId: "run-A",
      receiptId: "rcpt-old",
      createdAt: "2026-11-01T02:00:00.000Z",
      output: {
        extract: {
          eventType: "port_closure",
          countries: ["MY"],
          ports: ["MYPKG"],
          effectiveFrom: "2026-11-01",
          isOfficialStatement: true,
        },
        content: "a-ex",
      },
    })

    const first = await service.enrollFromExisting({ itemId: saved.itemId, versionId: saved.versionId })
    const firstDetail = await service.detail(first.id)
    expect(firstDetail.aiPrelabel?.decision.eventType).toBe("port_closure")
    expect(firstDetail.aiPrelabel?.analysisIds.sort()).toEqual([aPre.id, aEx.id].sort())
    expect(firstDetail.aiPrelabel?.modelId).toContain("model-A")

    await service.saveHuman({
      labelItemId: first.id,
      expectedContentHash: hash(body),
      kind: "human_confirm",
      operator: "human.keep",
      decision: {
        prefilterKeep: true,
        eventType: "port_closure",
        countries: ["MY"],
        ports: ["MYPKG"],
        effectiveFrom: "2026-11-01",
        isOfficialStatement: true,
        notes: "keep-human",
      },
      clientRequestId: "keep-human-1",
    })

    const bPre = await analysis.insert({
      itemId: saved.itemId,
      versionId: saved.versionId,
      contentHash: hash(body),
      step: "prefilter",
      status: "completed",
      provenance: "ai",
      basis: "fixture",
      modelId: "model-B",
      modelName: "B",
      promptHash: "prompt-B-pre",
      runId: "run-B",
      receiptId: "rcpt-new",
      createdAt: "2026-11-01T03:00:00.000Z",
      output: { decision: "PASS", content: "b-pre" },
    })
    const bEx = await analysis.insert({
      itemId: saved.itemId,
      versionId: saved.versionId,
      contentHash: hash(body),
      step: "extract",
      status: "completed",
      provenance: "ai",
      basis: "fixture",
      modelId: "model-B",
      modelName: "B",
      promptHash: "prompt-B-ex",
      runId: "run-B",
      receiptId: "rcpt-new",
      createdAt: "2026-11-01T04:00:00.000Z",
      output: {
        extract: {
          eventType: "port_congestion",
          countries: ["SG"],
          ports: ["SGSIN"],
          effectiveFrom: "2026-11-02",
          isOfficialStatement: false,
        },
        content: "b-ex",
      },
    })

    const second = await service.enrollFromExisting({ itemId: saved.itemId, versionId: saved.versionId })
    expect(second.id).toBe(first.id)
    const secondDetail = await service.detail(second.id)
    expect(secondDetail.aiPrelabel?.decision.eventType).toBe("port_congestion")
    expect(secondDetail.aiPrelabel?.decision.countries).toEqual(["SG"])
    expect(secondDetail.aiPrelabel?.analysisIds.sort()).toEqual([bPre.id, bEx.id].sort())
    expect(secondDetail.aiPrelabel?.analysisIds).not.toContain(aPre.id)
    expect(secondDetail.aiPrelabel?.analysisIds).not.toContain(aEx.id)
    expect(secondDetail.aiPrelabel?.modelId).toBe("extract:model-B|prefilter:model-B")
    expect(secondDetail.aiPrelabel?.promptHash).toBe("extract:prompt-B-ex|prefilter:prompt-B-pre")
    expect(secondDetail.humanDecision?.decision.notes).toBe("keep-human")
    expect(secondDetail.item.queueStatus).toBe("human_confirmed")

    // Same extract model/prompt, different prefilter → fingerprint must differ; ids = that pre + extract.
    const bPre2 = await analysis.insert({
      itemId: saved.itemId,
      versionId: saved.versionId,
      contentHash: hash(body),
      step: "prefilter",
      status: "completed",
      provenance: "ai",
      basis: "fixture",
      modelId: "model-B-pre2",
      modelName: "B2",
      promptHash: "prompt-B-pre2",
      runId: "run-C",
      receiptId: "rcpt-new",
      createdAt: "2026-11-01T05:00:00.000Z",
      output: { decision: "BLOCK", content: "b-pre2" },
    })
    const bEx2 = await analysis.insert({
      itemId: saved.itemId,
      versionId: saved.versionId,
      contentHash: hash(body),
      step: "extract",
      status: "completed",
      provenance: "ai",
      basis: "fixture",
      modelId: "model-B",
      modelName: "B",
      promptHash: "prompt-B-ex",
      runId: "run-C",
      receiptId: "rcpt-new",
      createdAt: "2026-11-01T06:00:00.000Z",
      output: {
        extract: {
          eventType: "port_congestion",
          countries: ["SG"],
          ports: ["SGSIN"],
          effectiveFrom: "2026-11-02",
          isOfficialStatement: false,
        },
        content: "b-ex2",
      },
    })
    const third = await service.enrollFromExisting({ itemId: saved.itemId, versionId: saved.versionId })
    const thirdDetail = await service.detail(third.id)
    expect(thirdDetail.aiPrelabel?.analysisIds.sort()).toEqual([bPre2.id, bEx2.id].sort())
    expect(thirdDetail.aiPrelabel?.promptHash).toBe("extract:prompt-B-ex|prefilter:prompt-B-pre2")
    expect(thirdDetail.aiPrelabel?.decision.prefilterKeep).toBe(false)
    expect(thirdDetail.humanDecision?.decision.notes).toBe("keep-human")
  })

  it("rC3: old success then new BLOCK enrolls BLOCK run (not old A); severity after extract kept", async () => {
    const { service, intel, analysis } = await fresh()
    await intel.upsertSource(source, NOW)
    const saved = await intel.writeEntry({
      sourceId: source.id,
      canonicalUrl: "https://example.test/label-rc3-block",
      title: "RC3 BLOCK",
      contentHash: hash(body),
      contentScope: "full_text",
      extractorVersion: "label-service-test-v1",
      blocks: licensedBlocks("full_text", "RC3 BLOCK", body),
      fetchedAt: NOW,
    })
    await analysis.insert({
      itemId: saved.itemId,
      versionId: saved.versionId,
      contentHash: hash(body),
      step: "prefilter",
      status: "completed",
      provenance: "ai",
      basis: "fixture",
      runId: "run-old",
      modelId: "mA",
      modelName: "A",
      promptHash: "pA-pre",
      receiptId: "r-old-pre",
      createdAt: "2026-11-01T01:00:00.000Z",
      output: { decision: "PASS", content: "old-pre" },
    })
    await analysis.insert({
      itemId: saved.itemId,
      versionId: saved.versionId,
      contentHash: hash(body),
      step: "extract",
      status: "completed",
      provenance: "ai",
      basis: "fixture",
      runId: "run-old",
      modelId: "mA",
      modelName: "A",
      promptHash: "pA-ex",
      receiptId: "r-old-ex",
      createdAt: "2026-11-01T02:00:00.000Z",
      output: { extract: { eventType: "port_closure", countries: ["MY"], ports: ["MYPKG"], effectiveFrom: "2026-11-01", isOfficialStatement: true }, content: "old-ex" },
    })
    // Real pipeline: severity createdAt AFTER extract
    await analysis.insert({
      itemId: saved.itemId,
      versionId: saved.versionId,
      contentHash: hash(body),
      step: "severity",
      status: "completed",
      provenance: "ai",
      basis: "fixture",
      runId: "run-old",
      modelId: "mA",
      modelName: "A",
      promptHash: "pA-sev",
      receiptId: "r-old-sev1",
      createdAt: "2026-11-01T02:00:01.000Z",
      attemptIndex: 1,
      output: { score: 2 },
    })
    await analysis.insert({
      itemId: saved.itemId,
      versionId: saved.versionId,
      contentHash: hash(body),
      step: "severity",
      status: "completed",
      provenance: "ai",
      basis: "fixture",
      runId: "run-old",
      modelId: "mA",
      modelName: "A",
      promptHash: "pA-sev",
      receiptId: "r-old-sev2",
      createdAt: "2026-11-01T02:00:02.000Z",
      attemptIndex: 2,
      output: { score: 3 },
    })
    const first = await service.enrollFromExisting({ itemId: saved.itemId, versionId: saved.versionId })
    const firstDetail = await service.detail(first.id)
    expect(firstDetail.aiPrelabel?.analysisIds.length).toBe(4)

    const bPre = await analysis.insert({
      itemId: saved.itemId,
      versionId: saved.versionId,
      contentHash: hash(body),
      step: "prefilter",
      status: "completed",
      provenance: "ai",
      basis: "fixture",
      runId: "run-new-block",
      modelId: "mB",
      modelName: "B",
      promptHash: "pB-pre",
      receiptId: "r-new-pre",
      createdAt: "2026-11-01T05:00:00.000Z",
      output: { decision: "BLOCK", content: "new-block" },
    })
    const second = await service.enrollFromExisting({ itemId: saved.itemId, versionId: saved.versionId })
    const d = await service.detail(second.id)
    expect(d.aiPrelabel?.decision.prefilterKeep).toBe(false)
    expect(d.aiPrelabel?.analysisIds).toEqual([bPre.id])
    expect(d.aiPrelabel?.analysisIds.length).toBe(1)
  })

  it("rC3: old success then new failed extract keeps failed run ids (no A fallback)", async () => {
    const { service, intel, analysis } = await fresh()
    await intel.upsertSource(source, NOW)
    const saved = await intel.writeEntry({
      sourceId: source.id,
      canonicalUrl: "https://example.test/label-rc3-fail",
      title: "RC3 FAIL",
      contentHash: hash(body),
      contentScope: "full_text",
      extractorVersion: "label-service-test-v1",
      blocks: licensedBlocks("full_text", "RC3 FAIL", body),
      fetchedAt: NOW,
    })
    await analysis.insert({
      itemId: saved.itemId,
      versionId: saved.versionId,
      contentHash: hash(body),
      step: "prefilter",
      status: "completed",
      provenance: "ai",
      basis: "fixture",
      runId: "run-A",
      modelId: "mA",
      modelName: "A",
      promptHash: "pA",
      receiptId: "rA",
      createdAt: "2026-11-01T01:00:00.000Z",
      output: { decision: "PASS", content: "a" },
    })
    await analysis.insert({
      itemId: saved.itemId,
      versionId: saved.versionId,
      contentHash: hash(body),
      step: "extract",
      status: "completed",
      provenance: "ai",
      basis: "fixture",
      runId: "run-A",
      modelId: "mA",
      modelName: "A",
      promptHash: "pAex",
      receiptId: "rA2",
      createdAt: "2026-11-01T02:00:00.000Z",
      output: { extract: { eventType: "port_closure", countries: ["MY"], ports: ["MYPKG"], effectiveFrom: null, isOfficialStatement: true }, content: "aex" },
    })
    const bPre = await analysis.insert({
      itemId: saved.itemId,
      versionId: saved.versionId,
      contentHash: hash(body),
      step: "prefilter",
      status: "completed",
      provenance: "ai",
      basis: "fixture",
      runId: "run-B-fail",
      modelId: "mB",
      modelName: "B",
      promptHash: "pB",
      receiptId: "rB-pre",
      createdAt: "2026-11-01T03:00:00.000Z",
      output: { decision: "PASS", content: "b" },
    })
    const bFail = await analysis.insert({
      itemId: saved.itemId,
      versionId: saved.versionId,
      contentHash: hash(body),
      step: "extract",
      status: "failed",
      provenance: "ai",
      basis: "fixture",
      runId: "run-B-fail",
      modelId: "mB",
      modelName: "B",
      promptHash: "pBex",
      receiptId: "rB-fail-charged",
      createdAt: "2026-11-01T04:00:00.000Z",
      errorCode: "invalid_extract",
      output: { content: "bad" },
    })
    const enrolled = await service.enrollFromExisting({ itemId: saved.itemId, versionId: saved.versionId })
    const d = await service.detail(enrolled.id)
    expect(d.aiPrelabel?.analysisIds.sort()).toEqual([bPre.id, bFail.id].sort())
    expect(d.aiPrelabel?.analysisIds).toContain(bFail.id)
  })

  it("rC4: v35→v36 legacy AI cache (NULL run_id) is audit-only on detail; human kept; eval-ready only after new run_id analysis", async () => {
    const { native, db, service, intel, analysis } = await fresh()
    const { IntelLabelRepository } = await import("#/database/intel-label")
    const labels = new IntelLabelRepository(db)

    await intel.upsertSource(source, NOW)
    const saved = await intel.writeEntry({
      sourceId: source.id,
      canonicalUrl: "https://example.test/label-rc4-upgrade",
      title: "RC4 UPGRADE",
      contentHash: hash(body),
      contentScope: "full_text",
      extractorVersion: "label-service-test-v1",
      blocks: licensedBlocks("full_text", "RC4 UPGRADE", body),
      fetchedAt: NOW,
    })

    // Enroll while run_id present (creates AI cache), then NULL run_id to simulate v35→v36 migrate.
    const legacyPre = await analysis.insert({
      itemId: saved.itemId,
      versionId: saved.versionId,
      contentHash: hash(body),
      step: "prefilter",
      status: "completed",
      provenance: "ai",
      basis: "fixture",
      runId: "pre-migrate-run",
      modelId: "legacy-m",
      modelName: "Legacy",
      promptHash: "legacy-pre",
      receiptId: "rcpt-legacy-pre",
      createdAt: "2026-10-01T01:00:00.000Z",
      output: { decision: "PASS", content: "legacy-pre" },
    })
    const legacyEx = await analysis.insert({
      itemId: saved.itemId,
      versionId: saved.versionId,
      contentHash: hash(body),
      step: "extract",
      status: "completed",
      provenance: "ai",
      basis: "fixture",
      runId: "pre-migrate-run",
      modelId: "legacy-m",
      modelName: "Legacy",
      promptHash: "legacy-ex",
      receiptId: "rcpt-legacy-ex",
      createdAt: "2026-10-01T02:00:00.000Z",
      output: {
        extract: {
          eventType: "port_closure",
          countries: ["MY"],
          ports: ["MYPKG"],
          effectiveFrom: "2026-10-01",
          isOfficialStatement: true,
        },
        content: "legacy-ex",
      },
    })
    const enrolled = await service.enrollFromExisting({ itemId: saved.itemId, versionId: saved.versionId })
    expect((await service.detail(enrolled.id)).aiPrelabel?.analysisIds.sort()).toEqual(
      [legacyPre.id, legacyEx.id].sort(),
    )

    await service.saveHuman({
      labelItemId: enrolled.id,
      expectedContentHash: hash(body),
      kind: "human_confirm",
      operator: "human.rc4",
      decision: {
        prefilterKeep: true,
        eventType: "port_closure",
        countries: ["MY"],
        ports: ["MYPKG"],
        effectiveFrom: "2026-10-01",
        isOfficialStatement: true,
        notes: "human-kept-across-upgrade",
      },
      clientRequestId: "rc4-human-1",
    })

    native.prepare("UPDATE intel_analysis SET run_id = NULL WHERE id IN (?, ?)").run(legacyPre.id, legacyEx.id)

    // Without re-enroll: detail fail-closed; human retained; AI audit row still in DB.
    const afterUpgrade = await service.detail(enrolled.id)
    expect(afterUpgrade.aiPrelabel).toBeNull()
    expect(afterUpgrade.humanDecision?.decision.notes).toBe("human-kept-across-upgrade")
    expect(afterUpgrade.humanDecision?.decision.eventType).toBe("port_closure")
    const cached = await labels.latestAiPrelabel(enrolled.id)
    expect(cached?.analysisIds.sort()).toEqual([legacyPre.id, legacyEx.id].sort())

    // Re-enroll with only legacy NULL run_id rows: still no usable AI; human preserved.
    await service.enrollFromExisting({ itemId: saved.itemId, versionId: saved.versionId })
    const afterReEnrollLegacy = await service.detail(enrolled.id)
    expect(afterReEnrollLegacy.aiPrelabel).toBeNull()
    expect(afterReEnrollLegacy.humanDecision?.decision.notes).toBe("human-kept-across-upgrade")
    expect((await labels.latestAiPrelabel(enrolled.id))?.analysisIds.sort()).toEqual(
      [legacyPre.id, legacyEx.id].sort(),
    )

    // New run_id analysis restores selectable prediction; human still kept; legacy ids not current.
    const newPre = await analysis.insert({
      itemId: saved.itemId,
      versionId: saved.versionId,
      contentHash: hash(body),
      step: "prefilter",
      status: "completed",
      provenance: "ai",
      basis: "fixture",
      runId: "run-post-v36",
      modelId: "new-m",
      modelName: "New",
      promptHash: "new-pre",
      receiptId: "rcpt-new-pre",
      createdAt: "2026-11-02T05:00:00.000Z",
      output: { decision: "PASS", content: "new-pre" },
    })
    const newEx = await analysis.insert({
      itemId: saved.itemId,
      versionId: saved.versionId,
      contentHash: hash(body),
      step: "extract",
      status: "completed",
      provenance: "ai",
      basis: "fixture",
      runId: "run-post-v36",
      modelId: "new-m",
      modelName: "New",
      promptHash: "new-ex",
      receiptId: "rcpt-new-ex",
      createdAt: "2026-11-02T06:00:00.000Z",
      output: {
        extract: {
          eventType: "port_closure",
          countries: ["MY"],
          ports: ["MYPKG"],
          effectiveFrom: "2026-11-02",
          isOfficialStatement: true,
        },
        content: "new-ex",
      },
    })
    await service.enrollFromExisting({ itemId: saved.itemId, versionId: saved.versionId })
    const restored = await service.detail(enrolled.id)
    expect(restored.aiPrelabel?.analysisIds.sort()).toEqual([newPre.id, newEx.id].sort())
    expect(restored.aiPrelabel?.modelId).toContain("new-m")
    expect(restored.humanDecision?.decision.notes).toBe("human-kept-across-upgrade")
    expect(restored.aiPrelabel?.analysisIds).not.toContain(legacyPre.id)
    expect(restored.aiPrelabel?.analysisIds).not.toContain(legacyEx.id)
  })
})
