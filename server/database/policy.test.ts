import process from "node:process"
import NativeDatabase from "better-sqlite3"
import { createDatabase } from "db0"
import { describe, expect, it } from "vitest"
import { type PolicyInput, policyCsv, policyDisplay, policyToday, validatePolicyInput } from "@shared/policy"
import { PolicyRepository } from "#/database/policy"
import { initShippingTables } from "#/database/shipping"
import { readDatabaseMetadata } from "#/database/runtime"
import { policyClock } from "#/services/policy-clock"

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

// TEST_NOW-style fixed clocks (never the real clock).
const at = (iso: string) => new Date(iso)
const T0 = at("2026-10-12T02:00:00.000Z") // 2026-10-12 UTC+8

function official(over: Partial<PolicyInput> = {}): PolicyInput {
  return {
    category: "customs_tax",
    countryCode: "VN",
    title: "[FIXTURE] 示例海关公告",
    documentNumber: "FIXTURE-001",
    publisher: "示例机关（fixture）",
    publishedAt: "2026-10-01",
    effectiveAt: "2026-11-01",
    status: "published",
    sourceType: "official",
    sourceUrl: "https://example.org/fixture/vn-001",
    fullText: "示例全文（fixture，非真实公告）。",
    basisText: "fixture 依据 v1",
    enteredBy: "tester",
    isFixture: true,
    ...over,
  }
}
function platformRule(over: Partial<PolicyInput> = {}): PolicyInput {
  return {
    category: "ecommerce_platform",
    countryCode: "TH",
    platform: "shopee",
    title: "[FIXTURE] 示例平台规则",
    effectiveAt: "2026-10-20",
    status: "published",
    sourceType: "platform",
    sourceUrl: "https://example.org/fixture/shopee-th",
    bodyExcerpt: "示例摘录（fixture）",
    basisText: "fixture 平台依据",
    enteredBy: "tester",
    isFixture: true,
    ...over,
  }
}

async function setup() {
  const { native, database } = memoryDb()
  await initShippingTables(database, "real")
  return { native, database, repo: new PolicyRepository(database) }
}

describe("r1.5-7 validation", () => {
  const ok = (i: PolicyInput) => validatePolicyInput(i, "2026-10-12")
  const err = (i: PolicyInput) => {
    const r = ok(i)
    return r.ok ? "ok" : r.error
  }
  it("enforces source-type storage rules, entrant, link and basis", () => {
    expect(err(official())).toBe("ok")
    expect(err(official({ fullText: "" }))).toBe("official_full_text_required")
    expect(err(platformRule())).toBe("ok")
    expect(err(platformRule({ fullText: "整页全文" }))).toBe("platform_excerpt_only")
    expect(err(platformRule({ bodyExcerpt: "" }))).toBe("platform_excerpt_required")
    expect(err(platformRule({ platform: "" }))).toBe("platform_required")
    expect(err(official({ sourceType: "media" }))).toBe("media_source_must_be_rumor")
    expect(err(official({ status: "rumor" }))).toBe("rumor_requires_media_source")
    expect(err(official({ sourceType: "media", status: "rumor", fullText: "" }))).toBe("ok")
    expect(err(official({ sourceUrl: "http://example.org/x" }))).toBe("source_url_required")
    expect(err(official({ enteredBy: " " }))).toBe("entered_by_required")
    expect(err(official({ basisText: "" }))).toBe("basis_required")
    expect(err(official({ effectiveAt: "2026-02-30" }))).toBe("invalid_effectiveAt")
    expect(err(official({ expiresAt: "2026-10-01" }))).toBe("effective_after_expiry")
    expect(err(official({ effectiveAt: "" }))).toBe("effective_date_required")
    expect(err(official({ status: "effective" }))).toBe("effective_status_before_effective_date")
    expect(err(official({ status: "repealed" }))).toBe("status_requires_explicit_transition")
    expect(err(official({ category: "toString" }))).toBe("invalid_category")
    expect(err(official({ status: "__proto__" }))).toBe("invalid_status")
  })
})

