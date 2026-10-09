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
import type { TestContext } from "vitest"
import {
  R1MigrationCopyPathError,
  R1_MIGRATION_DB_RELATIVE,
  resolveAllowedCopyDatabasePath,
  resolveDatabaseFileIdentity,
  shippingRepoRoot,
} from "./r1-migration-copy-guard"

const realRepoRoot = shippingRepoRoot()

interface FakeRepoFixture {
  root: string
  fakeRepo: string
  retainedDb: string
  isolatedRoot: string
}

interface LinkProbe {
  ok: boolean
  error: string
}

let fileSymlinkProbe: LinkProbe = { ok: false, error: "not probed" }
let dirLinkProbe: LinkProbe = { ok: false, error: "not probed" }

function probeFileSymlink(): LinkProbe {
  const probeParent = mkdtempSync(join(realRepoRoot, ".tmp", "r1-guard-file-probe-"))
  try {
    const target = join(probeParent, "target")
    writeFileSync(target, "probe")
    symlinkSync(target, join(probeParent, "link"))
    return { ok: true, error: "" }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  } finally {
    if (existsSync(probeParent)) rmSync(probeParent, { recursive: true, force: true })
  }
}

function probeDirLink(): LinkProbe {
  const probeParent = mkdtempSync(join(realRepoRoot, ".tmp", "r1-guard-dir-probe-"))
  try {
    const targetDir = join(probeParent, "target-dir")
    mkdirSync(targetDir)
    writeFileSync(join(targetDir, "inside"), "probe")
    const linkPath = join(probeParent, "dir-link")
    if (process.platform === "win32") {
      symlinkSync(targetDir, linkPath, "junction")
    } else {
      symlinkSync(targetDir, linkPath, "dir")
    }
    return { ok: true, error: "" }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  } finally {
    if (existsSync(probeParent)) rmSync(probeParent, { recursive: true, force: true })
  }
}

beforeAll(() => {
  fileSymlinkProbe = probeFileSymlink()
  dirLinkProbe = probeDirLink()
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

function skipUnlessFileSymlink(context: TestContext) {
  if (!fileSymlinkProbe.ok) context.skip(`file symlink unsupported: ${fileSymlinkProbe.error}`)
}

function skipUnlessDirLink(context: TestContext) {
  if (!dirLinkProbe.ok) context.skip(`directory link unsupported: ${dirLinkProbe.error}`)
}

function expectGuardRejection(run: () => unknown, messagePart: string) {
  let thrown: unknown
  try {
    run()
  } catch (error) {
    thrown = error
  }
  expect(thrown).toBeInstanceOf(R1MigrationCopyPathError)
  expect((thrown as R1MigrationCopyPathError).message).toContain(messagePart)
}

describe("r1 migration copy path guard", () => {
  it("records link probe results for the test run", () => {
    expect(fileSymlinkProbe.ok || fileSymlinkProbe.error.length > 0).toBe(true)
    expect(dirLinkProbe.ok || dirLinkProbe.error.length > 0).toBe(true)
    if (!fileSymlinkProbe.ok) {
      expect(fileSymlinkProbe.error).toMatch(/EPERM|operation not permitted|privilege/i)
    }
  })

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
    expect(() => resolveAllowedCopyDatabasePath(outsideTmp, fx.fakeRepo)).toThrow(R1MigrationCopyPathError)
  })

  it("rejects a missing database file", () => {
    const fx = track(createFakeRepoFixture())
    const emptyDir = join(fx.isolatedRoot, "no-db")
    mkdirSync(emptyDir, { recursive: true })
    expect(() => resolveAllowedCopyDatabasePath(emptyDir, fx.fakeRepo)).toThrow(R1MigrationCopyPathError)
  })

  it("rejects a hard link to the retained database file", () => {
    const fx = track(createFakeRepoFixture())
    const copyDir = join(fx.isolatedRoot, "hard-link-copy")
    mkdirSync(join(copyDir, ".data"), { recursive: true })
    const dbAtCopy = join(copyDir, R1_MIGRATION_DB_RELATIVE)
    linkSync(fx.retainedDb, dbAtCopy)
    expectGuardRejection(() => resolveAllowedCopyDatabasePath(copyDir, fx.fakeRepo), "hard link")
  })

  it("rejects a directory at the database path", () => {
    const fx = track(createFakeRepoFixture())
    const copyDir = join(fx.isolatedRoot, "dir-as-db")
    mkdirSync(join(copyDir, ".data", "shipping-hot-v3.sqlite3"), { recursive: true })
    expect(() => resolveAllowedCopyDatabasePath(copyDir, fx.fakeRepo)).toThrow(R1MigrationCopyPathError)
  })

  it("rejects when database realpath escapes .tmp via file symlink", (context) => {
    skipUnlessFileSymlink(context)
    const fx = track(createFakeRepoFixture())
    const outside = join(fx.root, "outside-isolated")
    mkdirSync(outside, { recursive: true })
    const outsideDb = touchCopyDb(outside, "outside-db")
    const copyDir = join(fx.isolatedRoot, "symlink-out")
    mkdirSync(join(copyDir, ".data"), { recursive: true })
    symlinkSync(outsideDb, join(copyDir, R1_MIGRATION_DB_RELATIVE))
    expectGuardRejection(() => resolveAllowedCopyDatabasePath(copyDir, fx.fakeRepo), "escapes .tmp")
  })

  it("rejects file symlink directly to retained database file", (context) => {
    skipUnlessFileSymlink(context)
    const fx = track(createFakeRepoFixture())
    const copyDir = join(fx.isolatedRoot, "symlink-retained")
    mkdirSync(join(copyDir, ".data"), { recursive: true })
    symlinkSync(fx.retainedDb, join(copyDir, R1_MIGRATION_DB_RELATIVE))
    expectGuardRejection(() => resolveAllowedCopyDatabasePath(copyDir, fx.fakeRepo), "escapes .tmp")
  })

  it("rejects copy directory directory-link that resolves outside .tmp", (context) => {
    skipUnlessDirLink(context)
    const fx = track(createFakeRepoFixture())
    const outside = join(fx.root, "outside-copy-root")
    mkdirSync(outside, { recursive: true })
    touchCopyDb(outside)
    const linkDir = join(fx.isolatedRoot, "dir-link")
    mkdirSync(fx.isolatedRoot, { recursive: true })
    if (process.platform === "win32") symlinkSync(outside, linkDir, "junction")
    else symlinkSync(outside, linkDir, "dir")
    expect(() => resolveAllowedCopyDatabasePath(linkDir, fx.fakeRepo)).toThrow(R1MigrationCopyPathError)
  })

  it("rejects symlink to a hard link of the retained database (combo)", (context) => {
    skipUnlessFileSymlink(context)
    const fx = track(createFakeRepoFixture())
    const hardLink = join(fx.isolatedRoot, "retained-hardlink")
    linkSync(fx.retainedDb, hardLink)
    const copyDir = join(fx.isolatedRoot, "symlink-hardlink-copy")
    mkdirSync(join(copyDir, ".data"), { recursive: true })
    symlinkSync(hardLink, join(copyDir, R1_MIGRATION_DB_RELATIVE))
    expectGuardRejection(() => resolveAllowedCopyDatabasePath(copyDir, fx.fakeRepo), "hard link")
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
