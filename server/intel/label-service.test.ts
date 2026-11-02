import { createHash } from "node:crypto"
import NativeDatabase from "better-sqlite3"
import { createDatabase } from "db0"
import { afterEach, describe, expect, it } from "vitest"
import { initShippingTables } from "#/database/shipping"
import { IntelRepository } from "#/database/intel"
import { IntelAnalysisRepository } from "#/database/intel-analysis"
import { licensedBlocks } from "#/intel/content-license"
import { intelSourceSeeds } from "#/intel/sources"
import { LabelService, decisionFromAnalysisOutputs, selectConsistentAnalysisRun } from "#/intel/label-service"

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
    expect(detail.aiPrelabel?.modelId).toBe("prefilter:model-pre|extract:model-ex")
    expect(detail.aiPrelabel?.promptHash).toBe("prefilter:prompt-pre|extract:prompt-ex")
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

  it("selectConsistentAnalysisRun prefers latest extract + prefilter at-or-before it", () => {
    const rows = [
      { id: "p1", step: "prefilter", status: "completed", createdAt: "2026-11-01T01:00:00.000Z", attemptIndex: 0, modelId: "A", promptHash: "pa" },
      { id: "e1", step: "extract", status: "completed", createdAt: "2026-11-01T02:00:00.000Z", attemptIndex: 0, modelId: "A", promptHash: "ea" },
      { id: "p2", step: "prefilter", status: "completed", createdAt: "2026-11-01T03:00:00.000Z", attemptIndex: 0, modelId: "B", promptHash: "pb" },
      { id: "e2", step: "extract", status: "completed", createdAt: "2026-11-01T04:00:00.000Z", attemptIndex: 0, modelId: "B", promptHash: "eb" },
      { id: "p3", step: "prefilter", status: "completed", createdAt: "2026-11-01T05:00:00.000Z", attemptIndex: 0, modelId: "C", promptHash: "pc" },
    ]
    const selected = selectConsistentAnalysisRun(rows)
    expect(selected.map(r => r.id)).toEqual(["p2", "e2"])
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
    expect(secondDetail.aiPrelabel?.modelId).toBe("prefilter:model-B|extract:model-B")
    expect(secondDetail.aiPrelabel?.promptHash).toBe("prefilter:prompt-B-pre|extract:prompt-B-ex")
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
    expect(thirdDetail.aiPrelabel?.promptHash).toBe("prefilter:prompt-B-pre2|extract:prompt-B-ex")
    expect(thirdDetail.aiPrelabel?.decision.prefilterKeep).toBe(false)
    expect(thirdDetail.humanDecision?.decision.notes).toBe("keep-human")
  })
})
