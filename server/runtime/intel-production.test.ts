import process from "node:process"
import { mkdirSync, mkdtempSync } from "node:fs"
import { access, readFile, writeFile } from "node:fs/promises"
import { createServer } from "node:http"
import { resolve } from "node:path"
import { pathToFileURL } from "node:url"
import { spawnSync } from "node:child_process"
import { createApp, createRouter, toNodeListener } from "h3"
import { afterEach, describe, expect, it, vi } from "vitest"
import { PRODUCTION_ALLOW_SELECT_CATALOG_IDS, productionIntelOptions } from "#/runtime/intel-production"
import { registeredIntelSources } from "#/intel/sources/registry"
import { htmlIndexCandidates } from "#/intel/sources/html-index-candidates"
import { rssCandidates } from "#/intel/sources/rss-candidates"
import { intelSourceSeeds } from "#/intel/sources.ts"
import { SPLASH247_RSS_SYNTHETIC } from "#/intel/sources/__fixtures__/splash247-rss-synthetic"
import { maerskHtml as MAERSK_SYNTHETIC } from "#/intel/sources/__fixtures__/maersk-news-synthetic"
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
/** Independent literal expected allow-select set (must not be derived from PRODUCTION_ALLOW_SELECT_CATALOG_IDS). */
const EXPECTED_ALLOW_SELECT_LITERAL = [
  "TH-W01",
  "ID-W01",
  "CN-T02",
  "TH-C01",
  "PH-C01",
  "CN-P01",
  "TH-C02",
  "VN-P03",
  "VN-T01",
  "ID-T01",
  "XX-K03",
  "ID-T02",
  "VN-D01",
  "XX-K02",
  "XX-K01",
  "MY-C01",
  "MY-T01",
  "PH-M01",
  "XX-M03",
] as const
it("defaults off with no sources/dependency work and rejects incomplete enabled settings", () => {
  expect(productionIntelOptions({ env: {}, dependencies: null }).registry?.intel).toMatchObject({ enabled: false, seeds: [] })
  expect(productionIntelOptions({ env: { SHIPPING_INTEL_ENABLED: "" } }).registry?.intel).toEqual({ enabled: false, seeds: [] })
  expect(productionIntelOptions({ env: { SHIPPING_INTEL_ENABLED: "false" } }).registry?.intel).toEqual({ enabled: false, seeds: [] })
  expect(() => productionIntelOptions({ env: { SHIPPING_INTEL_ENABLED: "true" } })).toThrow("source_selection_invalid")
  expect(() => productionIntelOptions({ env: { SHIPPING_INTEL_ENABLED: "true", SHIPPING_INTEL_SOURCE_IDS: "" } })).toThrow("source_selection_invalid")
  expect(() => productionIntelOptions({ env: { SHIPPING_INTEL_ENABLED: "true", SHIPPING_INTEL_SOURCE_IDS: " , , " } })).toThrow("source_selection_invalid")
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

describe("phase allow-select expansion", () => {
  const dependencies = {
    fetch: {
      lookup: vi.fn(async () => [{ address: "93.184.216.34", family: 4 as const }]),
      transport: vi.fn(async () => ({ status: 503, headers: {}, body: new Uint8Array() })),
    },
    acquireOwnership: vi.fn(async () => ({ release: async () => undefined })),
  }

  it("allow-select constant matches independent literal (old 2 + new 17) without deriving expected from the constant", () => {
    expect([...PRODUCTION_ALLOW_SELECT_CATALOG_IDS]).toEqual([...EXPECTED_ALLOW_SELECT_LITERAL])
    expect(PRODUCTION_ALLOW_SELECT_CATALOG_IDS).toHaveLength(19)
    expect(PRODUCTION_ALLOW_SELECT_CATALOG_IDS.slice(0, 2)).toEqual(["TH-W01", "ID-W01"])
    expect(PRODUCTION_ALLOW_SELECT_CATALOG_IDS.slice(2)).toEqual([
      "CN-T02",
      "TH-C01",
      "PH-C01",
      "CN-P01",
      "TH-C02",
      "VN-P03",
      "VN-T01",
      "ID-T01",
      "XX-K03",
      "ID-T02",
      "VN-D01",
      "XX-K02",
      "XX-K01",
      "MY-C01",
      "MY-T01",
      "PH-M01",
      "XX-M03",
    ])
  })

  it("accepts valid single and mixed selections in input order", () => {
    const single = productionIntelOptions({ env: { SHIPPING_INTEL_ENABLED: "true", SHIPPING_INTEL_SOURCE_IDS: "XX-M03" }, dependencies })
    expect(single.registry?.intel?.seeds?.map(s => s.catalogId)).toEqual(["XX-M03"])
    const mixed = productionIntelOptions({ env: { SHIPPING_INTEL_ENABLED: "true", SHIPPING_INTEL_SOURCE_IDS: "ID-W01,MY-C01,TH-W01,XX-K01" }, dependencies })
    expect(mixed.registry?.intel?.seeds?.map(s => s.catalogId)).toEqual(["ID-W01", "MY-C01", "TH-W01", "XX-K01"])
  })

  it("preserves original two license contracts and new seventeen disallowed", () => {
    const options = productionIntelOptions({
      env: { SHIPPING_INTEL_ENABLED: "true", SHIPPING_INTEL_SOURCE_IDS: "TH-W01,ID-W01,CN-T02,XX-M03,XX-K01" },
      dependencies,
    })
    const byId = Object.fromEntries(options.registry!.intel!.seeds!.map(s => [s.catalogId, s]))
    expect(byId["TH-W01"].persistence).toBe("full")
    expect(byId["ID-W01"].persistence).toBe("excerpt_only")
    expect(byId["CN-T02"].persistence).toBe("disallowed")
    expect(byId["XX-M03"].persistence).toBe("disallowed")
    expect(byId["XX-K01"].persistence).toBe("disallowed")
    expect(byId["XX-K01"].sourceHeaderLimit).toEqual({ sourceId: "intel:xx-k01", url: "https://www.maersk.com/news", maxHeaderSize: 32768 })
    for (const seed of options.registry!.intel!.seeds!) {
      expect(seed.enabled).toBe(true)
      expect(seed.adaptive).toEqual({ minMinutes: 15, maxMinutes: 60 })
    }
  })

  it.each([
    "CN-T01",
    "XX-M01",
    "MY-P02",
    "MY-P03",
    "CN-P05",
    "the-loadstar",
    "intel:xx-m03",
    "bounded:MY-C01",
    "TH-W01,CN-T01",
    "ID-W01,XX-M01",
    "XX-M03,XX-M01",
    "TH-W01,TH-W01",
    "TH-W01,the-loadstar",
  ])("rejects %s as whole-batch intel_source_selection_invalid", (ids) => {
    expect(() => productionIntelOptions({ env: { SHIPPING_INTEL_ENABLED: "true", SHIPPING_INTEL_SOURCE_IDS: ids }, dependencies })).toThrow("intel_source_selection_invalid")
  })

  it("fails closed with intel_source_config_missing when allow-selected id is absent from registry (isolated module mock; real shared registry untouched)", async () => {
    vi.resetModules()
    vi.doMock("#/intel/sources/registry", async () => {
      const actual = await vi.importActual<typeof import("#/intel/sources/registry")>("#/intel/sources/registry")
      return {
        ...actual,
        registeredIntelSources: actual.registeredIntelSources.filter(s => s.catalogId !== "PH-M01"),
      }
    })
    try {
      const { productionIntelOptions: isolatedProduction } = await import("#/runtime/intel-production")
      const { registeredIntelSources: mockedRegistry } = await import("#/intel/sources/registry")
      expect(mockedRegistry.some(s => s.catalogId === "PH-M01")).toBe(false)
      // Top-level static import still binds the real shared registry; mock must not mutate it.
      expect(registeredIntelSources.some(s => s.catalogId === "PH-M01")).toBe(true)
      expect(() =>
        isolatedProduction({
          env: { SHIPPING_INTEL_ENABLED: "true", SHIPPING_INTEL_SOURCE_IDS: "PH-M01" },
          dependencies,
        }),
      ).toThrow("intel_source_config_missing:PH-M01")
    } finally {
      vi.doUnmock("#/intel/sources/registry")
      vi.resetModules()
    }
  })

  it("structuredClone isolates returned seeds from registry and across calls", () => {
    const first = productionIntelOptions({ env: { SHIPPING_INTEL_ENABLED: "true", SHIPPING_INTEL_SOURCE_IDS: "XX-K01,MY-C01,XX-K02" }, dependencies })
    const byId = Object.fromEntries(first.registry!.intel!.seeds!.map(s => [s.catalogId, s]))
    const maerskCopy = byId["XX-K01"]
    const customsCopy = byId["MY-C01"]
    const oneCopy = byId["XX-K02"]
    const registryMaersk = registeredIntelSources.find(s => s.catalogId === "XX-K01")!
    const registryCustoms = registeredIntelSources.find(s => s.catalogId === "MY-C01")!
    const registryOne = registeredIntelSources.find(s => s.catalogId === "XX-K02")!
    expect(maerskCopy).not.toBe(registryMaersk)
    expect(maerskCopy.allowedHosts).not.toBe(registryMaersk.allowedHosts)
    expect(maerskCopy.webList).not.toBe(registryMaersk.webList)
    expect(maerskCopy.sourceHeaderLimit).not.toBe(registryMaersk.sourceHeaderLimit)
    expect(maerskCopy.allowedContentTypes).not.toBe(registryMaersk.allowedContentTypes)
    expect(maerskCopy.adaptive).not.toBe(registryMaersk.adaptive)
    expect(customsCopy.allowedHosts).not.toBe(registryCustoms.allowedHosts)
    expect(oneCopy).not.toBe(registryOne)
    expect(oneCopy.jsonList).not.toBe(registryOne.jsonList)
    expect(oneCopy.jsonList?.itemsPaths).toBeDefined()
    expect(registryOne.jsonList?.itemsPaths).toBeDefined()
    expect(oneCopy.jsonList!.itemsPaths).not.toBe(registryOne.jsonList!.itemsPaths)
    expect(oneCopy.allowedContentTypes).not.toBe(registryOne.allowedContentTypes)
    expect(oneCopy.adaptive).not.toBe(registryOne.adaptive)
    const hostsBefore = [...registryMaersk.allowedHosts]
    const headerBefore = { ...registryMaersk.sourceHeaderLimit! }
    const maerskTypesBefore = [...registryMaersk.allowedContentTypes]
    const onePathsBefore = [...registryOne.jsonList!.itemsPaths!]
    const oneTypesBefore = [...registryOne.allowedContentTypes]
    expect(registryMaersk.adaptive).toBeUndefined()
    expect(registryOne.adaptive).toBeUndefined()
    maerskCopy.allowedHosts.push("evil.example")
    maerskCopy.sourceHeaderLimit!.maxHeaderSize = 1
    maerskCopy.allowedContentTypes.push("application/evil")
    maerskCopy.adaptive = { minMinutes: 1, maxMinutes: 2 }
    if (maerskCopy.webList) (maerskCopy.webList as { itemSelector?: string }).itemSelector = "evil"
    customsCopy.allowedHosts.push("evil.example")
    oneCopy.jsonList!.itemsPaths!.push("props.evil")
    oneCopy.allowedContentTypes.push("application/evil")
    oneCopy.adaptive = { minMinutes: 9, maxMinutes: 99 }
    expect(registryMaersk.allowedHosts).toEqual(hostsBefore)
    expect(registryMaersk.sourceHeaderLimit).toEqual(headerBefore)
    expect(registryMaersk.allowedContentTypes).toEqual(maerskTypesBefore)
    expect(registryCustoms.allowedHosts).not.toContain("evil.example")
    expect(registryOne.jsonList!.itemsPaths).toEqual(onePathsBefore)
    expect(registryOne.allowedContentTypes).toEqual(oneTypesBefore)
    expect(registryMaersk.adaptive).toBeUndefined()
    expect(registryOne.adaptive).toBeUndefined()
    const second = productionIntelOptions({ env: { SHIPPING_INTEL_ENABLED: "true", SHIPPING_INTEL_SOURCE_IDS: "XX-K01,MY-C01,XX-K02" }, dependencies })
    const secondById = Object.fromEntries(second.registry!.intel!.seeds!.map(s => [s.catalogId, s]))
    expect(secondById["XX-K01"]).not.toBe(maerskCopy)
    expect(secondById["XX-K01"].allowedHosts).not.toContain("evil.example")
    expect(secondById["XX-K01"].sourceHeaderLimit?.maxHeaderSize).toBe(32768)
    expect(secondById["XX-K01"].allowedContentTypes).not.toContain("application/evil")
    expect(secondById["XX-K01"].adaptive).toEqual({ minMinutes: 15, maxMinutes: 60 })
    expect(secondById["MY-C01"].allowedHosts).not.toContain("evil.example")
    expect(secondById["XX-K02"]).not.toBe(oneCopy)
    expect(secondById["XX-K02"].jsonList!.itemsPaths).toEqual(onePathsBefore)
    expect(secondById["XX-K02"].allowedContentTypes).not.toContain("application/evil")
    expect(secondById["XX-K02"].adaptive).toEqual({ minMinutes: 15, maxMinutes: 60 })
    expect(intelSourceSeeds.map(s => s.persistence)).toEqual(["full", "excerpt_only"])
    expect(rssCandidates.find(s => s.catalogId === "MY-C01")).toMatchObject({ enabled: false, persistence: "disallowed" })
    expect(htmlIndexCandidates.find(s => s.catalogId === "XX-K01")).toMatchObject({ enabled: false, persistence: "disallowed" })
    expect(htmlIndexCandidates.find(s => s.catalogId === "XX-K02")).toMatchObject({ enabled: false, persistence: "disallowed" })
  })

  it("master switch off: ownership spy wired into productionIntelOptions and bootstrap; schedule path never hits DNS/transport/ownership (not job.run evidence)", async () => {
    const lookup = vi.fn(async () => [{ address: "93.184.216.34", family: 4 as const }])
    const transport = vi.fn(async () => ({ status: 200, headers: { "content-type": "application/rss+xml" }, body: "<rss/>" }))
    const acquireOwnership = vi.fn(async () => ({ release: async () => undefined }))
    const setTimeoutSpy = vi.fn(() => 0 as unknown as NodeJS.Timeout)
    const clearTimeoutSpy = vi.fn()
    // Spy must enter the disabled resolve path (not a vacuous local unused fn).
    const options = productionIntelOptions({
      env: { SHIPPING_INTEL_ENABLED: "false" },
      dependencies: { fetch: { lookup, transport }, acquireOwnership },
    })
    expect(options.registry?.intel).toEqual({ enabled: false, seeds: [] })
    expect(options.acquireIntelOwnership).toBeUndefined()
    expect(acquireOwnership).not.toHaveBeenCalled()
    const state = open()
    vi.stubEnv("SHIPPING_DATA_MODE", "real")
    vi.stubEnv("SHIPPING_WEATHER_ALERT_PROVIDER", "off")
    try {
      await initShippingTables(state.database, "real")
      const now = () => new Date("2026-10-20T12:00:00Z")
      const jobs = getDefaultRuntimeJobs({
        ...options.registry,
        database: state.database,
        dataMode: "real",
        now,
        intel: { enabled: false, seeds: [], fetch: { lookup, transport } },
      }).filter(job => job.id === INTEL_COLLECT_JOB_ID)
      expect(jobs).toHaveLength(1)
      expect(jobs[0].enabled).toBe(false)
      // Wire the same spy into bootstrap so "not called" is a real gate when jobs are disabled.
      const runtime = await bootstrapBackgroundRuntime({
        database: state.database,
        jobs,
        enabled: true,
        acquireIntelOwnership: acquireOwnership,
        runtimeOptions: { now, setTimeout: setTimeoutSpy as never, clearTimeout: clearTimeoutSpy, logger: { info: vi.fn(), error: vi.fn() } },
      })
      expect(runtime.getStatus().jobs.find(j => j.id === INTEL_COLLECT_JOB_ID)).toMatchObject({ enabled: false, status: "disabled" })
      expect(setTimeoutSpy).not.toHaveBeenCalled()
      expect(lookup).not.toHaveBeenCalled()
      expect(transport).not.toHaveBeenCalled()
      expect(acquireOwnership).not.toHaveBeenCalled()
      expect(state.native.prepare("SELECT COUNT(*) AS n FROM intel_fetch_run").get()).toEqual({ n: 0 })
    } finally {
      await shutdownBackgroundRuntime()
      state.native.close()
    }
  })

  it("productionIntelOptions -> runtime registry -> BackgroundRuntime -> isolated SQLite for allow-selected closed candidate", async () => {
    mkdirSync(".tmp", { recursive: true })
    const dir = mkdtempSync(resolve(".tmp", "intel-allow-select-chain-"))
    const file = resolve(dir, "isolated.sqlite3")
    const state = open(file)
    const lookups: string[] = []
    const calls: string[] = []
    const transportOpts: unknown[] = []
    const release = vi.fn(async () => {})
    const lookup = vi.fn(async (host: string) => {
      lookups.push(host)
      return [{ address: "93.184.216.34", family: 4 as const }]
    })
    const transport = vi.fn(async (url: URL, _a: unknown, opts: unknown) => {
      calls.push(url.toString())
      transportOpts.push(opts)
      if (url.toString() === "https://splash247.com/feed/") {
        return { status: 200, headers: { "content-type": "application/rss+xml; charset=utf-8" }, body: new TextEncoder().encode(SPLASH247_RSS_SYNTHETIC) }
      }
      return { status: 503, headers: {}, body: new Uint8Array() }
    })
    vi.stubEnv("SHIPPING_DATA_MODE", "real")
    vi.stubEnv("SHIPPING_WEATHER_ALERT_PROVIDER", "off")
    try {
      await initShippingTables(state.database, "real")
      const options = productionIntelOptions({
        env: { SHIPPING_INTEL_ENABLED: "true", SHIPPING_INTEL_SOURCE_IDS: "XX-M03" },
        dependencies: {
          fetch: { lookup, transport },
          acquireOwnership: async () => {
            const lease = await acquireIntelDatabaseOwnership(file)
            return {
              release: async () => {
                await lease.release()
                await release()
              },
            }
          },
        },
      })
      const seed = options.registry!.intel!.seeds![0]
      expect(seed).toMatchObject({ catalogId: "XX-M03", enabled: true, persistence: "disallowed", adaptive: { minMinutes: 15, maxMinutes: 60 } })
      expect(seed.intervalMs).toBe(3_600_000)
      const now = () => new Date("2026-10-20T12:00:00Z")
      const jobs = getDefaultRuntimeJobs({ ...options.registry, database: state.database, dataMode: "real", now }).filter(job => job.id === INTEL_COLLECT_JOB_ID)
      expect(jobs).toHaveLength(1)
      const runtime = await bootstrapBackgroundRuntime({
        ...options,
        database: state.database,
        jobs,
        enabled: true,
        runtimeOptions: { now, setTimeout: vi.fn(() => 0) as never, clearTimeout: vi.fn(), logger: { info: vi.fn(), error: vi.fn() } },
      })
      expect(await runtime.runNow(INTEL_COLLECT_JOB_ID)).toMatchObject({ status: "success", recordsRead: 2, recordsWritten: 2 })
      expect(calls).toEqual(["https://splash247.com/feed/"])
      expect(lookups).toEqual(["splash247.com"])
      expect(state.native.prepare("SELECT enabled, persistence FROM intel_source WHERE id = ?").get("intel:xx-m03")).toEqual({ enabled: 1, persistence: "disallowed" })
      const items = await state.repository.listItems("intel:xx-m03")
      expect(items).toHaveLength(2)
      // Concrete UTC publishedAt from splash247 fixture (+0000 pubDate); RSS keeps dateEvidence=null.
      // No <updated> in fixture → sourceUpdatedAt is parser fallback to pubDate, not an independent update.
      // Title-only blocks: description in synthetic RSS is not persisted.
      expect(items.map(item => [item.canonicalUrl, item.title, item.publishedAt]).sort()).toEqual([
        ["https://splash247.com/synthetic-splash-one", "Synthetic Splash story one", "2026-10-14T22:05:11.000Z"],
        ["https://splash247.com/synthetic-splash-two", "Synthetic Splash story two", "2026-10-12T06:00:00.000Z"],
      ].sort())
      for (const item of items) {
        const versions = await state.repository.listVersions(item.id)
        expect(versions).toHaveLength(1)
        expect(versions[0].contentScope).toBe("metadata_only")
        expect(versions[0].dateEvidence).toBeNull()
        expect(versions[0].sourcePublishedAt).toBe(item.publishedAt)
        expect(versions[0].sourceUpdatedAt).toBe(item.publishedAt)
        expect(await state.repository.readVersionBlocks(versions[0].id)).toEqual([
          expect.objectContaining({ type: "title", text: item.title }),
        ])
      }
      for (const opts of transportOpts) expect(opts).not.toMatchObject({ maxHeaderSize: 32768 })
    } finally {
      await shutdownBackgroundRuntime()
      state.native.close()
    }
  })

  it("maersk allow-select keeps exact 32768 header opt-in on production chain", async () => {
    mkdirSync(".tmp", { recursive: true })
    const dir = mkdtempSync(resolve(".tmp", "intel-allow-select-maersk-"))
    const file = resolve(dir, "isolated.sqlite3")
    const state = open(file)
    const optionsSeen: unknown[] = []
    const transport = vi.fn(async (url: URL, _a: unknown, opts: unknown) => {
      optionsSeen.push(opts)
      if (url.toString() === "https://www.maersk.com/news") {
        return { status: 200, headers: { "content-type": "text/html; charset=utf-8" }, body: new TextEncoder().encode(MAERSK_SYNTHETIC) }
      }
      return { status: 503, headers: {}, body: new Uint8Array() }
    })
    vi.stubEnv("SHIPPING_DATA_MODE", "real")
    vi.stubEnv("SHIPPING_WEATHER_ALERT_PROVIDER", "off")
    try {
      await initShippingTables(state.database, "real")
      const options = productionIntelOptions({
        env: { SHIPPING_INTEL_ENABLED: "true", SHIPPING_INTEL_SOURCE_IDS: "XX-K01" },
        dependencies: {
          fetch: { lookup: async () => [{ address: "93.184.216.34", family: 4 }], transport },
          acquireOwnership: async () => {
            const lease = await acquireIntelDatabaseOwnership(file)
            return { release: async () => {
              await lease.release()
            } }
          },
        },
      })
      expect(options.registry!.intel!.seeds![0].persistence).toBe("disallowed")
      const now = () => new Date("2026-10-20T12:00:00Z")
      const jobs = getDefaultRuntimeJobs({ ...options.registry, database: state.database, dataMode: "real", now }).filter(job => job.id === INTEL_COLLECT_JOB_ID)
      const runtime = await bootstrapBackgroundRuntime({
        ...options,
        database: state.database,
        jobs,
        enabled: true,
        runtimeOptions: { now, setTimeout: vi.fn(() => 0) as never, clearTimeout: vi.fn(), logger: { info: vi.fn(), error: vi.fn() } },
      })
      expect(await runtime.runNow(INTEL_COLLECT_JOB_ID)).toMatchObject({ status: "success", recordsRead: 2, recordsWritten: 2 })
      expect(optionsSeen).toHaveLength(1)
      expect(optionsSeen[0]).toMatchObject({ maxHeaderSize: 32768, maxBytes: 524288, timeoutMs: 10000 })
      expect((optionsSeen[0] as { caPem?: unknown }).caPem).toBeUndefined()
    } finally {
      await shutdownBackgroundRuntime()
      state.native.close()
    }
  })
})
