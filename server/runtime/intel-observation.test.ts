import process from "node:process"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { randomUUID } from "node:crypto"
import { resolve } from "node:path"
import { spawnSync } from "node:child_process"
import { request as httpsRequest } from "node:https"
import { request as httpRequest } from "node:http"
import { lookup as realLookup } from "node:dns/promises"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import NativeDatabase from "better-sqlite3"
import { startIntelObservation, validateObservationDirectory } from "#/runtime/intel-observation"
import { shutdownBackgroundRuntime } from "#/runtime/bootstrap"
import type { ArticleTransport } from "#/services/article-fetch-security"
import type { IntelObservationConfig } from "#/runtime/intel-observation-network"

vi.mock("node:http", () => ({ request: vi.fn(() => {
  throw new Error("offline_http_tripwire")
}) }))
vi.mock("node:https", () => ({ request: vi.fn(() => {
  throw new Error("offline_https_tripwire")
}) }))
vi.mock("node:dns/promises", () => ({ lookup: vi.fn(() => {
  throw new Error("offline_dns_tripwire")
}) }))

const minute = 60000
const initial = Date.parse("2026-10-19T00:00:00.000Z")
const workspace = resolve(".")
let session: Awaited<ReturnType<typeof startIntelObservation>> | undefined
let resume: (() => void) | undefined
const config = (overrides: Partial<IntelObservationConfig> = {}): IntelObservationConfig => ({ sourceIds: ["TH-W01", "ID-W01"], durationMs: 180 * minute, maxHttpRequests: 20, approvedRedirects: [], ...overrides })
function directory() {
  mkdirSync(resolve(".tmp"), { recursive: true })
  const path = resolve(`.tmp/r2-intel-observe-test-${randomUUID()}`)
  mkdirSync(path)
  return path
}
function read<T = Record<string, unknown>>(path: string, sql: string): T[] {
  const db = new NativeDatabase(path, { readonly: true })
  try {
    return db.prepare(sql).all() as T[]
  } finally {
    db.close()
  }
}
function rss(url: URL) {
  return `<rss version="2.0"><channel><title>Offline synthetic feed</title><item><title>Offline synthetic alert</title><link>https://${url.hostname}/synthetic-one</link><pubDate>Mon, 19 Oct 2026 00:00:00 GMT</pubDate><description>${"Synthetic content. ".repeat(80)}</description></item></channel></rss>`
}
function transport() {
  return vi.fn<ArticleTransport>(async url => ({ status: 200, headers: { "content-type": "application/rss+xml" }, body: rss(url) }))
}
async function start(fetch = transport(), selected = config(), dir = directory()) {
  session = await startIntelObservation({ workspace, directory: dir, config: selected, evidenceMode: "offline", codeIdentity: { fixture: "offline-only" }, fetch: { lookup: async () => [{ address: "93.184.216.34", family: 4 }], transport: fetch }, runtimeOptions: { logger: { info: vi.fn(), error: vi.fn() } } })
  return { session, fetch, dir }
}
beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(initial)
  vi.stubEnv("SHIPPING_DATA_MODE", "real")
})
afterEach(async () => {
  resume?.()
  resume = undefined
  await session?.stop()
  session = undefined
  await shutdownBackgroundRuntime()
  expect(httpsRequest).not.toHaveBeenCalled()
  expect(httpRequest).not.toHaveBeenCalled()
  expect(realLookup).not.toHaveBeenCalled()
  vi.useRealTimers()
  vi.unstubAllEnvs()
})

