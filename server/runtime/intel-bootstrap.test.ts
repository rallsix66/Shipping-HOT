import { mkdirSync, mkdtempSync } from "node:fs"
import { resolve } from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { open } from "#/intel/__fixtures__/isolated-db"
import { intelSourceSeeds } from "#/intel/sources"
import { bootstrapBackgroundRuntime, shutdownBackgroundRuntime } from "#/runtime/bootstrap"
import { getDefaultRuntimeJobs } from "#/runtime/registry"
import { INTEL_COLLECT_JOB_ID, createIntelCollectJob } from "#/runtime/intel-collect-job"
import { initShippingTables } from "#/database/shipping"

const TEST_NOW = Date.parse("2026-10-13T02:00:00Z")
let clock = TEST_NOW
const now = () => new Date(clock)
const A = { ...intelSourceSeeds[0], id: "test:runtime-a", intervalMs: 1000 }
const B = { ...intelSourceSeeds[1], id: "test:runtime-b", intervalMs: 1000 }
const lookup = async (_host: string) => [{ address: "93.184.216.34", family: 4 as const }]
const body = (url: URL) => `<rss><channel><item><title>Offline runtime</title><link>${url.origin}/article</link><pubDate>2026-10-13T02:00:00Z</pubDate></item></channel></rss>`
const transport = vi.fn(async (url: URL) => ({ status: 200, headers: { "content-type": "application/rss+xml" }, body: body(url) }))
const fetch = { lookup, transport }
const runtimeOptions = { now, logger: { info: vi.fn(), error: vi.fn() } }

/** Test ownership provider: denial/release models a DB-scoped lease, not an age-based recovery signal. */
function ownership() {
  let held = false
  const release = vi.fn(async () => {
    held = false
  })
  const acquire = vi.fn(async () => {
    if (held) throw new Error("test_database_owner_busy")
    held = true
    return { release }
  })
  return { acquire, release, isHeld: () => held }
}

beforeEach(() => {
  clock = TEST_NOW
  vi.useFakeTimers()
  vi.stubEnv("SHIPPING_DATA_MODE", "mock")
  vi.stubEnv("SHIPPING_FEED_PROVIDER", "")
  vi.stubEnv("SHIPPING_WEATHER_ALERT_PROVIDER", "")
  transport.mockClear()
})
afterEach(async () => {
  await shutdownBackgroundRuntime()
  vi.useRealTimers()
  vi.unstubAllEnvs()
})

