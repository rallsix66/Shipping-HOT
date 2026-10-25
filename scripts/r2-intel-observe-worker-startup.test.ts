import { EventEmitter } from "node:events"
import { existsSync, mkdirSync, readFileSync } from "node:fs"
import { randomUUID } from "node:crypto"
import { resolve } from "node:path"
import { request as httpsRequest } from "node:https"
import { request as httpRequest } from "node:http"
import { lookup as realLookup } from "node:dns/promises"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { type WorkerStopLatch, latchWorkerStop, startAfterImportBarrier } from "./r2-intel-observe-worker-startup"
import { startIntelObservation } from "#/runtime/intel-observation"
import { shutdownBackgroundRuntime } from "#/runtime/bootstrap"
import type { ArticleTransport } from "#/services/article-fetch-security"

// Offline only: any real DNS/HTTP(S) use is a test failure.
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
const workspace = resolve(".")
let session: Awaited<ReturnType<typeof startIntelObservation>> | undefined
let latch: WorkerStopLatch | undefined

/** Stand-in for the worker's `process`: IPC channel present (send is a function) and a mutable `connected`. */
class FakeWorkerProcess extends EventEmitter {
  send?: () => boolean
  constructor(public connected: boolean | undefined, ipc = true) {
    super()
    if (ipc) this.send = () => true
  }

  disconnectFromParent() {
    this.connected = false
    this.emit("disconnect")
  }
}
function directory() {
  mkdirSync(resolve(".tmp"), { recursive: true })
  const path = resolve(`.tmp/r2-intel-observe-startup-${randomUUID()}`)
  mkdirSync(path)
  return path
}
function rss(url: URL) {
  return `<rss version="2.0"><channel><title>Offline synthetic feed</title><item><title>Offline synthetic alert</title><link>https://${url.hostname}/synthetic-one</link><pubDate>Mon, 19 Oct 2026 00:00:00 GMT</pubDate><description>Synthetic content.</description></item></channel></rss>`
}

/**
 * Deterministic import barrier: the business import does not resolve until `release()`. `during` runs while
 * the worker is blocked inside the barrier, i.e. after the latch was installed but before start.
 */
async function startThroughBarrier(proc: FakeWorkerProcess, during: (proc: FakeWorkerProcess) => void = () => {}, beforeImport: (proc: FakeWorkerProcess) => void = () => {}) {
  const lookup = vi.fn(async () => [{ address: "93.184.216.34", family: 4 as const }])
  const transport = vi.fn<ArticleTransport>(async url => ({ status: 200, headers: { "content-type": "application/rss+xml" }, body: rss(url) }))
  const dir = directory()
  latch = latchWorkerStop(proc)
  beforeImport(proc)
  let release!: () => void
  const gate = new Promise<void>((resolveGate) => {
    release = resolveGate
  })
  let entered = false
  const pending = startAfterImportBarrier(latch, async () => {
    entered = true
    await gate
    return { startIntelObservation }
  }, (modules, stopSignal) => modules.startIntelObservation({ workspace, directory: dir, config: { sourceIds: ["TH-W01", "ID-W01"], durationMs: 180 * minute, maxHttpRequests: 20, approvedRedirects: [] }, evidenceMode: "offline", codeIdentity: { fixture: "offline-only" }, stopSignal, fetch: { lookup, transport } }))
  await Promise.resolve()
  expect(entered).toBe(true)
  during(proc)
  release()
  session = await pending
  return { session, lookup, transport, dir }
}
async function expectStoppedWithoutSourceWork(run: Awaited<ReturnType<typeof startThroughBarrier>>) {
  const result = await run.session.done
  // Nothing may start later either: advance well past the first due tick.
  await vi.advanceTimersByTimeAsync(30 * minute)
  expect(run.lookup).not.toHaveBeenCalled()
  expect(run.transport).not.toHaveBeenCalled()
  expect(result).toMatchObject({ reason: "operator_stop", httpRequests: 0, reservations: 0, dnsRequests: 0, readOnlyReopen: true, ownershipReleased: true })
  expect(existsSync(`${run.session.databasePath}.intel-owner.lock`)).toBe(false)
  const events = readFileSync(resolve(run.dir, "events.jsonl"), "utf8").trim().split("\n").map(line => JSON.parse(line) as { type: string })
  expect(events.some(row => row.type === "source_run")).toBe(false)
  expect(events.at(-1)?.type).toBe("finished")
  expect(existsSync(resolve(run.dir, "result.json"))).toBe(true)
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(Date.parse("2026-10-19T00:00:00.000Z"))
  vi.stubEnv("SHIPPING_DATA_MODE", "real")
})
afterEach(async () => {
  await session?.stop()
  session = undefined
  latch?.dispose()
  latch = undefined
  await shutdownBackgroundRuntime()
  expect(httpsRequest).not.toHaveBeenCalled()
  expect(httpRequest).not.toHaveBeenCalled()
  expect(realLookup).not.toHaveBeenCalled()
  vi.useRealTimers()
  vi.unstubAllEnvs()
})