it("uses one existing job, adaptive due times, license-scoped blocks and dedupe across ticks", async () => {
  const f = await start()
  expect(f.session.runtime.getStatus().jobs.map(row => row.id)).toEqual(["intel-collect"])
  expect(f.fetch).not.toHaveBeenCalled()
  await vi.advanceTimersByTimeAsync(15 * minute)
  expect(f.fetch).toHaveBeenCalledTimes(2)
  expect(read(f.session.databasePath, "SELECT status, next_sync_at FROM intel_source WHERE id IN ('intel:th-w01','intel:id-w01')")).toEqual([
    { status: "ok", next_sync_at: new Date(initial + 75 * minute).toISOString() },
    { status: "ok", next_sync_at: new Date(initial + 75 * minute).toISOString() },
  ])
  const versions = read(f.session.databasePath, "SELECT content_scope FROM intel_item_version ORDER BY content_scope")
  expect(versions).toEqual([{ content_scope: "excerpt" }, { content_scope: "full_text" }])
  expect(read(f.session.databasePath, "SELECT MAX(LENGTH(text)) AS n FROM intel_item_block WHERE block_type = 'excerpt'")).toEqual([{ n: 280 }])
  expect(read(f.session.databasePath, "SELECT COUNT(*) AS n FROM intel_source WHERE enabled = 1 AND id NOT IN ('intel:th-w01','intel:id-w01')")).toEqual([{ n: 0 }])
  await vi.advanceTimersByTimeAsync(60 * minute)
  expect(f.fetch).toHaveBeenCalledTimes(4)
  expect(read(f.session.databasePath, "SELECT COUNT(*) AS n FROM intel_item_version")).toEqual([{ n: 2 }])
  expect(read(f.session.databasePath, "SELECT COUNT(*) AS n FROM intel_fetch_run WHERE items_new = 0 AND status = 'ok_items'")).toEqual([{ n: 2 }])
  await f.session.stop()
  const result = await f.session.done
  expect(result).toMatchObject({ evidenceMode: "offline", httpRequests: 4, ownershipReleased: true, readOnlyReopen: true })
  const events = readFileSync(resolve(f.dir, "events.jsonl"), "utf8").trim().split("\n").map(line => JSON.parse(line))
  expect(events.filter(row => row.type === "source_run")).toHaveLength(4)
  expect(readFileSync(resolve(f.dir, "events.jsonl"), "utf8")).not.toContain("Synthetic content.")
  // A fresh OS process only reopens readonly; it never resumes the observation window/budget.
  const child = spawnSync(process.execPath, ["--input-type=module", "-e", "import DB from 'better-sqlite3'; const d=new DB(process.argv[1],{readonly:true}); console.log(JSON.stringify(d.prepare('SELECT COUNT(*) AS n FROM intel_item_version').get())); d.close()", f.session.databasePath], { cwd: f.dir, encoding: "utf8", windowsHide: true })
  expect(child.status, child.stderr).toBe(0)
  expect(JSON.parse(child.stdout)).toEqual({ n: 2 })
  expect(() => validateObservationDirectory(workspace, f.dir)).toThrow("run_exists")
})

it("retains the existing 15/30-minute failure backoff and distinguishes success-empty", async () => {
  const fetch = transport().mockImplementation(async url => url.hostname === "www.tmd.go.th" ? { status: 503, headers: {}, body: "unavailable" } : { status: 200, headers: { "content-type": "application/rss+xml" }, body: "<rss><channel><title>Offline empty feed</title></channel></rss>" })
  const f = await start(fetch)
  await vi.advanceTimersByTimeAsync(15 * minute)
  expect(read(f.session.databasePath, "SELECT status, consecutive_failures, next_sync_at FROM intel_source WHERE id = 'intel:th-w01'")).toEqual([{ status: "failing", consecutive_failures: 1, next_sync_at: new Date(initial + 30 * minute).toISOString() }])
  expect(read(f.session.databasePath, "SELECT status, consecutive_failures FROM intel_source WHERE id = 'intel:id-w01'")).toEqual([{ status: "ok_empty", consecutive_failures: 0 }])
  await vi.advanceTimersByTimeAsync(15 * minute)
  expect(fetch).toHaveBeenCalledTimes(3)
  expect(read(f.session.databasePath, "SELECT consecutive_failures, next_sync_at FROM intel_source WHERE id = 'intel:th-w01'")).toEqual([{ consecutive_failures: 2, next_sync_at: new Date(initial + 60 * minute).toISOString() }])
  await vi.advanceTimersByTimeAsync(15 * minute)
  expect(fetch).toHaveBeenCalledTimes(3)
  fetch.mockImplementation(async () => ({ status: 200, headers: { "content-type": "application/rss+xml" }, body: "<rss><channel><title>Offline empty feed</title></channel></rss>" }))
  await vi.advanceTimersByTimeAsync(15 * minute)
  expect(fetch).toHaveBeenCalledTimes(4)
  expect(read(f.session.databasePath, "SELECT status, consecutive_failures FROM intel_source WHERE id = 'intel:th-w01'")).toEqual([{ status: "ok_empty", consecutive_failures: 0 }])
  expect(read(f.session.databasePath, "SELECT status FROM intel_fetch_run ORDER BY started_at,source_id").map(row => row.status)).toEqual(["ok_empty", "failed", "failed", "ok_empty"])
})

