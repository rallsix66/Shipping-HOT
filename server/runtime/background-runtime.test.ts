import { mkdtempSync, rmSync } from "node:fs"
import NativeDatabase from "better-sqlite3"
import { createDatabase } from "db0"
import { afterEach, describe, expect, it, vi } from "vitest"
import { RuntimeRepository } from "#/database/runtime-jobs"
import { initShippingTables } from "#/database/shipping"
import { bootstrapBackgroundRuntime, getBackgroundRuntime, shutdownBackgroundRuntime } from "#/runtime/bootstrap"
import { BackgroundRuntime, type RuntimeJob } from "#/runtime/background-runtime"
import { ProviderError } from "#/providers/contracts"

function createNativeDatabase(path = ":memory:") {
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

async function waitFor(check: () => boolean, timeoutMs = 500): Promise<void> {
  const startedAt = Date.now()
  while (!check()) {
    if (Date.now() - startedAt >= timeoutMs) throw new Error("test_timeout")
    await new Promise(resolve => setTimeout(resolve, 2))
  }
}

function job(overrides: Partial<RuntimeJob> = {}): RuntimeJob {
  return {
    id: "job-default",
    providerId: "provider-default",
    capability: "test",
    intervalMs: 60 * 60 * 1000,
    enabled: true,
    run: async () => ({ status: "success" }),
    ...overrides,
  }
}

afterEach(async () => {
  await shutdownBackgroundRuntime()
})

describe("backgroundRuntime", () => {
  it("keeps bootstrap singleton state and does not register a second timer/job", async () => {
    const { database, native } = createNativeDatabase()
    const first = await bootstrapBackgroundRuntime({ database, jobs: [job()], enabled: true })
    const second = await bootstrapBackgroundRuntime({ database, jobs: [job({ id: "other-job" })], enabled: true })

    expect(second).toBe(first)
    expect(first.getStatus().jobs).toHaveLength(1)
    expect(first.getStatus().jobs[0].id).toBe("job-default")
    expect(await new RuntimeRepository(database).getProviderRuntime("provider-default", "test")).toMatchObject({ status: "never_succeeded", consecutiveFailures: 0 })
    native.close()
  })

  it("skips overlapping executions and records only the actual run", async () => {
    const { database, native } = createNativeDatabase()
    await initShippingTables(database, "mock")
    const repository = new RuntimeRepository(database)
    let active = 0
    let maximumActive = 0
    let release!: () => void
    const blocked = new Promise<void>((resolve) => {
      release = resolve
    })
    const runtime = new BackgroundRuntime(repository)
    runtime.register(job({
      id: "slow-job",
      providerId: "provider-slow",
      intervalMs: 10,
      run: async () => {
        active += 1
        maximumActive = Math.max(maximumActive, active)
        await blocked
        active -= 1
        return { status: "success", recordsRead: 1, recordsWritten: 1 }
      },
    }))
    await runtime.start()
    const first = runtime.runNow("slow-job")
    await waitFor(() => active === 1)
    await new Promise(resolve => setTimeout(resolve, 30))
    expect(maximumActive).toBe(1)
    release()
    await expect(first).resolves.toMatchObject({ status: "success" })
    runtime.stop()

    expect(await repository.listSyncRuns("provider-slow")).toHaveLength(1)
    expect((await repository.listSyncRuns("provider-slow"))[0]).toMatchObject({ status: "success", recordsRead: 1, recordsWritten: 1 })
    native.close()
  })

  it("isolates a failed job, updates provider health, and recovers on success", async () => {
    const { database, native } = createNativeDatabase()
    await initShippingTables(database, "mock")
    const repository = new RuntimeRepository(database)
    let shouldFail = true
    const runtime = new BackgroundRuntime(repository)
    runtime.register(job({
      id: "failing-job",
      providerId: "provider-failing",
      run: async () => shouldFail ? Promise.reject(new Error("boom")) : { status: "success" },
    }))
    runtime.register(job({
      id: "healthy-job",
      providerId: "provider-healthy",
      run: async () => ({ status: "success", recordsWritten: 2 }),
    }))
    await runtime.start()
    const [failed, healthy] = await Promise.all([runtime.runNow("failing-job"), runtime.runNow("healthy-job")])

    expect(failed).toMatchObject({ status: "failed", errorCode: "job_failed" })
    expect(healthy).toMatchObject({ status: "success", recordsWritten: 2 })
    expect(runtime.getStatus().running).toBe(true)
    expect(runtime.getStatus().jobs.find(item => item.id === "failing-job")).toMatchObject({ status: "failed", consecutiveFailures: 1 })
    expect(await repository.listSyncRuns("provider-failing")).toEqual([expect.objectContaining({ status: "failed", errorMessage: "boom" })])
    expect(await repository.listSyncRuns("provider-healthy")).toEqual([expect.objectContaining({ status: "success", recordsWritten: 2 })])

    shouldFail = false
    await expect(runtime.runNow("failing-job")).resolves.toMatchObject({ status: "success" })
    expect(await repository.getProviderRuntime("provider-failing", "test")).toMatchObject({ status: "healthy", consecutiveFailures: 0, lastSuccessAt: expect.any(String) })
    native.close()
  })

  it("propagates a ProviderError code through sync_runs, provider_runtime and provider_usage", async () => {
    const { database, native } = createNativeDatabase()
    await initShippingTables(database, "mock")
    const repository = new RuntimeRepository(database)
    const runtime = new BackgroundRuntime(repository)
    runtime.register(job({
      id: "provider-error-job",
      providerId: "provider-error",
      capability: "feed_sync",
      run: async () => {
        throw new ProviderError("rate_limited", "provider quota reached")
      },
    }))
    await runtime.start()
    await expect(runtime.runNow("provider-error-job")).resolves.toMatchObject({ status: "failed", errorCode: "rate_limited" })
    runtime.stop()

    expect(await repository.listSyncRuns("provider-error")).toEqual([expect.objectContaining({ status: "failed", errorCode: "rate_limited" })])
    expect(await repository.getProviderRuntime("provider-error", "feed_sync")).toMatchObject({ status: "failed", errorCode: "rate_limited" })
    expect(native.prepare("SELECT provider_id, capability, request_count, success_count, failure_count, records_count, error_code FROM provider_usage WHERE provider_id = 'provider-error'").all()).toEqual([
      { provider_id: "provider-error", capability: "feed_sync", request_count: 1, success_count: 0, failure_count: 1, records_count: 0, error_code: "rate_limited" },
    ])
    native.close()
  })

  it("does not create a new sync run after stop", async () => {
    const { database, native } = createNativeDatabase()
    await initShippingTables(database, "mock")
    const repository = new RuntimeRepository(database)
    const runtime = new BackgroundRuntime(repository)
    runtime.register(job({ id: "stoppable-job", providerId: "provider-stoppable", intervalMs: 10 }))
    await runtime.start()
    await expect(runtime.runNow("stoppable-job")).resolves.toMatchObject({ status: "success" })
    runtime.stop()
    await new Promise(resolve => setTimeout(resolve, 30))
    expect(await repository.listSyncRuns("provider-stoppable")).toHaveLength(1)
    await expect(runtime.runNow("stoppable-job")).resolves.toMatchObject({ status: "skipped", errorCode: "runtime_stopped" })
    native.close()
  })

  it("keeps provider runtime rows independent across capabilities and restart", async () => {
    const root = mkdtempSync("shipping-hot-runtime-capability-")
    const path = `${root}/runtime.sqlite3`
    try {
      const first = createNativeDatabase(path)
      await initShippingTables(first.database, "mock")
      const repository = new RuntimeRepository(first.database)
      const runtime = new BackgroundRuntime(repository)
      runtime.register(job({ id: "capability-a", providerId: "provider-shared", capability: "capability-A", run: async () => ({ status: "success" }) }))
      runtime.register(job({ id: "capability-b", providerId: "provider-shared", capability: "capability-B", run: async () => ({ status: "failed", errorCode: "capability_b_failed" }) }))
      await runtime.start()
      await Promise.all([runtime.runNow("capability-a"), runtime.runNow("capability-b")])

      const rows = (await repository.listProviderRuntime()).filter(item => item.providerId === "provider-shared")
      expect(rows).toHaveLength(2)
      expect(await repository.getProviderRuntime("provider-shared", "capability-A")).toMatchObject({ status: "healthy", consecutiveFailures: 0, lastSuccessAt: expect.any(String) })
      expect(await repository.getProviderRuntime("provider-shared", "capability-B")).toMatchObject({ status: "failed", consecutiveFailures: 1, lastSuccessAt: undefined })
      runtime.stop()
      first.native.close()

      const reopened = createNativeDatabase(path)
      await initShippingTables(reopened.database, "mock")
      const reopenedRepository = new RuntimeRepository(reopened.database)
      expect(await reopenedRepository.getProviderRuntime("provider-shared", "capability-A")).toMatchObject({ status: "healthy", consecutiveFailures: 0 })
      expect(await reopenedRepository.getProviderRuntime("provider-shared", "capability-B")).toMatchObject({ status: "failed", consecutiveFailures: 1 })
      reopened.native.close()
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it("does not let a disabled capability disable another capability", async () => {
    const { database, native } = createNativeDatabase()
    await initShippingTables(database, "mock")
    const repository = new RuntimeRepository(database)
    const runtime = new BackgroundRuntime(repository)
    runtime.register(job({ id: "disabled-capability", providerId: "provider-shared", capability: "capability-A", enabled: false }))
    runtime.register(job({ id: "enabled-capability", providerId: "provider-shared", capability: "capability-B" }))
    await runtime.start()

    expect(await repository.getProviderRuntime("provider-shared", "capability-A")).toMatchObject({ status: "disabled" })
    expect(await repository.getProviderRuntime("provider-shared", "capability-B")).toMatchObject({ status: "never_succeeded" })
    runtime.stop()
    native.close()
  })

  it("resets timer cadence after runNow and persists skipped cadence", async () => {
    vi.useFakeTimers()
    const startAt = new Date("2026-08-24T00:00:00.000Z")
    vi.setSystemTime(startAt)
    const { database, native } = createNativeDatabase()
    try {
      await initShippingTables(database, "mock")
      const repository = new RuntimeRepository(database)
      const run = vi.fn(async () => ({ status: "success" as const }))
      const runtime = new BackgroundRuntime(repository)
      runtime.register(job({ id: "cadence-job", providerId: "provider-cadence", capability: "cadence", intervalMs: 60 * 60 * 1000, run }))
      await runtime.start()
      expect((await repository.getProviderRuntime("provider-cadence", "cadence"))?.nextSyncAt).toBe("2026-08-24T01:00:00.000Z")

      await vi.advanceTimersByTimeAsync(30 * 60 * 1000)
      await runtime.runNow("cadence-job")
      expect(run).toHaveBeenCalledTimes(1)
      expect((await repository.getProviderRuntime("provider-cadence", "cadence"))?.nextSyncAt).toBe("2026-08-24T01:30:00.000Z")
      expect(runtime.getStatus().jobs[0].nextSyncAt).toBe("2026-08-24T01:30:00.000Z")

      await vi.advanceTimersByTimeAsync(30 * 60 * 1000)
      expect(run).toHaveBeenCalledTimes(1)
      await vi.advanceTimersByTimeAsync(30 * 60 * 1000)
      expect(run).toHaveBeenCalledTimes(2)
      runtime.stop()

      const skippedRuntime = new BackgroundRuntime(repository)
      skippedRuntime.register(job({ id: "skipped-job", providerId: "provider-skipped", capability: "skipped", intervalMs: 60 * 60 * 1000, run: async () => ({ status: "skipped", errorCode: "not_due" }) }))
      await skippedRuntime.start()
      await skippedRuntime.runNow("skipped-job")
      expect(await repository.getProviderRuntime("provider-skipped", "skipped")).toMatchObject({ status: "never_succeeded", nextSyncAt: "2026-08-24T02:30:00.000Z", errorCode: "not_due" })
      skippedRuntime.stop()
    } finally {
      native.close()
      vi.useRealTimers()
    }
  })
})

describe("runtimeRepository persistence", () => {
  it("keeps sync history and provider runtime state across database reopen", async () => {
    const root = mkdtempSync("shipping-hot-runtime-")
    const path = `${root}/runtime.sqlite3`
    try {
      const first = createNativeDatabase(path)
      await initShippingTables(first.database, "mock")
      const repository = new RuntimeRepository(first.database)
      const run = await repository.createSyncRun({ providerId: "provider-restart", capability: "test", startedAt: "2026-08-24T00:00:00.000Z" })
      await repository.completeSyncRun({ id: run.id, status: "success", completedAt: "2026-08-24T00:00:01.000Z", recordsRead: 3, recordsWritten: 2 })
      await repository.updateProviderRuntime({ providerId: "provider-restart", capability: "test", status: "healthy", lastSuccessAt: "2026-08-24T00:00:01.000Z", nextSyncAt: "2026-08-24T01:00:01.000Z", consecutiveFailures: 0, updatedAt: "2026-08-24T00:00:01.000Z" })
      first.native.close()

      const second = createNativeDatabase(path)
      await initShippingTables(second.database, "mock")
      const reopened = new RuntimeRepository(second.database)
      expect(await reopened.getProviderRuntime("provider-restart", "test")).toMatchObject({ status: "healthy", lastSuccessAt: "2026-08-24T00:00:01.000Z" })
      expect(await reopened.listSyncRuns("provider-restart")).toEqual([expect.objectContaining({ status: "success", recordsRead: 3, recordsWritten: 2 })])
      second.native.close()
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it("rebuilds the legacy provider runtime table without losing rows", async () => {
    const { database, native } = createNativeDatabase()
    native.exec(`
      CREATE TABLE provider_runtime (
        provider_id TEXT PRIMARY KEY,
        capability TEXT NOT NULL,
        status TEXT NOT NULL,
        last_request_at TEXT,
        last_success_at TEXT,
        last_failure_at TEXT,
        last_source_updated_at TEXT,
        last_fetched_at TEXT,
        cache_age_seconds INTEGER,
        ttl_seconds INTEGER,
        next_sync_at TEXT,
        consecutive_failures INTEGER NOT NULL DEFAULT 0,
        error_code TEXT,
        error_message TEXT,
        rate_limit_reset_at TEXT,
        data_count INTEGER,
        coverage_json TEXT,
        updated_at TEXT NOT NULL
      );
      INSERT INTO provider_runtime (provider_id, capability, status, last_success_at, consecutive_failures, updated_at)
      VALUES ('provider-legacy', 'legacy-capability', 'healthy', '2026-08-24T00:00:00.000Z', 0, '2026-08-24T00:00:01.000Z');
    `)
    const { p2cRuntimeFoundationMigration } = await import("#/database/migrations/006-p2c-runtime-foundation")
    await p2cRuntimeFoundationMigration.up(database)
    const repository = new RuntimeRepository(database)

    expect(await repository.getProviderRuntime("provider-legacy", "legacy-capability")).toMatchObject({ status: "healthy", lastSuccessAt: "2026-08-24T00:00:00.000Z" })
    expect(native.prepare("SELECT COUNT(*) AS count FROM pragma_index_list('provider_runtime') WHERE origin = 'pk'").get()).toEqual({ count: 1 })
    native.close()
  })

  it("clears running state when start initialization fails", async () => {
    const repository = {
      getProviderRuntime: async () => {
        throw new Error("repository_init_failed")
      },
    } as unknown as RuntimeRepository
    const runtime = new BackgroundRuntime(repository)
    runtime.register(job({ id: "start-failure", providerId: "provider-start-failure", capability: "start-failure" }))

    await expect(runtime.start()).rejects.toThrow("repository_init_failed")
    expect(runtime.getStatus()).toMatchObject({ running: false, jobs: [expect.objectContaining({ executionStatus: "idle" })] })
  })

  it("allows bootstrap recovery after a failed runtime start", async () => {
    vi.useFakeTimers()
    const { database, native } = createNativeDatabase()
    const failingRepository = {
      getProviderRuntime: async () => {
        throw new Error("bootstrap_repository_failed")
      },
    } as unknown as RuntimeRepository
    try {
      await expect(bootstrapBackgroundRuntime({ database, repository: failingRepository, jobs: [job({ id: "bootstrap-failure", providerId: "provider-bootstrap", capability: "bootstrap" })], enabled: true })).rejects.toThrow("bootstrap_repository_failed")
      expect(getBackgroundRuntime()).toBeUndefined()
      expect(vi.getTimerCount()).toBe(0)

      const recovered = await bootstrapBackgroundRuntime({ database, jobs: [job({ id: "bootstrap-recovered", providerId: "provider-bootstrap", capability: "bootstrap" })], enabled: true })
      expect(recovered.getStatus().running).toBe(true)
      expect(getBackgroundRuntime()).toBe(recovered)
      recovered.stop()
    } finally {
      await shutdownBackgroundRuntime()
      native.close()
      vi.useRealTimers()
    }
  })
})
