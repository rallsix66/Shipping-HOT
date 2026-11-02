import { createHash } from "node:crypto"
import NativeDatabase from "better-sqlite3"
import { createDatabase } from "db0"
import { afterEach, describe, expect, it } from "vitest"
import { initShippingTables } from "#/database/shipping"
import { IntelRepository } from "#/database/intel"
import { IntelAnalysisRepository } from "#/database/intel-analysis"
import { licensedBlocks } from "#/intel/content-license"
import { intelSourceSeeds } from "#/intel/sources"
import { LabelService, decisionFromAnalysisOutputs } from "#/intel/label-service"

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
    expect(detail.aiPrelabel?.modelId).toBe("model-ex")
    expect(detail.aiPrelabel?.promptHash).toBe("prompt-ex")
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
})
