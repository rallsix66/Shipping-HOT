import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { resolve } from "node:path"
import { pathToFileURL } from "node:url"
import NativeDatabase from "better-sqlite3"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { PH_M01_FEED_URL, PH_M01_MAX_HTTP_REQUESTS, createPhM01BoundedFetch, liveFetchFactory, parsePhM01Arguments, resolvePhM01Paths, runPhM01Oneshot } from "./ph-m01-oneshot"
import type { IntelFetchDeps } from "#/intel/collect"
import { registeredIntelSources } from "#/intel/sources/registry"
import { PRODUCTION_ALLOW_SELECT_CATALOG_IDS, productionIntelOptions } from "#/runtime/intel-production"
import { validateObservationConfig } from "#/runtime/intel-observation-network"

const SECRET = "SECRET-DESCRIPTION-NOT-STORED"
const NOTICE = "PortCalls synthetic notice"
const item = `<item><title>${NOTICE}</title><link>https://portcalls.com/synthetic-notice</link><pubDate>Tue, 13 Oct 2026 02:00:00 GMT</pubDate><description>${SECRET}</description></item>`
const feedBody = `<?xml version="1.0"?><rss version="2.0"><channel>${item}${item}</channel></rss>`
const emptyBody = `<?xml version="1.0"?><rss version="2.0"><channel><item><description>${SECRET}</description></item></channel></rss>`
const lookup = async () => [{ address: "93.184.216.34", family: 4 as const }]
const ok = (body = feedBody) => vi.fn(async (url: URL) => ({ status: 200, headers: { "content-type": "application/rss+xml" }, body, requested: url.href }))

let live: ReturnType<typeof vi.spyOn>
beforeEach(() => {
  live = vi.spyOn(liveFetchFactory, "create").mockImplementation(() => {
    throw new Error("live_fetch_called")
  })
})
afterEach(() => {
  live.mockRestore()
  vi.unstubAllEnvs()
})

function workspace() {
  return mkdtempSync(resolve(tmpdir(), "ph-m01-oneshot-"))
}

function execute(dir: string, runId: string, fetch: IntelFetchDeps, extra: { signal?: AbortSignal, dnsWaitMs?: number, acquireOwnership?: () => Promise<{ release: () => Promise<void> }> } = {}) {
  return runPhM01Oneshot({ mode: "execute", workspace: dir, runId, fetch, now: () => new Date("2026-10-24T03:00:00.000Z"), ...extra })
}

it("plans with no database, no network, and no job run", async () => {
  const dir = workspace()
  const transport = vi.fn()
  const summary = await runPhM01Oneshot({ mode: "plan", workspace: dir, fetch: { lookup, transport } })
  expect(summary).toMatchObject({ mode: "plan", exit: "planned", exitCode: 0, reason: "planned", runInvoked: false, httpRequests: 0, lookupCalls: 0, redirectResponses: 0, network: "not_started", liveVerified: false, jobEnabled: null, databasePath: null, descriptionPersisted: false, contentScope: "metadata_only" })
  expect(summary.selection).toMatchObject({ catalogId: "PH-M01", sourceId: "intel:ph-m01", url: PH_M01_FEED_URL, allowedHosts: ["portcalls.com"], persistence: "disallowed", registryEnabled: false, parsedSeeds: 1 })
  expect(transport).not.toHaveBeenCalled()
  expect(live).not.toHaveBeenCalled()
  expect(existsSync(resolve(dir, ".tmp"))).toBe(false)
  expect(existsSync(resolve(dir, ".data"))).toBe(false)
  expect(JSON.stringify(summary)).not.toContain("dnsRequests")
})

it("accepts only an explicit PH-M01 execute and rejects directory escape", () => {
  expect(parsePhM01Arguments([])).toEqual({ help: false, mode: "plan" })
  expect(parsePhM01Arguments(["--help"])).toMatchObject({ help: true, mode: "plan" })
  expect(() => parsePhM01Arguments(["--run-id", "once"])).toThrow("ph_m01_execute_required")
  expect(() => parsePhM01Arguments(["--execute"])).toThrow("ph_m01_run_id_invalid")
  expect(() => parsePhM01Arguments(["--execute", "--run-id", "../outside"])).toThrow("ph_m01_run_id_invalid")
  expect(() => parsePhM01Arguments(["--execute", "--execute", "--run-id", "once"])).toThrow("ph_m01_duplicate_argument")
  expect(parsePhM01Arguments(["--execute", "--run-id", "once"])).toEqual({ help: false, mode: "execute", runId: "once" })
  expect(() => resolvePhM01Paths(workspace(), "..")).toThrow("ph_m01_run_id_invalid")
  expect(() => resolvePhM01Paths(workspace(), "nested/dir")).toThrow("ph_m01_run_id_invalid")
})

