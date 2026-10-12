import { readFileSync } from "node:fs"
import NativeDatabase from "better-sqlite3"
import { createDatabase } from "db0"
import { describe, expect, it } from "vitest"
import { IntelRepository } from "#/database/intel"
import { initShippingTables } from "#/database/shipping"
import { readDatabaseMetadata } from "#/database/runtime"
import { RuntimeRepository } from "#/database/runtime-jobs"
import { INTEL_BACKOFF_BASE_MS, INTEL_BACKOFF_MAX_MS, type IntelFetchDeps, collectIntelSource, computeBackoffMs } from "#/intel/collect"
import { type IntelSourceSeed, intelSourceSeeds } from "#/intel/sources"
import { BackgroundRuntime } from "#/runtime/background-runtime"
import { INTEL_COLLECT_JOB_ID, createIntelCollectJob } from "#/runtime/intel-collect-job"
import type { ArticleHttpResponse, ResolvedAddress } from "#/services/article-fetch-security"

// Real archived fixtures from approved catalog sources (TH-W01 TMD CAP 2026-10-10, ID-W01 BMKG nowcast 2026-10-10).
const TMD_XML = readFileSync("server/providers/__fixtures__/tmd-cap-2026-10-10/index.xml", "utf8")
const BMKG_XML = readFileSync("server/providers/__fixtures__/bmkg-cap-2026-10-10/index.xml", "utf8")
const TMD = intelSourceSeeds.find(seed => seed.catalogId === "TH-W01")!
const BMKG = intelSourceSeeds.find(seed => seed.catalogId === "ID-W01")!
const PUBLIC_ADDRESS: ResolvedAddress = { address: "93.184.216.34", family: 4 }
const T0 = new Date("2026-10-12T08:00:00.000Z")

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

async function setup(seeds: IntelSourceSeed[] = [TMD]) {
  const { database, native } = createNativeDatabase()
  await initShippingTables(database, "mock")
  const repository = new IntelRepository(database)
  for (const seed of seeds) await repository.upsertSource(seed, T0.toISOString())
  return { database, native, repository }
}

type Reply = ArticleHttpResponse | Error
/** Injected offline fetcher: serves archived bytes; records every call; never opens a socket. */
function offline(routes: Record<string, () => Reply>, addresses: ResolvedAddress[] = [PUBLIC_ADDRESS]) {
  const calls: string[] = []
  const lookups: string[] = []
  const deps: IntelFetchDeps = {
    lookup: async (hostname) => {
      lookups.push(hostname)
      return addresses
    },
    transport: async (url) => {
      calls.push(url.toString())
      const route = routes[url.toString()]
      const reply = route ? route() : { status: 404, headers: { "content-type": "text/plain" }, body: "" }
      if (reply instanceof Error) throw reply
      return reply
    },
  }
  return { deps, calls, lookups }
}
const xml = (body: string): ArticleHttpResponse => ({ status: 200, headers: { "content-type": "application/rss+xml; charset=utf-8" }, body })
const minutes = (from: Date, iso: string | null) => (Date.parse(iso!) - from.getTime()) / 60_000

describe("migrations 021/022 (intel)", () => {
  it("apply on a fresh isolated database to schema v22 and are idempotent", async () => {
    const { database, native } = createNativeDatabase()
    await initShippingTables(database, "mock")
    await initShippingTables(database, "mock")
    expect((await readDatabaseMetadata(database)).schemaVersion).toBe(22)
    const tables = new Set((native.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{ name: string }>).map(row => row.name))
    for (const table of ["intel_source", "intel_fetch_run", "intel_item", "intel_item_version", "intel_item_block"]) expect(tables.has(table)).toBe(true)
    const applied = native.prepare("SELECT version, COUNT(*) AS c FROM schema_migrations WHERE version IN (21, 22) GROUP BY version").all() as Array<{ c: number }>
    expect(applied.map(row => row.c)).toEqual([1, 1])
    native.close()
  })
})

