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
import { INTEL_COLLECT_JOB_ID, createIntelCollectJob, recoverIntelRunsAtExclusiveStartup } from "#/runtime/intel-collect-job"
import type { ArticleHttpResponse, ResolvedAddress } from "#/services/article-fetch-security"

// Real archived fixtures from approved catalog sources (TH-W01 TMD CAP 2026-10-10, ID-W01 BMKG nowcast 2026-10-10).
const TMD_XML = readFileSync("server/providers/__fixtures__/tmd-cap-2026-10-10/index.xml", "utf8")
const BMKG_XML = readFileSync("server/providers/__fixtures__/bmkg-cap-2026-10-10/index.xml", "utf8")
const TMD = intelSourceSeeds.find(seed => seed.catalogId === "TH-W01")!
const BMKG = intelSourceSeeds.find(seed => seed.catalogId === "ID-W01")!
const PUBLIC_ADDRESS: ResolvedAddress = { address: "93.184.216.34", family: 4 }
const T0 = new Date("2026-10-12T08:00:00.000Z")

/** Storage fault injection: statements whose SQL matches `faults.when` throw at run time (simulated I/O error). */
const faults: { when?: (sql: string) => boolean } = {}

function createNativeDatabase() {
  faults.when = undefined
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
          if (faults.when?.(sql)) throw new Error("SQLITE_IOERR: simulated storage failure")
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

describe("migrations 021/022/023 (intel)", () => {
  it("apply on a fresh isolated database to schema v25 and are idempotent", async () => {
    const { database, native } = createNativeDatabase()
    await initShippingTables(database, "mock")
    await initShippingTables(database, "mock")
    expect((await readDatabaseMetadata(database)).schemaVersion).toBe(25)
    const tables = new Set((native.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{ name: string }>).map(row => row.name))
    for (const table of ["intel_source", "intel_fetch_run", "intel_item", "intel_item_version", "intel_item_block"]) expect(tables.has(table)).toBe(true)
    const applied = native.prepare("SELECT version, COUNT(*) AS c FROM schema_migrations WHERE version IN (21, 22, 23) GROUP BY version").all() as Array<{ c: number }>
    expect(applied.map(row => row.c)).toEqual([1, 1, 1])
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

  it("a→B→A rollback restores the current pointer and metadata to the existing A version and records the change", async () => {
    const { native, repository } = await setup()
    let body = TMD_XML
    const net = offline({ [TMD.url]: () => xml(body) })
    const firstDescription = /<item>[\s\S]*?<description>([\s\S]*?)<\/description>/.exec(TMD_XML)![1]
    const firstTitle = /<item>\s*<title>([^<]*)<\/title>/.exec(TMD_XML)![1]
    await collectIntelSource(repository, TMD, net.deps, T0)
    const firstLink = /<item>[\s\S]*?<link>([^<]*)<\/link>/.exec(TMD_XML)![1]
    const a = (await repository.listItems(TMD.id)).find(item => item.canonicalUrl === firstLink)!
    expect(a.title).toBe(firstTitle)
    const versionA = a.currentVersionId!
    const blocksA = await repository.readVersionBlocks(versionA)
    const counts = () => native.prepare("SELECT (SELECT COUNT(*) FROM intel_item_version) AS v, (SELECT COUNT(*) FROM intel_item_block) AS b").get() as { v: number, b: number }

    body = TMD_XML.replace(`<title>${firstTitle}</title>`, `<title>B-${firstTitle}</title>`).replace(firstDescription, `B BODY. ${firstDescription}`)
    expect(await collectIntelSource(repository, TMD, net.deps, new Date(T0.getTime() + 3_600_000))).toMatchObject({ itemsRevised: 1 })
    const b = (await repository.listItems(TMD.id)).find(item => item.id === a.id)!
    expect(b.title).toBe(`B-${firstTitle}`)
    const versionB = b.currentVersionId!
    expect(versionB).not.toBe(versionA)
    const afterB = counts()

    body = TMD_XML
    const back = await collectIntelSource(repository, TMD, net.deps, new Date(T0.getTime() + 7_200_000))
    expect(back).toMatchObject({ status: "ok_items", itemsNew: 0, itemsRevised: 1 })
    const restored = (await repository.listItems(TMD.id)).find(item => item.id === a.id)!
    expect(restored.currentVersionId).toBe(versionA)
    expect(restored.title).toBe(a.title)
    expect(restored.publishedAt).toBe(a.publishedAt)
    expect(counts()).toEqual(afterB)
    expect(await repository.readVersionBlocks(versionA)).toEqual(blocksA)
    expect((await repository.listVersions(a.id)).map(version => version.id).sort()).toEqual([versionA, versionB].sort())
    expect((await repository.listCurrentChanges(a.id)).map(change => [change.reason, change.fromVersionId, change.toVersionId])).toEqual([
      ["new_version", null, versionA],
      ["new_version", versionA, versionB],
      ["restored_version", versionB, versionA],
    ])
    // Seeing A again while A is current is unchanged: no further change row.
    await collectIntelSource(repository, TMD, net.deps, new Date(T0.getTime() + 10_800_000))
    expect(await repository.listCurrentChanges(a.id)).toHaveLength(3)
    native.close()
  })

  it("a single write failure closes the run as failed with backoff, keeps committed entries, lets later sources run, and is retryable", async () => {
    const { database, native, repository } = await setup([TMD, BMKG])
    const net = offline({ [TMD.url]: () => xml(TMD_XML), [BMKG.url]: () => xml(BMKG_XML) })
    let blockInserts = 0
    faults.when = (sql) => {
      if (!sql.includes("INSERT INTO intel_item_block")) return false
      blockInserts++
      return blockInserts === 5
    }
    const job = createIntelCollectJob({ db: database, enabled: true, fetch: net.deps, seeds: [TMD, BMKG], now: () => T0 })
    expect((await job.run()).status).toBe("success")
    const tmdRuns = await repository.listRuns(TMD.id)
    expect(tmdRuns.map(run => [run.status, run.errorCode])).toEqual([["failed", "store_failed"]])
    const committed = await repository.listItems(TMD.id)
    expect(committed.length).toBeGreaterThan(0)
    expect(committed.every(item => item.currentVersionId)).toBe(true)
    const tmd = (await repository.getSource(TMD.id))!
    expect(tmd).toMatchObject({ status: "failing", consecutiveFailures: 1, lastErrorCode: "store_failed" })
    expect(minutes(T0, tmd.nextSyncAt)).toBe(15)
    expect((await repository.listRuns(BMKG.id)).map(run => run.status)).toEqual(["ok_items"])
    expect(native.prepare("SELECT COUNT(*) AS c FROM intel_fetch_run WHERE status = 'running'").get()).toEqual({ c: 0 })

    faults.when = undefined
    const later = new Date(T0.getTime() + 16 * 60_000)
    const retry = createIntelCollectJob({ db: database, enabled: true, fetch: net.deps, seeds: [TMD, BMKG], now: () => later })
    expect((await retry.run()).status).toBe("success")
    expect((await repository.listRuns(TMD.id)).map(run => run.status)).toEqual(["failed", "ok_items"])
    expect((await repository.listItems(TMD.id)).length).toBeGreaterThan(committed.length)
    expect(await repository.getSource(TMD.id)).toMatchObject({ status: "ok", consecutiveFailures: 0 })
    native.close()
  })

  it("reports storage that cannot record the outcome explicitly instead of claiming the run finished", async () => {
    const { database, native, repository } = await setup()
    const net = offline({ [TMD.url]: () => xml(TMD_XML) })
    faults.when = sql => sql.includes("INSERT INTO intel_item_block") || sql.startsWith("UPDATE intel_fetch_run") || sql.trim().startsWith("UPDATE intel_source")
    const outcome = await collectIntelSource(repository, TMD, net.deps, T0)
    expect(outcome).toMatchObject({ status: "storage_unavailable", errorCode: "store_failed" })
    const job = createIntelCollectJob({ db: database, enabled: true, fetch: net.deps, seeds: [{ ...TMD, id: "intel:test-second" }], now: () => T0 })
    expect(await job.run()).toMatchObject({ status: "failed", errorCode: "intel_storage_unavailable" })
    faults.when = undefined
    native.close()
  })

  it("a one-time source-success write failure leaves DB, return value and backoff consistent and keeps committed entries", async () => {
    const { native, repository } = await setup()
    const net = offline({ [TMD.url]: () => xml(TMD_XML) })
    let successWrites = 0
    faults.when = (sql) => {
      if (!sql.includes("consecutive_failures = 0")) return false
      successWrites++
      return successWrites === 1
    }
    const outcome = await collectIntelSource(repository, TMD, net.deps, T0)
    expect(outcome).toMatchObject({ status: "failed", errorCode: "finalize_failed" })
    const committed = (outcome as { itemsCommitted: number }).itemsCommitted
    expect(committed).toBeGreaterThan(0)
    expect((await repository.listRuns(TMD.id)).map(run => [run.status, run.errorCode])).toEqual([["failed", "finalize_failed"]])
    const source = (await repository.getSource(TMD.id))!
    expect(source).toMatchObject({ status: "failing", consecutiveFailures: 1, lastErrorCode: "finalize_failed", lastOkAt: null })
    expect(minutes(T0, source.nextSyncAt)).toBe(15)
    expect((await repository.listItems(TMD.id)).length).toBe(committed)
    expect(native.prepare("SELECT COUNT(*) AS c FROM intel_fetch_run WHERE status IN ('ok_items','ok_empty')").get()).toEqual({ c: 0 })
    native.close()
  })

  it("if the failure state cannot be saved either, success finish returns storage_unavailable and records no success", async () => {
    const { native, repository } = await setup()
    const net = offline({ [TMD.url]: () => xml(TMD_XML) })
    faults.when = sql => sql.trim().startsWith("UPDATE intel_source")
    const outcome = await collectIntelSource(repository, TMD, net.deps, T0)
    expect(outcome).toMatchObject({ status: "storage_unavailable", errorCode: "finalize_failed" })
    faults.when = undefined
    expect((await repository.listRuns(TMD.id)).map(run => run.status)).toEqual(["running"])
    expect(await repository.getSource(TMD.id)).toMatchObject({ consecutiveFailures: 0, lastOkAt: null })
    expect((await repository.listItems(TMD.id)).length).toBeGreaterThan(0)
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

  it("blocks a second in-flight run of the same source at the DB level", async () => {
    const { native, repository } = await setup()
    expect(await repository.beginRun(TMD.id, "2026-10-12T07:00:00.000Z")).not.toBeNull()
    expect(await repository.beginRun(TMD.id, "2026-10-12T07:00:01.000Z")).toBeNull()
    const net = offline({ [TMD.url]: () => xml(TMD_XML) })
    expect(await collectIntelSource(repository, TMD, net.deps, T0)).toEqual({ status: "skipped", errorCode: "source_run_in_flight" })
    expect(net.calls).toEqual([])
    native.close()
  })

  it("negative: a second job instance created while the first is mid-fetch does not interrupt it or collect twice", async () => {
    const { database, native, repository } = await setup()
    let release!: () => void
    let entered!: () => void
    const gate = new Promise<void>(resolve => (release = resolve))
    const inTransport = new Promise<void>(resolve => (entered = resolve))
    const netA = offline({ [TMD.url]: () => xml(TMD_XML) })
    const paused: IntelFetchDeps = {
      lookup: netA.deps.lookup,
      transport: async (...args) => {
        entered()
        await gate
        return netA.deps.transport(...args)
      },
    }
    const first = createIntelCollectJob({ db: database, enabled: true, fetch: paused, seeds: [TMD], now: () => T0 })
    const firstRun = first.run()
    await inTransport
    const later = new Date(T0.getTime() + 60_000)
    const netB = offline({ [TMD.url]: () => xml(TMD_XML) })
    const second = createIntelCollectJob({ db: database, enabled: true, fetch: netB.deps, seeds: [TMD], now: () => later })
    expect(await second.run()).toMatchObject({ status: "success", recordsRead: 0 })
    expect(netB.calls).toEqual([])
    expect((await repository.listRuns(TMD.id)).map(run => run.status)).toEqual(["running"])
    release()
    expect((await firstRun).status).toBe("success")
    expect((await repository.listRuns(TMD.id)).map(run => [run.status, run.errorCode])).toEqual([["ok_items", null]])
    native.close()
  })

  it("genuine restart leftovers stay blocked until the explicit exclusive startup step, then collection resumes", async () => {
    const { database, native, repository } = await setup()
    await repository.registerExecutor("crashed-executor", "2026-10-12T07:00:00.000Z")
    expect(await repository.beginRun(TMD.id, "2026-10-12T07:00:00.000Z", "crashed-executor")).not.toBeNull()
    const net = offline({ [TMD.url]: () => xml(TMD_XML) })
    const job = createIntelCollectJob({ db: database, enabled: true, fetch: net.deps, seeds: [TMD], now: () => T0 })
    expect(await job.run()).toMatchObject({ status: "success", recordsRead: 0 })
    expect((await repository.listRuns(TMD.id)).map(run => run.status)).toEqual(["running"])
    expect(net.calls).toEqual([])

    expect(await recoverIntelRunsAtExclusiveStartup(database, T0)).toBe(1)
    const restarted = createIntelCollectJob({ db: database, enabled: true, fetch: net.deps, seeds: [TMD], now: () => T0 })
    expect((await restarted.run()).status).toBe("success")
    expect((await repository.listRuns(TMD.id)).map(run => [run.status, run.errorCode])).toEqual([["failed", "interrupted"], ["ok_items", null]])
    native.close()
  })

  it("recovers leftovers of an executor confirmed ended without the startup step", async () => {
    const { database, native, repository } = await setup()
    const net = offline({ [TMD.url]: () => xml(TMD_XML) })
    const old = createIntelCollectJob({ db: database, enabled: true, fetch: net.deps, seeds: [], now: () => T0 })
    await old.run()
    expect(await repository.beginRun(TMD.id, "2026-10-12T07:59:00.000Z", old.executorId)).not.toBeNull()
    await old.end()
    const job = createIntelCollectJob({ db: database, enabled: true, fetch: net.deps, seeds: [TMD], now: () => T0 })
    expect((await job.run()).status).toBe("success")
    expect((await repository.listRuns(TMD.id)).map(run => [run.status, run.errorCode])).toEqual([["failed", "interrupted"], ["ok_items", null]])
    native.close()
  })

  it("negative: end() is rejected while a fetch is paused, so a second instance cannot reclaim the working run", async () => {
    const { database, native, repository } = await setup()
    let release!: () => void
    let entered!: () => void
    const gate = new Promise<void>(resolve => (release = resolve))
    const inTransport = new Promise<void>(resolve => (entered = resolve))
    const netA = offline({ [TMD.url]: () => xml(TMD_XML) })
    const paused: IntelFetchDeps = { lookup: netA.deps.lookup, transport: async (...args) => {
      entered()
      await gate
      return netA.deps.transport(...args)
    } }
    const first = createIntelCollectJob({ db: database, enabled: true, fetch: paused, seeds: [TMD], now: () => T0 })
    const firstRun = first.run()
    await inTransport
    await expect(first.end()).rejects.toThrow(/intel_executor_busy/)
    expect(native.prepare("SELECT ended_at FROM intel_executor WHERE id = ?").get(first.executorId)).toEqual({ ended_at: null })
    const netB = offline({ [TMD.url]: () => xml(TMD_XML) })
    const second = createIntelCollectJob({ db: database, enabled: true, fetch: netB.deps, seeds: [TMD], now: () => new Date(T0.getTime() + 60_000) })
    expect(await second.run()).toMatchObject({ status: "success", recordsRead: 0 })
    expect(netB.calls).toEqual([])
    expect((await repository.listRuns(TMD.id)).map(run => run.status)).toEqual(["running"])
    release()
    expect((await firstRun).status).toBe("success")
    expect((await repository.listRuns(TMD.id)).map(run => [run.status, run.errorCode])).toEqual([["ok_items", null]])
    await first.end()
    native.close()
  })

  it("negative: an ended instance refuses to run again and opens no run", async () => {
    const { database, native, repository } = await setup()
    const net = offline({ [TMD.url]: () => xml(TMD_XML) })
    const job = createIntelCollectJob({ db: database, enabled: true, fetch: net.deps, seeds: [TMD], now: () => T0 })
    expect((await job.run()).status).toBe("success")
    await job.end()
    expect(await job.run()).toMatchObject({ status: "failed", errorCode: "intel_executor_ended" })
    expect(net.calls.length).toBe(1)
    expect((await repository.listRuns(TMD.id)).length).toBe(1)
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