it("refuses an existing directory or database before any request", async () => {
  const dir = workspace()
  const transport = vi.fn()
  const directory = resolvePhM01Paths(dir, "taken")
  mkdirSync(directory.directory, { recursive: true })
  await expect(execute(dir, "taken", { lookup, transport })).rejects.toThrow("ph_m01_directory_exists")
  const database = resolvePhM01Paths(dir, "dbtaken")
  mkdirSync(database.directory, { recursive: true })
  writeFileSync(database.databasePath, "")
  await expect(execute(dir, "dbtaken", { lookup, transport })).rejects.toThrow("ph_m01_database_exists")
  expect(transport).not.toHaveBeenCalled()
  expect(existsSync(resolve(dir, ".data", "shipping-hot-v3.sqlite3"))).toBe(false)
})

it("stops the fifth HTTP call before transport and follows only four same-host hops", async () => {
  const inner = vi.fn(async () => ({ status: 204, headers: {}, body: "" }))
  const bounded = createPhM01BoundedFetch({ lookup, transport: inner }, new AbortController().signal, 1000)
  const options = { timeoutMs: 1000, maxBytes: 1024, headers: {} }
  for (let count = 0; count < PH_M01_MAX_HTTP_REQUESTS; count += 1) await bounded.fetch.transport(new URL(PH_M01_FEED_URL), [{ address: "93.184.216.34", family: 4 }], options)
  await expect(bounded.fetch.transport(new URL(PH_M01_FEED_URL), [{ address: "93.184.216.34", family: 4 }], options)).rejects.toThrow("ph_m01_http_budget_exhausted")
  expect(inner).toHaveBeenCalledTimes(4)
  expect(bounded.state).toMatchObject({ httpRequests: 4, budgetRejections: 1 })

  const dir = workspace()
  let hops = 0
  const transport = vi.fn(async (url: URL) => {
    expect(url.href).toBe(PH_M01_FEED_URL)
    hops += 1
    if (hops < 4) return { status: 302, headers: { location: PH_M01_FEED_URL }, body: "" }
    return { status: 200, headers: { "content-type": "application/rss+xml" }, body: feedBody }
  })
  const summary = await execute(dir, "redirects", { lookup: vi.fn(lookup), transport })
  expect(summary).toMatchObject({ exit: "collected", exitCode: 0, httpRequests: 4, lookupCalls: 4, redirectResponses: 3, detailRequests: 0, otherHostRequests: 0 })
  expect(transport).toHaveBeenCalledTimes(4)
})

it("rejects a cross-host redirect and an HTTPS downgrade without another request", async () => {
  for (const [runId, location, errorCode] of [
    ["cross-host", "https://evil.example/feed/", "host_not_allowed"],
    ["downgrade", "http://portcalls.com/feed/", "https_downgrade"],
  ] as const) {
    const dir = workspace()
    const transport = vi.fn(async (url: URL) => {
      expect(url.href).toBe(PH_M01_FEED_URL)
      return { status: 302, headers: { location }, body: "" }
    })
    const calls = vi.fn(lookup)
    const summary = await execute(dir, runId, { lookup: calls, transport })
    expect(summary.exit).not.toBe("collected")
    expect(summary).toMatchObject({ exitCode: 1, reason: "source_failed", httpRequests: 1, runErrorCode: errorCode, otherHostRequests: 0, detailRequests: 0 })
    expect(transport).toHaveBeenCalledTimes(1)
    expect(calls).toHaveBeenCalledTimes(1)
    expect(registeredIntelSources.find(seed => seed.catalogId === "PH-M01")?.allowedHosts).toEqual(["portcalls.com"])
  }
})

