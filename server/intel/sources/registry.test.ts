import { Socket } from "node:net"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { open } from "../__fixtures__/isolated-db"
import type { IntelFetchDeps } from "../collect"
import { intelSourceSeeds } from "../sources"
import { CUSTOMS_SYNTHETIC } from "./__fixtures__/html-index-synthetic"
import { fixtures as POST_CLASH } from "./__fixtures__/post-clash-synthetic"
import { GD_SYNTHETIC, JDIH_MOF_SYNTHETIC, MOF_SYNTHETIC, PH_SYNTHETIC, SITC_SYNTHETIC } from "./__fixtures__/public-index-synthetic"
import { markup as thaiDocumentMarkup } from "./__fixtures__/thai-document-synthetic"
import { htmlIndexCandidates } from "./html-index-candidates"
import { REGISTERED_CLOSED_CANDIDATE_IDS, registeredIntelSources } from "./registry"
import { initShippingTables } from "#/database/shipping"
import { RuntimeRepository } from "#/database/runtime-jobs"
import { BackgroundRuntime } from "#/runtime/background-runtime"
import { INTEL_COLLECT_JOB_ID, createIntelCollectJob } from "#/runtime/intel-collect-job"
import { productionIntelOptions } from "#/runtime/intel-production"
import { getDefaultRuntimeJobs } from "#/runtime/registry"

const NOW = new Date("2026-10-22T08:00:00Z")
const CN = htmlIndexCandidates.find(seed => seed.catalogId === "CN-T02")!
const TH = htmlIndexCandidates.find(seed => seed.catalogId === "TH-C01")!
const PH = htmlIndexCandidates.find(seed => seed.catalogId === "PH-C01")!
const GD = htmlIndexCandidates.find(seed => seed.catalogId === "CN-P01")!
const TD = htmlIndexCandidates.find(seed => seed.catalogId === "TH-C02")!
const VP = htmlIndexCandidates.find(seed => seed.catalogId === "VN-P03")!
const VT = htmlIndexCandidates.find(seed => seed.catalogId === "VN-T01")!
const IT = htmlIndexCandidates.find(seed => seed.catalogId === "ID-T01")!
const SK = htmlIndexCandidates.find(seed => seed.catalogId === "XX-K03")!
const JD = htmlIndexCandidates.find(seed => seed.catalogId === "ID-T02")!
const NEW = [CN, TH, PH, GD, TD, VP, VT, IT, SK, JD]
const SYNTHETIC = [{ seed: CN, html: MOF_SYNTHETIC }, { seed: TH, html: CUSTOMS_SYNTHETIC }, { seed: PH, html: PH_SYNTHETIC }, { seed: GD, html: GD_SYNTHETIC }, { seed: TD, html: thaiDocumentMarkup() }, { seed: VP, html: POST_CLASH["VN-P03"] }, { seed: VT, html: POST_CLASH["VN-T01"] }, { seed: IT, html: POST_CLASH["ID-T01"] }, { seed: SK, html: SITC_SYNTHETIC }, { seed: JD, html: JDIH_MOF_SYNTHETIC, count: 3 }]
const SNAPSHOT = JSON.stringify(htmlIndexCandidates)
const ORIGINAL_SNAPSHOT = JSON.stringify(intelSourceSeeds)

/** Fake lookup/transport: records every call, serves synthetic HTML by URL, 503 otherwise; never opens a socket. */
function fake(routes: Record<string, string> = {}) {
  const lookups: string[] = []
  const calls: string[] = []
  const deps: IntelFetchDeps = {
    lookup: async (host: string) => {
      lookups.push(host)
      return [{ address: "93.184.216.34", family: 4 }]
    },
    transport: async (url: URL) => {
      calls.push(url.toString())
      const html = routes[url.toString()]
      if (html === undefined) return { status: 503, headers: {}, body: new Uint8Array() }
      return { status: 200, headers: { "content-type": "text/html; charset=utf-8" }, body: new TextEncoder().encode(html) }
    },
  }
  return { deps, calls, lookups }
}