describe("intel collect offline loop", () => {
  it("parses the real TMD archive and a repeated fetch adds no duplicate rows", async () => {
    const { native, repository } = await setup()
    const net = offline({ [TMD.url]: () => xml(TMD_XML) })
    const first = await collectIntelSource(repository, TMD, net.deps, T0)
    expect(first.status).toBe("ok_items")
    const items = await repository.listItems(TMD.id)
    expect(items.length).toBeGreaterThan(0)
    expect(items.every(item => item.title && item.canonicalUrl.startsWith("https://www.tmd.go.th/") && item.publishedAt)).toBe(true)
    const counts = () => native.prepare("SELECT (SELECT COUNT(*) FROM intel_item) AS i, (SELECT COUNT(*) FROM intel_item_version) AS v, (SELECT COUNT(*) FROM intel_item_block) AS b").get()
    const before = counts()
    const second = await collectIntelSource(repository, TMD, net.deps, new Date(T0.getTime() + 3_600_000))
    expect(second).toMatchObject({ status: "ok_items", itemsNew: 0, itemsRevised: 0 })
    expect(counts()).toEqual(before)
    expect((await repository.listRuns(TMD.id)).map(run => run.status)).toEqual(["ok_items", "ok_items"])
    native.close()
  })

  it("a body change creates a new version and the old version stays readable", async () => {
    const { native, repository } = await setup()
    let body = TMD_XML
    const net = offline({ [TMD.url]: () => xml(body) })
    await collectIntelSource(repository, TMD, net.deps, T0)
    const before = new Map<string, { versionId: string, blocks: Awaited<ReturnType<typeof repository.readVersionBlocks>> }>()
    for (const item of await repository.listItems(TMD.id)) before.set(item.id, { versionId: item.currentVersionId!, blocks: await repository.readVersionBlocks(item.currentVersionId!) })
    expect([...before.values()].every(entry => entry.blocks.some(block => block.type === "paragraph"))).toBe(true)

    const firstDescription = /<item>[\s\S]*?<description>([\s\S]*?)<\/description>/.exec(TMD_XML)![1]
    body = TMD_XML.replace(firstDescription, `REVISED BULLETIN. ${firstDescription}`)
    const result = await collectIntelSource(repository, TMD, net.deps, new Date(T0.getTime() + 3_600_000))
    expect(result).toMatchObject({ status: "ok_items", itemsNew: 0, itemsRevised: 1 })

    const items = await repository.listItems(TMD.id)
    const revised = items.filter(item => item.currentVersionId !== before.get(item.id)!.versionId)
    expect(revised).toHaveLength(1)
    const { versionId: oldVersionId, blocks: oldBlocks } = before.get(revised[0].id)!
    const versions = await repository.listVersions(revised[0].id)
    expect(versions.map(version => version.id)).toEqual([revised[0].currentVersionId, oldVersionId])
    expect(await repository.readVersionBlocks(oldVersionId)).toEqual(oldBlocks)
    const newText = (await repository.readVersionBlocks(revised[0].currentVersionId!)).map(block => block.text).join(" ")
    expect(newText).toContain("REVISED BULLETIN.")
    expect(oldBlocks.map(block => block.text).join(" ")).not.toContain("REVISED BULLETIN.")
    native.close()
  })

  it("stores licensed full text, excerpt or metadata only according to source persistence", async () => {
    const metadataOnly: IntelSourceSeed = { ...TMD, id: "intel:test-metadata-only", persistence: "disallowed" }
    const { native, repository } = await setup([TMD, BMKG, metadataOnly])
    const net = offline({ [TMD.url]: () => xml(TMD_XML), [BMKG.url]: () => xml(BMKG_XML) })
    await collectIntelSource(repository, TMD, net.deps, T0)
    await collectIntelSource(repository, BMKG, net.deps, T0)
    await collectIntelSource(repository, metadataOnly, net.deps, T0)

    const scopeOf = async (seed: IntelSourceSeed) => {
      const item = (await repository.listItems(seed.id))[0]
      const [version] = await repository.listVersions(item.id)
      return { version, blocks: await repository.readVersionBlocks(version.id) }
    }
    const full = await scopeOf(TMD)
    expect(full.version.contentScope).toBe("full_text")
    expect(full.blocks.filter(block => block.type === "paragraph").map(block => block.text).join("").length).toBeGreaterThan(280)

    const excerpt = await scopeOf(BMKG)
    expect(excerpt.version.contentScope).toBe("excerpt")
    expect(excerpt.blocks.map(block => block.type)).toEqual(["title", "excerpt"])
    expect(excerpt.blocks[1].text.length).toBeLessThanOrEqual(280)

    const meta = await scopeOf(metadataOnly)
    expect(meta.version.contentScope).toBe("metadata_only")
    expect(meta.blocks.map(block => block.type)).toEqual(["title"])
    expect(meta.version.contentHash).toBe(full.version.contentHash)
    native.close()
  })

  it("distinguishes a successful empty feed from a failure", async () => {
    const empty: IntelSourceSeed = { ...TMD, id: "intel:test-empty" }
    const broken: IntelSourceSeed = { ...TMD, id: "intel:test-broken", url: "https://www.tmd.go.th/broken" }
    const { native, repository } = await setup([empty, broken])
    const emptyNet = offline({ [empty.url]: () => xml("<?xml version=\"1.0\"?><rss version=\"2.0\"><channel><title>t</title></channel></rss>") })
    expect((await collectIntelSource(repository, empty, emptyNet.deps, T0)).status).toBe("ok_empty")
    expect(await repository.getSource(empty.id)).toMatchObject({ status: "ok_empty", consecutiveFailures: 0, lastErrorCode: null })

    const brokenNet = offline({ [broken.url]: () => ({ status: 500, headers: { "content-type": "text/html" }, body: "" }) })
    expect(await collectIntelSource(repository, broken, brokenNet.deps, T0)).toMatchObject({ status: "failed", errorCode: "http_error" })
    expect(await repository.getSource(broken.id)).toMatchObject({ status: "failing", consecutiveFailures: 1, lastErrorCode: "http_error" })

    const notXml = offline({ [empty.url]: () => xml("this is not a feed") })
    expect(await collectIntelSource(repository, empty, notXml.deps, new Date(T0.getTime() + 3_600_000))).toMatchObject({ status: "failed", errorCode: "parse_failed" })
    native.close()
  })

  it("a failure keeps previously stored items readable and makes the failing status visible", async () => {
    const { native, repository } = await setup()
    let down = false
    const net = offline({ [TMD.url]: () => (down ? new Error("fetch_timeout") : xml(TMD_XML)) })
    await collectIntelSource(repository, TMD, net.deps, T0)
    const items = await repository.listItems(TMD.id)
    const blocks = await repository.readVersionBlocks(items[0].currentVersionId!)
    down = true
    expect(await collectIntelSource(repository, TMD, net.deps, new Date(T0.getTime() + 3_600_000))).toMatchObject({ status: "failed", errorCode: "fetch_timeout" })
    expect(await repository.listItems(TMD.id)).toEqual(items)
    expect(await repository.readVersionBlocks(items[0].currentVersionId!)).toEqual(blocks)
    expect(await repository.getSource(TMD.id)).toMatchObject({ status: "failing", lastErrorCode: "fetch_timeout", lastOkAt: T0.toISOString() })
    native.close()
  })

  it("backs off exponentially on consecutive failures and resets after success", async () => {
    expect([1, 2, 3, 4].map(n => computeBackoffMs(n))).toEqual([1, 2, 4, 8].map(k => k * INTEL_BACKOFF_BASE_MS))
    expect(computeBackoffMs(40)).toBe(INTEL_BACKOFF_MAX_MS)
    const { native, repository } = await setup()
    let down = true
    const net = offline({ [TMD.url]: () => (down ? { status: 503, headers: { "content-type": "text/html" }, body: "" } : xml(TMD_XML)) })
    const gaps: number[] = []
    for (let attempt = 0; attempt < 3; attempt++) {
      const at = new Date(T0.getTime() + attempt * 86_400_000)
      await collectIntelSource(repository, TMD, net.deps, at)
      gaps.push(minutes(at, (await repository.getSource(TMD.id))!.nextSyncAt))
    }
    expect(gaps).toEqual([15, 30, 60])
    down = false
    const at = new Date(T0.getTime() + 4 * 86_400_000)
    await collectIntelSource(repository, TMD, net.deps, at)
    const source = (await repository.getSource(TMD.id))!
    expect(source).toMatchObject({ status: "ok", consecutiveFailures: 0 })
    expect(minutes(at, source.nextSyncAt)).toBe(TMD.intervalMs / 60_000)
    native.close()
  })

  it("keeps every existing secure-fetch protection (blocked address, host allowlist, HTTPS downgrade)", async () => {
    const { native, repository } = await setup()
    const privateNet = offline({ [TMD.url]: () => xml(TMD_XML) }, [{ address: "10.0.0.5", family: 4 }])
    expect(await collectIntelSource(repository, TMD, privateNet.deps, T0)).toMatchObject({ status: "failed", errorCode: "blocked_address" })
    expect(privateNet.calls).toEqual([])

    const offHost: IntelSourceSeed = { ...TMD, id: "intel:test-offhost", url: "https://evil.example/feed" }
    await repository.upsertSource(offHost, T0.toISOString())
    const offHostNet = offline({})
    expect(await collectIntelSource(repository, offHost, offHostNet.deps, T0)).toMatchObject({ status: "failed", errorCode: "host_not_allowed" })
    expect(offHostNet.lookups).toEqual([])

    const downgrade = offline({ [TMD.url]: () => ({ status: 302, headers: { location: "http://www.tmd.go.th/en/api/xml/CAP" }, body: "" }) })
    expect(await collectIntelSource(repository, TMD, downgrade.deps, new Date(T0.getTime() + 86_400_000))).toMatchObject({ status: "failed", errorCode: "https_downgrade" })
    native.close()
  })
})

