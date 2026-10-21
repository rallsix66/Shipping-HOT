import { expect, it, vi } from "vitest"
import { type IntelObservationConfig, createObservationNetwork, validateObservationConfig } from "#/runtime/intel-observation-network"
import { type ArticleLookup, type ArticleTransport, secureFetchArticle } from "#/services/article-fetch-security"
import { sourcePolicy } from "#/intel/collect"
import { intelSourceSeeds } from "#/intel/sources"

const seed = intelSourceSeeds[0]
const url = new URL(seed.url)
const addresses = [{ address: "93.184.216.34", family: 4 as const }]
const transportOptions = { timeoutMs: 10000, maxBytes: 524288, headers: {} }
const config = (maxHttpRequests = 3): IntelObservationConfig => ({ sourceIds: ["TH-W01"], durationMs: 1000, maxHttpRequests, approvedRedirects: [] })
const response = { status: 200, headers: { "content-type": "application/rss+xml" }, body: "<rss><channel></channel></rss>" }
function fixture(limit = 3, overrides: Partial<IntelObservationConfig> = {}) {
  let now = 0
  const events: Record<string, unknown>[] = []
  const transport = vi.fn<ArticleTransport>(async () => response)
  const lookup = vi.fn<ArticleLookup>(async () => addresses)
  const stopped = vi.fn()
  const guard = createObservationNetwork({ config: { ...config(limit), ...overrides }, fetch: { transport, lookup }, startedAt: 0, now: () => now, record: event => events.push(event), onStop: stopped })
  return { guard, transport, lookup, events, stopped, time: (at: number) => {
    now = at
  } }
}
it.each([-1, 201, 1.5, Number.NaN])("rejects invalid physical budgets %s", limit => expect(() => validateObservationConfig(config(limit))).toThrow("budget_invalid"))
it.each([0, -1, 86400001])("rejects duration outside the proposed window %s", durationMs => expect(() => validateObservationConfig({ ...config(), durationMs })).toThrow("duration_invalid"))
it("zero budget permits no DNS or transport invocation", async () => {
  const f = fixture(0)
  await expect(f.guard.fetch.lookup(url.hostname)).rejects.toThrow("http_budget")
  expect(f.lookup).not.toHaveBeenCalled()
  expect(f.transport).not.toHaveBeenCalled()
})
it("atomically caps concurrent physical dispatches and lets the final reserved response drain", async () => {
  const f = fixture(3)
  const outcomes = await Promise.allSettled(Array.from({ length: 12 }, () => f.guard.fetch.transport(url, addresses, transportOptions)))
  expect(outcomes.filter(row => row.status === "fulfilled")).toHaveLength(3)
  expect(f.transport).toHaveBeenCalledTimes(3)
  expect(f.guard.snapshot()).toMatchObject({ httpRequests: 3, reservations: 3, reason: "http_budget", hardAborted: false })
  expect(f.stopped).toHaveBeenCalledTimes(1)
})
it("enforces the deadline even if the lifecycle timer has not fired", async () => {
  const f = fixture()
  f.time(1000)
  await expect(f.guard.fetch.transport(url, addresses, transportOptions)).rejects.toThrow("deadline")
  expect(f.transport).not.toHaveBeenCalled()
})
it("rechecks the deadline after a delayed DNS result", async () => {
  const f = fixture()
  f.lookup.mockImplementation(async () => {
    f.time(1000)
    return addresses
  })
  const result = await secureFetchArticle(seed.url, { policy: sourcePolicy(seed), ...f.guard.fetch })
  expect(result.ok).toBe(false)
  expect(f.guard.snapshot().reason).toBe("deadline")
  expect(f.transport).not.toHaveBeenCalled()
})
it("passes an abort signal and remaining timeout to the original transport", async () => {
  const f = fixture()
  f.time(900)
  await f.guard.fetch.transport(url, addresses, transportOptions)
  const options = f.transport.mock.calls[0][2]
  expect(options.timeoutMs).toBe(100)
  expect(options.signal?.aborted).toBe(false)
  f.guard.stop("deadline")
  expect(options.signal?.aborted).toBe(true)
})
it("counts approved redirect hops separately without changing secure-fetch validation", async () => {
  const target = new URL("/approved-fixture", url).href
  const f = fixture(3, { approvedRedirects: [{ from: url.href, to: target }] })
  f.transport.mockImplementation(async (current: URL) => current.href === url.href ? { ...response, status: 302, headers: { ...response.headers, location: target } } : response)
  const result = await secureFetchArticle(seed.url, { policy: sourcePolicy(seed), ...f.guard.fetch })
  expect(result.ok && result.hops).toBe(1)
  expect(f.transport).toHaveBeenCalledTimes(2)
  expect(f.guard.snapshot()).toMatchObject({ httpRequests: 2, dnsRequests: 2, redirectResponses: 1 })
})
it("does not let an approved redirect spend beyond the final slot", async () => {
  const target = new URL("/approved-fixture", url).href
  const f = fixture(1, { approvedRedirects: [{ from: url.href, to: target }] })
  f.transport.mockResolvedValue({ ...response, status: 302, headers: { ...response.headers, location: target } })
  expect((await secureFetchArticle(seed.url, { policy: sourcePolicy(seed), ...f.guard.fetch })).ok).toBe(false)
  expect(f.transport).toHaveBeenCalledTimes(1)
  expect(f.lookup).toHaveBeenCalledTimes(1)
})
it.each(["https://unreviewed.example/path", "/same-host-but-unreviewed", "http://www.tmd.go.th/downgrade"])("stops an unreviewed redirect before any target DNS/HTTP: %s", async (location) => {
  const f = fixture()
  f.transport.mockResolvedValue({ ...response, status: 302, headers: { ...response.headers, location } })
  expect((await secureFetchArticle(seed.url, { policy: sourcePolicy(seed), ...f.guard.fetch })).ok).toBe(false)
  expect(f.guard.snapshot().reason).toBe("redirect_unapproved")
  expect(f.transport).toHaveBeenCalledTimes(1)
  expect(f.lookup).toHaveBeenCalledTimes(1)
})
it("rejects scope and private addresses before transport", async () => {
  const f = fixture()
  f.lookup.mockResolvedValue([{ address: "127.0.0.1", family: 4 }])
  expect((await secureFetchArticle(seed.url, { policy: sourcePolicy(seed), ...f.guard.fetch })).ok).toBe(false)
  expect(f.transport).not.toHaveBeenCalled()
  expect(f.guard.snapshot().reason).toBe("unsafe_address")
  const other = fixture()
  await expect(other.guard.fetch.transport(new URL("https://www.tmd.go.th/article-body"), addresses, transportOptions)).rejects.toThrow("url_out_of_scope")
  expect(other.transport).not.toHaveBeenCalled()
})
it("consumes a dispatched failed request without retries", async () => {
  const f = fixture(1)
  f.transport.mockRejectedValue(new Error("original synthetic transport failure"))
  await expect(f.guard.fetch.transport(url, addresses, transportOptions)).rejects.toThrow("synthetic")
  expect(f.guard.snapshot().httpRequests).toBe(1)
  expect(f.transport).toHaveBeenCalledTimes(1)
})
it("fails closed when recording a reservation fails", async () => {
  const transport = vi.fn(async () => response)
  const guard = createObservationNetwork({ config: config(), fetch: { lookup: async () => addresses, transport }, startedAt: 0, now: () => 0, record: () => {
    throw new Error("disk full fixture")
  }, onStop: vi.fn() })
  await expect(guard.fetch.transport(url, addresses, transportOptions)).rejects.toThrow("ledger_failed")
  expect(transport).not.toHaveBeenCalled()
  expect(guard.snapshot().reason).toBe("ledger_failed")
})

