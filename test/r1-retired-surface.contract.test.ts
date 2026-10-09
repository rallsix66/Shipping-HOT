import { spawnSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { describe, expect, it } from "vitest"

const repoRoot = resolve(process.cwd())

const R1_1_PATTERN = "aisstream|vesselapi|gfw|voyage|watchlist"

/** Same pattern/globs as docs/plans/r1-1-grep-exception-proposal.md; `-n` for line-accurate allowlist. */
export const R1_1_RG_ARGS = [
  "-n",
  "-i",
  R1_1_PATTERN,
  "src",
  "server",
  "--glob",
  "!server/database/migrations/**",
]

export interface RgRunResult {
  exitCode: number
  stdout: string
  stderr: string
}

/** Run ripgrep; never treat thrown exec as “zero matches”. */
export function runRg(args: string[], cwd = repoRoot): RgRunResult {
  const result = spawnSync("rg", args, { cwd, encoding: "utf8" })
  return {
    exitCode: result.status ?? (result.error ? 127 : 2),
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  }
}

export interface RgHit {
  file: string
  line: number
  content: string
}

export function normalizeRepoPath(file: string): string {
  return file.replace(/\\/g, "/")
}

/** Parse `path:line:rest` (rg default, no column when not used). */
export function parseRgLine(raw: string): RgHit | null {
  const trimmed = raw.trim()
  if (!trimmed) return null
  const match = trimmed.match(/^(.+?):(\d+):(.*)$/)
  if (!match) return null
  return {
    file: normalizeRepoPath(match[1]),
    line: Number(match[2]),
    content: match[3],
  }
}

/**
 * PROPOSED allowlist — exact relative path + full line body (trimmed).
 * docs/plans/r1-1-grep-exception-proposal.md
 */
export const R1_1_PROPOSED_ALLOWED_HITS: readonly RgHit[] = [
  { file: "server/middleware/retired-spa-routes.ts", line: 7, content: "    || pathname === \"/voyages\"" },
  { file: "server/middleware/retired-spa-routes.ts", line: 8, content: "    || pathname.startsWith(\"/voyages/\")" },
  { file: "server/middleware/retired-spa-routes.test.ts", line: 25, content: "    \"/voyages\"," },
  { file: "server/middleware/retired-spa-routes.test.ts", line: 26, content: "    \"/voyages/example-id\"," },
  { file: "server/shipping-store.read-only.test.ts", line: 126, content: "    expect(result).not.toHaveProperty(\"voyages\")" },
]

export function isProposedAllowedHit(hit: RgHit): boolean {
  const content = hit.content.trimEnd()
  return R1_1_PROPOSED_ALLOWED_HITS.some(
    allowed => allowed.file === hit.file && allowed.line === hit.line && allowed.content === content,
  )
}

/** src-only strict zero-match: exit 1, empty stdout; exit 0 / 2 / 127 = fail. */
export function assertStrictSrcZeroMatch(result: RgRunResult): void {
  if (result.exitCode === 0) {
    throw new Error(`expected rg exit 1 (no matches) but exit 0 with stdout:\n${result.stdout}\nstderr:\n${result.stderr}`)
  }
  if (result.exitCode !== 1) {
    throw new Error(`rg failed or unavailable (exit ${result.exitCode}); stderr:\n${result.stderr}\nstdout:\n${result.stdout}`)
  }
  if (result.stdout.trim() !== "") {
    throw new Error(`expected empty stdout on exit 1, got:\n${result.stdout}`)
  }
}

export function parseHits(stdout: string): RgHit[] {
  return stdout.split(/\r?\n/).map(parseRgLine).filter((hit): hit is RgHit => hit !== null)
}

export function classifyServerSrcScan(result: RgRunResult): { ok: true } | { ok: false, reason: string } {
  if (result.exitCode !== 0 && result.exitCode !== 1) {
    return { ok: false, reason: `rg exit ${result.exitCode}; stderr:\n${result.stderr}` }
  }
  if (result.exitCode === 1 && result.stdout.trim() === "") {
    return { ok: true }
  }
  if (result.exitCode === 1 && result.stdout.trim() !== "") {
    return { ok: false, reason: `rg exit 1 but stdout not empty:\n${result.stdout}` }
  }
  const rawLines = result.stdout.trim().split(/\r?\n/).filter(Boolean)
  const hits = parseHits(result.stdout)
  if (result.exitCode === 0 && hits.length !== rawLines.length) {
    return { ok: false, reason: `rg exit 0 but stdout lines are not path:line:body:\n${result.stdout}` }
  }
  const violations = hits.filter(hit => !isProposedAllowedHit(hit))
  if (violations.length) {
    return {
      ok: false,
      reason: `disallowed hits:\n${violations.map(v => `${v.file}:${v.line}:${v.content}`).join("\n")}`,
    }
  }
  return { ok: true }
}

describe("r1 retired surface contract", () => {
  it("r1-1 proposed allowlist: server+src scan hits only exact allowed lines", () => {
    const result = runRg([...R1_1_RG_ARGS])
    const verdict = classifyServerSrcScan(result)
    expect(verdict.ok, verdict.ok ? "" : verdict.reason).toBe(true)
    if (result.exitCode === 0) {
      const hits = parseHits(result.stdout)
      expect(hits.length).toBeGreaterThan(0)
      expect(hits.every(isProposedAllowedHit)).toBe(true)
    }
  })

  it("src/ strict scan: rg exit 1 and empty stdout", () => {
    const result = runRg(["-n", "-i", R1_1_PATTERN, "src"])
    expect(() => assertStrictSrcZeroMatch(result)).not.toThrow()
  })

  it("src strict: exit 0 with matches must fail (regression)", () => {
    expect(() => assertStrictSrcZeroMatch({ exitCode: 0, stdout: "src/foo.tsx:1:const voyage = 1\n", stderr: "" })).toThrow(/exit 0/)
  })

  it("src strict: rg tool failure must not pass as zero matches (regression)", () => {
    const result = runRg(["--totally-invalid-rg-flag-r1"])
    expect(result.exitCode).not.toBe(1)
    expect(() => assertStrictSrcZeroMatch(result)).toThrow(/exit/)
  })

  it("allowlist rejects provider/runtime keyword on same file (counterexample)", () => {
    const fakeHit: RgHit = {
      file: "server/middleware/retired-spa-routes.ts",
      line: 99,
      content: "const provider = process.env.VESSELAPI_API_KEY",
    }
    expect(isProposedAllowedHit(fakeHit)).toBe(false)
  })

  it("allowlist rejects substring-only match on allowed file (counterexample)", () => {
    const fakeHit: RgHit = {
      file: "server/middleware/retired-spa-routes.test.ts",
      line: 25,
      content: "    \"/voyages\", // aisstream hook",
    }
    expect(isProposedAllowedHit(fakeHit)).toBe(false)
  })

  it("allowlist rejects wrong line with correct text snippet (counterexample)", () => {
    const fakeHit: RgHit = {
      file: "server/shipping-store.read-only.test.ts",
      line: 125,
      content: "    expect(result).not.toHaveProperty(\"voyages\")",
    }
    expect(isProposedAllowedHit(fakeHit)).toBe(false)
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
