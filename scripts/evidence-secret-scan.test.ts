import { spawnSync } from "node:child_process"
import { describe, expect, it } from "vitest"

const script = "scripts/evidence-secret-scan.mjs"

describe("evidence-secret-scan", () => {
  it("synthetic positive control: detects quoted/escaped JSON, suffixed field names and multiple values per line, then redacts all", () => {
    const r = spawnSync(process.execPath, [script, "--self-test"], { encoding: "utf8" })
    expect(r.stdout).toContain("result=PASS")
    expect(r.status).toBe(0)
  })

  it("promo research archive has no residual key-shaped values after redaction", () => {
    const r = spawnSync(process.execPath, [script, "docs/evidence/r1-5-promo-research-2026-10-12"], { encoding: "utf8" })
    expect(r.stdout).toContain("total_hits=0")
    expect(r.status).toBe(0)
  })
})
