import NativeDatabase from "better-sqlite3"
import { createDatabase } from "db0"
import { describe, expect, it } from "vitest"
import { initShippingTables } from "#/database/shipping"
import { type CapabilityReadiness, type RuntimeReadinessStatus, type V3ToolchainObservation, aggregateRuntimeReadiness, approvedRuntimeJobKeys, readV3PackageManagerObservation, readV3Readiness, readV3ToolchainChecks } from "#/services/v3-readiness"

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
    jobs: approvedRuntimeJobKeys("mock").map((key) => {
      const [id, capability] = key.split(":")
      return { id: id === "feed-sync" ? `${id}:${capability}` : id, providerId: "mock", capability: id === "feed-sync" ? "feed_sync" : capability, enabled: true }
    }),
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

async function realVesselSearchCapability(options: { provider?: string, gfwToken?: string, vesselApiKey?: string }): Promise<CapabilityReadiness> {
  const environmentNames = ["SHIPPING_DATA_MODE", "SHIPPING_VESSEL_SEARCH_PROVIDER", "GFW_API_TOKEN", "VESSELAPI_API_KEY"]
  const previous = new Map(environmentNames.map(name => [name, process.env[name]]))
  const values: Record<string, string | undefined> = {
    SHIPPING_DATA_MODE: "real",
    SHIPPING_VESSEL_SEARCH_PROVIDER: options.provider,
    GFW_API_TOKEN: options.gfwToken,
    VESSELAPI_API_KEY: options.vesselApiKey,
  }
  for (const name of environmentNames) {
    const value = values[name]
    if (value === undefined) delete process.env[name]
    else process.env[name] = value
  }
  try {
    const { database, native } = createNativeDatabase()
    try {
      await initShippingTables(database, "real")
      const report = await readV3Readiness(database, {
        dataMode: "real",
        profile: "REAL_OPERATIONAL",
        toolchain: { packageManager: "pnpm@10.30.3", betterSqlite3Version: "12.6.2", betterSqlite3LoadError: undefined },
      })
      const capability = report.capabilities.find(item => item.capability === "vessel_search")
      if (!capability) throw new Error("vessel_search readiness capability is missing")
      return capability
    } finally {
      native.close()
    }
  } finally {
    for (const name of environmentNames) {
      const value = previous.get(name)
      if (value === undefined) delete process.env[name]
      else process.env[name] = value
    }
  }
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

  it("aggregates every Feed source instead of letting the last source overwrite the first", () => {
    const source = (id: string, status: string, enabled = true) => ({ id, providerId: id, capability: "feed_sync", enabled, status })
    expect(aggregateRuntimeReadiness([source("the-loadstar", "failed"), source("shekou-official", "healthy")])).toBe("degraded")
    expect(aggregateRuntimeReadiness([source("the-loadstar", "healthy"), source("shekou-official", "healthy")])).toBe("healthy")
    expect(aggregateRuntimeReadiness([source("the-loadstar", "failed"), source("shekou-official", "failed")])).toBe("failed")
    expect(aggregateRuntimeReadiness([source("the-loadstar", "never_succeeded"), source("shekou-official", "never_succeeded")])).toBe("never_succeeded")
  })

  it("retains source-level Feed state in the Readiness capability", async () => {
    const previous = process.env.SHIPPING_FEED_PROVIDER
    process.env.SHIPPING_FEED_PROVIDER = "public"
    try {
      const { database, native } = createNativeDatabase()
      await initShippingTables(database, "real")
      const jobs = approvedRuntimeJobKeys("real").map((key) => {
        const separator = key.lastIndexOf(":")
        const id = key.slice(0, separator)
        const capability = key.slice(separator + 1)
        return { id, providerId: id.startsWith("feed-sync:") ? id.slice("feed-sync:".length) : id, capability, enabled: true, status: "healthy" }
      })
      const feedJobs = jobs.filter(job => job.capability === "feed_sync")
      feedJobs[0].status = "failed"
      feedJobs[1].status = "healthy"
      const report = await readV3Readiness(database, {
        dataMode: "real",
        profile: "REAL_OPERATIONAL",
        runtime: { running: true, jobs },
        toolchain: { packageManager: "pnpm@10.30.3", betterSqlite3Version: "12.6.2", betterSqlite3LoadError: undefined },
      })
      const feed = report.capabilities.find(capability => capability.capability === "feed")
      expect(feed).toMatchObject({ runtime: "degraded", sources: [expect.objectContaining({ runtime: "failed" }), expect.objectContaining({ runtime: "healthy" })] })
      native.close()
    } finally {
      if (previous === undefined) delete process.env.SHIPPING_FEED_PROVIDER
      else process.env.SHIPPING_FEED_PROVIDER = previous
    }
  })

  it("reports GFW Vessel Search as configured with an available credential", async () => {
    await expect(realVesselSearchCapability({ provider: "gfw", gfwToken: "test-secret" })).resolves.toMatchObject({
      provider: "gfw",
      configured: true,
      credential: "available",
      status: "coverage_pending",
    })
  })

  it("reports GFW Vessel Search credential_missing when its token is absent", async () => {
    await expect(realVesselSearchCapability({ provider: "gfw" })).resolves.toMatchObject({
      provider: "gfw",
      configured: true,
      credential: "missing",
      status: "credential_missing",
    })
  })

  it("keeps VesselAPI Readiness behavior when VesselAPI is explicitly selected", async () => {
    await expect(realVesselSearchCapability({ provider: "vesselapi", vesselApiKey: "test-secret" })).resolves.toMatchObject({
      provider: "vesselapi",
      configured: true,
      credential: "available",
      status: "coverage_pending",
    })
  })

  it("uses GFW credential when GFW is selected even if VesselAPI is also configured", async () => {
    await expect(realVesselSearchCapability({ provider: "gfw", vesselApiKey: "vesselapi-secret" })).resolves.toMatchObject({
      provider: "gfw",
      configured: true,
      credential: "missing",
      status: "credential_missing",
    })
  })
})
