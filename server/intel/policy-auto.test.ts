import process from "node:process"
/**
 * R3-8 offline policy-auto service path coverage + TikTok page diff + GET zero-model guard.
 */
import { readFileSync } from "node:fs"
import { join } from "node:path"
import NativeDatabase from "better-sqlite3"
import { createDatabase } from "db0"
import { describe, expect, it } from "vitest"
import { PolicyRepository } from "#/database/policy"
import { initShippingTables } from "#/database/shipping"
import { readDatabaseMetadata } from "#/database/runtime"
import { type PolicyAutoCandidate, PolicyAutoService } from "#/intel/policy-auto"
import { diffDatedParagraphs, extractDatedParagraphs, pageContentFingerprint } from "#/intel/policy-page-diff"

const fixture = (name: string) => readFileSync(join(process.cwd(), "server/intel/__fixtures__", name), "utf8")

function memoryDb() {
  const native = new NativeDatabase(":memory:")
  const database = createDatabase({
    name: "sqlite",
    dialect: "sqlite",
    getInstance: () => native,
    exec: (sql: string) => native.exec(sql),
    prepare: (sql: string) => {
      const statement = native.prepare(sql)
      return {
        all: async (...params: unknown[]) => statement.all(...params as never[]),
        get: async (...params: unknown[]) => statement.get(...params as never[]),
        run: async (...params: unknown[]) => {
          const result = statement.run(...params as never[])
          return { success: result.changes > 0, changes: result.changes, lastInsertRowid: result.lastInsertRowid }
        },
      }
    },
    dispose: () => native.close(),
  } as never)
  return { native, database }
}

const T0 = new Date("2026-10-12T02:00:00.000Z")

function officialCandidate(over: Partial<PolicyAutoCandidate> = {}): PolicyAutoCandidate {
  return {
    eventType: "customs_rule",
    countryCode: "VN",
    publisher: "示例机关（fixture）",
    documentNumber: "AUTO-FIXTURE-001",
    title: "[FIXTURE] 自动准入海关公告",
    sourceUrl: "https://example.org/fixture/auto-vn-001",
    sourceType: "official",
    status: "published",
    publishedAt: "2026-10-01",
    effectiveAt: "2026-11-01",
    fullText: "示例全文（fixture，非真实公告）。",
    basisText: "fixture auto basis v1",
    analysisIds: ["an-1"],
    modelId: "fixture-model",
    modelName: "fixture-model-name",
    promptHash: "prompt-hash-1",
    intelItemId: "item-1",
    intelVersionId: "ver-1",
    contentHash: "content-1",
    isFixture: true,
    enteredBy: "policy-auto-test",
    ...over,
  }
}

async function setup() {
  const { native, database } = memoryDb()
  await initShippingTables(database, "real")
  const policies = new PolicyRepository(database)
  const auto = new PolicyAutoService(database, policies)
  return { native, database, policies, auto }
}

describe("r3-8 policy-page-diff (TikTok Shop offline fixtures)", () => {
  it("detects added and modified dated paragraphs; repeat fingerprint stable", () => {
    const v1 = extractDatedParagraphs(fixture("tiktok-shop-policy-page-v1.html"))
    const v2 = extractDatedParagraphs(fixture("tiktok-shop-policy-page-v2.html"))
    expect(v1.length).toBe(2)
    expect(v2.length).toBe(3)
    const diff = diffDatedParagraphs(v1, v2)
    expect(diff.unchanged.length).toBe(1)
    expect(diff.modified.length).toBe(1)
    expect(diff.added.length).toBe(1)
    expect(diff.added[0]?.date).toBe("2026-10-01")
    expect(pageContentFingerprint(v2)).toBe(pageContentFingerprint(extractDatedParagraphs(fixture("tiktok-shop-policy-page-v2.html"))))
  })
})