it("drains the last budgeted response before end/release and never starts the second source", async () => {
  const fetch = transport().mockImplementation(url => new Promise((resolveResponse) => {
    resume = () => resolveResponse({ status: 200, headers: { "content-type": "application/rss+xml" }, body: rss(url) })
  }))
  const f = await start(fetch, config({ maxHttpRequests: 1 }))
  let completed = false
  void f.session.done.then(() => {
    completed = true
  })
  await vi.advanceTimersByTimeAsync(15 * minute)
  expect(fetch).toHaveBeenCalledTimes(1)
  expect(f.session.runtime.getStatus().running).toBe(false)
  expect(completed).toBe(false)
  expect(existsSync(`${f.session.databasePath}.intel-owner.lock`)).toBe(true)
  expect(read(f.session.databasePath, "SELECT ended_at FROM intel_executor")).toEqual([{ ended_at: null }])
  resume!()
  const result = await f.session.done
  expect(result).toMatchObject({ reason: "http_budget", httpRequests: 1, hardAborted: false, ownershipReleased: true })
  expect(read(f.session.databasePath, "SELECT source_id,status FROM intel_fetch_run")).toEqual([{ source_id: "intel:th-w01", status: "ok_items" }])
  expect(read(f.session.databasePath, "SELECT status FROM intel_source WHERE id = 'intel:id-w01'")).toEqual([{ status: "never_run" }])
  expect(read(f.session.databasePath, "SELECT ended_at FROM intel_executor")[0].ended_at).not.toBeNull()
})

it("aborts in-flight HTTP on deadline, records failure and releases only after drain", async () => {
  const fetch = transport().mockImplementation((_url, _addresses, options) => new Promise((_resolveResponse, reject) => {
    options.signal!.addEventListener("abort", () => reject(new Error("synthetic aborted HTTP")), { once: true })
  }))
  const f = await start(fetch, config({ durationMs: 16 * minute }))
  await vi.advanceTimersByTimeAsync(15 * minute)
  expect(existsSync(`${f.session.databasePath}.intel-owner.lock`)).toBe(true)
  await vi.advanceTimersByTimeAsync(minute)
  expect(await f.session.done).toMatchObject({ reason: "deadline", httpRequests: 1, hardAborted: true, ownershipReleased: true })
  expect(read(f.session.databasePath, "SELECT status FROM intel_fetch_run")).toEqual([{ status: "failed" }])
  expect(read(f.session.databasePath, "SELECT COUNT(*) AS n FROM intel_item")).toEqual([{ n: 0 }])
})

it("ends a zero-budget run before source work and refuses another simultaneous Runtime", async () => {
  const f = await start(transport(), config({ maxHttpRequests: 0 }))
  expect(await f.session.done).toMatchObject({ reason: "http_budget", httpRequests: 0, dnsRequests: 0, ownershipReleased: true })
  expect(f.fetch).not.toHaveBeenCalled()
  session = undefined
  const other = await start()
  await expect(startIntelObservation({ workspace, directory: directory(), config: config(), fetch: { lookup: vi.fn(), transport: transport() }, codeIdentity: {}, evidenceMode: "offline" })).rejects.toThrow("runtime_already_active")
  expect(other.fetch).not.toHaveBeenCalled()
})

it("rejects a retained/outside directory, prior DB and non-real mode before creating state", async () => {
  expect(() => validateObservationDirectory(workspace, workspace)).toThrow("directory_invalid")
  const old = directory()
  mkdirSync(resolve(old, ".data"))
  writeFileSync(resolve(old, ".data/retained.txt"), "untouched")
  expect(() => validateObservationDirectory(workspace, old)).toThrow("run_exists")
  vi.stubEnv("SHIPPING_DATA_MODE", "mock")
  const fresh = directory()
  await expect(startIntelObservation({ workspace, directory: fresh, config: config(), fetch: { lookup: vi.fn(), transport: transport() }, codeIdentity: {}, evidenceMode: "offline" })).rejects.toThrow("real_mode_required")
  expect(existsSync(resolve(fresh, ".data"))).toBe(false)
  expect(readFileSync(resolve(old, ".data/retained.txt"), "utf8")).toBe("untouched")
})