describe("intel collect job on the single BackgroundRuntime", () => {
  it("is disabled by default and without an offline fetcher does nothing (zero network)", async () => {
    const { database, native } = createNativeDatabase()
    await initShippingTables(database, "mock")
    const job = createIntelCollectJob({ db: database })
    expect(job.enabled).toBe(false)
    expect(await job.run()).toMatchObject({ status: "skipped", errorCode: "offline_fetcher_not_configured" })
    expect(native.prepare("SELECT COUNT(*) AS c FROM intel_fetch_run").get()).toEqual({ c: 0 })
    native.close()
  })

  it("closes runs interrupted by a restart and blocks a second in-flight run of the same source", async () => {
    const { database, native, repository } = await setup()
    const staleRun = await repository.beginRun(TMD.id, "2026-10-12T07:00:00.000Z")
    expect(staleRun).not.toBeNull()
    expect(await repository.beginRun(TMD.id, "2026-10-12T07:00:01.000Z")).toBeNull()
    const net = offline({ [TMD.url]: () => xml(TMD_XML) })
    expect(await collectIntelSource(repository, TMD, net.deps, T0)).toEqual({ status: "skipped", errorCode: "source_run_in_flight" })
    expect(net.calls).toEqual([])

    // "Restart": a new job instance created after the stale run recovers it before collecting.
    const job = createIntelCollectJob({ db: database, enabled: true, fetch: net.deps, seeds: [TMD], now: () => T0 })
    expect((await job.run()).status).toBe("success")
    const runs = await repository.listRuns(TMD.id)
    expect(runs.map(run => [run.status, run.errorCode])).toEqual([["failed", "interrupted"], ["ok_items", null]])
    native.close()
  })

  it("runs through BackgroundRuntime, whose in-flight guard rejects a concurrent run of the same job", async () => {
    const { database, native } = await setup()
    let release!: () => void
    const gate = new Promise<void>(resolve => (release = resolve))
    const net = offline({ [TMD.url]: () => xml(TMD_XML) })
    const slow: IntelFetchDeps = {
      lookup: net.deps.lookup,
      transport: async (...args) => {
        await gate
        return net.deps.transport(...args)
      },
    }
    const runtime = new BackgroundRuntime(new RuntimeRepository(database), { setTimeout: (() => 0) as never, clearTimeout: (() => undefined) as never, logger: { info: () => undefined, error: () => undefined } })
    runtime.register(createIntelCollectJob({ db: database, enabled: true, fetch: slow, seeds: [TMD], now: () => T0 }))
    await runtime.start()
    const first = runtime.runNow(INTEL_COLLECT_JOB_ID)
    await new Promise(resolve => setTimeout(resolve, 5))
    expect(await runtime.runNow(INTEL_COLLECT_JOB_ID)).toMatchObject({ status: "skipped", errorCode: "job_running" })
    release()
    expect((await first).status).toBe("success")
    expect(net.calls).toEqual([TMD.url])
    runtime.stop()
    native.close()
  })
})

describe("intel seeds come from the approved catalog", () => {
  it("every seed carries a catalog ID whose catalog row has the same URL", () => {
    const catalog = readFileSync("docs/intel-source-catalog.md", "utf8").split(/\r?\n/)
    for (const seed of intelSourceSeeds) {
      const row = catalog.find(line => line.startsWith(`| ${seed.catalogId} |`))
      expect(row, seed.catalogId).toBeDefined()
      expect(row).toContain(seed.url)
    }
  })
})