it("stores one metadata title, dedupes the repeat, and keeps the lock on this database", async () => {
  const dir = workspace()
  vi.stubEnv("SHIPPING_DATABASE_PATH", resolve(dir, "retained.sqlite3"))
  vi.stubEnv("SHIPPING_INTEL_ENABLED", "false")
  const interval = vi.spyOn(globalThis, "setInterval")
  const calls = vi.fn(lookup)
  const paths = resolvePhM01Paths(dir, "stored")
  const seen = { lockDatabase: "" }
  const transport = vi.fn(async (url: URL) => {
    expect(url.href).toBe(PH_M01_FEED_URL)
    const canonical = realpathSync(resolve(realpathSync(paths.directory), "ph-m01.sqlite3"))
    const payload = JSON.parse(readFileSync(`${canonical}.intel-owner.lock`, "utf8")) as { database: string }
    seen.lockDatabase = payload.database
    expect(payload.database).toBe(canonical)
    return { status: 200, headers: { "content-type": "application/rss+xml" }, body: feedBody }
  })
  const summary = await execute(dir, "stored", { lookup: calls, transport })
  expect(interval).not.toHaveBeenCalled()
  interval.mockRestore()
  expect(live).not.toHaveBeenCalled()
  expect(summary).toMatchObject({
    exit: "collected",
    exitCode: 0,
    reason: "collected",
    runInvoked: true,
    jobEnabled: false,
    jobStatus: "success",
    network: "injected",
    liveVerified: false,
    httpRequests: 1,
    lookupCalls: 1,
    recordsRead: 2,
    recordsWritten: 1,
    itemsNew: 1,
    itemsRevised: 0,
    itemsUnchanged: 1,
    contentScope: "metadata_only",
    descriptionPersisted: false,
    dateEvidenceRows: 0,
    enabledCatalogIds: ["PH-M01"],
    lockMatchesDatabase: true,
    ownershipReleased: true,
    databaseClosed: true,
    cleanup: ["run_settled", "job_ended", "database_closed", "ownership_released"],
  })
  expect(seen.lockDatabase).toBe(realpathSync(summary.databasePath!))
  expect(existsSync(`${summary.databasePath}.intel-owner.lock`)).toBe(false)
  expect(existsSync(resolve(dir, "retained.sqlite3"))).toBe(false)
  expect(existsSync(resolve(dir, ".data"))).toBe(false)
  const db = new NativeDatabase(summary.databasePath!, { readonly: true })
  try {
    expect(db.prepare("SELECT block_type, text FROM intel_item_block").all()).toEqual([{ block_type: "title", text: NOTICE }])
    expect(JSON.stringify(db.prepare("SELECT title, canonical_url FROM intel_item").all())).not.toContain(SECRET)
    expect(db.prepare("SELECT content_scope, date_evidence, source_published_at FROM intel_item_version").all()).toEqual([{ content_scope: "metadata_only", date_evidence: null, source_published_at: "2026-10-13T02:00:00.000Z" }])
    expect(db.prepare("SELECT status FROM intel_fetch_run").all()).toEqual([{ status: "ok_items" }])
    expect(db.prepare("SELECT ended_at FROM intel_executor").get()).toMatchObject({ ended_at: expect.any(String) })
    expect(db.prepare("SELECT COUNT(*) AS n FROM provider_usage").get()).toEqual({ n: 0 })
    const locked = db.prepare("SELECT url, persistence, enabled FROM intel_source WHERE catalog_id = 'PH-M01'").get()
    expect(locked).toMatchObject({ url: PH_M01_FEED_URL, persistence: "disallowed", enabled: 1 })
  } finally {
    db.close()
  }
})

it("does not retry a failed fetch or call an empty or unrequested result success", async () => {
  const failed = workspace()
  const transport = vi.fn(async () => {
    throw new Error("fetch_timeout")
  })
  const summary = await execute(failed, "failed", { lookup: vi.fn(lookup), transport })
  expect(transport).toHaveBeenCalledTimes(1)
  expect(summary).toMatchObject({ exit: "failed", exitCode: 1, reason: "source_failed", runErrorCode: "fetch_timeout", httpRequests: 1, ownershipReleased: true, databaseClosed: true })
  expect(summary.exit).not.toBe("collected")

  const empty = workspace()
  const emptySummary = await execute(empty, "empty", { lookup, transport: ok(emptyBody) })
  expect(emptySummary).toMatchObject({ exit: "failed", exitCode: 1, reason: "empty_result", jobStatus: "success", recordsRead: 0, httpRequests: 1 })
  expect(emptySummary.exit).not.toBe("collected")
})

it("aborts the in-flight transport and releases the database only after the run settles", async () => {
  const dir = workspace()
  const controller = new AbortController()
  let entered: () => void = () => {}
  const ready = new Promise<void>((resolveReady) => {
    entered = resolveReady
  })
  let sawAbort = false
  const transport: IntelFetchDeps["transport"] = (_url, _addresses, options) => new Promise((_resolve, reject) => {
    entered()
    options.signal?.addEventListener("abort", () => {
      sawAbort = true
      reject(new Error("aborted-in-test"))
    }, { once: true })
  })
  const pending = execute(dir, "cancel", { lookup, transport }, { signal: controller.signal })
  await ready
  controller.abort()
  const summary = await pending
  expect(sawAbort).toBe(true)
  expect(summary).toMatchObject({ exit: "cancelled", exitCode: 2, reason: "cancelled", cancellation: "during_run", ownershipReleased: true, databaseClosed: true, cleanup: ["run_settled", "job_ended", "database_closed", "ownership_released"] })
  expect(summary.exit).not.toBe("collected")
  expect(existsSync(`${summary.databasePath}.intel-owner.lock`)).toBe(false)
  const db = new NativeDatabase(summary.databasePath!, { readonly: true })
  try {
    expect(db.prepare("SELECT status, error_code FROM intel_fetch_run").get()).toMatchObject({ status: "failed", error_code: "fetch_timeout" })
    expect((db.prepare("SELECT ended_at FROM intel_executor").get() as { ended_at: string }).ended_at).toEqual(expect.any(String))
  } finally {
    db.close()
  }
})