describe("r3-8 policy-auto service paths", () => {
  it("schema reaches v37 with policy_auto tables", async () => {
    const { database, native } = await setup()
    expect((await readDatabaseMetadata(database)).schemaVersion).toBe(37)
    const tables = native.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'policy_auto%'").all() as Array<{ name: string }>
    expect(tables.map(t => t.name).sort()).toEqual(["policy_auto_audit", "policy_auto_pending"])
    native.close()
  })

  it("first create, exact update, repeat unchanged; audit has model/prompt", async () => {
    const { auto, policies, native } = await setup()
    const c1 = officialCandidate()
    const created = await auto.apply(c1, T0)
    expect(created.outcome).toBe("created")
    expect(created.record?.entryMethod).toBe("auto")
    expect(created.versionId).toBeTruthy()

    const c2 = officialCandidate({
      basisText: "fixture auto basis v2",
      fullText: "示例全文（fixture，非真实公告）v2。",
      promptHash: "prompt-hash-2",
    })
    const updated = await auto.apply(c2, T0)
    expect(updated.outcome).toBe("updated")
    expect(updated.policyId).toBe(created.policyId)
    const detail = await policies.detail(created.policyId!, T0)
    expect(detail?.versions.length).toBe(2)

    const again = await auto.apply(c2, T0)
    expect(again.outcome).toBe("unchanged")
    const detail2 = await policies.detail(created.policyId!, T0)
    expect(detail2?.versions.length).toBe(2)

    const audits = await auto.listAudit(created.policyId)
    expect(audits.some(a => a.outcome === "created")).toBe(true)
    expect(audits.some(a => a.outcome === "updated")).toBe(true)
    expect(audits.some(a => a.outcome === "unchanged")).toBe(true)
    expect(audits.some(a => String(a.model_id || "") === "fixture-model")).toBe(true)
    expect(audits.some(a => String(a.prompt_hash || "").includes("prompt-hash"))).toBe(true)
    native.close()
  })

  it("missing document number → human confirm; idempotent pending", async () => {
    const { auto, policies, native } = await setup()
    const c = officialCandidate({ documentNumber: null })
    const r1 = await auto.apply(c, T0)
    expect(r1.outcome).toBe("needs_human_confirm")
    expect(r1.reason).toBe("missing_document_number")
    expect(r1.pendingId).toBeTruthy()
    const r2 = await auto.apply(c, T0)
    expect(r2.outcome).toBe("needs_human_confirm")
    expect(r2.pendingId).toBe(r1.pendingId)
    expect((await policies.list({}, T0)).length).toBe(0)
    expect((await auto.listPending()).length).toBe(1)
    native.close()
  })

  it("same document number different country/publisher do not merge", async () => {
    const { auto, policies, native } = await setup()
    const a = await auto.apply(officialCandidate({ countryCode: "VN", publisher: "机关A", documentNumber: "SAME-DOC-9" }), T0)
    const b = await auto.apply(officialCandidate({
      countryCode: "TH",
      publisher: "机关A",
      documentNumber: "SAME-DOC-9",
      sourceUrl: "https://example.org/fixture/auto-th-001",
      title: "[FIXTURE] TH 同文号",
    }), T0)
    const c = await auto.apply(officialCandidate({
      countryCode: "VN",
      publisher: "机关B",
      documentNumber: "SAME-DOC-9",
      sourceUrl: "https://example.org/fixture/auto-vn-002",
      title: "[FIXTURE] VN 不同发布方",
    }), T0)
    expect(a.outcome).toBe("created")
    expect(b.outcome).toBe("created")
    expect(c.outcome).toBe("created")
    expect(new Set([a.policyId, b.policyId, c.policyId]).size).toBe(3)
    expect((await policies.list({}, T0)).length).toBe(3)
    native.close()
  })

  it("shopee/Lazada platform_rule out of auto scope; TikTok page add/modify then repeat unchanged", async () => {
    const { auto, policies, native } = await setup()
    const shopee2 = await auto.apply({
      eventType: "platform_rule",
      countryCode: "TH",
      publisher: "Shopee TH",
      documentNumber: "SHOPEE-RULE-1",
      title: "[FIXTURE] Shopee rule",
      sourceUrl: "https://example.org/fixture/shopee",
      sourceType: "platform",
      status: "published",
      effectiveAt: "2026-10-20",
      bodyExcerpt: "shopee excerpt",
      basisText: "fixture",
      platform: "shopee",
      analysisIds: ["a"],
      isFixture: true,
    }, T0)
    expect(shopee2.outcome).toBe("rejected")
    expect(shopee2.reason).toBe("platform_out_of_auto_scope")

    const lazada = await auto.apply({
      eventType: "platform_rule",
      countryCode: "TH",
      publisher: "Lazada TH",
      documentNumber: "LAZADA-RULE-1",
      title: "[FIXTURE] Lazada rule",
      sourceUrl: "https://example.org/fixture/lazada",
      sourceType: "platform",
      status: "published",
      effectiveAt: "2026-10-20",
      bodyExcerpt: "lazada excerpt",
      basisText: "fixture",
      platform: "lazada",
      analysisIds: ["a"],
      isFixture: true,
    }, T0)
    expect(lazada.outcome).toBe("rejected")
    expect(lazada.reason).toBe("platform_out_of_auto_scope")

    const v1 = extractDatedParagraphs(fixture("tiktok-shop-policy-page-v1.html"))
    const v2 = extractDatedParagraphs(fixture("tiktok-shop-policy-page-v2.html"))
    const base = {
      eventType: "platform_rule" as const,
      countryCode: "TH" as const,
      publisher: "TikTok Shop",
      documentNumber: "TT-SHOP-POLICY-2026",
      title: "[FIXTURE] TikTok Shop Seller Policy",
      sourceUrl: "https://example.org/fixture/tiktok-shop-policy",
      sourceType: "platform" as const,
      status: "published" as const,
      effectiveAt: "2026-03-01",
      publishedAt: "2026-03-01",
      bodyExcerpt: v1.map(p => p.text).join(" / ").slice(0, 500),
      basisText: "offline fixture page v1",
      platform: "tiktok_shop" as const,
      analysisIds: ["tt-an-1"],
      modelId: "fixture-model",
      promptHash: "tt-prompt",
      isFixture: true,
      pageParagraphs: v1,
    }
    const created = await auto.apply(base, T0)
    expect(created.outcome).toBe("created")
    const updated = await auto.apply({
      ...base,
      bodyExcerpt: v2.map(p => p.text).join(" / ").slice(0, 500),
      basisText: "offline fixture page v2",
      pageParagraphs: v2,
    }, T0)
    expect(updated.outcome).toBe("updated")
    const again = await auto.apply({
      ...base,
      bodyExcerpt: v2.map(p => p.text).join(" / ").slice(0, 500),
      basisText: "offline fixture page v2",
      pageParagraphs: v2,
    }, T0)
    expect(again.outcome).toBe("unchanged")
    const detail = await policies.detail(created.policyId!, T0)
    expect(detail?.versions.length).toBe(2)
    native.close()
  })

  it("validation failure leaves no policy row (rollback) and writes rejected audit", async () => {
    const { auto, policies, native } = await setup()
    const before = (await policies.list({}, T0)).length
    await expect(auto.apply(officialCandidate({ fullText: "" }), T0)).rejects.toBeTruthy()
    expect((await policies.list({}, T0)).length).toBe(before)
    const audits = await auto.listAudit()
    expect(audits.some(a => a.outcome === "rejected")).toBe(true)
    native.close()
  })

  it("media-only is rumor; status without evidence → human; browse GET modules stay zero-model", async () => {
    const { auto, policies, native } = await setup()
    const media = await auto.apply(officialCandidate({
      sourceType: "media",
      status: null,
      fullText: null,
      bodyExcerpt: "media excerpt only",
      documentNumber: "MEDIA-FIXTURE-1",
      title: "[FIXTURE] media rumor",
      sourceUrl: "https://example.org/fixture/media-1",
    }), T0)
    expect(media.outcome).toBe("created")
    expect(media.record?.status).toBe("rumor")
    expect(media.record?.sourceType).toBe("media")

    const noStatus = await auto.apply(officialCandidate({
      status: null,
      documentNumber: "OFFICIAL-NO-STATUS",
      sourceUrl: "https://example.org/fixture/auto-vn-nostatus",
    }), T0)
    expect(noStatus.outcome).toBe("needs_human_confirm")
    expect(noStatus.reason).toBe("status_evidence_insufficient")

    const badMedia = await auto.apply(officialCandidate({
      sourceType: "media",
      status: "published",
      fullText: null,
      bodyExcerpt: "x",
      documentNumber: "MEDIA-BAD",
      sourceUrl: "https://example.org/fixture/media-bad",
    }), T0)
    expect(badMedia.outcome).toBe("rejected")
    expect(badMedia.reason).toBe("media_source_must_be_rumor")

    const getIndex = readFileSync(join(process.cwd(), "server/api/shipping/policies/index.get.ts"), "utf8")
    const getOne = readFileSync(join(process.cwd(), "server/api/shipping/policies/[id]/index.get.ts"), "utf8")
    for (const src of [getIndex, getOne]) {
      expect(src.includes("policy-auto")).toBe(false)
      expect(src.includes("/llm")).toBe(false)
      expect(src.includes("PolicyAutoService")).toBe(false)
    }
    expect(PolicyAutoService.browseGetsMustNotCallApply).toBe(true)
    expect((await policies.list({}, T0)).length).toBeGreaterThanOrEqual(1)
    native.close()
  })
})
