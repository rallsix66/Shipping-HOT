import { existsSync, lstatSync, realpathSync } from "node:fs"
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

  const realDb = realPathSafe(dbPath)
  if (!realDb.startsWith(`${realIsolated}${sep}`)) {
    throw new R1MigrationCopyPathError(`database realpath escapes .tmp (${realDb})`)
  }

  const retainedDb = join(repoRoot, R1_MIGRATION_DB_RELATIVE)
  if (existsSync(retainedDb)) {
    const realRetained = realPathSafe(retainedDb)
    if (realDb === realRetained) {
      throw new R1MigrationCopyPathError("refusing the retained production database; copy to .tmp/ first")
    }
  }

  try {
    const dbStat = lstatSync(dbPath)
    const retainedStat = existsSync(retainedDb) ? lstatSync(retainedDb) : undefined
    if (retainedStat && dbStat.dev === retainedStat.dev && dbStat.ino === retainedStat.ino) {
      throw new R1MigrationCopyPathError("refusing hard link to the retained production database")
    }
  } catch (error) {
    if (error instanceof R1MigrationCopyPathError) throw error
  }

  return { copyDir: realCopyDir, dbPath: realDb }
}
