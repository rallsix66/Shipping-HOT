import { spawnSync } from "node:child_process"
import { mkdtempSync, rmSync } from "node:fs"
import { pathToFileURL } from "node:url"
import { join, resolve } from "node:path"
import process from "node:process"
import NativeDatabase from "better-sqlite3"
import { createDatabase } from "db0"
import { initShippingTables } from "#/database/shipping"
import { RuntimeRepository } from "#/database/runtime-jobs"

function createNativeDatabase(path: string) {
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

async function runStage(stage: "A" | "B", path: string) {
  const { database, native } = createNativeDatabase(path)
  await initShippingTables(database, "mock")
  const repository = new RuntimeRepository(database)
  if (stage === "A") {
    const run = await repository.createSyncRun({ providerId: "p2c-smoke-provider", capability: "p2c-smoke", startedAt: "2026-08-24T00:00:00.000Z" })
    await repository.completeSyncRun({ id: run.id, status: "success", completedAt: "2026-08-24T00:00:01.000Z", recordsRead: 1, recordsWritten: 1 })
    await repository.updateProviderRuntime({ providerId: "p2c-smoke-provider", capability: "p2c-smoke", status: "healthy", lastSuccessAt: "2026-08-24T00:00:01.000Z", nextSyncAt: "2026-08-24T01:00:01.000Z", consecutiveFailures: 0, updatedAt: "2026-08-24T00:00:01.000Z" })
  } else {
    const runtime = await repository.getProviderRuntime("p2c-smoke-provider")
    const runs = await repository.listSyncRuns("p2c-smoke-provider")
    if (runtime?.status !== "healthy" || runtime.lastSuccessAt !== "2026-08-24T00:00:01.000Z" || runs.length !== 1 || runs[0].status !== "success") {
      throw new Error("p2c_runtime_persistence_failed")
    }
    console.log(JSON.stringify({ process: "B", persisted: true, status: runtime.status, lastSuccessAt: runtime.lastSuccessAt, syncRuns: runs.length }))
  }
  native.close()
}

const stage = process.env.P2C_RUNTIME_SMOKE_STAGE
const databasePath = process.env.P2C_RUNTIME_SMOKE_DB
if (stage === "A" || stage === "B") {
  if (!databasePath) throw new Error("p2c_runtime_smoke_database_missing")
  await runStage(stage, databasePath)
} else {
  const root = mkdtempSync(join(process.env.TEMP ?? ".", "shipping-hot-p2c-"))
  const path = join(root, "runtime.sqlite3")
  const loader = resolve("scripts/tsx-alias-loader.mjs")
  try {
    for (const childStage of ["A", "B"] as const) {
      const child = spawnSync(process.execPath, ["--import", "tsx/esm", "--experimental-loader", pathToFileURL(loader).href, "./scripts/p2c-runtime-sqlite-smoke.ts"], {
        cwd: process.cwd(),
        env: { ...process.env, P2C_RUNTIME_SMOKE_STAGE: childStage, P2C_RUNTIME_SMOKE_DB: path },
        encoding: "utf8",
      })
      if (child.status !== 0) throw new Error(`${childStage} failed: ${child.stderr || child.stdout}`)
      if (child.stdout) process.stdout.write(child.stdout)
    }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}
