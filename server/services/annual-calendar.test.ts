import { describe, expect, it, vi } from "vitest"
import { annualEventScope, annualMonthDays, annualSourceLabel, annualSourcePublishedLabel, annualTypes } from "@shared/annual-calendar"
import { getAnnualCalendar } from "./annual-calendar"

describe("annual reference calendar", () => {
  it("serves five isolated datasets without network and returns detached copies", () => {
    const fetch = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network forbidden"))
    try {
      const data = getAnnualCalendar(2026)
      expect(data.datasets.map(d => d.events.length)).toEqual([25, 23, 15, 21, 16])
      expect(data.datasets.flatMap(d => d.events)).toHaveLength(100)
      expect(fetch).not.toHaveBeenCalled()
      data.datasets[0].events.length = 0
      expect(getAnnualCalendar(2026).datasets[0].events).toHaveLength(25)
      expect(getAnnualCalendar(2027).datasets).toEqual([])
    } finally {
      fetch.mockRestore()
    }
  })
  it("validates every date, type, identity and source link", () => {
    const ids = new Set<string>()
    for (const dataset of getAnnualCalendar(2026).datasets) {
      const sources = new Set(dataset.sourceDocuments.map(s => s.id))
      expect(sources.size).toBe(dataset.sourceDocuments.length)
      for (const event of dataset.events) {
        expect(ids.has(event.id)).toBe(false)
        ids.add(event.id)
        expect(event.countryCode).toBe(dataset.countryCode)
        expect(new Date(`${event.date}T00:00:00Z`).toISOString().slice(0, 10)).toBe(event.date)
        expect(event.date.startsWith("2026-")).toBe(true)
        expect(annualTypes[event.type]).toBeDefined()
        expect(event.sourceDocumentIds.length).toBeGreaterThan(0)
        expect(event.sourceDocumentIds.every(s => sources.has(s))).toBe(true)
      }
      expect(dataset.sourceDocuments.every(s => new URL(s.url).protocol === "https:")).toBe(true)
    }
  })
  it("keeps applicability, incomplete coverage and non-holidays explicit", () => {
    const data = getAnnualCalendar(2026).datasets
    const thailand = data.find(d => d.countryCode === "TH")!
    expect(thailand.warning).toContain("23 条参考事项，全国主依据仍待核验")
    expect(thailand.events.map(event => event.date)).toEqual(expect.arrayContaining(["2026-05-31", "2026-06-01", "2026-12-05", "2026-12-07"]))
    expect(thailand.events.find(event => event.date === "2026-06-01")?.type).toBe("government_office_substitute_holiday")
    expect(thailand.events.find(event => event.date === "2026-05-31")?.holidaySubtype).toBe("weekend_original")
    expect(thailand.events.find(event => event.date === "2026-10-16")?.geographicScope).toContain("Bangkok only")
    expect(thailand.events.some(event => event.verificationStatus.includes("primary_pending"))).toBe(true)
    expect(annualTypes.government_office_substitute_holiday.label).toBe("政府机关补休")
    const soc = thailand.sourceDocuments.find(source => source.id === "TH-SOC-HOLIDAYS-2569")!
    expect(soc.publishedAt).toBeNull()
    expect(annualSourceLabel(soc)).toBe("待核验入口")
    expect(annualSourcePublishedLabel(soc)).toBe("发布日期未知")
    const substitute = data.find(d => d.countryCode === "VN")?.events.find(e => e.date === "2026-04-27")
    expect(substitute?.type).toBe("conditional_substitute_day")
    expect(substitute?.subjectAndConditionsZh).toContain("周休日重合")
    expect(annualTypes.special_working_day.work).toBe(true)
    expect(annualTypes.civil_service_makeup_workday.work).toBe(true)
    const deepavali = data.find(d => d.countryCode === "MY")!.events.find(e => e.date === "2026-11-08")!
    expect(annualEventScope(deepavali)).toBe("不含砂拉越")
  })
  it("exposes 2026 and 2027 as selectable years with formal datasets and lightweight country-year statuses", () => {
    const asked2026 = getAnnualCalendar(2026)
    expect(asked2026.availableYears).toEqual([2026, 2027])
    expect(asked2026.datasets).toHaveLength(5)
    expect(asked2026.statuses.every(status => status.status === "available")).toBe(true)

    const asked2027 = getAnnualCalendar(2027)
    expect(asked2027.datasets).toEqual([])
    const byCountry = new Map(asked2027.statuses.map(status => [status.countryCode, status.status]))
    expect(byCountry).toEqual(new Map([
      ["ID", "not_published"],
      ["TH", "sector_evidence_only"],
      ["MY", "published_not_imported"],
      ["PH", "not_published"],
      ["VN", "proposal_not_effective"],
    ]))
    expect(asked2027.statuses.every(status => status.detailZh.length > 0)).toBe(true)
  })

  it("constructs Monday-first grids without timezone offsets including leap years", () => {
    expect(annualMonthDays(2026, 1)[0].date).toBe("2026-01-26")
    expect(annualMonthDays(2026, 1).filter(d => !d.outside)).toHaveLength(28)
    expect(annualMonthDays(2028, 1).filter(d => !d.outside)).toHaveLength(29)
    expect(annualMonthDays(2026, 11).some(d => d.date === "2027-01-01")).toBe(true)
  })
})
