import process from "node:process"
import { mkdirSync, mkdtempSync } from "node:fs"
import { access, readFile, writeFile } from "node:fs/promises"
import { createServer } from "node:http"
import { resolve } from "node:path"
import { pathToFileURL } from "node:url"
import { spawnSync } from "node:child_process"
import { createApp, createRouter, toNodeListener } from "h3"
import { afterEach, expect, it, vi } from "vitest"
import { productionIntelOptions } from "#/runtime/intel-production"
import { acquireIntelDatabaseOwnership } from "#/runtime/intel-ownership"
import { bootstrapBackgroundRuntime, shutdownBackgroundRuntime } from "#/runtime/bootstrap"
import { getDefaultRuntimeJobs } from "#/runtime/registry"
import { INTEL_COLLECT_JOB_ID } from "#/runtime/intel-collect-job"
import { open } from "#/intel/__fixtures__/isolated-db"
import { defaultTransport } from "#/services/article-fetch-security"
import { initShippingTables } from "#/database/shipping"
import itemsHandler from "#/api/shipping/intel/items.get"

afterEach(async () => {
  await shutdownBackgroundRuntime()
  vi.unstubAllEnvs()
})
const enabled = { SHIPPING_INTEL_ENABLED: "true", SHIPPING_INTEL_SOURCE_IDS: "TH-W01" }
it("defaults off with no sources/dependency work and rejects incomplete enabled settings", () => {
  expect(productionIntelOptions({ env: {}, dependencies: null }).registry?.intel).toMatchObject({ enabled: false, seeds: [] })
  expect(() => productionIntelOptions({ env: { SHIPPING_INTEL_ENABLED: "true" } })).toThrow("source_selection_invalid")
  expect(() => productionIntelOptions({ env: enabled, dependencies: null })).toThrow("dependencies_missing")
  expect(() => productionIntelOptions({ env: { ...enabled, SHIPPING_INTEL_SOURCE_IDS: "CN-P05" } })).toThrow("source_selection_invalid")
  expect(() => productionIntelOptions({ env: { ...enabled, SHIPPING_RUNTIME_ENABLED: "false" } })).toThrow("requires_running_runtime")
  const realEntry = productionIntelOptions({ env: enabled })
  expect(realEntry.registry?.intel?.fetch?.transport).toBe(defaultTransport)
  expect(realEntry.registry?.intel?.seeds?.map(seed => seed.catalogId)).toEqual(["TH-W01"])
  expect(typeof realEntry.acquireIntelOwnership).toBe("function") // constructed only, never invoked here
})

it("holds a database-scoped lease across processes, refuses competitors and never deletes a stale lease", async () => {
  mkdirSync(".tmp", { recursive: true })
  const dir = mkdtempSync(resolve(".tmp", "intel-production-lock-"))
  const file = resolve(dir, "isolated.sqlite3")
  const lease = await acquireIntelDatabaseOwnership(file)
  try {
    await expect(acquireIntelDatabaseOwnership(file)).rejects.toThrow("owner_busy")
    const moduleUrl = pathToFileURL(resolve("server/runtime/intel-ownership.ts")).href
    const script = `const {acquireIntelDatabaseOwnership}=await import(${JSON.stringify(moduleUrl)});try{const lease=await acquireIntelDatabaseOwnership(process.argv[1]);await lease.release();console.log('acquired')}catch(e){console.log(e.message)}`
    const child = spawnSync(process.execPath, ["--import", "tsx/esm", "--input-type=module", "-e", script, file], { encoding: "utf8", windowsHide: true })
    expect(child.status).toBe(0)
    expect(child.stdout.trim()).toBe("intel_database_owner_busy")
    expect(JSON.parse(await readFile(`${file}.intel-owner.lock`, "utf8")).pid).toBe(process.pid)
  } finally {
    await lease.release()
  }
  await expect(access(`${file}.intel-owner.lock`)).rejects.toThrow()
  const next = await acquireIntelDatabaseOwnership(file)
  await next.release()
  const stale = JSON.stringify({ pid: -1, token: "synthetic-stale", database: file })
  await writeFile(`${file}.intel-owner.lock`, stale)
  await expect(acquireIntelDatabaseOwnership(file)).rejects.toThrow("owner_busy")
  expect(await readFile(`${file}.intel-owner.lock`, "utf8")).toBe(stale)
})

