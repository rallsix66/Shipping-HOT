import NativeDatabase from "better-sqlite3"
import { createDatabase } from "db0"
import { describe, expect, it } from "vitest"
import { initShippingTables } from "#/database/shipping"
import { type RuntimeReadinessStatus, type V3ToolchainObservation, approvedRuntimeJobs, readV3PackageManagerObservation, readV3Readiness, readV3ToolchainChecks } from "#/services/v3-readiness"

function createNativeDatabase() {
  const native = new NativeDatabase(":memory:")
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

function validRuntime(overrides: Partial<RuntimeReadinessStatus> = {}): RuntimeReadinessStatus {
  return {
    running: true,
    jobs: approvedRuntimeJobs.map(job => ({ ...job, providerId: "mock", enabled: true })),
    ...overrides,
  }
}

async function readiness(runtime: RuntimeReadinessStatus | undefined, options: { bootstrapFailed?: boolean, toolchain?: Partial<V3ToolchainObservation> } = {}) {
  const { database, native } = createNativeDatabase()
  await initShippingTables(database, "mock")
  const report = await readV3Readiness(database, {
    dataMode: "mock",
    runtime,
    bootstrapFailed: options.bootstrapFailed,
    toolchain: { packageManager: "pnpm@10.30.3", ...options.toolchain },
  })
  native.close()
  return report
}

describe("v3 readiness", () => {
  it("passes only with the running exact approved Runtime Job set", async () => {
    const report = await readiness(validRuntime())
    expect(report.ready).toBe(true)
    expect(report.checks.find(check => check.id === "runtime-scope")).toMatchObject({ status: "pass" })
    expect(report.checks.find(check => check.id === "network-probes")).toMatchObject({ status: "skipped" })
  })

  const failureCases: Array<[string, RuntimeReadinessStatus | undefined, { bootstrapFailed?: boolean }, string]> = [
    ["runtime undefined", undefined, {}, "runtime-scope"],
    ["bootstrap failed", undefined, { bootstrapFailed: true }, "runtime-scope"],
    ["runtime empty", { running: true, jobs: [] }, {}, "runtime-scope"],
    ["runtime not running", { running: false, jobs: validRuntime().jobs }, {}, "runtime-running"],
    ["missing AIS Job", { running: true, jobs: validRuntime().jobs.filter(job => job.id !== "ais-tracking") }, {}, "runtime-scope"],
    ["disabled Voyage Job", { running: true, jobs: validRuntime().jobs.map(job => job.id === "voyage-sync" ? { ...job, enabled: false } : job) }, {}, "runtime-scope"],
    ["duplicate AIS Job", { running: true, jobs: [...validRuntime().jobs, validRuntime().jobs[0]] }, {}, "runtime-scope"],
    ["invalid Job", { running: true, jobs: validRuntime().jobs.map(job => job.id === "ais-tracking" ? { ...job, capability: "translation" } : job) }, {}, "runtime-scope"],
  ]
  it.each(failureCases)("fails for %s", async (_name, runtime, options, expectedCheck) => {
    const report = await readiness(runtime, options)
    expect(report.ready).toBe(false)
    expect(report.checks.find(check => check.id === expectedCheck)).toMatchObject({ status: "fail" })
  })

  it("fails when both expected jobs are disabled", async () => {
    const report = await readiness({ running: true, jobs: validRuntime().jobs.map(job => ({ ...job, enabled: false })) })
    expect(report.ready).toBe(false)
    expect(report.checks.find(check => check.id === "runtime-scope")).toMatchObject({ status: "fail" })
  })

  it("does not report ready when the HTTP package manager observation is unavailable", async () => {
    const report = await readiness(validRuntime(), { toolchain: { packageManager: undefined } })
    expect(report.ready).toBe(false)
    expect(report.checks.find(check => check.id === "package-manager")).toMatchObject({ status: "skipped" })
  })

  it("rejects a non-pnpm user-agent instead of treating it as unverified success", async () => {
    const packageManager = readV3PackageManagerObservation("npm/10.9.0 node/v24.15.0 win32 x64")
    expect(packageManager).toBe("npm@10.9.0")
    const report = await readiness(validRuntime(), { toolchain: { packageManager } })
    expect(report.ready).toBe(false)
    expect(report.checks.find(check => check.id === "package-manager")).toMatchObject({ status: "fail" })
  })

  it("rejects a mismatched pnpm version", async () => {
    const report = await readiness(validRuntime(), { toolchain: { packageManager: "pnpm@9.0.0" } })
    expect(report.ready).toBe(false)
    expect(report.checks.find(check => check.id === "package-manager")).toMatchObject({ status: "fail" })
  })

  it("evaluates the actual better-sqlite3 package version and native load", () => {
    expect(readV3ToolchainChecks({ packageManager: "pnpm@10.30.3" })).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "node-version" }),
      expect.objectContaining({ id: "node-abi" }),
      expect.objectContaining({ id: "package-manager", status: "pass" }),
      expect.objectContaining({ id: "better-sqlite3", status: "pass" }),
    ]))
  })

  it.each([
    ["wrong installed version", { betterSqlite3Version: "12.6.1", betterSqlite3VersionError: undefined }],
    ["unreadable installed version", { betterSqlite3Version: undefined, betterSqlite3VersionError: "version read failed" }],
    ["native load failure", { betterSqlite3Version: "12.6.2", betterSqlite3LoadError: "native load failed" }],
  ])("fails when better-sqlite3 is not reliably observed: %s", async (_name, toolchain) => {
    const report = await readiness(validRuntime(), { toolchain })
    expect(report.ready).toBe(false)
    expect(report.checks.find(check => check.id === "better-sqlite3")).toMatchObject({ status: "fail" })
  })
})
