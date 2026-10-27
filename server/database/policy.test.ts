import process from "node:process"
import NativeDatabase from "better-sqlite3"
import { createDatabase } from "db0"
import { describe, expect, it } from "vitest"
import { type PolicyInput, policyCsv, policyDisplay, policyToday, validatePolicyInput } from "@shared/policy"
import { PolicyRepository } from "#/database/policy"
import { initShippingTables } from "#/database/shipping"
import { readDatabaseMetadata } from "#/database/runtime"
import { shippingMigrations } from "#/database/migrations"
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
  const ok = (i: PolicyInput) => validatePolicyInput(i, at("2026-10-12T02:00:00Z"))
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
  it("switches at 00:00 local time of the applicable zone; expiry is inclusive of its date", () => {
    expect(policyToday(at("2026-10-31T15:59:59.999Z"))).toBe("2026-10-31")
    expect(policyToday(at("2026-10-31T16:00:00.000Z"))).toBe("2026-11-01")
    const cn = { status: "published" as const, effectiveAt: "2026-11-01", expiresAt: "2026-12-31", applicableTimezone: "Asia/Shanghai" as const }
    expect(policyDisplay(cn, at("2026-10-31T15:59:59Z"))).toMatchObject({ displayStatus: "published", autoActivated: false, datePosition: "future", localToday: "2026-10-31" })
    expect(policyDisplay(cn, at("2026-10-31T16:00:00Z"))).toMatchObject({ displayStatus: "effective", autoActivated: true, datePosition: "in_effect", localToday: "2026-11-01" })
    expect(policyDisplay(cn, at("2026-12-31T15:59:59Z")).displayStatus).toBe("effective")
    expect(policyDisplay(cn, at("2026-12-31T16:00:00Z"))).toMatchObject({ displayStatus: "expired", datePosition: "past_expiry" })
    for (const tz of ["Asia/Ho_Chi_Minh", "Asia/Bangkok", "Asia/Jakarta"] as const) {
      const p = { ...cn, applicableTimezone: tz }
      expect(policyDisplay(p, at("2026-10-31T16:59:59Z")).displayStatus).toBe("published") // local 23:59:59 Oct 31
      expect(policyDisplay(p, at("2026-10-31T17:00:00Z")).displayStatus).toBe("effective") // local 00:00 Nov 1
    }
    for (const tz of ["Asia/Kuala_Lumpur", "Asia/Manila", "Asia/Makassar"] as const) {
      expect(policyDisplay({ ...cn, applicableTimezone: tz }, at("2026-10-31T15:59:59Z")).displayStatus).toBe("published")
      expect(policyDisplay({ ...cn, applicableTimezone: tz }, at("2026-10-31T16:00:00Z")).displayStatus).toBe("effective")
    }
    expect(policyDisplay({ ...cn, applicableTimezone: "Asia/Jayapura" }, at("2026-10-31T14:59:59Z")).displayStatus).toBe("published")
    expect(policyDisplay({ ...cn, applicableTimezone: "Asia/Jayapura" }, at("2026-10-31T15:00:00Z")).displayStatus).toBe("effective")
    expect(policyDisplay({ ...cn, applicableTimezone: null }, at("2027-01-01T00:00:00Z"))).toMatchObject({ displayStatus: "published", autoActivated: false, datePosition: "timezone_unconfirmed" })
  })

  it("rumor, draft, revised and repealed never auto-activate when the date arrives", () => {
    for (const status of ["rumor", "draft", "revised", "repealed"] as const) {
      expect(policyDisplay({ status, effectiveAt: "2026-01-01", expiresAt: null, applicableTimezone: "Asia/Shanghai" }, T0)).toMatchObject({ displayStatus: status, autoActivated: false, datePosition: "not_applicable" })
    }
  })

  it("timezone input: single-zone default, ID must be explicit, zone must belong to the country", () => {
    const v = (i: PolicyInput) => {
      const r = validatePolicyInput(i, T0)
      return r.ok ? r.fields.applicableTimezone : r.error
    }
    expect(v(official())).toBe("Asia/Ho_Chi_Minh")
    expect(v(official({ countryCode: "TH" }))).toBe("Asia/Bangkok")
    expect(v(official({ countryCode: "CN" }))).toBe("Asia/Shanghai")
    expect(v(official({ countryCode: "ID" }))).toBe("timezone_required")
    expect(v(official({ countryCode: "ID", applicableTimezone: "Asia/Makassar" }))).toBe("Asia/Makassar")
    expect(v(official({ applicableTimezone: "Asia/Bangkok" }))).toBe("timezone_country_mismatch")
    expect(v(official({ applicableTimezone: "toString" }))).toBe("invalid_timezone")
  })

  it("repository views follow the injected clock in the policy's own zone (VN switches at local midnight)", async () => {
    const { native, repo } = await setup()
    const created = await repo.create(official(), T0)
    expect(created).toMatchObject({ displayStatus: "published", datePosition: "future", applicableTimezone: "Asia/Ho_Chi_Minh" })
    expect((await repo.list({}, at("2026-10-31T16:30:00.000Z")))[0]).toMatchObject({ displayStatus: "published", localToday: "2026-10-31" })
    expect((await repo.list({}, at("2026-10-31T17:00:00.000Z")))[0]).toMatchObject({ displayStatus: "effective", autoActivated: true, status: "published", localToday: "2026-11-01" })
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
  it("migrations reach schema v18", async () => {
    const { native, database } = await setup()
    expect((await readDatabaseMetadata(database)).schemaVersion).toBe(31)
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

  it("supersession: rumor/draft cannot supersede; a future policy schedules the switch without terminating early", async () => {
    const { native, repo } = await setup()
    const a = await repo.create(official({ status: "effective", effectiveAt: "2026-10-01" }), T0)
    const before = JSON.stringify(await repo.detail(a.id, T0))
    await expect(repo.create({ ...official({ sourceType: "media", status: "rumor", fullText: "", title: "[FIXTURE] 传闻替代" }), supersedesPolicyId: a.id, relation: "revised" }, T0)).rejects.toMatchObject({ code: "supersession_requires_published_or_effective" })
    await expect(repo.create({ ...official({ status: "draft", title: "[FIXTURE] 征求意见替代" }), supersedesPolicyId: a.id, relation: "repealed" }, T0)).rejects.toMatchObject({ code: "supersession_requires_published_or_effective" })
    expect(JSON.stringify(await repo.detail(a.id, T0))).toBe(before)
    const b = await repo.create({ ...official({ title: "[FIXTURE] 未来替代 B", documentNumber: "FIXTURE-B" }), supersedesPolicyId: a.id, relation: "revised" }, T0)
    const pending = (await repo.detail(a.id, T0))!
    expect(pending.record).toMatchObject({ status: "effective", displayStatus: "effective", supersededByPolicyId: b.id, supersededByRelationKind: "revised", supersedeSwitchAt: "2026-11-01", supersedeSwitched: false })
    expect(pending.versions).toHaveLength(1)
    expect((await repo.list({}, at("2026-10-31T16:59:59Z"))).find(r => r.id === a.id)?.displayStatus).toBe("effective")
    const switched = (await repo.list({}, at("2026-10-31T17:00:00Z"))).find(r => r.id === a.id)!
    expect(switched).toMatchObject({ displayStatus: "revised", supersedeSwitched: true, datePosition: "superseded", status: "effective" })
    await expect(repo.revise(a.id, { ...official({ status: "effective", effectiveAt: "2026-10-01" }), changeSummary: "x" }, T0)).rejects.toMatchObject({ code: "policy_has_supersession" })
    await expect(repo.create({ ...official({ title: "[FIXTURE] 第二个替代" }), supersedesPolicyId: a.id, relation: "revised" }, T0)).rejects.toMatchObject({ code: "superseded_policy_has_supersession" })
    // Revising B's effective date moves the pending switch; repealing B before the switch cancels it.
    await repo.revise(b.id, { ...official({ title: "[FIXTURE] 未来替代 B", documentNumber: "FIXTURE-B", effectiveAt: "2026-11-10" }), changeSummary: "延期" }, T0)
    expect((await repo.detail(a.id, T0))!.record.supersedeSwitchAt).toBe("2026-11-10")
    await expect(repo.revise(b.id, { ...official({ status: "draft" }), changeSummary: "改草案" }, T0)).rejects.toMatchObject({ code: "supersession_requires_published_or_effective" })
    await repo.repeal(b.id, { actor: "tester", changeSummary: "撤回", sourceUrl: "https://example.org/fixture/withdraw" }, T0)
    const cancelled = (await repo.detail(a.id, at("2026-12-01T00:00:00Z")))!
    expect(cancelled.record).toMatchObject({ displayStatus: "effective", supersededByPolicyId: null })
    expect(cancelled.changeLog.map(c => c.action)).toEqual(["create", "revise_scheduled", "supersession_rescheduled", "supersession_cancelled"])
    // An already-effective replacement switches immediately.
    const c = await repo.create(official({ status: "effective", effectiveAt: "2026-10-01", title: "[FIXTURE] C" }), T0)
    await repo.create({ ...official({ status: "effective", effectiveAt: "2026-10-12", title: "[FIXTURE] D" }), supersedesPolicyId: c.id, relation: "repealed" }, T0)
    expect((await repo.detail(c.id, T0))!.record).toMatchObject({ displayStatus: "repealed", supersedeSwitched: true })
    native.close()
  })

  it("fixture isolation is bidirectional and leaves the original record untouched on failure", async () => {
    const { native, repo } = await setup()
    const real = await repo.create(official({ isFixture: false, title: "正式记录（测试库）" }), T0)
    const fixture = await repo.create(official(), T0)
    const snapshot = async () => JSON.stringify([await repo.detail(real.id, T0), await repo.detail(fixture.id, T0)])
    const before = await snapshot()
    await expect(repo.create({ ...official({ isFixture: true }), supersedesPolicyId: real.id, relation: "revised" }, T0)).rejects.toMatchObject({ code: "fixture_flag_mismatch" })
    await expect(repo.create({ ...official({ isFixture: false }), supersedesPolicyId: fixture.id, relation: "revised" }, T0)).rejects.toMatchObject({ code: "fixture_flag_mismatch" })
    expect(await snapshot()).toBe(before)
    expect((await repo.list({}, T0)).length).toBe(2)
    native.close()
  })

  it("mixed chain A -(revised by)-> B -(repealed by)-> C keeps both directions' relation kinds", async () => {
    const { native, repo } = await setup()
    const a = await repo.create(official({ status: "effective", effectiveAt: "2026-09-01", publishedAt: "2026-08-01", title: "[FIXTURE] A" }), T0)
    const b = await repo.create({ ...official({ status: "effective", effectiveAt: "2026-10-01", title: "[FIXTURE] B" }), supersedesPolicyId: a.id, relation: "revised" }, T0)
    const c = await repo.create({ ...official({ status: "effective", effectiveAt: "2026-10-10", title: "[FIXTURE] C" }), supersedesPolicyId: b.id, relation: "repealed" }, T0)
    const view = async (id: string) => (await repo.detail(id, T0))!.record
    expect(await view(a.id)).toMatchObject({ supersedesPolicyId: null, supersededByPolicyId: b.id, supersededByRelationKind: "revised", displayStatus: "revised" })
    expect(await view(b.id)).toMatchObject({ supersedesPolicyId: a.id, supersedesRelationKind: "revised", supersededByPolicyId: c.id, supersededByRelationKind: "repealed", displayStatus: "repealed" })
    expect(await view(c.id)).toMatchObject({ supersedesPolicyId: b.id, supersedesRelationKind: "repealed", supersededByPolicyId: null, displayStatus: "effective" })
    const csv = policyCsv(await repo.list({}, T0))
    const rowB = csv.split("\r\n").find(l => l.includes("[FIXTURE] B"))!
    expect(rowB).toContain(`修订 ${a.id}`)
    expect(rowB).toContain(`已被 ${c.id} 废止`)
    expect(rowB).not.toContain(`废止 ${a.id}`)
    native.close()
  })

  it("explicit repeal without replacement keeps the original source/excerpt in old versions", async () => {
    const { native, repo } = await setup()
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

describe("r1.5-7 P2 round 2 (dots 2026-10-12)", () => {
  it("a successor relation cannot be created for a target whose own supersession has not switched (A -> pending B -> C)", async () => {
    const { native, repo } = await setup()
    const a = await repo.create(official({ status: "effective", effectiveAt: "2026-10-01", title: "[FIXTURE] A" }), T0)
    const b = await repo.create({ ...official({ title: "[FIXTURE] B" }), supersedesPolicyId: a.id, relation: "revised" }, T0)
    const dump = () => JSON.stringify(native.prepare("SELECT * FROM policy_record ORDER BY id").all()) + JSON.stringify(native.prepare("SELECT * FROM policy_version ORDER BY id").all()) + JSON.stringify(native.prepare("SELECT * FROM policy_change_log ORDER BY rowid").all())
    const before = dump()
    await expect(repo.create({ ...official({ status: "effective", effectiveAt: "2026-10-12", title: "[FIXTURE] C" }), supersedesPolicyId: b.id, relation: "repealed" }, T0)).rejects.toMatchObject({ code: "superseded_policy_supersession_pending", statusCode: 409 })
    expect(dump()).toBe(before)
    expect((native.prepare("SELECT COUNT(*) AS n FROM policy_record").get() as { n: number }).n).toBe(2)
    // Once B's supersession of A has switched (VN 2026-11-01 00:00), C may supersede B.
    const later = at("2026-10-31T17:00:00Z")
    const c = await repo.create({ ...official({ status: "effective", effectiveAt: "2026-11-01", title: "[FIXTURE] C" }), supersedesPolicyId: b.id, relation: "repealed" }, later)
    expect((await repo.detail(b.id, later))!.record).toMatchObject({ supersedesRelationKind: "revised", supersededByPolicyId: c.id, supersededByRelationKind: "repealed", displayStatus: "repealed" })
    expect((await repo.detail(a.id, later))!.record).toMatchObject({ displayStatus: "revised", supersededByPolicyId: b.id })
    native.close()
  })

  it("v17 -> latest upgrade with real legacy rows: 019 repairs the 018 backfill, unknown stays unknown, versions preserved", async () => {
    const { native, database } = memoryDb()
    native.exec("CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)")
    for (const m of shippingMigrations.filter(m => m.version <= 17)) {
      await m.up(database)
      native.prepare("INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)").run(m.version, m.name, "2026-10-12T00:00:00Z")
    }
    // Rows exactly as 017 code left them: B's single relation_kind was overwritten to 'repealed' when C repealed it.
    const rec = native.prepare(`INSERT INTO policy_record (id, category, country_code, title, status, source_url, entry_method, entered_by, current_version_id, created_at, updated_at, source_type, full_text, basis_text, is_fixture, effective_at, supersedes_policy_id, superseded_by_policy_id, relation_kind)
      VALUES (?, 'customs_tax', 'VN', ?, ?, 'https://example.org/fixture/legacy', 'manual', 'legacy-tester', ?, '2026-10-01T00:00:00Z', '2026-10-02T00:00:00Z', 'official', 'legacy full text (fixture)', ?, 1, '2026-10-01', ?, ?, ?)`)
    rec.run("policy:A", "[FIXTURE] legacy A", "revised", "policy:A:v2", "basis A v1", null, "policy:B", "revised")
    rec.run("policy:B", "[FIXTURE] legacy B", "repealed", "policy:B:v2", "basis B", "policy:A", "policy:C", "repealed")
    rec.run("policy:C", "[FIXTURE] legacy C", "effective", "policy:C:v1", "basis C", "policy:B", null, "repealed")
    rec.run("policy:D", "[FIXTURE] legacy D (predecessor missing)", "effective", "policy:D:v1", "basis D", "policy:missing", null, "revised")
    const ver = native.prepare(`INSERT INTO policy_version (id, policy_id, version_number, title, body_excerpt, effective_at, status, change_summary, source_url, created_at, superseded_by_version_id, snapshot_json, entered_by)
      VALUES (?, ?, ?, ?, NULL, '2026-10-01', ?, ?, 'https://example.org/fixture/legacy', '2026-10-01T00:00:00Z', ?, ?, 'legacy-tester')`)
    ver.run("policy:A:v1", "policy:A", 1, "[FIXTURE] legacy A", "effective", "create", "policy:A:v2", JSON.stringify({ basisText: "basis A v1" }))
    ver.run("policy:A:v2", "policy:A", 2, "[FIXTURE] legacy A", "revised", "revised by B", null, JSON.stringify({ basisText: "basis A v1" }))
    ver.run("policy:B:v1", "policy:B", 1, "[FIXTURE] legacy B", "effective", "create", "policy:B:v2", JSON.stringify({ basisText: "basis B" }))
    ver.run("policy:B:v2", "policy:B", 2, "[FIXTURE] legacy B", "repealed", "repealed by C", null, JSON.stringify({ basisText: "basis B" }))
    ver.run("policy:C:v1", "policy:C", 1, "[FIXTURE] legacy C", "effective", "create", null, null)
    ver.run("policy:D:v1", "policy:D", 1, "[FIXTURE] legacy D", "effective", "create", null, null)
    native.prepare("INSERT INTO policy_change_log (id, policy_id, version_id, action, actor, summary, created_at) VALUES ('log1', 'policy:A', 'policy:A:v2', 'superseded', 'legacy-tester', 'revised by B', '2026-10-02T00:00:00Z')").run()
    const versionsBefore = JSON.stringify(native.prepare("SELECT * FROM policy_version ORDER BY id").all())
    const logBefore = JSON.stringify(native.prepare("SELECT * FROM policy_change_log").all())

    await initShippingTables(database, "real") // runs 018 then 019 on the legacy rows
    expect((await readDatabaseMetadata(database)).schemaVersion).toBe(31)
    const raw = Object.fromEntries((native.prepare("SELECT id, supersedes_relation_kind AS s, superseded_by_relation_kind AS b, status, title, basis_text, applicable_timezone AS tz FROM policy_record").all() as { id: string, s: string | null, b: string | null, sw: string | null }[]).map(r => [r.id, r]))
    expect(raw["policy:A"]).toMatchObject({ s: null, b: "revised", status: "revised", basis_text: "basis A v1", tz: "Asia/Ho_Chi_Minh" })
    expect(raw["policy:B"]).toMatchObject({ s: "revised", b: "repealed", status: "repealed", title: "[FIXTURE] legacy B" })
    expect(raw["policy:C"]).toMatchObject({ s: "repealed", b: null })
    expect(raw["policy:D"]).toMatchObject({ s: "unknown", b: null })
    expect(JSON.stringify(native.prepare("SELECT * FROM policy_version ORDER BY id").all())).toBe(versionsBefore)
    expect(JSON.stringify(native.prepare("SELECT * FROM policy_change_log").all())).toBe(logBefore)

    const repo = new PolicyRepository(database)
    const b = (await repo.detail("policy:B", T0))!
    expect(b.record).toMatchObject({ supersedesRelationKind: "revised", supersededByRelationKind: "repealed", displayStatus: "repealed" })
    expect(b.versions.map(v => v.versionNumber)).toEqual([1, 2])
    expect((await repo.detail("policy:D", T0))!.record.supersedesRelationKind).toBe("unknown")
    const csv = policyCsv(await repo.list({}, T0))
    const rowB = csv.split("\r\n").find(l => l.includes("legacy B"))!
    expect(rowB).toContain("修订 policy:A")
    expect(rowB).not.toContain("废止 policy:A")
    expect(csv.split("\r\n").find(l => l.includes("legacy D"))).toContain("关系类型未知")
    native.close()
  })
})

describe("r1.5-7 mixed-version upgrade matrix (dots 2026-10-12 12:24)", () => {
  // Builds a DB at v17, inserts legacy rows exactly as 017 code wrote them, then applies migrations up to `upTo`.
  async function legacyDb(upTo: number) {
    const { native, database } = memoryDb()
    native.exec("CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)")
    const apply = async (from: number, to: number) => {
      for (const m of shippingMigrations.filter(m => m.version >= from && m.version <= to)) {
        await m.up(database)
        native.prepare("INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)").run(m.version, m.name, "2026-10-12T00:00:00Z")
      }
    }
    await apply(1, 17)
    const rec = native.prepare(`INSERT INTO policy_record (id, category, country_code, title, status, source_url, entry_method, entered_by, current_version_id, created_at, updated_at, source_type, full_text, basis_text, is_fixture, effective_at, published_at, supersedes_policy_id, superseded_by_policy_id, relation_kind)
      VALUES (?, 'customs_tax', 'VN', ?, ?, 'https://example.org/fixture/legacy', 'manual', 'legacy-tester', ?, '2026-09-01T00:00:00Z', '2026-09-02T00:00:00Z', 'official', 'legacy full text (fixture)', ?, 1, '2026-09-01', '2026-08-01', ?, ?, ?)`)
    const ver = native.prepare(`INSERT INTO policy_version (id, policy_id, version_number, title, body_excerpt, effective_at, status, change_summary, source_url, created_at, superseded_by_version_id, snapshot_json, entered_by)
      VALUES (?, ?, 1, ?, NULL, '2026-09-01', ?, 'legacy create', 'https://example.org/fixture/legacy', '2026-09-01T00:00:00Z', NULL, NULL, 'legacy-tester')`)
    const legacy = (id: string, title: string, status: string, supersedes: string | null, supersededBy: string | null, kind: string | null) => {
      rec.run(id, title, status, `${id}:v1`, `basis ${id}`, supersedes, supersededBy, kind)
      ver.run(`${id}:v1`, id, title, status)
    }
    // Mixed legacy chain A <-revised- B <-repealed- C (B's single field overwritten to 'repealed').
    legacy("policy:A", "[FIXTURE] legacy A", "revised", null, "policy:B", "revised")
    legacy("policy:B", "[FIXTURE] legacy B", "repealed", "policy:A", "policy:C", "repealed")
    legacy("policy:C", "[FIXTURE] legacy C", "effective", "policy:B", null, "repealed")
    // Legacy P <-revised- Q, Q has no successor yet (stale relation_kind 'revised').
    legacy("policy:P", "[FIXTURE] legacy P", "revised", null, "policy:Q", "revised")
    legacy("policy:Q", "[FIXTURE] legacy Q", "effective", "policy:P", null, "revised")
    // Legacy D whose predecessor is missing.
    legacy("policy:D", "[FIXTURE] legacy D", "effective", "policy:missing", null, "revised")
    await apply(18, upTo)
    return { native, database, repo: new PolicyRepository(database), apply }
  }
  const dump = (native: InstanceType<typeof NativeDatabase>) => JSON.stringify(native.prepare("SELECT * FROM policy_version ORDER BY id").all()) + JSON.stringify(native.prepare("SELECT id, policy_id, version_id, action, actor, summary, created_at FROM policy_change_log ORDER BY rowid").all())
  const kinds = (native: InstanceType<typeof NativeDatabase>) => Object.fromEntries((native.prepare("SELECT id, supersedes_relation_kind AS s, superseded_by_relation_kind AS b, supersede_switch_at AS sw FROM policy_record").all() as { id: string, s: string | null, b: string | null, sw: string | null }[]).map(r => [r.id, r]))
  // Repeals legacy Q from post-v18 code: Q's correct inbound kind is 'repealed' while its legacy field still says 'revised'.
  const repealQ = async (repo: PolicyRepository) => await repo.create({ ...official({ status: "effective", effectiveAt: "2026-10-10", title: "[FIXTURE] new R repeals Q" }), supersedesPolicyId: "policy:Q", relation: "repealed" }, T0)

  it("(1) pure v17 mixed chain -> latest", async () => {
    const { native, database, repo } = await legacyDb(17)
    const before = dump(native)
    await initShippingTables(database, "real")
    expect((await readDatabaseMetadata(database)).schemaVersion).toBe(31)
    const k = kinds(native)
    expect(k["policy:A"]).toMatchObject({ s: null, b: "revised", sw: null })
    expect(k["policy:B"]).toMatchObject({ s: "revised", b: "repealed", sw: null })
    expect(k["policy:C"]).toMatchObject({ s: "repealed", b: null })
    expect(k["policy:Q"]).toMatchObject({ s: "revised", b: null })
    expect(dump(native)).toBe(before)
    const rowB = policyCsv(await repo.list({}, T0)).split("\r\n").find(l => l.includes("legacy B"))!
    expect(rowB).toContain("修订 policy:A")
    expect(rowB).toContain("已被 policy:C 废止")
    native.close()
  })

  it("(2) v18 adds a different-type relation on a legacy record, then upgrade: 019/020 keep the post-v18 kind", async () => {
    const { native, database, repo } = await legacyDb(18)
    const r = await repealQ(repo)
    const before = dump(native)
    await initShippingTables(database, "real")
    const k = kinds(native)
    expect(k["policy:Q"]).toMatchObject({ s: "revised", b: "repealed", sw: "2026-10-10" })
    expect(k[r.id]).toMatchObject({ s: "repealed" })
    expect(dump(native)).toBe(before)
    const q = (await repo.detail("policy:Q", T0))!
    expect(q.record).toMatchObject({ supersedesRelationKind: "revised", supersededByPolicyId: r.id, supersededByRelationKind: "repealed", supersedeSwitchAt: "2026-10-10", supersedeSwitchTimezone: "Asia/Ho_Chi_Minh", supersedeSwitched: true, displayStatus: "repealed" })
    const rowQ = policyCsv(await repo.list({}, T0)).split("\r\n").find(l => l.includes("legacy Q"))!
    expect(rowQ).toContain("修订 policy:P")
    expect(rowQ).toContain(`已被 ${r.id} 废止`)
    native.close()
  })

  it("(3) records already damaged by 019 are recovered by 020 from linked record, else change log, else unknown", async () => {
    const { native, database, repo, apply } = await legacyDb(18)
    const r = await repealQ(repo)
    // Second legacy pair for the change-log and unknown paths.
    native.prepare("UPDATE policy_record SET relation_kind = 'revised' WHERE id = 'policy:D'").run()
    const s1 = await repo.create({ ...official({ status: "effective", effectiveAt: "2026-10-10", title: "[FIXTURE] new S1 repeals C" }), supersedesPolicyId: "policy:C", relation: "repealed" }, T0)
    const s2 = await repo.create({ ...official({ status: "effective", effectiveAt: "2026-10-10", title: "[FIXTURE] new S2 repeals D" }), supersedesPolicyId: "policy:D", relation: "repealed" }, T0)
    await apply(19, 19)
    const damaged = kinds(native)
    expect(damaged["policy:Q"].b).toBe("revised") // reproduces the 019 overwrite
    expect(damaged["policy:C"].b).toBe("repealed") // legacy 'repealed' happens to match
    expect(damaged["policy:D"]).toMatchObject({ s: "unknown", b: "revised" })
    // Break the successor link for C (forces change-log path) and remove both link and log for D (forces unknown).
    native.prepare("UPDATE policy_record SET supersedes_relation_kind = NULL WHERE id = ?").run(s1.id)
    native.prepare("UPDATE policy_record SET superseded_by_relation_kind = 'revised' WHERE id = 'policy:C'").run()
    native.prepare("UPDATE policy_record SET supersedes_relation_kind = NULL WHERE id = ?").run(s2.id)
    native.prepare("DELETE FROM policy_change_log WHERE policy_id = 'policy:D' AND action = 'repeal_scheduled'").run()
    const before = dump(native)
    await initShippingTables(database, "real") // runs only 020
    expect((await readDatabaseMetadata(database)).schemaVersion).toBe(31)
    const k = kinds(native)
    expect(k["policy:Q"]).toMatchObject({ b: "repealed", sw: "2026-10-10", s: "revised" }) // from successor link
    expect(k["policy:C"]).toMatchObject({ b: "repealed", sw: "2026-10-10" }) // from change log
    expect(k["policy:D"]).toMatchObject({ b: "unknown", s: "unknown", sw: "2026-10-10" }) // no evidence
    expect(k["policy:A"]).toMatchObject({ b: "revised", sw: null }) // pure legacy untouched
    expect(k[r.id].s).toBe("repealed")
    expect(dump(native)).toBe(before)
    const d = (await repo.detail("policy:D", T0))!.record
    expect(d).toMatchObject({ supersededByRelationKind: "unknown", supersedesRelationKind: "unknown" })
    const csv = policyCsv(await repo.list({}, T0))
    expect(csv.split("\r\n").find(l => l.includes("legacy Q"))).toContain(`已被 ${r.id} 废止`)
    expect(csv.split("\r\n").find(l => l.includes("legacy D"))).toContain("关系类型未知")
    native.close()
  })

  it("(4) missing predecessor stays unknown through every path", async () => {
    for (const upTo of [17, 18, 19]) {
      const { native, database, repo } = await legacyDb(upTo)
      await initShippingTables(database, "real")
      expect(kinds(native)["policy:D"]).toMatchObject({ s: "unknown", b: null })
      expect((await repo.detail("policy:D", T0))!.record.supersedesRelationKind).toBe("unknown")
      native.close()
    }
  })
})