async function isolated() {
  const state = open()
  await initShippingTables(state.database, "mock")
  return state
}

function runtimeFor(state: ReturnType<typeof open>) {
  return new BackgroundRuntime(new RuntimeRepository(state.database), { now: () => NOW, setTimeout: (() => 0) as never, clearTimeout: (() => undefined) as never, logger: { info: () => undefined, error: () => undefined } })
}

const sourceRow = (state: ReturnType<typeof open>, id: string) => state.native.prepare("SELECT enabled, persistence FROM intel_source WHERE id = ?").get(id) as { enabled: number, persistence: string } | undefined
const runCount = (state: ReturnType<typeof open>, id: string) => (state.native.prepare("SELECT COUNT(*) AS n FROM intel_fetch_run WHERE source_id = ?").get(id) as { n: number }).n
const sourceIds = (state: ReturnType<typeof open>) => (state.native.prepare("SELECT id FROM intel_source ORDER BY id").all() as { id: string }[]).map(row => row.id)
const isNewUrl = (url: string) => NEW.some(seed => url === seed.url || new URL(url).host === new URL(seed.url).host)

const blocked: string[] = []
let guard: ReturnType<typeof vi.spyOn> | undefined
beforeEach(() => {
  blocked.length = 0
  guard = vi.spyOn(Socket.prototype, "connect").mockImplementation(function (this: Socket, ...args: unknown[]) {
    blocked.push(JSON.stringify(args[0]))
    throw new Error("External TCP forbidden in registry test")
  } as never)
})
afterEach(() => {
  guard?.mockRestore()
  expect(blocked).toEqual([])
  expect(JSON.stringify(htmlIndexCandidates)).toBe(SNAPSHOT)
  expect(JSON.stringify(intelSourceSeeds)).toBe(ORIGINAL_SNAPSHOT)
  for (const seed of NEW) expect(seed).toMatchObject({ enabled: false, persistence: "disallowed" })
})

describe("registeredIntelSources", () => {
  it("keeps the original two seeds unchanged and reuses all ten closed candidate objects (CN-T02/TH-C01/PH-C01/CN-P01/TH-C02/VN-P03/VN-T01/ID-T01/XX-K03/ID-T02)", () => {
    expect(registeredIntelSources.map(seed => seed.catalogId)).toEqual(["TH-W01", "ID-W01", ...REGISTERED_CLOSED_CANDIDATE_IDS])
    expect(registeredIntelSources.slice(0, 2)).toEqual(intelSourceSeeds)
    expect(registeredIntelSources[0]).toBe(intelSourceSeeds[0])
    expect(registeredIntelSources[1]).toBe(intelSourceSeeds[1])
    expect(registeredIntelSources.slice(0, 2).every(seed => seed.enabled)).toBe(true)
    expect(registeredIntelSources.slice(2)).toEqual(NEW)
    NEW.forEach((seed, index) => expect(registeredIntelSources[index + 2]).toBe(seed))
    for (const seed of NEW) expect(seed).toMatchObject({ enabled: false, persistence: "disallowed" })
    expect(new Set(registeredIntelSources.map(seed => seed.id)).size).toBe(12)
    expect(new Set(registeredIntelSources.map(seed => seed.catalogId)).size).toBe(12)
    expect(Object.isFrozen(registeredIntelSources)).toBe(true)
  })
})