it("stops after two naturally due PH-M01 rounds, keeps metadata title blocks, and treats an unchanged second feed as new=0", async () => {
  const fetch = vi.fn<ArticleTransport>(async () => ({ status: 200, headers: { "content-type": "application/rss+xml" }, body: `<rss version="2.0"><channel><title>Offline PortCalls</title><item><title>Offline synthetic port call</title><link>https://portcalls.com/synthetic-one</link><pubDate>Mon, 19 Oct 2026 00:00:00 GMT</pubDate><description>${"Synthetic content. ".repeat(80)}</description></item></channel></rss>` }))
  const f = await start(fetch, config({ sourceIds: ["PH-M01"], maxHttpRequests: 8, stopAfterSuccessfulRounds: 2 }))
  expect(fetch).not.toHaveBeenCalled()
  await vi.advanceTimersByTimeAsync(15 * minute)
  expect(fetch).toHaveBeenCalledTimes(1)
  expect(fetch.mock.calls[0][0].href).toBe("https://portcalls.com/feed/")
  expect(read(f.session.databasePath, "SELECT status, next_sync_at FROM intel_source WHERE id = 'intel:ph-m01'")).toEqual([{ status: "ok", next_sync_at: new Date(initial + 75 * minute).toISOString() }])
  await vi.advanceTimersByTimeAsync(59 * minute)
  expect(fetch).toHaveBeenCalledTimes(1)
  await vi.advanceTimersByTimeAsync(minute)
  expect(fetch.mock.calls.map(call => call[0].href)).toEqual(["https://portcalls.com/feed/", "https://portcalls.com/feed/"])
  const result = await f.session.done
  expect(result).toMatchObject({ reason: "rounds_complete", successfulRounds: 2, httpRequests: 2, dnsRequests: 2, hardAborted: false, ownershipReleased: true, readOnlyReopen: true })
  expect(read(f.session.databasePath, "SELECT status, items_seen, items_new, items_revised FROM intel_fetch_run ORDER BY started_at")).toEqual([
    { status: "ok_items", items_seen: 1, items_new: 1, items_revised: 0 },
    { status: "ok_items", items_seen: 1, items_new: 0, items_revised: 0 },
  ])
  expect(read(f.session.databasePath, "SELECT content_scope FROM intel_item_version")).toEqual([{ content_scope: "metadata_only" }])
  expect(read(f.session.databasePath, "SELECT DISTINCT block_type FROM intel_item_block")).toEqual([{ block_type: "title" }])
  expect(readFileSync(resolve(f.dir, "events.jsonl"), "utf8")).not.toContain("Synthetic content.")
  expect(read(f.session.databasePath, "SELECT ended_at FROM intel_executor")[0].ended_at).not.toBeNull()
  expect(existsSync(`${f.session.databasePath}.intel-owner.lock`)).toBe(false)
  expect(() => validateObservationDirectory(workspace, f.dir)).toThrow("run_exists")
})

it("records the first failed round and does not dispatch another collection", async () => {
  const fetch = transport().mockResolvedValue({ status: 503, headers: {}, body: "unavailable" })
  const f = await start(fetch, config({ sourceIds: ["PH-M01"], maxHttpRequests: 8, stopAfterSuccessfulRounds: 2 }))
  await vi.advanceTimersByTimeAsync(15 * minute)
  const result = await f.session.done
  expect(result).toMatchObject({ reason: "round_failed", successfulRounds: 0, httpRequests: 1, ownershipReleased: true, readOnlyReopen: true })
  expect(read(f.session.databasePath, "SELECT status FROM intel_fetch_run")).toEqual([{ status: "failed" }])
  await vi.advanceTimersByTimeAsync(60 * minute)
  expect(fetch).toHaveBeenCalledTimes(1)
  expect(read(f.session.databasePath, "SELECT ended_at FROM intel_executor")[0].ended_at).not.toBeNull()
  expect(existsSync(`${f.session.databasePath}.intel-owner.lock`)).toBe(false)
})

it("does not copy the Maersk header limit onto PH-M01 or admit that source into a PH-M01 manifest", async () => {
  const ph = await start(transport(), config({ sourceIds: ["PH-M01"], maxHttpRequests: 0 }))
  const phManifest = JSON.parse(readFileSync(resolve(ph.dir, "manifest.json"), "utf8"))
  expect(phManifest.sources.map((row: { catalogId: string }) => row.catalogId)).toEqual(["PH-M01"])
  expect(phManifest.sources[0]).toMatchObject({ url: "https://portcalls.com/feed/", persistence: "disallowed", enabled: true })
  expect(phManifest.sources[0].sourceHeaderLimit).toBeUndefined()
  expect(await ph.session.done).toMatchObject({ reason: "http_budget", httpRequests: 0 })
  session = undefined
  const maersk = await start(transport(), config({ sourceIds: ["XX-K01"], maxHttpRequests: 0 }))
  const manifest = JSON.parse(readFileSync(resolve(maersk.dir, "manifest.json"), "utf8"))
  expect(manifest.sources).toHaveLength(1)
  expect(manifest.sources[0]).toMatchObject({ catalogId: "XX-K01", sourceHeaderLimit: { sourceId: "intel:xx-k01", url: "https://www.maersk.com/news", maxHeaderSize: 32768 } })
  expect(await maersk.session.done).toMatchObject({ reason: "http_budget", httpRequests: 0 })
})
