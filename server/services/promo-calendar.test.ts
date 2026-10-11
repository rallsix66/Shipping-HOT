import NativeDatabase from "better-sqlite3"
import { createDatabase } from "db0"
import { describe, expect, it } from "vitest"
import { isCivilDate, promoStatusLabel } from "@shared/promo-calendar"
import { generatePromoCandidates, promoCandidateId } from "./promo-calendar"
import { PromoCalendarRepository, validatePromoFields } from "#/database/promo-calendar"
import { initShippingTables } from "#/database/shipping"
import { readDatabaseMetadata } from "#/database/runtime"

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

const NOW = "2026-10-11T04:00:00.000Z"
const LATER = "2026-10-12T04:00:00.000Z"

describe("r1.5-5 rule generator (catalog §9)", () => {
  const { candidates, gaps } = generatePromoCandidates(2026)
  const by = (rule: string) => candidates.filter(c => c.ruleId === rule)

  it("applies each rule only to its catalog countries/platforms", () => {
    expect(by("E-R01")).toHaveLength(12 * 5 * 3)
    expect(by("E-R03")).toHaveLength(12 * 5 * 3)
    expect(by("E-R02")).toHaveLength(12 * 5 * 2)
    expect(new Set(by("E-R02").map(c => c.platform))).toEqual(new Set(["shopee", "lazada"]))
    expect(new Set(by("E-R01").map(c => c.countryCode))).toEqual(new Set(["VN", "TH", "MY", "ID", "PH"]))
    expect(by("E-R05")).toEqual([expect.objectContaining({ countryCode: "ID", platform: "unspecified", startsAt: "2026-12-10", endsAt: "2026-12-16", basisKind: "catalog_source" })])
    expect(new Set(by("E-R04").map(c => c.countryCode))).toEqual(new Set(["ID", "MY"]))
    expect(by("E-R04").every(c => c.windowStatus === "pending" && c.platform === "unspecified")).toBe(true)
    expect(by("E-R06").map(c => `${c.countryCode}:${c.occurrence}`).sort()).toEqual(["ID:christmas", "MY:christmas", "PH:christmas", "TH:songkran", "VN:tet"])
    expect(by("E-R06").every(c => c.windowStatus === "pending")).toBe(true)
    expect(candidates.every(c => validatePromoFields(c) === null)).toBe(true)
  })

  it("e-R01 window -7/+3 crosses the year boundary; E-R04/E-R06 never get the -7/+3 window", () => {
    const jan = by("E-R01").find(c => c.occurrence === "m01" && c.countryCode === "VN" && c.platform === "shopee")!
    expect([jan.startsAt, jan.endsAt]).toEqual(["2025-12-25", "2026-01-04"])
    const dec = by("E-R01").find(c => c.occurrence === "m12")!
    expect([dec.startsAt, dec.endsAt]).toEqual(["2026-12-05", "2026-12-15"])
    const eid = by("E-R04").find(c => c.countryCode === "ID")!
    expect([eid.startsAt, eid.endsAt]).toEqual(["2026-03-21", "2026-03-22"])
    const tet = by("E-R06").find(c => c.occurrence === "tet")!
    expect([tet.startsAt, tet.endsAt]).toEqual(["2026-02-16", "2026-02-20"])
  })

  it("e-R03 runs to the real month end, including leap February", () => {
    const feb2026 = by("E-R03").find(c => c.occurrence === "m02")!
    expect(feb2026.endsAt).toBe("2026-02-28")
    const feb2028 = generatePromoCandidates(2028, []).candidates.find(c => c.ruleId === "E-R03" && c.occurrence === "m02")!
    expect(feb2028.endsAt).toBe("2028-02-29")
    expect(by("E-R03").find(c => c.occurrence === "m04")!.endsAt).toBe("2026-04-30")
  })

  it("other years: no E-R05 extrapolation; E-R04/E-R06 without reliable holiday data are 待定 gaps", () => {
    const y2027 = generatePromoCandidates(2027)
    expect(y2027.candidates.some(c => ["E-R04", "E-R05", "E-R06"].includes(c.ruleId))).toBe(false)
    expect(y2027.gaps.map(g => g.ruleId)).toEqual(expect.arrayContaining(["E-R04", "E-R05", "E-R06"]))
    expect(y2027.gaps.every(g => /待定/.test(g.reasonZh))).toBe(true)
    expect(gaps.some(g => g.ruleId === "E-R04" && /斋月起止/.test(g.reasonZh))).toBe(true)
  })

  it("strict date validation", () => {
    for (const bad of ["2026-02-30", "2026-13-01", "2026-2-1", "2026-02-29", "", "2026-04-31"]) expect(isCivilDate(bad)).toBe(false)
    expect(isCivilDate("2028-02-29")).toBe(true)
    expect(validatePromoFields({ countryCode: "VN", platform: "shopee", startsAt: "2026-03-05", endsAt: "2026-03-01" })).toBe("start_after_end")
    expect(validatePromoFields({ countryCode: "CN", platform: "shopee", startsAt: "2026-03-01", endsAt: "2026-03-01" })).toBe("invalid_country")
    expect(validatePromoFields({ countryCode: "VN", platform: "amazon", startsAt: "2026-03-01", endsAt: "2026-03-01" })).toBe("invalid_platform")
    expect(() => generatePromoCandidates(1.5)).toThrow(/invalid_year/)
  })
})