describe("default collect job (no seeds) on the BackgroundRuntime with isolated SQLite", () => {
  it("a) registers all ten closed candidates as enabled=0 but never makes them due or requests them", async () => {
    const state = await isolated()
    const net = fake()
    const runtime = runtimeFor(state)
    try {
      runtime.register(createIntelCollectJob({ db: state.database, enabled: true, fetch: net.deps, now: () => NOW }))
      await runtime.start()
      await runtime.runNow(INTEL_COLLECT_JOB_ID)
      for (const seed of NEW) {
        expect(sourceRow(state, seed.id)).toEqual({ enabled: 0, persistence: "disallowed" })
        expect(runCount(state, seed.id)).toBe(0)
      }
      for (const seed of intelSourceSeeds) expect(sourceRow(state, seed.id)?.enabled).toBe(1)
      expect((await state.repository.listDueSources(new Date(NOW.getTime() + 864e5).toISOString())).map(row => row.id).sort()).toEqual(intelSourceSeeds.map(seed => seed.id).sort())
      // Only the original two (fake 503) were requested; the new two never reached lookup/transport.
      expect(net.calls.filter(isNewUrl)).toEqual([])
      expect(net.lookups.filter(host => NEW.some(seed => seed.allowedHosts.includes(host)))).toEqual([])
      expect(net.calls.sort()).toEqual(intelSourceSeeds.map(seed => seed.url).sort())
    } finally {
      runtime.stop()
      state.native.close()
    }
  })

  it("e) a same-ID row previously enabled=1 returns to enabled=0 after the default upsert and is not requested", async () => {
    const state = await isolated()
    const net = fake(Object.fromEntries(SYNTHETIC.map(({ seed, html }) => [seed.url, html])))
    const runtime = runtimeFor(state)
    try {
      for (const seed of NEW) await state.repository.upsertSource({ ...seed, enabled: true }, new Date(NOW.getTime() - 1000).toISOString())
      for (const seed of NEW) expect(sourceRow(state, seed.id)?.enabled).toBe(1)
      runtime.register(createIntelCollectJob({ db: state.database, enabled: true, fetch: net.deps, now: () => NOW }))
      await runtime.start()
      await runtime.runNow(INTEL_COLLECT_JOB_ID)
      for (const seed of NEW) {
        expect(sourceRow(state, seed.id)).toEqual({ enabled: 0, persistence: "disallowed" })
        expect(runCount(state, seed.id)).toBe(0)
        expect(await state.repository.listItems(seed.id)).toEqual([])
      }
      const due = (await state.repository.listDueSources(NOW.toISOString())).map(row => row.id)
      for (const seed of NEW) expect(due).not.toContain(seed.id)
      expect(net.calls.filter(isNewUrl)).toEqual([])
    } finally {
      runtime.stop()
      state.native.close()
    }
  })

  it("c) explicit seeds: [] adds zero registered rows (migration-preseeded catalog rows unchanged), no registry fallback, zero requests", async () => {
    const state = await isolated()
    const net = fake()
    const runtime = runtimeFor(state)
    try {
      // Migrations pre-seed catalog/manual rows; [] must leave that set and every enabled flag untouched.
      const before = JSON.stringify(state.native.prepare("SELECT id, enabled, updated_at FROM intel_source ORDER BY id").all())
      runtime.register(createIntelCollectJob({ db: state.database, enabled: true, fetch: net.deps, seeds: [], now: () => NOW }))
      await runtime.start()
      expect(await runtime.runNow(INTEL_COLLECT_JOB_ID)).toMatchObject({ status: "success", recordsRead: 0, recordsWritten: 0 })
      expect(JSON.stringify(state.native.prepare("SELECT id, enabled, updated_at FROM intel_source ORDER BY id").all())).toBe(before)
      for (const seed of NEW) expect(sourceIds(state)).not.toContain(seed.id)
      expect(state.native.prepare("SELECT COUNT(*) AS n FROM intel_fetch_run").get()).toEqual({ n: 0 })
      expect(net.calls).toEqual([])
      expect(net.lookups).toEqual([])
    } finally {
      runtime.stop()
      state.native.close()
    }
  })
})

