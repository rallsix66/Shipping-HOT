import { mkdtempSync, rmSync } from "node:fs"
import NativeDatabase from "better-sqlite3"
import { createDatabase } from "db0"
import { afterEach, describe, expect, it } from "vitest"
import { RuntimeRepository } from "#/database/runtime-jobs"
import { initShippingTables } from "#/database/shipping"
import { bootstrapBackgroundRuntime, shutdownBackgroundRuntime } from "#/runtime/bootstrap"
import { BackgroundRuntime, type RuntimeJob } from "#/runtime/background-runtime"

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

afterEach(() => {
  shutdownBackgroundRuntime()
})

describe("backgroundRuntime", () => {
  it("keeps bootstrap singleton state and does not register a second timer/job", async () => {
    const { database, native } = createNativeDatabase()
    const first = await bootstrapBackgroundRuntime({ database, jobs: [job()], enabled: true })
    const second = await bootstrapBackgroundRuntime({ database, jobs: [job({ id: "other-job" })], enabled: true })

    expect(second).toBe(first)
    expect(first.getStatus().jobs).toHaveLength(1)
    expect(first.getStatus().jobs[0].id).toBe("job-default")
    expect(await new RuntimeRepository(database).getProviderRuntime("provider-default")).toMatchObject({ status: "never_succeeded", consecutiveFailures: 0 })
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
    expect(await repository.getProviderRuntime("provider-failing")).toMatchObject({ status: "healthy", consecutiveFailures: 0, lastSuccessAt: expect.any(String) })
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
      expect(await reopened.getProviderRuntime("provider-restart")).toMatchObject({ status: "healthy", lastSuccessAt: "2026-08-24T00:00:01.000Z" })
      expect(await reopened.listSyncRuns("provider-restart")).toEqual([expect.objectContaining({ status: "success", recordsRead: 3, recordsWritten: 2 })])
      second.native.close()
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
