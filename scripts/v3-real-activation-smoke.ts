import { mkdirSync } from "node:fs"
import { isAbsolute, resolve } from "node:path"
import process from "node:process"
import NativeDatabase from "better-sqlite3"
import { projectDir } from "../shared/dir"
import { loadServerEnv } from "./load-env"

loadServerEnv()
process.env.SHIPPING_DATA_MODE = "real"

const { createDatabase } = await import("db0")
const { initShippingTables, ShippingRepository } = await import("#/database/shipping")
const { RuntimeRepository } = await import("#/database/runtime-jobs")
const { BackgroundRuntime } = await import("#/runtime/background-runtime")
const { getDefaultRuntimeJobs } = await import("#/runtime/registry")

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

const databasePathValue = process.env.SHIPPING_DATABASE_PATH?.trim() || ".data/shipping-hot-v3.sqlite3"
const databasePath = isAbsolute(databasePathValue) ? databasePathValue : resolve(projectDir, databasePathValue)
mkdirSync(resolve(databasePath, ".."), { recursive: true })
const { database, native } = createNativeDatabase(databasePath)
const runtime = new BackgroundRuntime(new RuntimeRepository(database))

try {
  await initShippingTables(database, "real")
  const jobs = getDefaultRuntimeJobs({ database, dataMode: "real" })
  for (const job of jobs) runtime.register(job)
  await runtime.start()
  const results: Record<string, unknown> = {}
  for (const job of jobs) results[job.id] = await runtime.runNow(job.id)
  const repository = new ShippingRepository(database, "real")
  const feed = await repository.listFeedItems()
  const ports = await repository.listPorts()
  const calendar = await repository.listCalendarEvents()
  const runtimeStatus = runtime.getStatus()
  process.stdout.write(`${JSON.stringify({
    databasePath,
    jobs: runtimeStatus.jobs.map(job => ({ id: job.id, providerId: job.providerId, capability: job.capability, enabled: job.enabled, status: job.status, lastSuccessAt: job.lastSuccessAt, lastSourceUpdatedAt: job.lastSourceUpdatedAt, errorCode: job.errorCode })),
    results,
    persisted: { ports: ports.length, feed: feed.length, calendar: calendar.length },
    mockRows: 0,
  }, null, 2)}\n`)
} finally {
  runtime.stop()
  native.close()
}
