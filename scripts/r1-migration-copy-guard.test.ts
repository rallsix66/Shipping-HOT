import {
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs"
import { join } from "node:path"
import process from "node:process"
import { afterEach, beforeAll, describe, expect, it } from "vitest"
import {
  R1MigrationCopyPathError,
  R1_MIGRATION_DB_RELATIVE,
  resolveAllowedCopyDatabasePath,
  resolveDatabaseFileIdentity,
  shippingRepoRoot,
} from "./r1-migration-copy-guard"

const realRepoRoot = shippingRepoRoot()

/** Exclusive fixture tree under real repo `.tmp` only; never touches retained DB or fixed paths outside. */
interface FakeRepoFixture {
  root: string
  fakeRepo: string
  retainedDb: string
  isolatedRoot: string
}

let symlinkProbe: "supported" | "unsupported" = "unsupported"

beforeAll(() => {
  const probeParent = mkdtempSync(join(realRepoRoot, ".tmp", "r1-guard-probe-"))
  try {
    const target = join(probeParent, "target")
    writeFileSync(target, "probe")
    symlinkSync(target, join(probeParent, "link"))
    symlinkProbe = "supported"
  } catch {
    symlinkProbe = "unsupported"
  } finally {
    if (existsSync(probeParent)) rmSync(probeParent, { recursive: true, force: true })
  }
})

function createFakeRepoFixture(): FakeRepoFixture {
  const repoTmp = join(realRepoRoot, ".tmp")
  mkdirSync(repoTmp, { recursive: true })
  const root = mkdtempSync(join(repoTmp, "r1-guard-"))
  const fakeRepo = join(root, "fake-repo")
  const isolatedRoot = join(fakeRepo, ".tmp")
  mkdirSync(join(fakeRepo, ".data"), { recursive: true })
  mkdirSync(isolatedRoot, { recursive: true })
  const retainedDb = join(fakeRepo, R1_MIGRATION_DB_RELATIVE)
  writeFileSync(retainedDb, `retained-${Date.now()}`)
  return { root, fakeRepo, retainedDb, isolatedRoot }
}

function touchCopyDb(copyDir: string, body = "copy-db") {
  mkdirSync(join(copyDir, ".data"), { recursive: true })
  const dbPath = join(copyDir, R1_MIGRATION_DB_RELATIVE)
  writeFileSync(dbPath, body)
  return dbPath
}

const activeFixtures: FakeRepoFixture[] = []

function itSymlink(name: string, fn: () => void) {
  return (symlinkProbe === "supported" ? it : it.skip)(name, fn)
}

afterEach(() => {
  while (activeFixtures.length) {
    const fixture = activeFixtures.pop()
    if (fixture && existsSync(fixture.root)) rmSync(fixture.root, { recursive: true, force: true })
  }
})

function track(fixture: FakeRepoFixture) {
  activeFixtures.push(fixture)
  return fixture
}

describe("r1 migration copy path guard", () => {
  it("accepts an isolated copy under fake repo .tmp", () => {
    const fx = track(createFakeRepoFixture())
    const copyDir = join(fx.isolatedRoot, "allowed-copy")
    mkdirSync(copyDir, { recursive: true })
    touchCopyDb(copyDir)
    const resolved = resolveAllowedCopyDatabasePath(copyDir, fx.fakeRepo)
    expect(resolved.dbPath).toContain("allowed-copy")
    expect(resolved.dbPath.endsWith("shipping-hot-v3.sqlite3")).toBe(true)
  })

  it("rejects the fake repository root", () => {
    const fx = track(createFakeRepoFixture())
    expect(() => resolveAllowedCopyDatabasePath(fx.fakeRepo, fx.fakeRepo)).toThrow(R1MigrationCopyPathError)
  })

  it("rejects a copy directory outside fake repo .tmp but inside fake repo", () => {
    const fx = track(createFakeRepoFixture())
    const outsideTmp = join(fx.fakeRepo, "outside-tmp")
    mkdirSync(outsideTmp, { recursive: true })
    touchCopyDb(outsideTmp)
    expect(() => resolveAllowedCopyDatabasePath(outsideTmp, fx.fakeRepo)).toThrow(/outside/)
  })

  it("rejects a missing database file", () => {
    const fx = track(createFakeRepoFixture())
    const emptyDir = join(fx.isolatedRoot, "no-db")
    mkdirSync(emptyDir, { recursive: true })
    expect(() => resolveAllowedCopyDatabasePath(emptyDir, fx.fakeRepo)).toThrow(/missing database copy/)
  })

  it("rejects a hard link to the retained database file", () => {
    const fx = track(createFakeRepoFixture())
    const copyDir = join(fx.isolatedRoot, "hard-link-copy")
    mkdirSync(join(copyDir, ".data"), { recursive: true })
    const dbAtCopy = join(copyDir, R1_MIGRATION_DB_RELATIVE)
    linkSync(fx.retainedDb, dbAtCopy)
    expect(() => resolveAllowedCopyDatabasePath(copyDir, fx.fakeRepo)).toThrow(/hard link/)
  })

  it("rejects a directory at the database path", () => {
    const fx = track(createFakeRepoFixture())
    const copyDir = join(fx.isolatedRoot, "dir-as-db")
    mkdirSync(join(copyDir, ".data", "shipping-hot-v3.sqlite3"), { recursive: true })
    expect(() => resolveAllowedCopyDatabasePath(copyDir, fx.fakeRepo)).toThrow(/directory/)
  })

  itSymlink("rejects when database realpath escapes .tmp via symlink", () => {
    const fx = track(createFakeRepoFixture())
    const outside = join(fx.root, "outside-isolated")
    mkdirSync(outside, { recursive: true })
    const outsideDb = touchCopyDb(outside, "outside-db")
    const copyDir = join(fx.isolatedRoot, "symlink-out")
    mkdirSync(join(copyDir, ".data"), { recursive: true })
    symlinkSync(outsideDb, join(copyDir, R1_MIGRATION_DB_RELATIVE))
    expect(() => resolveAllowedCopyDatabasePath(copyDir, fx.fakeRepo)).toThrow(/escapes/)
  })

  itSymlink("rejects symlink directly to retained database file", () => {
    const fx = track(createFakeRepoFixture())
    const copyDir = join(fx.isolatedRoot, "symlink-retained")
    mkdirSync(join(copyDir, ".data"), { recursive: true })
    symlinkSync(fx.retainedDb, join(copyDir, R1_MIGRATION_DB_RELATIVE))
    expect(() => resolveAllowedCopyDatabasePath(copyDir, fx.fakeRepo)).toThrow(/retained production database/)
  })

  itSymlink("rejects copy directory symlink that resolves outside .tmp", () => {
    const fx = track(createFakeRepoFixture())
    const outside = join(fx.root, "outside-copy-root")
    mkdirSync(outside, { recursive: true })
    touchCopyDb(outside)
    const linkDir = join(fx.isolatedRoot, "dir-link")
    mkdirSync(fx.isolatedRoot, { recursive: true })
    symlinkSync(outside, linkDir, process.platform === "win32" ? "junction" : "dir")
    expect(() => resolveAllowedCopyDatabasePath(linkDir, fx.fakeRepo)).toThrow(/outside/)
  })

  it("resolveDatabaseFileIdentity matches stat and realpath for a normal file", () => {
    const fx = track(createFakeRepoFixture())
    const copyDir = join(fx.isolatedRoot, "identity")
    const dbPath = touchCopyDb(copyDir)
    const identity = resolveDatabaseFileIdentity(dbPath)
    expect(identity.realPath).toBe(resolveDatabaseFileIdentity(dbPath).realPath)
    expect(identity.dev).toBeTypeOf("number")
    expect(identity.ino).toBeTypeOf("number")
  })
})
