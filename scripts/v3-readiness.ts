import { mkdirSync, readFileSync } from "node:fs"
import { dirname, isAbsolute, join, resolve } from "node:path"
import process from "node:process"
import NativeDatabase from "better-sqlite3"
import { createDatabase } from "db0"
import type { Database } from "db0"
import { projectDir } from "../shared/dir"
import { loadServerEnv } from "./load-env"
import { initShippingTables } from "#/database/shipping"
import { getDefaultRuntimeJobs } from "#/runtime/registry"
import { readV3Readiness } from "#/services/v3-readiness"
import type { ReadinessCheck } from "#/services/v3-readiness"

interface PackageManifest {
  engines?: { node?: string }
  packageManager?: string
}

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

function check(id: string, status: ReadinessCheck["status"], detail: string, value?: unknown): ReadinessCheck {
  return { id, status, detail, ...(value === undefined ? {} : { value }) }
}

function toolchainChecks(): ReadinessCheck[] {
  const manifest = JSON.parse(readFileSync(join(projectDir, "package.json"), "utf8")) as PackageManifest
  return [
    check("node-version", process.versions.node === manifest.engines?.node ? "pass" : "fail", `Node ${process.versions.node}; expected ${manifest.engines?.node ?? "unknown"}`, process.versions.node),
    check("node-abi", process.versions.modules === "137" ? "pass" : "fail", `Node ABI ${process.versions.modules}; expected 137`, process.versions.modules),
    check("package-manager", manifest.packageManager === "pnpm@10.30.3" ? "pass" : "fail", `Manifest package manager is ${manifest.packageManager ?? "missing"}; expected pnpm@10.30.3`, manifest.packageManager),
    check("better-sqlite3", "pass", "better-sqlite3 loaded successfully on the pinned ABI", { abi: process.versions.modules }),
  ]
}

loadServerEnv()
const databasePathValue = process.env.SHIPPING_DATABASE_PATH?.trim() || ".data/shipping-hot-v3.sqlite3"
const databasePath = isAbsolute(databasePathValue) ? databasePathValue : resolve(projectDir, databasePathValue)
mkdirSync(dirname(databasePath), { recursive: true })

const { database, native } = createNativeDatabase(databasePath)
try {
  const dataMode = process.env.SHIPPING_DATA_MODE === "real" ? "real" : "mock"
  await initShippingTables(database, dataMode)
  const runtimeJobs = getDefaultRuntimeJobs({ database, dataMode }).map(job => ({
    id: job.id,
    providerId: job.providerId,
    capability: job.capability,
    enabled: job.enabled,
  }))
  const foundation = await readV3Readiness(database, { dataMode, runtimeJobs })
  const checks = [...toolchainChecks(), ...foundation.checks]
  const report = {
    ...foundation,
    ready: checks.every(item => item.status !== "fail"),
    databasePath,
    checks,
  }
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
  if (!report.ready) process.exitCode = 1
} finally {
  native.close()
}
