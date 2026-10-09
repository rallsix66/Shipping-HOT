import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import {
  R1MigrationCopyPathError,
  R1_MIGRATION_DB_RELATIVE,
  resolveAllowedCopyDatabasePath,
  shippingRepoRoot,
} from "./r1-migration-copy-guard"

const repoRoot = shippingRepoRoot()
const fixtureRoot = join(repoRoot, ".tmp", "r1-migration-guard-fixture")

function touchDb(dir: string) {
  mkdirSync(join(dir, ".data"), { recursive: true })
  writeFileSync(join(dir, R1_MIGRATION_DB_RELATIVE), "sqlite-placeholder")
}

afterEach(() => {
  if (existsSync(fixtureRoot)) rmSync(fixtureRoot, { recursive: true, force: true })
})

describe("r1 migration copy path guard", () => {
  it("accepts an isolated copy under .tmp", () => {
    const allowed = join(fixtureRoot, "allowed-copy")
    touchDb(allowed)
    const resolved = resolveAllowedCopyDatabasePath(allowed, repoRoot)
    expect(resolved.dbPath).toContain("r1-migration-guard-fixture")
    expect(resolved.dbPath.endsWith("shipping-hot-v3.sqlite3")).toBe(true)
  })

  it("rejects the repository root", () => {
    expect(() => resolveAllowedCopyDatabasePath(repoRoot, repoRoot)).toThrow(R1MigrationCopyPathError)
  })

  it("rejects paths outside .tmp", () => {
    const outside = resolve(repoRoot, "..", "r1-migration-outside-tmp")
    mkdirSync(outside, { recursive: true })
    touchDb(outside)
    try {
      expect(() => resolveAllowedCopyDatabasePath(outside, repoRoot)).toThrow(R1MigrationCopyPathError)
    } finally {
      rmSync(outside, { recursive: true, force: true })
    }
  })

  it("rejects a missing database file", () => {
    const emptyDir = join(fixtureRoot, "no-db")
    mkdirSync(emptyDir, { recursive: true })
    expect(() => resolveAllowedCopyDatabasePath(emptyDir, repoRoot)).toThrow(/missing database copy/)
  })
})
