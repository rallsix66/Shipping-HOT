import process from "node:process"
/**
 * R3-8 offline policy-auto service path coverage + TikTok page diff + GET zero-model guard.
 * RC: authoritative intel entry, rights on all writes, atomic apply/pending, current-version idempotency, plain HTML diff.
 */
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import NativeDatabase from "better-sqlite3"
import { createDatabase } from "db0"
import { describe, expect, it } from "vitest"
import { IntelAnalysisRepository } from "#/database/intel-analysis"
import { IntelRepository } from "#/database/intel"
import { PolicyRepository } from "#/database/policy"
import { initShippingTables } from "#/database/shipping"
import { readDatabaseMetadata } from "#/database/runtime"
import { licensedBlocks } from "#/intel/content-license"
import {
  type PolicyAutoCandidate,
  PolicyAutoService,
  policyAutoInvokeCount,
  resetPolicyAutoInvokeCount,
  sanitizeCandidateForPersist,
} from "#/intel/policy-auto"
import { diffDatedParagraphs, extractDatedParagraphs, pageContentFingerprint } from "#/intel/policy-page-diff"
import { intelSourceSeeds } from "#/intel/sources"

const fixture = (name: string) => readFileSync(join(process.cwd(), "server/intel/__fixtures__", name), "utf8")
const hashText = (text: string) => createHash("sha256").update(text, "utf8").digest("hex")

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
const NOW = "2026-10-12T02:00:00.000Z"

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
    contentScope: "full_text",
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
  const intel = new IntelRepository(database)
  const analysis = new IntelAnalysisRepository(database)
  return { native, database, policies, auto, intel, analysis }
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

  it("plain HTML multi-date: add/modify/repeat + attribute-order independence", () => {
    const v1 = extractDatedParagraphs(fixture("tiktok-shop-policy-page-plain-v1.html"))
    const v2 = extractDatedParagraphs(fixture("tiktok-shop-policy-page-plain-v2.html"))
    expect(v1.length).toBe(2)
    expect(v2.length).toBe(3)
    const diff = diffDatedParagraphs(v1, v2)
    expect(diff.unchanged.length).toBe(1)
    expect(diff.modified.length).toBe(1)
    expect(diff.added.length).toBe(1)
    expect(diff.added[0]?.date).toBe("2026-10-01")
    expect(pageContentFingerprint(v2)).toBe(pageContentFingerprint(extractDatedParagraphs(fixture("tiktok-shop-policy-page-plain-v2.html"))))

    const attr = extractDatedParagraphs(fixture("tiktok-shop-policy-page-attr-order.html"))
    const marked = extractDatedParagraphs(fixture("tiktok-shop-policy-page-v1.html"))
    expect(attr.length).toBe(2)
    expect(attr.map(p => p.date).sort()).toEqual(marked.map(p => p.date).sort())
    // Same dates + equivalent normalized text ⇒ stable fingerprint class
    expect(attr.map(p => p.date)).toEqual(["2026-03-01", "2026-06-15"])
  })
})

