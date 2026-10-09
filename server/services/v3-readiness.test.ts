import NativeDatabase from "better-sqlite3"
import { createDatabase } from "db0"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { RuntimeReadinessJob, RuntimeReadinessStatus, V3ToolchainObservation } from "#/services/v3-readiness"
import {
  aggregateRuntimeReadiness,
  approvedRuntimeJobKeys,
  readV3PackageManagerObservation,
  readV3Readiness,
  readV3ToolchainChecks,
  resolveWeatherAlertLiveVerification,
  resolveWeatherAlertReadinessReason,
  resolveWeatherAlertReadinessStatus,
} from "#/services/v3-readiness"
import { initShippingTables } from "#/database/shipping"

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

function jobFromKey(key: string, overrides: Partial<RuntimeReadinessJob> = {}): RuntimeReadinessJob {
  const separator = key.lastIndexOf(":")
  const id = key.slice(0, separator)
  const capability = key.slice(separator + 1)
  const providerId = id.startsWith("feed-sync:")
    ? id.slice("feed-sync:".length)
    : id === "calendar-sync"
      ? "mock"
      : id === "port-sync" || id === "weather-sync"
        ? "mock"
        : id.startsWith("weather-alert-sync:")
          ? id.slice("weather-alert-sync:".length)
          : id
  return { id, providerId, capability, enabled: true, status: "healthy", ...overrides }
}

function validRuntime(dataMode: "mock" | "real" = "mock"): RuntimeReadinessStatus {
  return {
    running: true,
    jobs: approvedRuntimeJobKeys(dataMode).map(key => jobFromKey(key)),
  }
}

async function readiness(runtime: RuntimeReadinessStatus | undefined, options: { bootstrapFailed?: boolean, toolchain?: Partial<V3ToolchainObservation>, dataMode?: "mock" | "real" } = {}) {
  const dataMode = options.dataMode ?? "mock"
  const { database, native } = createNativeDatabase()
  await initShippingTables(database, dataMode)
  const report = await readV3Readiness(database, {
    dataMode,
    profile: dataMode === "real" ? "REAL_OPERATIONAL" : "DEVELOPMENT_SAFE",
    runtime,
    bootstrapFailed: options.bootstrapFailed,
    toolchain: { packageManager: "pnpm@10.30.3", betterSqlite3Version: "12.6.2", betterSqlite3LoadError: undefined, ...options.toolchain },
  })
  native.close()
  return report
}

function weatherAlertJobs(status: string, lastSuccess = true): RuntimeReadinessJob[] {
  return ["tmd", "bmkg"].map(sourceId => ({
    id: `weather-alert-sync:${sourceId}`,
    providerId: sourceId,
    capability: "weather_alerts",
    enabled: true,
    status,
    ...(lastSuccess ? { lastSuccessAt: "2026-09-01T00:10:00.000Z" } : {}),
    lastSourceUpdatedAt: "2026-09-01T00:00:00.000Z",
  }))
}