describe("intel actual registry/bootstrap path (offline)", () => {
  it.each(["end", "release"] as const)("keeps failed %s cleanup retryable and never returns a stopped runtime", async (failure) => {
    const state = open()
    const owner = ownership()
    const registry = { intel: { enabled: true, fetch, seeds: [A] } }
    const options = { database: state.database, registry, runtimeOptions, acquireIntelOwnership: owner.acquire }
    const jobs = getDefaultRuntimeJobs({ ...registry, database: state.database, dataMode: "mock", now })
    const intel = jobs.find(job => job.id === INTEL_COLLECT_JOB_ID) as ReturnType<typeof createIntelCollectJob>
    const end = vi.spyOn(intel, "end")
    if (failure === "end") end.mockRejectedValueOnce(new Error("first end failure"))
    else owner.release.mockRejectedValueOnce(new Error("first release failure"))
    try {
      const old = await bootstrapBackgroundRuntime({ ...options, jobs })
      await old.runNow(INTEL_COLLECT_JOB_ID)
      await expect(shutdownBackgroundRuntime()).rejects.toThrow(`first ${failure} failure`)
      expect(old.getStatus().running).toBe(false)
      expect(owner.isHeld()).toBe(true)
      expect(owner.release).toHaveBeenCalledTimes(failure === "end" ? 0 : 1)
      await expect(bootstrapBackgroundRuntime(options)).rejects.toThrow("runtime_shutdown_incomplete")
      expect(owner.acquire).toHaveBeenCalledTimes(1)
      await shutdownBackgroundRuntime()
      expect(owner.isHeld()).toBe(false)
      expect(end).toHaveBeenCalledTimes(failure === "end" ? 2 : 1)
      expect(owner.release).toHaveBeenCalledTimes(failure === "end" ? 1 : 2)
      await shutdownBackgroundRuntime()
      expect(end).toHaveBeenCalledTimes(failure === "end" ? 2 : 1)
      expect(owner.release).toHaveBeenCalledTimes(failure === "end" ? 1 : 2)
      const next = await bootstrapBackgroundRuntime(options)
      expect(next).not.toBe(old)
      expect(next.getStatus().running).toBe(true)
      clock += 1000
      expect(await next.runNow(INTEL_COLLECT_JOB_ID)).toMatchObject({ status: "success" })
      expect(owner.acquire).toHaveBeenCalledTimes(2)
    } finally {
      await shutdownBackgroundRuntime()
      state.native.close()
    }
  })
  it("releases acquired ownership after startup failure and permits a clean retry", async () => {
    const state = open()
    const owner = ownership()
    const options = { database: state.database, registry: { intel: { enabled: true, fetch, seeds: [A] } }, acquireIntelOwnership: owner.acquire }
    try {
      await expect(bootstrapBackgroundRuntime({ ...options, runtimeOptions: { ...runtimeOptions, setTimeout: (() => {
        throw new Error("injected timer failure")
      }) as unknown as typeof setTimeout } })).rejects.toThrow("injected timer failure")
      expect(owner.release).toHaveBeenCalledTimes(1)
      expect(owner.isHeld()).toBe(false)
      const runtime = await bootstrapBackgroundRuntime({ ...options, runtimeOptions })
      expect(await runtime.runNow(INTEL_COLLECT_JOB_ID)).toMatchObject({ status: "success" })
    } finally {
      await shutdownBackgroundRuntime()
      state.native.close()
    }
  })

  it("rejects a missing lease result before startup recovery", async () => {
    const state = open()
    try {
      await initShippingTables(state.database, "mock")
      await state.repository.upsertSource(A, now().toISOString())
      await state.repository.registerExecutor("unknown-live-owner", now().toISOString())
      await state.repository.beginRun(A.id, now().toISOString(), "unknown-live-owner")
      await expect(bootstrapBackgroundRuntime({ database: state.database, recoverInterruptedIntel: true, acquireIntelOwnership: (async () => undefined) as never, runtimeOptions })).rejects.toThrow("ownership_lease_invalid")
      expect((await state.repository.listRuns(A.id))[0].status).toBe("running")
    } finally {
      await shutdownBackgroundRuntime()
      state.native.close()
    }
  })
  it("registers exactly one disabled intel task with only disabled catalog seeds, no egress or duplicate Feed/weather tasks", async () => {
    const state = open()
    try {
      const runtime = await bootstrapBackgroundRuntime({ database: state.database, enabled: true, runtimeOptions })
      const jobs = runtime.getStatus().jobs
      expect(jobs.filter(job => job.id === INTEL_COLLECT_JOB_ID)).toMatchObject([{ enabled: false, status: "disabled" }])
      expect(new Set(jobs.map(job => job.id)).size).toBe(jobs.length)
      expect(jobs.filter(job => job.id === "weather-sync")).toHaveLength(1)
      expect(jobs.filter(job => job.id === "feed-sync:mock-port-notice")).toHaveLength(1)
      expect(await runtime.runNow(INTEL_COLLECT_JOB_ID)).toMatchObject({ status: "skipped", errorCode: "job_disabled" })
      expect(state.native.prepare("SELECT COUNT(*) AS n FROM intel_source WHERE enabled = 1").get()).toEqual({ n: 0 })
      expect(state.native.prepare("SELECT COUNT(*) AS n FROM intel_source WHERE kind='manual'").get()).toEqual({ n: 49 })
      expect(state.native.prepare("SELECT COUNT(*) AS n FROM intel_executor").get()).toEqual({ n: 0 })
      expect(transport).not.toHaveBeenCalled()
      expect(getDefaultRuntimeJobs({ database: state.database, dataMode: "mock" }).find(job => job.id === INTEL_COLLECT_JOB_ID)?.enabled).toBe(false)
      expect(() => getDefaultRuntimeJobs({ database: state.database, dataMode: "mock", intel: { enabled: true, fetch } })).toThrow("explicit_fetch_and_sources")
    } finally {
      await shutdownBackgroundRuntime()
      state.native.close()
    }
  })

  it("schedules the factory intel job, respects per-source due/backoff, and keeps health independent", async () => {
    const state = open()
    const owner = ownership()
    const calls: string[] = []
    const offline = { lookup, transport: async (url: URL) => {
      calls.push(url.toString())
      return url.toString() === B.url ? { status: 503, headers: {}, body: "" } : { status: 200, headers: { "content-type": "application/rss+xml" }, body: body(url) }
    } }
    try {
      const options = { database: state.database, enabled: true, runtimeOptions, registry: { intel: { enabled: true, fetch: offline, seeds: [A, B], intervalMs: 1000 } }, acquireIntelOwnership: owner.acquire }
      const [runtime, repeated] = await Promise.all([bootstrapBackgroundRuntime(options), bootstrapBackgroundRuntime(options)])
      expect(repeated).toBe(runtime)
      expect(owner.acquire).toHaveBeenCalledTimes(1)
      clock += 1000
      await vi.advanceTimersByTimeAsync(1000)
      expect(calls).toEqual([A.url, B.url])
      expect(await state.repository.getSource(A.id)).toMatchObject({ status: "ok", consecutiveFailures: 0 })
      expect(await state.repository.getSource(B.id)).toMatchObject({ status: "failing", consecutiveFailures: 1, nextSyncAt: new Date(clock + 15 * 60000).toISOString() })
      await runtime.runNow(INTEL_COLLECT_JOB_ID)
      expect(calls).toHaveLength(2)
      clock += 1000
      await runtime.runNow(INTEL_COLLECT_JOB_ID)
      expect(calls).toEqual([A.url, B.url, A.url])
      clock = TEST_NOW + 16 * 60000
      await runtime.runNow(INTEL_COLLECT_JOB_ID)
      expect(calls).toEqual([A.url, B.url, A.url, A.url, B.url])
      expect(await state.repository.getSource(B.id)).toMatchObject({ consecutiveFailures: 2, nextSyncAt: new Date(clock + 30 * 60000).toISOString() })
      expect(await state.repository.getSource(A.id)).toMatchObject({ status: "ok", consecutiveFailures: 0 })
      expect(runtime.getStatus().jobs.filter(job => job.executionStatus === "success").map(job => job.id)).toEqual([INTEL_COLLECT_JOB_ID])
    } finally {
      await shutdownBackgroundRuntime()
      state.native.close()
    }
    expect(owner.release).toHaveBeenCalledTimes(1)
  })

  it("rejects reentry and drains before executor end/lease release or another bootstrap", async () => {
    const state = open()
    const owner = ownership()
    let resume!: () => void
    let entered!: () => void
    const paused = new Promise<void>((resolve) => {
      entered = resolve
    })
    const hold = new Promise<void>((resolve) => {
      resume = resolve
    })
    const offline = { lookup, transport: async (url: URL) => {
      entered()
      await hold
      return { status: 200, headers: { "content-type": "application/rss+xml" }, body: body(url) }
    } }
    try {
      const options = { database: state.database, runtimeOptions, registry: { intel: { enabled: true, fetch: offline, seeds: [A] } }, acquireIntelOwnership: owner.acquire }
      const runtime = await bootstrapBackgroundRuntime(options)
      const active = runtime.runNow(INTEL_COLLECT_JOB_ID)
      await paused
      expect(await runtime.runNow(INTEL_COLLECT_JOB_ID)).toMatchObject({ status: "skipped", errorCode: "job_running" })
      const shutdown = shutdownBackgroundRuntime()
      await Promise.resolve()
      expect(owner.release).not.toHaveBeenCalled()
      expect(state.native.prepare("SELECT ended_at FROM intel_executor").get()).toEqual({ ended_at: null })
      const restarting = bootstrapBackgroundRuntime(options)
      resume()
      await active
      await shutdown
      const next = await restarting
      expect(next).not.toBe(runtime)
      expect(owner.acquire).toHaveBeenCalledTimes(2)
      expect(owner.release).toHaveBeenCalledTimes(1)
      expect((state.native.prepare("SELECT ended_at FROM intel_executor").get() as { ended_at: string }).ended_at).not.toBeNull()
    } finally {
      resume?.()
      await shutdownBackgroundRuntime()
      state.native.close()
    }
  })

  it("cannot recover a live external executor without explicit acquired DB ownership", async () => {
    const state = open()
    const owner = ownership()
    let resume!: () => void
    let entered!: () => void
    const paused = new Promise<void>((resolve) => {
      entered = resolve
    })
    const hold = new Promise<void>((resolve) => {
      resume = resolve
    })
    try {
      await initShippingTables(state.database, "mock")
      const lease = await owner.acquire()
      const job = createIntelCollectJob({ db: state.database, enabled: true, seeds: [A], now, fetch: { lookup, transport: async (url) => {
        entered()
        await hold
        return { status: 200, headers: { "content-type": "application/rss+xml" }, body: body(url) }
      } } })
      const running = job.run()
      await paused
      await expect(bootstrapBackgroundRuntime({ database: state.database, runtimeOptions, recoverInterruptedIntel: true })).rejects.toThrow("exclusive_ownership_required")
      await expect(bootstrapBackgroundRuntime({ database: state.database, runtimeOptions, recoverInterruptedIntel: true, acquireIntelOwnership: owner.acquire })).rejects.toThrow("owner_busy")
      expect((await state.repository.listRuns(A.id))[0].status).toBe("running")
      await expect(job.end()).rejects.toThrow("executor_busy")
      resume()
      await running
      await job.end()
      await lease.release()
    } finally {
      resume?.()
      await shutdownBackgroundRuntime()
      state.native.close()
    }
  })

  it("reopens an isolated DB and recovers crash rows only after ownership acquisition, then collects", async () => {
    mkdirSync(".tmp", { recursive: true })
    const path = resolve(mkdtempSync(".tmp/intel-bootstrap-"), "isolated.sqlite3")
    const old = open(path)
    await initShippingTables(old.database, "mock")
    await old.repository.upsertSource(A, now().toISOString())
    await old.repository.registerExecutor("synthetic-crashed-process", now().toISOString())
    await old.repository.beginRun(A.id, now().toISOString(), "synthetic-crashed-process")
    old.native.close() // The old connection is actually gone; the residual run is synthetic crash evidence.
    const state = open(path)
    const owner = ownership()
    try {
      const acquire = async () => {
        expect((await state.repository.listRuns(A.id))[0].status).toBe("running")
        return owner.acquire()
      }
      const options = { database: state.database, runtimeOptions, registry: { intel: { enabled: true, fetch, seeds: [A] } }, acquireIntelOwnership: acquire, recoverInterruptedIntel: true }
      const runtime = await bootstrapBackgroundRuntime(options)
      expect((await state.repository.listRuns(A.id))[0]).toMatchObject({ status: "failed", errorCode: "interrupted" })
      const again = await bootstrapBackgroundRuntime(options)
      expect(again).toBe(runtime)
      expect(owner.acquire).toHaveBeenCalledTimes(1)
      expect(await runtime.runNow(INTEL_COLLECT_JOB_ID)).toMatchObject({ status: "success", recordsWritten: 1 })
      expect(await state.repository.listItems(A.id)).toHaveLength(1)
    } finally {
      await shutdownBackgroundRuntime()
      state.native.close()
    }
  })
})
