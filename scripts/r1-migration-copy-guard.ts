import { existsSync, lstatSync, realpathSync, statSync } from "node:fs"
import { join, resolve, sep } from "node:path"
import process from "node:process"

export const R1_MIGRATION_DB_RELATIVE = join(".data", "shipping-hot-v3.sqlite3")

export class R1MigrationCopyPathError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "R1MigrationCopyPathError"
  }
}

export function shippingRepoRoot(cwd = process.cwd()): string {
  return resolve(cwd)
}

function realPathSafe(path: string): string {
  return realpathSync.native ? realpathSync.native(path) : realpathSync(path)
}

export interface FileIdentity {
  realPath: string
  dev: number
  ino: number
}

/** Stat the path SQLite will open (symlink-aware) and return canonical file identity. */
export function resolveDatabaseFileIdentity(dbPath: string): FileIdentity {
  let linkStat: ReturnType<typeof lstatSync>
  try {
    linkStat = lstatSync(dbPath)
  } catch (error) {
    throw new R1MigrationCopyPathError(`database path lstat failed: ${error instanceof Error ? error.message : String(error)}`)
  }
  if (linkStat.isDirectory()) {
    throw new R1MigrationCopyPathError("refusing directory as database path")
  }
  let realPath: string
  try {
    realPath = realPathSafe(dbPath)
  } catch (error) {
    throw new R1MigrationCopyPathError(`database realpath failed: ${error instanceof Error ? error.message : String(error)}`)
  }
  let fileStat: ReturnType<typeof statSync>
  try {
    fileStat = statSync(realPath)
  } catch (error) {
    throw new R1MigrationCopyPathError(`resolved database stat failed: ${error instanceof Error ? error.message : String(error)}`)
  }
  if (!fileStat.isFile()) {
    throw new R1MigrationCopyPathError("refusing non-file resolved database path")
  }
  return { realPath, dev: fileStat.dev, ino: fileStat.ino }
}

function sameFileIdentity(left: FileIdentity, right: FileIdentity): boolean {
  return left.dev === right.dev && left.ino === right.ino
}

function retainedDatabaseIdentity(repoRoot: string): FileIdentity | undefined {
  const retainedDb = join(repoRoot, R1_MIGRATION_DB_RELATIVE)
  if (!existsSync(retainedDb)) return undefined
  return resolveDatabaseFileIdentity(retainedDb)
}

/** R1-3: only open migration copies under repo/.tmp (isolated copy dirs). */
export function resolveAllowedCopyDatabasePath(copyDirArg: string, repoRoot = shippingRepoRoot()): { copyDir: string, dbPath: string } {
  const isolatedRoot = resolve(repoRoot, ".tmp")
  const copyDir = resolve(copyDirArg)
  if (!existsSync(copyDir)) {
    throw new R1MigrationCopyPathError(`copy directory does not exist: ${copyDir}`)
  }

  const realRepo = realPathSafe(repoRoot)
  const realCopyDir = realPathSafe(copyDir)
  const realIsolated = existsSync(isolatedRoot) ? realPathSafe(isolatedRoot) : isolatedRoot

  if (realCopyDir === realRepo) {
    throw new R1MigrationCopyPathError("refusing repository root; use an isolated directory under .tmp/")
  }
  if (!realCopyDir.startsWith(`${realIsolated}${sep}`) && realCopyDir !== realIsolated) {
    throw new R1MigrationCopyPathError(`refusing path outside ${realIsolated} (got ${realCopyDir})`)
  }

  const dbPath = join(copyDir, R1_MIGRATION_DB_RELATIVE)
  if (!existsSync(dbPath)) {
    throw new R1MigrationCopyPathError(`missing database copy: ${dbPath}`)
  }

  const dbIdentity = resolveDatabaseFileIdentity(dbPath)
  if (!dbIdentity.realPath.startsWith(`${realIsolated}${sep}`)) {
    throw new R1MigrationCopyPathError(`database realpath escapes .tmp (${dbIdentity.realPath})`)
  }

  const retainedIdentity = retainedDatabaseIdentity(repoRoot)
  if (retainedIdentity) {
    if (dbIdentity.realPath === retainedIdentity.realPath) {
      throw new R1MigrationCopyPathError("refusing the retained production database; copy to .tmp/ first")
    }
    if (sameFileIdentity(dbIdentity, retainedIdentity)) {
      throw new R1MigrationCopyPathError("refusing hard link to the retained production database")
    }
  }

  return { copyDir: realCopyDir, dbPath: dbIdentity.realPath }
}