async function realWeatherAlertCapability(options: { provider?: string, jobs?: RuntimeReadinessJob[] } = {}) {
  const environmentNames = ["SHIPPING_DATA_MODE", "SHIPPING_WEATHER_ALERT_PROVIDER"]
  const previous = new Map(environmentNames.map(name => [name, process.env[name]]))
  process.env.SHIPPING_DATA_MODE = "real"
  if (options.provider === undefined) delete process.env.SHIPPING_WEATHER_ALERT_PROVIDER
  else process.env.SHIPPING_WEATHER_ALERT_PROVIDER = options.provider
  try {
    const { database, native } = createNativeDatabase()
    try {
      await initShippingTables(database, "real")
      const report = await readV3Readiness(database, {
        dataMode: "real",
        profile: "REAL_OPERATIONAL",
        runtime: { running: true, jobs: options.jobs ?? [] },
        toolchain: { packageManager: "pnpm@10.30.3", betterSqlite3Version: "12.6.2", betterSqlite3LoadError: undefined },
      })
      const capability = report.capabilities.find(item => item.capability === "weather_alerts")
      if (!capability) throw new Error("weather_alerts readiness capability is missing")
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

describe("v3 readiness (R1 port-only runtime scope)", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("passes only with the running exact approved Runtime Job set", async () => {
    const report = await readiness(validRuntime())
    expect(report.ready).toBe(true)
    expect(report.checks.find(check => check.id === "runtime-scope")).toMatchObject({ status: "pass" })
    expect(report.checks.find(check => check.id === "network-probes")).toMatchObject({ status: "skipped" })
  })

  it("keeps the optional Translation Runtime outside the operational readiness job gate", async () => {
    const report = await readiness({
      running: true,
      jobs: [...validRuntime().jobs, { id: "translation-sync", providerId: "deepseek", capability: "translation", enabled: true, status: "never_succeeded" }],
    })
    expect(report.ready).toBe(true)
    expect(report.checks.find(check => check.id === "runtime-scope")).toMatchObject({ status: "pass" })
    expect(report.capabilities.some(capability => capability.capability === "translation")).toBe(false)
  })

  const failureCases: Array<[string, RuntimeReadinessStatus | undefined, { bootstrapFailed?: boolean }, string]> = [
    ["runtime undefined", undefined, {}, "runtime-scope"],
    ["bootstrap failed", undefined, { bootstrapFailed: true }, "runtime-scope"],
    ["runtime empty", { running: true, jobs: [] }, {}, "runtime-scope"],
    ["runtime not running", { running: false, jobs: validRuntime().jobs }, {}, "runtime-running"],
    ["missing calendar-sync job", { running: true, jobs: validRuntime().jobs.filter(job => job.id !== "calendar-sync") }, {}, "runtime-scope"],
    ["disabled port-sync job", { running: true, jobs: validRuntime().jobs.map(job => job.id === "port-sync" ? { ...job, enabled: false } : job) }, {}, "runtime-scope"],
    ["duplicate calendar-sync job", { running: true, jobs: [...validRuntime().jobs, validRuntime().jobs.find(job => job.id === "calendar-sync")!] }, {}, "runtime-scope"],
    ["invalid job capability", { running: true, jobs: validRuntime().jobs.map(job => job.id === "port-sync" ? { ...job, capability: "translation" } : job) }, {}, "runtime-scope"],
  ]
  it.each(failureCases)("fails for %s", async (_name, runtime, options, expectedCheck) => {
    const report = await readiness(runtime, options)
    expect(report.ready).toBe(false)
    expect(report.checks.find(check => check.id === expectedCheck)).toMatchObject({ status: "fail" })
  })

  it("fails when every expected job is disabled", async () => {
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
      const jobs = approvedRuntimeJobKeys("real").map(key => jobFromKey(key))
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

  it("aggregates public official alert sources as configured after historical success", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-09-01T00:15:00.000Z"))
    try {
      await expect(realWeatherAlertCapability({ provider: "public", jobs: weatherAlertJobs("healthy") })).resolves.toMatchObject({
        provider: "public",
        configured: true,
        credential: "not_required",
        runtime: "healthy",
        liveVerification: "verified_live",
        status: "configured",
        sources: [
          expect.objectContaining({ provider: "tmd", runtime: "healthy" }),
          expect.objectContaining({ provider: "bmkg", runtime: "healthy" }),
        ],
      })
    } finally {
      vi.useRealTimers()
    }
  })

  it("keeps official alert coverage pending until every active source has succeeded", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-09-01T00:15:00.000Z"))
    try {
      const jobs = weatherAlertJobs("healthy", false)
      jobs[0].lastSuccessAt = "2026-09-01T00:10:00.000Z"
      jobs[1].lastSuccessAt = undefined
      await expect(realWeatherAlertCapability({ provider: "public", jobs })).resolves.toMatchObject({
        configured: true,
        runtime: "healthy",
        liveVerification: "coverage_pending",
        status: "coverage_pending",
      })
    } finally {
      vi.useRealTimers()
    }
  })

  it("keeps public alerts pending before Runtime registration and not_configured when off", async () => {
    await expect(realWeatherAlertCapability({ provider: "public" })).resolves.toMatchObject({
      configured: true,
      runtime: "not_registered",
      liveVerification: "coverage_pending",
      status: "coverage_pending",
    })
    await expect(realWeatherAlertCapability({ provider: "off" })).resolves.toMatchObject({
      provider: "off",
      configured: false,
      runtime: "not_registered",
      liveVerification: "coverage_pending",
      status: "not_configured",
    })
  })

  it("does not upgrade JMA-only evidence because it is outside focus-port coverage", () => {
    const jobs: RuntimeReadinessJob[] = [{
      id: "weather-alert-sync:jma",
      providerId: "jma",
      capability: "weather_alerts",
      enabled: true,
      status: "healthy",
      lastSuccessAt: "2026-09-01T00:10:00.000Z",
    }]
    const input = { dataMode: "real" as const, provider: "public", activeSourceCount: 1, activeSourceIds: ["jma"], jobs }
    const liveVerification = resolveWeatherAlertLiveVerification(input)
    expect(liveVerification).toBe("coverage_pending")
    expect(resolveWeatherAlertReadinessStatus(input, liveVerification)).toBe("coverage_pending")
    expect(resolveWeatherAlertReadinessReason(input, liveVerification)).toBe("verified_source_not_in_focus_port_coverage")
  })
})