describe("r1.5-7 effective-date switching (injected clock)", () => {
  it("switches at 00:00 UTC+8 of the effective date; expiry is inclusive of its date", () => {
    expect(policyToday(at("2026-10-31T15:59:59.999Z"))).toBe("2026-10-31")
    expect(policyToday(at("2026-10-31T16:00:00.000Z"))).toBe("2026-11-01")
    const p = { status: "published" as const, effectiveAt: "2026-11-01", expiresAt: "2026-12-31" }
    expect(policyDisplay(p, "2026-10-31")).toEqual({ displayStatus: "published", autoActivated: false, datePosition: "future" })
    expect(policyDisplay(p, "2026-11-01")).toEqual({ displayStatus: "effective", autoActivated: true, datePosition: "in_effect" })
    expect(policyDisplay(p, "2026-12-31").displayStatus).toBe("effective")
    expect(policyDisplay(p, "2027-01-01")).toMatchObject({ displayStatus: "expired", datePosition: "past_expiry" })
  })

  it("rumor, draft, revised and repealed never auto-activate when the date arrives", () => {
    for (const status of ["rumor", "draft", "revised", "repealed"] as const) {
      expect(policyDisplay({ status, effectiveAt: "2026-01-01", expiresAt: null }, "2026-10-12")).toEqual({ displayStatus: status, autoActivated: false, datePosition: "not_applicable" })
    }
  })

  it("repository views follow the injected clock, not the real one", async () => {
    const { native, repo } = await setup()
    const created = await repo.create(official(), T0)
    expect(created).toMatchObject({ displayStatus: "published", datePosition: "future" })
    expect((await repo.list({}, at("2026-10-31T16:00:00.000Z")))[0]).toMatchObject({ displayStatus: "effective", autoActivated: true, status: "published" })
    expect((await repo.list({}, at("2026-10-31T15:59:59.000Z")))[0]).toMatchObject({ displayStatus: "published" })
    native.close()
  })

  it("tEST_NOW is honoured only with SHIPPING_TEST_CLOCK=1", () => {
    const saved = { a: process.env.TEST_NOW, b: process.env.SHIPPING_TEST_CLOCK }
    process.env.TEST_NOW = "2030-01-01T00:00:00Z"
    delete process.env.SHIPPING_TEST_CLOCK
    expect(policyClock().clock).toBe("system")
    process.env.SHIPPING_TEST_CLOCK = "1"
    expect(policyClock()).toEqual({ now: at("2030-01-01T00:00:00Z"), clock: "test" })
    process.env.TEST_NOW = "not-a-date"
    expect(policyClock().clock).toBe("system")
    if (saved.a === undefined) delete process.env.TEST_NOW
    else process.env.TEST_NOW = saved.a
    if (saved.b === undefined) delete process.env.SHIPPING_TEST_CLOCK
    else process.env.SHIPPING_TEST_CLOCK = saved.b
  })
})