it("actual Nitro plugin defaults intel off; GET is query-only and never starts collection", async () => {
  const state = open()
  vi.stubEnv("SHIPPING_INTEL_ENABLED", "false")
  vi.stubEnv("SHIPPING_RUNTIME_ENABLED", "false")
  vi.stubEnv("SHIPPING_DATA_MODE", "real")
  vi.stubGlobal("useDatabase", () => state.database)
  vi.stubGlobal("defineNitroPlugin", (callback: unknown) => callback)
  const plugin = (await import("#/plugins/background-runtime")).default
  const hooks = { hook: vi.fn() }
  plugin({ hooks } as never)
  const runtime = await bootstrapBackgroundRuntime({ database: state.database, enabled: false })
  const app = createApp({ debug: false })
  app.use(createRouter().get("/api/shipping/intel/items", itemsHandler))
  const server = createServer(toNodeListener(app))
  try {
    expect(runtime.getStatus().jobs.find(job => job.id === INTEL_COLLECT_JOB_ID)?.enabled).toBe(false)
    expect(await runtime.runNow(INTEL_COLLECT_JOB_ID)).toMatchObject({ status: "skipped" })
    state.native.exec("PRAGMA query_only=ON")
    await new Promise<void>(done => server.listen(0, "127.0.0.1", done))
    const response = await fetch(`http://127.0.0.1:${(server.address() as { port: number }).port}/api/shipping/intel/items`)
    expect(response.status).toBe(200)
    expect(state.native.prepare("SELECT COUNT(*) AS n FROM intel_fetch_run").get()).toEqual({ n: 0 })
    expect(state.native.prepare("SELECT COUNT(*) AS n FROM intel_executor").get()).toEqual({ n: 0 })
    expect(hooks.hook).toHaveBeenCalledWith("close", expect.any(Function))
  } finally {
    server.closeAllConnections()
    await new Promise<void>(done => server.close(() => done()))
    await shutdownBackgroundRuntime()
    state.native.close()
    vi.unstubAllGlobals()
  }
})

it("the wired Runtime drains before ownership release and preserves all manual source state", async () => {
  mkdirSync(".tmp", { recursive: true })
  const dir = mkdtempSync(resolve(".tmp", "intel-production-drain-"))
  const file = resolve(dir, "isolated.sqlite3")
  const state = open(file)
  let resume!: () => void
  let entered!: () => void
  const waiting = new Promise<void>((done) => {
    entered = done
  })
  const hold = new Promise<void>((done) => {
    resume = done
  })
  const release = vi.fn(async () => {})
  const transport = vi.fn(async () => {
    entered()
    await hold
    return { status: 200, headers: { "content-type": "application/rss+xml" }, body: "<rss><channel><title>Offline empty</title></channel></rss>" }
  })
  vi.stubEnv("SHIPPING_DATA_MODE", "real")
  try {
    await initShippingTables(state.database, "real")
    const manualBefore = state.native.prepare("SELECT * FROM intel_source WHERE kind='manual' ORDER BY id").all()
    const options = productionIntelOptions({ env: enabled, dependencies: { fetch: { lookup: async () => [{ address: "93.184.216.34", family: 4 }], transport }, acquireOwnership: async () => {
      const lease = await acquireIntelDatabaseOwnership(file)
      return { release: async () => {
        await lease.release()
        await release()
      } }
    } } })
    const now = () => new Date("2026-10-20T12:00:00Z")
    const jobs = getDefaultRuntimeJobs({ ...options.registry, database: state.database, dataMode: "real", now }).filter(job => job.id === INTEL_COLLECT_JOB_ID)
    const runtime = await bootstrapBackgroundRuntime({ ...options, database: state.database, jobs, enabled: true, runtimeOptions: { now, setTimeout: vi.fn(() => 0) as never, clearTimeout: vi.fn(), logger: { info: vi.fn(), error: vi.fn() } } })
    const active = runtime.runNow(INTEL_COLLECT_JOB_ID)
    await waiting
    const stop = shutdownBackgroundRuntime()
    await expect(acquireIntelDatabaseOwnership(file)).rejects.toThrow("owner_busy")
    expect(release).not.toHaveBeenCalled()
    resume()
    expect((await active).status).toBe("success")
    await stop
    expect(release).toHaveBeenCalledTimes(1)
    expect(transport).toHaveBeenCalledTimes(1)
    expect(state.native.prepare("SELECT * FROM intel_source WHERE kind='manual' ORDER BY id").all()).toEqual(manualBefore)
  } finally {
    resume?.()
    await shutdownBackgroundRuntime()
    state.native.close()
  }
})