it.each([
  { from: url.href, to: "http://www.tmd.go.th/downgrade" },
  { from: url.href, to: "https://other.example/path" },
  { from: url.href, to: "https://user:password@www.tmd.go.th/path" },
  { from: url.href, to: "https://www.tmd.go.th/path?token=synthetic" },
  { from: "https://www.tmd.go.th/not-reachable", to: "https://www.tmd.go.th/path" },
])("rejects a redirect authorization outside the fixed safe scope: %s", (edge) => {
  expect(() => validateObservationConfig({ ...config(), approvedRedirects: [edge] })).toThrow("redirects_invalid")
})

it("stops a reversed clock before another dispatch", async () => {
  const f = fixture()
  f.time(500)
  await f.guard.fetch.transport(url, addresses, transportOptions)
  f.time(499)
  await expect(f.guard.fetch.transport(url, addresses, transportOptions)).rejects.toThrow("clock_reversed")
  expect(f.transport).toHaveBeenCalledTimes(1)
})

it("a deadline still aborts the final reserved request while a budget stop is draining", async () => {
  const f = fixture(1)
  let abortSignal: AbortSignal | undefined
  f.transport.mockImplementation((_url, _addresses, options) => new Promise((_done, reject) => {
    abortSignal = options.signal
    options.signal!.addEventListener("abort", () => reject(new Error("synthetic deadline abort")), { once: true })
  }))
  const request = f.guard.fetch.transport(url, addresses, transportOptions)
  expect(f.guard.snapshot().hardAborted).toBe(false)
  f.time(1000)
  expect(() => f.guard.check()).toThrow()
  await expect(request).rejects.toThrow("deadline abort")
  expect(abortSignal?.aborted).toBe(true)
  expect(f.guard.snapshot()).toMatchObject({ reason: "http_budget", stopReasons: ["http_budget", "deadline"], httpRequests: 1, hardAborted: true })
})