describe("r1.5-7 versions, supersede and repeal", () => {
  it("migration 017 reaches schema v17", async () => {
    const { native, database } = await setup()
    expect((await readDatabaseMetadata(database)).schemaVersion).toBe(17)
    native.close()
  })

  it("revise appends a version; old version and its basis remain viewable", async () => {
    const { native, repo } = await setup()
    const a = await repo.create(official(), T0)
    await expect(repo.revise(a.id, { ...official({ effectiveAt: "2026-11-15", basisText: "fixture 依据 v2" }) }, T0)).rejects.toMatchObject({ code: "change_summary_required" })
    await expect(repo.revise(a.id, { ...official({ isFixture: false }), changeSummary: "x" }, T0)).rejects.toMatchObject({ code: "fixture_flag_immutable" })
    const revised = await repo.revise(a.id, { ...official({ effectiveAt: "2026-11-15", basisText: "fixture 依据 v2", enteredBy: "tester2" }), changeSummary: "生效日改为 11-15" }, at("2026-10-13T02:00:00Z"))
    expect(revised).toMatchObject({ currentVersionNumber: 2, effectiveAt: "2026-11-15", basisText: "fixture 依据 v2" })
    const d = (await repo.detail(a.id, T0))!
    expect(d.versions.map(v => v.versionNumber)).toEqual([1, 2])
    expect(d.versions[0]).toMatchObject({ effectiveAt: "2026-11-01", supersededByVersionId: `${a.id}:v2`, enteredBy: "tester", snapshot: { basisText: "fixture 依据 v1", fullText: "示例全文（fixture，非真实公告）。" } })
    expect(d.versions[1]).toMatchObject({ supersededByVersionId: null, changeSummary: "生效日改为 11-15", enteredBy: "tester2" })
    expect(d.changeLog.map(c => c.action)).toEqual(["create", "revise"])
    native.close()
  })

  it("explicit supersede marks the old record revised/repealed with two-way links; terminal records are frozen", async () => {
    const { native, repo } = await setup()
    const a = await repo.create(official(), T0)
    await expect(repo.create({ ...official({ title: "[FIXTURE] B" }), supersedesPolicyId: a.id }, T0)).rejects.toMatchObject({ code: "relation_required" })
    const b = await repo.create({ ...official({ title: "[FIXTURE] B", documentNumber: "FIXTURE-002" }), supersedesPolicyId: a.id, relation: "revised" }, T0)
    expect(b.supersedesPolicyId).toBe(a.id)
    const da = (await repo.detail(a.id, T0))!
    expect(da.record).toMatchObject({ status: "revised", displayStatus: "revised", supersededByPolicyId: b.id, relationKind: "revised", basisText: "fixture 依据 v1" })
    expect(da.versions.map(v => v.status)).toEqual(["published", "revised"])
    expect(da.versions[0].snapshot?.basisText).toBe("fixture 依据 v1")
    await expect(repo.revise(a.id, { ...official(), changeSummary: "x" }, T0)).rejects.toMatchObject({ code: "policy_terminal" })
    await expect(repo.create({ ...official({ title: "[FIXTURE] C" }), supersedesPolicyId: a.id, relation: "repealed" }, T0)).rejects.toMatchObject({ code: "superseded_policy_already_terminal" })
    await expect(repo.create({ ...official({ isFixture: false }), supersedesPolicyId: b.id, relation: "revised" }, T0)).rejects.toMatchObject({ code: "fixture_cannot_be_superseded_by_real" })
    const c = await repo.create(platformRule(), T0)
    await expect(repo.repeal(c.id, { actor: "tester", changeSummary: "停用" }, T0)).rejects.toMatchObject({ code: "source_url_required" })
    const repealed = await repo.repeal(c.id, { actor: "tester", changeSummary: "停用", sourceUrl: "https://example.org/fixture/repeal" }, at("2026-10-25T00:00:00Z"))
    expect(repealed).toMatchObject({ status: "repealed", displayStatus: "repealed", autoActivated: false, sourceUrl: "https://example.org/fixture/shopee-th" })
    const dc = (await repo.detail(c.id, T0))!
    expect(dc.versions[1]).toMatchObject({ status: "repealed", sourceUrl: "https://example.org/fixture/repeal" })
    expect(dc.versions[0].snapshot?.bodyExcerpt).toBe("示例摘录（fixture）")
    await expect(repo.repeal(c.id, { actor: "t", changeSummary: "x", sourceUrl: "https://example.org/x" }, T0)).rejects.toMatchObject({ code: "policy_terminal" })
    native.close()
  })
})

describe("r1.5-7 filtering and export", () => {
  it("filters by country/platform/category/status/effective range/text and exports exactly the filtered rows", async () => {
    const { native, repo } = await setup()
    await repo.create(official(), T0) // VN customs, effective 11-01
    await repo.create(official({ countryCode: "MY", title: "=HYPERLINK(\"x\")", publishedAt: "2026-08-20", effectiveAt: "2026-09-01", status: "effective", documentNumber: "FIXTURE-MY" }), T0)
    await repo.create(platformRule(), T0) // TH shopee 10-20
    await repo.create(platformRule({ platform: "lazada", countryCode: "TH", title: "[FIXTURE] Lazada 规则", effectiveAt: "2027-01-05" }), T0)
    await repo.create(official({ sourceType: "media", status: "rumor", fullText: "", title: "[FIXTURE] 传闻", effectiveAt: "2026-01-01", publishedAt: "" }), T0)
    const now = at("2026-10-21T02:00:00Z")
    expect((await repo.list({ countryCode: "TH" }, now)).length).toBe(2)
    expect((await repo.list({ platform: "shopee" }, now)).map(r => r.title)).toEqual(["[FIXTURE] 示例平台规则"])
    expect((await repo.list({ category: "customs_tax" }, now)).length).toBe(3)
    const effective = await repo.list({ status: "effective" }, now)
    expect(effective.map(r => r.countryCode).sort()).toEqual(["MY", "TH"])
    expect((await repo.list({ status: "rumor" }, now)).length).toBe(1)
    expect((await repo.list({ effectiveFrom: "2026-10-01", effectiveTo: "2026-12-31" }, now)).map(r => r.effectiveAt)).toEqual(["2026-10-20", "2026-11-01"])
    expect((await repo.list({ q: "fixture-my" }, now)).length).toBe(1)
    const csv = policyCsv(effective)
    expect(csv.startsWith("\uFEFFid,")).toBe(true)
    const lines = csv.trim().split("\r\n")
    expect(lines).toHaveLength(1 + effective.length)
    expect(csv).toContain("\"'=HYPERLINK(\"\"x\"\")\"")
    expect(csv).toContain("示例（fixture，非真实公告）")
    native.close()
  })
})