describe("r1.5-5 persistence, regeneration and confirmation", () => {
  async function setup() {
    const { native, database } = memoryDb()
    await initShippingTables(database, "real")
    return { native, database, repo: new PromoCalendarRepository(database) }
  }

  it("migration 016 adds platform/confirmation columns; legacy rows read as 未指定 and never confirmed without evidence", async () => {
    const { native, database, repo } = await setup()
    expect((await readDatabaseMetadata(database)).schemaVersion).toBe(16)
    native.prepare("INSERT INTO ops_calendar_event (id, country_code, title, starts_at, ends_at, category, basis_kind, basis_ref, confirmation_status, rule_id, notes, created_at, updated_at) VALUES ('legacy-1','VN','旧记录','2026-05-05',NULL,'promo','manual',NULL,'confirmed',NULL,NULL,?,?)").run(NOW, NOW)
    native.prepare("INSERT INTO ops_calendar_event (id, country_code, title, starts_at, ends_at, category, basis_kind, basis_ref, confirmation_status, rule_id, notes, created_at, updated_at, platform) VALUES ('bad-1','VN','坏日期','2026-02-30','2026-02-30','promo','manual',NULL,'confirmed',NULL,NULL,?,?,'amazon')").run(NOW, NOW)
    const legacy = await repo.get("legacy-1")
    expect(legacy).toMatchObject({ platform: "unspecified", entryKind: "legacy", confirmationStatus: "pending", dataIssue: "confirmed_without_evidence", endsAt: "2026-05-05" })
    expect(promoStatusLabel(legacy!)).not.toMatch(/已.*确认/)
    const bad = await repo.get("bad-1")
    expect(bad).toMatchObject({ confirmationStatus: "pending", dataIssue: "invalid_date", platform: "unspecified" })
    native.close()
  })

  it("repeat generation is idempotent; same date carries one row per platform", async () => {
    const { native, repo } = await setup()
    const { candidates } = generatePromoCandidates(2026)
    const first = await repo.upsertGenerated(candidates, NOW)
    expect(first).toMatchObject({ created: candidates.length, updated: 0, rejected: 0 })
    const second = await repo.upsertGenerated(candidates, LATER)
    expect(second).toMatchObject({ created: 0, unchanged: candidates.length })
    const day = (await repo.listForYear(2026)).filter(e => e.startsAt === "2026-03-15" && e.countryCode === "TH")
    expect(day.map(e => e.platform).sort()).toEqual(["lazada", "shopee"])
    expect(day.every(e => e.confirmationStatus === "pending" && promoStatusLabel(e) === "规则生成（待确认）")).toBe(true)
    const jan = await repo.listForYear(2025)
    expect(jan.some(e => e.id === promoCandidateId("E-R01", 2026, "VN", "shopee", "m01"))).toBe(true)
    native.close()
  })

  it("confirmation requires matching country/platform and applicable HTTPS evidence; regenerate after confirm keeps it", async () => {
    const { native, repo } = await setup()
    await repo.upsertGenerated(generatePromoCandidates(2026).candidates, NOW)
    const id = promoCandidateId("E-R01", 2026, "VN", "shopee", "m11")
    const base = { id, countryCode: "VN", platform: "shopee" }
    await expect(repo.confirm({ ...base, evidenceSourceId: undefined, evidenceRef: undefined, confirmed: true } as never, NOW)).rejects.toMatchObject({ code: "evidence_source_required" })
    await expect(repo.confirm({ ...base, evidenceSourceId: "XX-E01", evidenceRef: "" }, NOW)).rejects.toMatchObject({ code: "evidence_ref_required" })
    await expect(repo.confirm({ ...base, evidenceSourceId: "XX-E01", evidenceRef: "http://shopee.vn/blog/11-11" }, NOW)).rejects.toMatchObject({ code: "evidence_ref_required" })
    await expect(repo.confirm({ ...base, countryCode: "TH", evidenceSourceId: "XX-E01", evidenceRef: "https://shopee.vn/blog/11-11" }, NOW)).rejects.toMatchObject({ code: "country_platform_mismatch" })
    await expect(repo.confirm({ ...base, platform: "lazada", evidenceSourceId: "XX-E01", evidenceRef: "https://shopee.vn/blog/11-11" }, NOW)).rejects.toMatchObject({ code: "country_platform_mismatch" })
    await expect(repo.confirm({ ...base, evidenceSourceId: "XX-E02", evidenceRef: "https://www.lazadasolutions.com/x" }, NOW)).rejects.toMatchObject({ code: "evidence_not_applicable" })
    await expect(repo.confirm({ ...base, evidenceSourceId: "XX-E01", evidenceRef: "https://evil.example.com/shopee.vn" }, NOW)).rejects.toMatchObject({ code: "evidence_host_mismatch" })
    await expect(repo.confirm({ ...base, id: "nope", evidenceSourceId: "XX-E01", evidenceRef: "https://shopee.vn/blog/11-11" }, NOW)).rejects.toMatchObject({ code: "promo_not_found" })
    const anchor = promoCandidateId("E-R04", 2026, "ID", "unspecified", "eid-anchor")
    await expect(repo.confirm({ id: anchor, countryCode: "ID", platform: "unspecified", evidenceSourceId: "manual_url", evidenceRef: "https://example.org/eid-sale" }, NOW)).rejects.toMatchObject({ code: "window_pending_not_confirmable" })
    expect((await repo.get(id))?.confirmationStatus).toBe("pending")
    const confirmed = await repo.confirm({ ...base, evidenceSourceId: "XX-E01", evidenceRef: "https://shopee.vn/blog/lich-sale-11-11", note: "博客日历" }, NOW)
    expect(confirmed).toMatchObject({ confirmationStatus: "confirmed", confirmation: { sourceId: "XX-E01", evidenceRef: "https://shopee.vn/blog/lich-sale-11-11" } })
    expect(confirmed.generationBasis).toMatch(/E-R01/)
    expect(promoStatusLabel(confirmed)).toBe("已由 XX-E01 确认")
    const regen = await repo.upsertGenerated(generatePromoCandidates(2026).candidates.map(c => c.id === id ? { ...c, title: "changed", generationBasis: "changed" } : c), LATER)
    expect(regen.protected).toBe(1)
    expect(await repo.get(id)).toMatchObject({ title: "11.11 双数日大促", confirmationStatus: "confirmed", generationBasis: confirmed.generationBasis })
    const harbolnas = await repo.confirm({ id: promoCandidateId("E-R05", 2026, "ID", "unspecified", "harbolnas"), countryCode: "ID", platform: "unspecified", evidenceSourceId: "XX-E06", evidenceRef: "https://harbolnas.com/" }, NOW)
    expect(harbolnas.confirmationStatus).toBe("confirmed")
    native.close()
  })

  it("manual edits and manual entries are never overwritten and stay distinguishable", async () => {
    const { native, repo } = await setup()
    await repo.upsertGenerated(generatePromoCandidates(2026).candidates, NOW)
    const id = promoCandidateId("E-R02", 2026, "PH", "lazada", "m06")
    await repo.editManually(id, { startsAt: "2026-06-14", endsAt: "2026-06-15" }, NOW)
    await expect(repo.editManually(id, { endsAt: "2026-06-10" }, NOW)).rejects.toMatchObject({ code: "start_after_end" })
    const regen = await repo.upsertGenerated(generatePromoCandidates(2026).candidates, LATER)
    expect(regen.protected).toBe(1)
    expect(await repo.get(id)).toMatchObject({ startsAt: "2026-06-14", endsAt: "2026-06-15" })
    const manual = await repo.insertManual({ countryCode: "MY", platform: "tiktok_shop", title: "人工录入活动", startsAt: "2026-08-08", endsAt: "2026-08-09" }, NOW)
    expect(manual).toMatchObject({ entryKind: "manual", confirmationStatus: "pending", ruleId: null })
    expect(promoStatusLabel(manual)).toBe("人工录入（待确认）")
    await expect(repo.insertManual({ countryCode: "MY", platform: "tiktok_shop", title: "x", startsAt: "2026-02-30", endsAt: "2026-03-01" }, NOW)).rejects.toMatchObject({ code: "invalid_date" })
    native.close()
  })
})