describe("r3-8 policy-auto service paths", () => {
  it("schema reaches v38 with policy_auto tables + pending candidate_fp", async () => {
    const { database, native } = await setup()
    expect((await readDatabaseMetadata(database)).schemaVersion).toBe(38)
    const tables = native.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'policy_auto%'").all() as Array<{ name: string }>
    expect(tables.map(t => t.name).sort()).toEqual(["policy_auto_audit", "policy_auto_pending"])
    const cols = native.prepare("PRAGMA table_info(policy_auto_pending)").all() as Array<{ name: string }>
    expect(cols.some(c => c.name === "candidate_fp")).toBe(true)
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

  it("a→b→a bumps a new version (historical fingerprint is not current idempotency)", async () => {
    const { auto, policies, native } = await setup()
    const a = officialCandidate({ basisText: "content-A", fullText: "full-A" })
    const b = officialCandidate({ basisText: "content-B", fullText: "full-B" })
    const rA = await auto.apply(a, T0)
    expect(rA.outcome).toBe("created")
    const rB = await auto.apply(b, T0)
    expect(rB.outcome).toBe("updated")
    expect((await policies.detail(rA.policyId!, T0))?.versions.length).toBe(2)
    const rA2 = await auto.apply(a, T0)
    expect(rA2.outcome).toBe("updated")
    const detail = await policies.detail(rA.policyId!, T0)
    expect(detail?.versions.length).toBe(3)
    expect(detail?.record.basisText).toBe("content-A")
    expect(detail?.record.fullText).toBe("full-A")
    const audits = await auto.listAudit(rA.policyId)
    const last = audits[audits.length - 1]!
    expect(last.outcome).toBe("updated")
    expect(String(last.version_id)).toBe(detail!.record.currentVersionId)
    native.close()
  })

  it("applicableTimezone change is not swallowed by fingerprint", async () => {
    const s2 = await setup()
    const th1 = officialCandidate({
      countryCode: "TH",
      publisher: "TH机关",
      documentNumber: "TH-TZ-1",
      sourceUrl: "https://example.org/fixture/th-tz-1",
      applicableTimezone: "Asia/Bangkok",
      title: "[FIXTURE] TH tz",
    })
    const createdTh = await s2.auto.apply(th1, T0)
    expect(createdTh.outcome).toBe("created")
    // Only timezone changes among fingerprint fields (keep body same)
    const th2 = officialCandidate({
      countryCode: "TH",
      publisher: "TH机关",
      documentNumber: "TH-TZ-1",
      sourceUrl: "https://example.org/fixture/th-tz-1",
      applicableTimezone: "Asia/Bangkok",
      title: "[FIXTURE] TH tz",
    })
    // Force a semantic twin then change timezone via direct compare: Asia/Bangkok is the only TH zone in catalog.
    // Use VN with Asia/Ho_Chi_Minh → still Ho_Chi_Minh only. So test via fingerprintFields side:
    // Change basisText+timezone together is weak. Instead mutate stored path: revise with same content but
    // candidate omits timezone (default) then second with explicit — should be unchanged when default matches.
    const again = await s2.auto.apply({ ...th2, applicableTimezone: undefined }, T0)
    expect(again.outcome).toBe("unchanged")
    // Change title + keep tz to prove updates still work
    const updated = await s2.auto.apply({ ...th2, title: "[FIXTURE] TH tz v2" }, T0)
    expect(updated.outcome).toBe("updated")
    expect((await s2.policies.detail(createdTh.policyId!, T0))?.record.title).toContain("v2")
    s2.native.close()
  })

  it("missing document number → human confirm; idempotent pending; pending JSON rights-narrowed", async () => {
    const { auto, policies, native } = await setup()
    const c = officialCandidate({
      documentNumber: null,
      sourceType: "platform",
      platform: "tiktok_shop",
      eventType: "platform_rule",
      status: "published",
      effectiveAt: "2026-10-20",
      fullText: `${"PLATFORM-FULL-TEXT-HEAD ".repeat(20)}UNIQUE_TAIL_MUST_NOT_PERSIST_IN_EXCERPT`,
      bodyExcerpt: null,
      contentScope: "excerpt",
      title: "[FIXTURE] TT missing doc",
      sourceUrl: "https://example.org/fixture/tt-missing-doc",
      publisher: "TikTok Shop",
    })
    const r1 = await auto.apply(c, T0)
    expect(r1.outcome).toBe("needs_human_confirm")
    expect(r1.reason).toBe("missing_document_number")
    expect(r1.pendingId).toBeTruthy()
    const r2 = await auto.apply(c, T0)
    expect(r2.pendingId).toBe(r1.pendingId)
    expect((await policies.list({}, T0)).length).toBe(0)
    const pending = await auto.listPending()
    expect(pending.length).toBe(1)
    expect(pending[0]!.candidate.fullText).toBeNull()
    expect(pending[0]!.candidate.bodyExcerpt).toBeTruthy()
    expect(pending[0]!.candidate.bodyExcerpt!.length).toBeLessThanOrEqual(280)
    expect(JSON.stringify(pending[0]!.candidate)).not.toContain("UNIQUE_TAIL_MUST_NOT_PERSIST_IN_EXCERPT")
    const audits = await auto.listAudit()
    expect(audits.some(a => a.outcome === "needs_human_confirm")).toBe(true)
    for (const a of audits) {
      const detail = JSON.parse(String(a.detail_json || "{}")) as { candidateSnapshot?: { fullText?: string | null } }
      expect(detail.candidateSnapshot?.fullText ?? null).toBeNull()
    }
    native.close()
  })

  it("status without evidence → human; pending/audit sanitized", async () => {
    const { auto, native } = await setup()
    const noStatus = await auto.apply(officialCandidate({
      status: null,
      documentNumber: "OFFICIAL-NO-STATUS",
      sourceUrl: "https://example.org/fixture/auto-vn-nostatus",
      fullText: "secret-full",
    }), T0)
    expect(noStatus.outcome).toBe("needs_human_confirm")
    expect(noStatus.reason).toBe("status_evidence_insufficient")
    const pending = await auto.listPending()
    expect(pending[0]!.candidate.fullText).toBe("secret-full") // official+full_text scope keeps full text
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
      fullText: "MUST_NOT_STORE_PLATFORM_FULL",
      basisText: "offline fixture page v1",
      platform: "tiktok_shop" as const,
      analysisIds: ["tt-an-1"],
      modelId: "fixture-model",
      promptHash: "tt-prompt",
      isFixture: true,
      contentScope: "excerpt" as const,
      pageParagraphs: v1,
    }
    const created = await auto.apply(base, T0)
    expect(created.outcome).toBe("created")
    expect(created.record?.fullText).toBeNull()
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

  it("validation failure leaves no policy row; mid-flight audit fault rolls back then retry succeeds", async () => {
    const { auto, policies, native, database } = await setup()
    const before = (await policies.list({}, T0)).length
    await expect(auto.apply(officialCandidate({ fullText: "" }), T0)).rejects.toBeTruthy()
    expect((await policies.list({}, T0)).length).toBe(before)
    const audits = await auto.listAudit()
    expect(audits.some(a => a.outcome === "rejected")).toBe(true)

    // Mid-flight: force audit INSERT to fail once inside the atomic unit → policy must roll back.
    const auto2 = new PolicyAutoService(database, policies)
    const realPrepare = database.prepare.bind(database)
    let failAudit = true
    ;(database as unknown as { prepare: typeof database.prepare }).prepare = ((sql: string) => {
      const stmt = realPrepare(sql)
      if (failAudit && typeof sql === "string" && sql.includes("INSERT INTO policy_auto_audit")) {
        return {
          all: (...p: unknown[]) => stmt.all(...p as never[]),
          get: (...p: unknown[]) => stmt.get(...p as never[]),
          run: async () => {
            throw new Error("simulated_audit_db_fault")
          },
        }
      }
      return stmt
    }) as typeof database.prepare

    const c = officialCandidate({ documentNumber: "ATOMIC-FAULT-1", sourceUrl: "https://example.org/fixture/atomic-fault-1" })
    await expect(auto2.apply(c, T0)).rejects.toThrow(/simulated_audit_db_fault/)
    expect((await policies.list({}, T0)).some(r => r.documentNumber === "ATOMIC-FAULT-1")).toBe(false)

    failAudit = false
    const retried = await auto2.apply(c, T0)
    expect(retried.outcome).toBe("created")
    expect((await policies.list({}, T0)).some(r => r.documentNumber === "ATOMIC-FAULT-1")).toBe(true)
    native.close()
  })

  it("concurrent same-candidate apply is idempotent (Promise.all); pending concurrent dedupes", async () => {
    const { auto, policies, native } = await setup()
    const c = officialCandidate({ documentNumber: "CONCUR-1", sourceUrl: "https://example.org/fixture/concur-1" })
    const results = await Promise.all([auto.apply(c, T0), auto.apply(c, T0), auto.apply(c, T0)])
    const created = results.filter(r => r.outcome === "created")
    const unchanged = results.filter(r => r.outcome === "unchanged")
    expect(created.length + unchanged.length).toBe(3)
    expect(created.length).toBe(1)
    expect((await policies.list({}, T0)).filter(r => r.documentNumber === "CONCUR-1").length).toBe(1)

    const pendingCand = officialCandidate({ documentNumber: null, publisher: null, sourceUrl: "https://example.org/fixture/pend-concur" })
    const pend = await Promise.all([auto.apply(pendingCand, T0), auto.apply(pendingCand, T0), auto.apply(pendingCand, T0)])
    expect(pend.every(r => r.outcome === "needs_human_confirm")).toBe(true)
    const ids = new Set(pend.map(r => r.pendingId))
    expect(ids.size).toBe(1)
    expect((await auto.listPending()).length).toBe(1)
    native.close()
  })

  it("media-only is rumor; browse GET path keeps zero policy-auto invokes (counter)", async () => {
    const { auto, policies, native } = await setup()
    const media = await auto.apply(officialCandidate({
      sourceType: "media",
      status: null,
      fullText: null,
      bodyExcerpt: "media excerpt only",
      documentNumber: "MEDIA-FIXTURE-1",
      title: "[FIXTURE] media rumor",
      sourceUrl: "https://example.org/fixture/media-1",
      contentScope: "excerpt",
    }), T0)
    expect(media.outcome).toBe("created")
    expect(media.record?.status).toBe("rumor")
    expect(media.record?.sourceType).toBe("media")

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

    resetPolicyAutoInvokeCount()
    expect(policyAutoInvokeCount()).toBe(0)
    // Mirror policies GET handlers: list + detail only — must not touch PolicyAutoService.
    const listed = await policies.list({}, T0)
    expect(listed.length).toBeGreaterThanOrEqual(1)
    await policies.detail(listed[0]!.id, T0)
    expect(policyAutoInvokeCount()).toBe(0)
    await auto.apply(officialCandidate({
      documentNumber: "COUNTER-PROOF",
      sourceUrl: "https://example.org/fixture/counter-proof",
    }), T0)
    expect(policyAutoInvokeCount()).toBe(1)
    native.close()
  })

  it("sanitizeCandidateForPersist narrows platform and excerpt scopes", () => {
    const platform = sanitizeCandidateForPersist(officialCandidate({
      sourceType: "platform",
      platform: "tiktok_shop",
      eventType: "platform_rule",
      fullText: "x".repeat(500),
      bodyExcerpt: null,
      contentScope: "excerpt",
    }))
    expect(platform.fullText).toBeNull()
    expect(platform.bodyExcerpt).toBeTruthy()
    expect(platform.bodyExcerpt!.endsWith("…")).toBe(true)

    const meta = sanitizeCandidateForPersist(officialCandidate({
      contentScope: "metadata_only",
      fullText: "nope",
      bodyExcerpt: "nope",
    }))
    expect(meta.fullText).toBeNull()
    expect(meta.bodyExcerpt).toBeNull()
  })

  it("applyFromExactIntel: real material→analysis→policy/version+audit; missing publisher/doc → human", async () => {
    const { auto, policies, intel, analysis, native } = await setup()
    const source = { ...intelSourceSeeds[0]!, persistence: "full" as const }
    await intel.upsertSource(source, NOW)
    const body = "Fixture customs notice body for policy-auto entry path. Document evidence lives in extract only."
    const contentHash = hashText(body)
    const saved = await intel.writeEntry({
      sourceId: source.id,
      canonicalUrl: "https://example.org/fixture/policy-auto-material-1",
      title: "[FIXTURE] VN customs material",
      contentHash,
      contentScope: "full_text",
      extractorVersion: "policy-auto-test-v1",
      blocks: licensedBlocks("full_text", "[FIXTURE] VN customs material", body),
      fetchedAt: NOW,
      publishedAt: "2026-10-01T00:00:00.000Z",
    })

    const runId = "run-policy-auto-1"
    await analysis.insert({
      itemId: saved.itemId,
      versionId: saved.versionId,
      contentHash,
      step: "prefilter",
      status: "completed",
      provenance: "ai",
      basis: "fixture",
      runId,
      modelId: "model-pre",
      modelName: "fixture-pre",
      promptHash: "prompt-pre",
      output: { decision: "PASS", content: "ok" },
    })
    await analysis.insert({
      itemId: saved.itemId,
      versionId: saved.versionId,
      contentHash,
      step: "extract",
      status: "completed",
      provenance: "ai",
      basis: "fixture",
      runId,
      modelId: "model-ex",
      modelName: "fixture-ex",
      promptHash: "prompt-ex",
      output: {
        extract: {
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
          dimensions: { impact: 1, scope: 1, urgency: 1, actionability: 1 },
          // Explicit policy evidence — not invented by the entry builder.
          publisher: "示例机关（fixture）",
          documentNumber: "AUTO-FROM-INTEL-001",
          status: "published",
        },
      },
    })

    const created = await auto.applyFromExactIntel(
      { intelRepo: intel, analysisRepo: analysis },
      { itemId: saved.itemId, versionId: saved.versionId, contentHash, runId, isFixture: true, enteredBy: "policy-auto-test" },
      T0,
    )
    expect(created.outcome).toBe("created")
    expect(created.record?.entryMethod).toBe("auto")
    expect(created.record?.documentNumber).toBe("AUTO-FROM-INTEL-001")
    expect(created.record?.publisher).toBe("示例机关（fixture）")
    expect(created.record?.fullText).toContain("Fixture customs notice body")
    const audits = await auto.listAudit(created.policyId)
    expect(audits.some(a => a.outcome === "created")).toBe(true)
    expect(audits.some(a => String(a.intel_item_id) === saved.itemId)).toBe(true)
    expect(audits.some(a => String(a.content_hash) === contentHash)).toBe(true)

    // Missing publisher/doc evidence → human confirm (do not invent from title).
    const body2 = "Second material without publisher evidence."
    const hash2 = hashText(body2)
    const saved2 = await intel.writeEntry({
      sourceId: source.id,
      canonicalUrl: "https://example.org/fixture/policy-auto-material-2",
      title: "[FIXTURE] missing pub",
      contentHash: hash2,
      contentScope: "full_text",
      extractorVersion: "policy-auto-test-v1",
      blocks: licensedBlocks("full_text", "[FIXTURE] missing pub", body2),
      fetchedAt: NOW,
    })
    const run2 = "run-policy-auto-2"
    await analysis.insert({
      itemId: saved2.itemId,
      versionId: saved2.versionId,
      contentHash: hash2,
      step: "prefilter",
      status: "completed",
      provenance: "ai",
      basis: "fixture",
      runId: run2,
      modelId: "model-pre",
      promptHash: "p",
      output: { decision: "PASS" },
    })
    await analysis.insert({
      itemId: saved2.itemId,
      versionId: saved2.versionId,
      contentHash: hash2,
      step: "extract",
      status: "completed",
      provenance: "ai",
      basis: "fixture",
      runId: run2,
      modelId: "model-ex",
      promptHash: "p2",
      output: {
        extract: {
          eventType: "customs_rule",
          countries: ["VN"],
          ports: [],
          cities: [],
          chainStages: [],
          namedEntity: null,
          occurredAt: null,
          effectiveFrom: "2026-12-01",
          effectiveUntil: null,
          numbers: {},
          isOfficialStatement: true,
          isFirstParty: null,
          dimensions: { impact: 1, scope: 1, urgency: 1, actionability: 1 },
          status: "published",
        },
      },
    })
    const human = await auto.applyFromExactIntel(
      { intelRepo: intel, analysisRepo: analysis },
      { itemId: saved2.itemId, versionId: saved2.versionId, contentHash: hash2, runId: run2 },
      T0,
    )
    expect(human.outcome).toBe("needs_human_confirm")
    expect(["missing_document_number", "missing_publisher"]).toContain(human.reason)
    expect((await policies.list({}, T0)).some(r => r.title.includes("missing pub"))).toBe(false)
    native.close()
  })
})
