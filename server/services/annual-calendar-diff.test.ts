import { describe, expect, it } from "vitest"
import type { AnnualEvent, AnnualSource } from "@shared/annual-calendar"
import { diffAnnualDatasets, formatAnnualDiff, validateAnnualDataset } from "./annual-calendar-diff"

const source: AnnualSource = { id: "SRC-1", url: "https://example.gov/doc", officialInstitutions: ["Gov"], documentNumbers: ["No. 1"], evidenceStatus: "official_original_verified", publishedAt: "2026-01-01" }

function event(overrides: Partial<AnnualEvent> = {}): AnnualEvent {
  return {
    id: "MY-2026-01-01",
    countryCode: "MY",
    date: "2026-01-01",
    nameZh: "元旦",
    shortNameZh: "元旦",
    nameLocal: "New Year",
    type: "federal_public_holiday",
    geographicScope: "All states",
    subjectAndConditionsZh: "全国适用",
    sourceDocumentIds: ["SRC-1"],
    verificationStatus: "official_original_verified",
    notesZh: "",
    ...overrides,
  }
}

describe("annual calendar validator and diff", () => {
  it("accepts a valid dataset", () => {
    expect(validateAnnualDataset({ countryCode: "MY", year: 2026, sourceDocuments: [source], events: [event()] }, "MY", 2026)).toEqual([])
  })

  it("flags duplicate ids, duplicate facts, invalid dates, wrong year and broken source references", () => {
    const issues = validateAnnualDataset({
      countryCode: "MY",
      year: 2026,
      sourceDocuments: [source],
      events: [
        event(),
        event(),
        event({ id: "x2", date: "2026-13-40" }),
        event({ id: "x3", date: "2027-01-01" }),
        event({ id: "x4", sourceDocumentIds: ["MISSING"] }),
      ],
    }, "MY", 2026)
    expect(issues.some(i => i.includes("duplicate event id"))).toBe(true)
    expect(issues.some(i => i.includes("duplicate fact"))).toBe(true)
    expect(issues.some(i => i.includes("invalid date"))).toBe(true)
    expect(issues.some(i => i.includes("date outside year"))).toBe(true)
    expect(issues.some(i => i.includes("unknown sourceDocumentId"))).toBe(true)
  })

  it("diffs candidates by stable id and reports changed fields, not a whole-year rewrite", () => {
    const runtime = [event(), event({ id: "MY-2026-05-01", date: "2026-05-01", nameLocal: "Labour Day" })]
    const candidate = [
      event(),
      event({ id: "MY-2026-05-01", date: "2026-05-01", nameLocal: "Labour Day (revised)" }),
      event({ id: "MY-2026-08-31", date: "2026-08-31", nameLocal: "National Day" }),
    ]
    const result = diffAnnualDatasets(candidate, runtime)
    expect(result).toEqual({ added: ["MY-2026-08-31"], changed: ["MY-2026-05-01"], removed: [], unchanged: 1 })
    expect(formatAnnualDiff("MY-2026", result, [])).toContain("added=1 changed=1 removed=0 unchanged=1")
  })

  it("is idempotent: identical candidate and runtime produce no changes", () => {
    const runtime = [event(), event({ id: "MY-2026-05-01", date: "2026-05-01", nameLocal: "Labour Day" })]
    const result = diffAnnualDatasets(runtime, runtime)
    expect(result).toEqual({ added: [], changed: [], removed: [], unchanged: 2 })
  })
})