describe("b) production selection is unchanged", () => {
  const dependencies = { fetch: fake().deps, acquireOwnership: async () => ({ release: async () => undefined }) }
  it("still selects only TH-W01/ID-W01", () => {
    const options = productionIntelOptions({ env: { SHIPPING_INTEL_ENABLED: "true", SHIPPING_INTEL_SOURCE_IDS: "TH-W01,ID-W01" }, dependencies })
    expect(options.registry?.intel?.seeds?.map(seed => seed.catalogId)).toEqual(["TH-W01", "ID-W01"])
  })
  it.each(["CN-T02", "TH-C01", "PH-C01", "CN-P01", "TH-W01,CN-T02", "ID-W01,TH-C01", "TH-W01,PH-C01", "ID-W01,CN-P01", "TH-C02", "VN-P03", "VN-T01", "ID-T01", "TH-W01,TH-C02", "ID-W01,ID-T01", "XX-K03", "ID-T02", "TH-W01,XX-K03", "ID-W01,ID-T02"])("rejects %s with intel_source_selection_invalid", (ids) => {
    expect(() => productionIntelOptions({ env: { SHIPPING_INTEL_ENABLED: "true", SHIPPING_INTEL_SOURCE_IDS: ids }, dependencies })).toThrow("intel_source_selection_invalid")
  })
  it("disabled production passes explicit empty seeds", () => {
    expect(productionIntelOptions({ env: {} }).registry?.intel).toEqual({ enabled: false, seeds: [] })
  })
})

describe("d) test-only enabled copies run Runtime -> isolated SQLite with fake lookup/transport", () => {
  it.each(SYNTHETIC)("$seed.catalogId copy collects synthetic HTML as metadata-only under disallowed persistence", async ({ seed, html, count = 2 }) => {
    const copy = { ...structuredClone(seed), enabled: true }
    expect(copy).not.toBe(seed)
    expect(copy.webList).not.toBe(seed.webList)
    expect(copy.persistence).toBe("disallowed")
    const state = await isolated()
    const net = fake({ [seed.url]: html })
    const baseline = sourceIds(state)
    vi.stubEnv("SHIPPING_DATA_MODE", "real")
    vi.stubEnv("SHIPPING_WEATHER_ALERT_PROVIDER", "off")
    const runtime = runtimeFor(state)
    try {
      const jobs = getDefaultRuntimeJobs({ database: state.database, dataMode: "real", now: () => NOW, intel: { enabled: true, seeds: [copy], fetch: net.deps } }).filter(job => job.id === INTEL_COLLECT_JOB_ID)
      expect(jobs).toHaveLength(1)
      runtime.register(jobs[0])
      await runtime.start()
      expect(await runtime.runNow(INTEL_COLLECT_JOB_ID)).toMatchObject({ status: "success", recordsRead: count, recordsWritten: count })
      // Only the exact configured HTTPS entry literal is requested: no HTTP body fetch, redirect or detail request.
      expect(net.calls).toEqual([seed.url])
      expect(net.calls.every(url => new URL(url).protocol === "https:")).toBe(true)
      expect(sourceRow(state, seed.id)).toEqual({ enabled: 1, persistence: "disallowed" })
      const items = await state.repository.listItems(seed.id)
      expect(items).toHaveLength(count)
      if (seed === SK) expect(items.map(item => item.canonicalUrl).sort()).toEqual(["http://www.sitc.com/en/show.asp?id=0001", "http://www.sitc.com/en/show.asp?id=0002"])
      for (const item of items) {
        const versions = await state.repository.listVersions(item.id)
        expect(versions).toHaveLength(1)
        expect(versions[0].contentScope).toBe("metadata_only")
        // Day/document/enactment date evidence keeps its role; never promoted to a publication instant.
        expect(item.publishedAt).toBeNull()
        expect(versions[0].dateEvidence?.publishedAt).toBeNull()
        expect(await state.repository.readVersionBlocks(versions[0].id)).toEqual([expect.objectContaining({ type: "title", text: item.title })])
      }
      expect(sourceIds(state).filter(id => !baseline.includes(id))).toEqual([seed.id])
      expect(state.native.prepare("SELECT DISTINCT source_id FROM intel_fetch_run").all()).toEqual([{ source_id: seed.id }])
    } finally {
      runtime.stop()
      state.native.close()
      vi.unstubAllEnvs()
    }
  })
})
