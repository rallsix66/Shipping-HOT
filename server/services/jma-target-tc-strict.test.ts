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
