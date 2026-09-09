import { describe, expect, it, vi } from "vitest"
import { annualEventScope, annualMonthDays, annualTypes } from "@shared/annual-calendar"
import { getAnnualCalendar } from "./annual-calendar"

describe("annual reference calendar", () => {
  it("serves five isolated datasets without network and returns detached copies", () => {
    const fetch = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network forbidden"))
    try {
      const data = getAnnualCalendar(2026)
      expect(data.datasets.map(d => d.events.length)).toEqual([25, 3, 15, 21, 16])
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
    expect(data.find(d => d.countryCode === "TH")?.warning).toContain("资料不完整")
    const substitute = data.find(d => d.countryCode === "VN")?.events.find(e => e.date === "2026-04-27")
    expect(substitute?.type).toBe("conditional_substitute_day")
    expect(substitute?.subjectAndConditionsZh).toContain("周休日重合")
    expect(annualTypes.special_working_day.work).toBe(true)
    expect(annualTypes.civil_service_makeup_workday.work).toBe(true)
    const deepavali = data.find(d => d.countryCode === "MY")!.events.find(e => e.date === "2026-11-08")!
    expect(annualEventScope(deepavali)).toBe("不含砂拉越")
  })
  it("constructs Monday-first grids without timezone offsets including leap years", () => {
    expect(annualMonthDays(2026, 1)[0].date).toBe("2026-01-26")
    expect(annualMonthDays(2026, 1).filter(d => !d.outside)).toHaveLength(28)
    expect(annualMonthDays(2028, 1).filter(d => !d.outside)).toHaveLength(29)
    expect(annualMonthDays(2026, 11).some(d => d.date === "2027-01-01")).toBe(true)
  })
})