// Primary regression (dots 1792555472.118219): parent disconnects while the import barrier is pending.
it("parent disconnect during the import barrier is latched; after release no DNS/HTTP or source work starts", async () => {
  const run = await startThroughBarrier(new FakeWorkerProcess(true), proc => proc.disconnectFromParent())
  await expectStoppedWithoutSourceWork(run)
})

it("connected=false during the barrier without a disconnect event is caught by the post-barrier re-check", async () => {
  const run = await startThroughBarrier(new FakeWorkerProcess(true), (proc) => {
    proc.connected = false
  })
  expect(latch!.signal.aborted).toBe(true)
  await expectStoppedWithoutSourceWork(run)
})

it("an IPC worker that is already disconnected at startup is aborted immediately and never starts source work", async () => {
  const proc = new FakeWorkerProcess(false)
  const run = await startThroughBarrier(proc, () => {
    expect(latch!.signal.aborted).toBe(true)
  })
  await expectStoppedWithoutSourceWork(run)
})

// Compatibility: early stop messages (not asserted as the root cause; Node may buffer IPC messages).
it.each([
  ["before the business import", "before"],
  ["during the import barrier", "during"],
] as const)("an early stop message %s is honoured without DNS/HTTP", async (_label, when) => {
  const proc = new FakeWorkerProcess(true)
  const sendStop = (target: FakeWorkerProcess) => target.emit("message", { type: "stop" })
  const run = await startThroughBarrier(proc, (target) => {
    if (when === "during") sendStop(target)
    else expect(latch!.signal.aborted).toBe(true)
  }, (target) => {
    if (when === "before") sendStop(target)
  })
  await expectStoppedWithoutSourceWork(run)
})

it("non-stop messages and a worker without IPC do not abort startup", () => {
  const proc = new FakeWorkerProcess(true)
  latch = latchWorkerStop(proc)
  proc.emit("message", { type: "stop", extra: true })
  proc.emit("message", "stop")
  expect(latch.signal.aborted).toBe(false)
  latch.dispose()
  const plain = new FakeWorkerProcess(undefined, false)
  latch = latchWorkerStop(plain)
  latch.recheck()
  expect(latch.expectsIpc).toBe(false)
  expect(latch.signal.aborted).toBe(false)
})

it("dispose removes every listener it installed", () => {
  const proc = new FakeWorkerProcess(true)
  latch = latchWorkerStop(proc)
  for (const event of ["message", "disconnect", "SIGINT", "SIGTERM"]) expect(proc.listenerCount(event)).toBe(1)
  latch.dispose()
  for (const event of ["message", "disconnect", "SIGINT", "SIGTERM"]) expect(proc.listenerCount(event)).toBe(0)
})

it.each([
  ["stop message", (proc: FakeWorkerProcess) => proc.emit("message", { type: "stop" })],
  ["parent disconnect", (proc: FakeWorkerProcess) => proc.disconnectFromParent()],
] as const)("normal startup still collects, and a run-time %s still stops with released ownership", async (_label, stopNow) => {
  const proc = new FakeWorkerProcess(true)
  const run = await startThroughBarrier(proc)
  expect(latch!.signal.aborted).toBe(false)
  await vi.advanceTimersByTimeAsync(15 * minute)
  expect(run.transport).toHaveBeenCalledTimes(2)
  stopNow(proc)
  const result = await run.session.done
  expect(result).toMatchObject({ reason: "operator_stop", httpRequests: 2, readOnlyReopen: true, ownershipReleased: true })
  expect(existsSync(`${run.session.databasePath}.intel-owner.lock`)).toBe(false)
})
