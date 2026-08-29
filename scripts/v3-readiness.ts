import { execFileSync } from "node:child_process"
import { mkdirSync } from "node:fs"
import { dirname, isAbsolute, resolve } from "node:path"
import process from "node:process"
import NativeDatabase from "better-sqlite3"
import { createDatabase } from "db0"
import type { Database } from "db0"
import { projectDir } from "../shared/dir"
import { loadServerEnv } from "./load-env"
import { initShippingTables } from "#/database/shipping"
import { bootstrapBackgroundRuntime, getBackgroundRuntime, shutdownBackgroundRuntime } from "#/runtime/bootstrap"
import { readV3Readiness } from "#/services/v3-readiness"

function createNativeDatabase(path: string): { database: Database, native: { close: () => void } } {
  const native = new NativeDatabase(path)
  const database = createDatabase({
    name: "sqlite",
    dialect: "sqlite",
    getInstance: () => native,
    exec: (sql: string) => native.exec(sql),
    prepare: (sql: string) => {
      const statement = native.prepare(sql)
      return {
        all: async (...params: (string | number | boolean | null | undefined)[]) => statement.all(...params),
        get: async (...params: (string | number | boolean | null | undefined)[]) => statement.get(...params),
        run: async (...params: (string | number | boolean | null | undefined)[]) => {
          const result = statement.run(...params)
          return { success: result.changes > 0, changes: result.changes, lastInsertRowid: result.lastInsertRowid }
        },
      }
    },
    dispose: () => native.close(),
  } as never)
  return { database, native }
}

function actualPnpmContract(): string | undefined {
  try {
    const executable = process.platform === "win32" ? "pnpm.cmd" : "pnpm"
    const version = execFileSync(executable, ["--version"], { cwd: projectDir, encoding: "utf8", shell: process.platform === "win32" }).trim()
    return version ? `pnpm@${version}` : undefined
  } catch {
    return undefined
  }
}

loadServerEnv()
const databasePathValue = process.env.SHIPPING_DATABASE_PATH?.trim() || ".data/shipping-hot-v3.sqlite3"
const databasePath = isAbsolute(databasePathValue) ? databasePathValue : resolve(projectDir, databasePathValue)
mkdirSync(dirname(databasePath), { recursive: true })

const { database, native } = createNativeDatabase(databasePath)
let bootstrapFailed = false
try {
  const dataMode = process.env.SHIPPING_DATA_MODE === "real" ? "real" : "mock"
  await initShippingTables(database, dataMode)
  try {
    await bootstrapBackgroundRuntime({ database, installSignalHandlers: false })
  } catch {
    bootstrapFailed = true
  }
  const runtime = getBackgroundRuntime()
  const runtimeStatus = runtime?.getStatus()
  const report = await readV3Readiness(database, {
    dataMode,
    bootstrapFailed,
    toolchain: { packageManager: actualPnpmContract() },
    runtime: runtimeStatus && {
      running: runtimeStatus.running,
      jobs: runtimeStatus.jobs.map(job => ({
        id: job.id,
        providerId: job.providerId,
        capability: job.capability,
        enabled: job.enabled,
        status: job.status,
        lastSuccessAt: job.lastSuccessAt,
        lastSourceUpdatedAt: job.lastSourceUpdatedAt,
        nextSyncAt: job.nextSyncAt,
      })),
    },
  })
  process.stdout.write(`${JSON.stringify({ ...report, databasePath }, null, 2)}\n`)
  if (!report.ready) process.exitCode = 1
} finally {
  shutdownBackgroundRuntime()
  native.close()
}
