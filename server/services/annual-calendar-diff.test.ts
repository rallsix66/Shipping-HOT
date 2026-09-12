import { describe, expect, it } from "vitest"
import type { AnnualEvent, AnnualSource } from "@shared/annual-calendar"
import { diffAnnualDatasets, formatAnnualDiff, validateAnnualDataset } from "./annual-calendar-diff"

const source: AnnualSource = { id: "SRC-1", url: "https://example.gov/doc", officialInstitutions: ["Gov"], documentNumbers: ["No. 1"], evidenceStatus: "official_original_verified", publishedAt: "2026-01-01" }
const source2: AnnualSource = { id: "SRC-2", url: "https://gov.example/mirror", officialInstitutions: ["Gov"], documentNumbers: ["No. 2"], evidenceStatus: "legal_text_mirror", publishedAt: "2026-01-02" }

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
    notesZh: "note",
    ...overrides,
  }
}

describe("annual calendar validator and diff", () => {
  it("accepts a valid dataset and flags structural problems", () => {
    expect(validateAnnualDataset({ countryCode: "MY", year: 2026, sourceDocuments: [source], events: [event()] }, "MY", 2026)).toEqual([])
    const issues = validateAnnualDataset({
      countryCode: "MY",
      year: 2026,
      sourceDocuments: [source],
      events: [event(), event(), event({ id: "x2", date: "2026-13-40" }), event({ id: "x3", date: "2027-01-01" }), event({ id: "x4", sourceDocumentIds: ["MISSING"] })],
    }, "MY", 2026)
    expect(issues.some(i => i.includes("duplicate event id"))).toBe(true)
    expect(issues.some(i => i.includes("duplicate fact"))).toBe(true)
    expect(issues.some(i => i.includes("invalid date"))).toBe(true)
    expect(issues.some(i => i.includes("date outside year"))).toBe(true)
    expect(issues.some(i => i.includes("unknown sourceDocumentId"))).toBe(true)
  })

  it("detects an evidence-reference change but not a reorder of sourceDocumentIds", () => {
    const runtime = { events: [event({ sourceDocumentIds: ["SRC-1", "SRC-2"] })], sourceDocuments: [source, source2] }
    const reordered = diffAnnualDatasets({ events: [event({ sourceDocumentIds: ["SRC-2", "SRC-1"] })], sourceDocuments: [source, source2] }, runtime)
    expect(reordered).toEqual({ added: [], changed: [], removed: [], unchanged: 1, evidenceChanged: [], notesOnly: [], sources: { added: [], changed: [], removed: [] } })

    const changedRefs = diffAnnualDatasets({ events: [event({ sourceDocumentIds: ["SRC-1"] })], sourceDocuments: [source, source2] }, runtime)
    expect(changedRefs.evidenceChanged).toEqual(["MY-2026-01-01"])
    expect(changedRefs.changed).toEqual([])
    expect(changedRefs.unchanged).toBe(0)
  })

  it("reports source-document url/evidenceStatus changes and notes-only changes separately", () => {
    const runtime = { events: [event()], sourceDocuments: [source] }
    const upgradedSource = { ...source, url: "https://pco.gov.ph/proc-1006", evidenceStatus: "official_government_published" }
    const result = diffAnnualDatasets({ events: [event({ notesZh: "updated note" })], sourceDocuments: [upgradedSource] }, runtime)
    expect(result.sources.changed).toEqual(["SRC-1"])
    expect(result.changed).toEqual(["MY-2026-01-01"])
    expect(result.notesOnly).toEqual(["MY-2026-01-01"])
  })

  it("is idempotent: identical input produces no diff, and reports a pure fact change", () => {
    const runtime = { events: [event()], sourceDocuments: [source] }
    expect(diffAnnualDatasets(runtime, runtime)).toEqual({ added: [], changed: [], removed: [], unchanged: 1, evidenceChanged: [], notesOnly: [], sources: { added: [], changed: [], removed: [] } })

    const factChange = diffAnnualDatasets({ events: [event({ date: "2026-01-02" })], sourceDocuments: [source] }, runtime)
    expect(factChange.changed).toEqual(["MY-2026-01-01"])
    expect(factChange.notesOnly).toEqual([])
    expect(formatAnnualDiff("MY-2026", factChange, []).includes("sources added=0 changed=0 removed=0")).toBe(true)
  })
})
