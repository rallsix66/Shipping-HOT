import { execSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { describe, expect, it } from "vitest"

const repoRoot = resolve(process.cwd())

/** R1-1: same ripgrep contract as acceptance (do not split keywords to force zero). */
const R1_1_RG_COMMAND = `rg -i "aisstream|vesselapi|gfw|voyage|watchlist" src server --glob "!server/database/migrations/**"`

const R1_1_ALLOWED_PATH_SUFFIXES = [
  "server/database/migrations/",
  "docs/archive/vessel-capability-recovery.md",
  "server/middleware/retired-spa-routes.ts",
  "server/middleware/retired-spa-routes.test.ts",
  "server/shipping-store.read-only.test.ts",
]

function normalizePath(file: string): string {
  return file.replace(/\\/g, "/")
}

describe("r1 retired surface contract", () => {
  it("r1-1 ripgrep scan has no disallowed matches in src/ and server/", () => {
    let output = ""
    let exitCode = 0
    try {
      output = execSync(R1_1_RG_COMMAND, { cwd: repoRoot, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })
    } catch (error) {
      const failed = error as { status?: number, stdout?: string, stderr?: string }
      exitCode = failed.status ?? 1
      output = [failed.stdout ?? "", failed.stderr ?? ""].filter(Boolean).join("\n")
    }
    const lines = output.split(/\r?\n/).map(line => line.trim()).filter(Boolean)
    if (exitCode !== 0 && exitCode !== 1) {
      throw new Error(`R1-1 rg failed (${exitCode}):\n${output}`)
    }
    const violations = lines.filter((line) => {
      const pathPart = line.split(":")[0] ?? line
      const normalized = normalizePath(pathPart)
      return !R1_1_ALLOWED_PATH_SUFFIXES.some(suffix => normalized.includes(suffix))
    })
    expect(violations, `R1-1 grep violations:\n${violations.join("\n")}\ncommand: ${R1_1_RG_COMMAND}`).toEqual([])
  })

  it("generated client route tree excludes vessel and voyage routes", () => {
    const routeTree = readFileSync(join(repoRoot, "src", "routeTree.gen.ts"), "utf8")
    expect(routeTree).not.toMatch(/['"]\/vessels['"]/)
    expect(routeTree).not.toMatch(/['"]\/voyages['"]/)
  })

  it("port-only shipping snapshot type excludes retired vessel and voyage collections", () => {
    const shippingTypes = readFileSync(join(repoRoot, "shared", "shipping.ts"), "utf8")
    expect(shippingTypes).not.toMatch(/\bvessels\s*:/)
    expect(shippingTypes).not.toMatch(/\bvoyages\s*:/)
  })
})