it("times out a hanging lookup once, records a lookup call rather than a packet count, and does not open transport", async () => {
  const dir = workspace()
  const transport = vi.fn()
  const summary = await execute(dir, "dns", { lookup: () => new Promise(() => undefined), transport }, { dnsWaitMs: 40 })
  expect(transport).not.toHaveBeenCalled()
  expect(summary).toMatchObject({ exit: "failed", exitCode: 1, reason: "source_failed", dns: "timed_out", lookupCalls: 1, httpRequests: 0, runErrorCode: "dns_failed" })
  expect(summary.exit).not.toBe("collected")
  expect(Object.keys(summary)).not.toContain("dnsRequests")
})

it("rejects a lock whose database path is not the isolated file", async () => {
  const dir = workspace()
  const transport = vi.fn()
  let released = false
  await expect(execute(dir, "mismatch", { lookup, transport }, { acquireOwnership: async () => {
    const canonical = realpathSync(resolve(realpathSync(resolvePhM01Paths(dir, "mismatch").directory), "ph-m01.sqlite3"))
    writeFileSync(`${canonical}.intel-owner.lock`, JSON.stringify({ token: "synthetic", database: resolve(dir, "shipping-hot-v3.sqlite3") }))
    return { release: async () => {
      released = true
    } }
  } })).rejects.toThrow("ph_m01_lock_database_mismatch")
  expect(released).toBe(true)
  expect(transport).not.toHaveBeenCalled()
})

it("leaves the registry, production default, and observation allowlist unchanged", async () => {
  const before = registeredIntelSources.map(seed => ({ id: seed.id, enabled: seed.enabled, url: seed.url, persistence: seed.persistence, allowedHosts: [...seed.allowedHosts] }))
  const allow = [...PRODUCTION_ALLOW_SELECT_CATALOG_IDS]
  const dir = workspace()
  await execute(dir, "shared", { lookup, transport: ok() })
  expect(registeredIntelSources.map(seed => ({ id: seed.id, enabled: seed.enabled, url: seed.url, persistence: seed.persistence, allowedHosts: [...seed.allowedHosts] }))).toEqual(before)
  expect([...PRODUCTION_ALLOW_SELECT_CATALOG_IDS]).toEqual(allow)
  expect(registeredIntelSources.find(seed => seed.catalogId === "PH-M01")).toMatchObject({ enabled: false, url: PH_M01_FEED_URL, persistence: "disallowed", allowedHosts: ["portcalls.com"] })
  expect(productionIntelOptions({ env: {}, dependencies: null }).registry?.intel).toMatchObject({ enabled: false, seeds: [] })
  expect(() => validateObservationConfig({ sourceIds: ["PH-M01"], durationMs: 1000, maxHttpRequests: 1, approvedRedirects: [] })).toThrow("observation_sources_invalid")
  const source = `${readFileSync(resolve("scripts/ph-m01-oneshot.ts"), "utf8")}\n${readFileSync(resolve("scripts/ph-m01-oneshot-cli.ts"), "utf8")}`
  expect(source).not.toContain("bootstrapBackgroundRuntime")
  expect(source).not.toContain("setInterval")
  expect(source).not.toContain("shipping-hot-v3.sqlite3")
  expect(source).not.toContain("SHIPPING_DATABASE_PATH")
})

it("the plan CLI prints a redacted plan and does not create a database", () => {
  const entry = ["--import", "tsx/esm", "--experimental-loader", pathToFileURL(resolve("scripts/tsx-alias-loader.mjs")).href, resolve("scripts/ph-m01-oneshot-cli.ts")]
  const plan = spawnSync(process.execPath, entry, { cwd: resolve("."), encoding: "utf8", windowsHide: true, timeout: 20000 })
  expect(plan.status, plan.stderr).toBe(0)
  expect(JSON.parse(plan.stdout)).toMatchObject({ exit: "planned", httpRequests: 0, runInvoked: false, network: "not_started" })
  expect(plan.stdout).not.toContain(SECRET)
  const missing = spawnSync(process.execPath, [...entry, "--run-id", "not-execute"], { cwd: resolve("."), encoding: "utf8", windowsHide: true, timeout: 20000 })
  expect(missing.status).toBe(1)
  expect(missing.stderr).toContain("ph_m01_execute_required")
})
