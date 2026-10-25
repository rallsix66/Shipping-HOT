import { describe, expect, it } from "vitest"
import { parseJmaTargetTcListStrict } from "#/services/jma-typhoon-parse"

describe("jma targetTc strict parse", () => {
  it("only empty array is ok_empty", () => {
    expect(parseJmaTargetTcListStrict([])).toEqual({ status: "empty" })
  })

  it("rejects non-empty all-invalid array", () => {
    const result = parseJmaTargetTcListStrict([{ bad: true }, null])
    expect(result.status).toBe("list_invalid")
  })

  it("accepts list entries that already carry an explicit issue offset", () => {
    const result = parseJmaTargetTcListStrict([
      { tropicalCyclone: "TC0001", typhoonNumber: "0001", category: "STS", issue: "2026-10-25T16:05:00+09:00" },
      { tropicalCyclone: "TC0002", typhoonNumber: "0002", category: "TS", issue: "2026-10-25T15:45:00+09:00" },
    ])
    expect(result).toMatchObject({ status: "ok" })
    if (result.status === "ok") {
      expect(result.entries.map(entry => entry.issue)).toEqual([
        "2026-10-25T16:05:00+09:00",
        "2026-10-25T15:45:00+09:00",
      ])
    }
  })

  it("reports mixed valid and invalid elements", () => {
    const result = parseJmaTargetTcListStrict([
      { tropicalCyclone: "TC1" },
      { nope: true },
    ])
    expect(result).toMatchObject({ status: "mixed", invalidCount: 1 })
    if (result.status === "mixed") {
      expect(result.entries).toHaveLength(1)
    }
  })
})
