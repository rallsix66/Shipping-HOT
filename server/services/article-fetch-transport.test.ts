import { Buffer } from "node:buffer"
import { EventEmitter } from "node:events"
import { PassThrough } from "node:stream"
import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * Offline regression through the real defaultTransport: node:http/node:https
 * request() is mocked at the Node boundary (ArticleTransport is NOT replaced),
 * so no socket is ever opened.
 */
interface FakeRequest extends EventEmitter {
  end: ReturnType<typeof vi.fn>
  destroy: ReturnType<typeof vi.fn>
}
interface Call {
  url: URL
  options: Record<string, any>
  request: FakeRequest
  respond: (status: number, headers: Record<string, string>, chunks: string[]) => PassThrough
}
const calls: Call[] = []
let onEnd: (call: Call) => void = () => {}

function fakeRequest(url: URL, options: Record<string, any>, callback: (response: PassThrough) => void): FakeRequest {
  const request = new EventEmitter() as FakeRequest
  request.destroy = vi.fn()
  const call: Call = {
    url,
    options,
    request,
    respond: (status, headers, chunks) => {
      const response = Object.assign(new PassThrough(), { statusCode: status, headers })
      callback(response)
      for (const chunk of chunks) response.write(Buffer.from(chunk, "utf8"))
      response.end()
      return response
    },
  }
  request.end = vi.fn(() => queueMicrotask(() => onEnd(call)))
  calls.push(call)
  return request
}
vi.mock("node:https", () => ({ request: vi.fn((url: URL, options: Record<string, any>, callback: any) => fakeRequest(url, options, callback)) }))
vi.mock("node:http", () => ({ request: vi.fn((url: URL, options: Record<string, any>, callback: any) => fakeRequest(url, options, callback)) }))

const { secureFetchArticle } = await import("./article-fetch-security")
const { createPublicFeedProvider, feedListFetchPolicy, shippingFeedSources } = await import("#/providers/feed")

const rssSource = shippingFeedSources.find(source => source.id === "the-loadstar")!
const PUBLIC = [{ address: "93.184.216.34", family: 4 as const }, { address: "2606:2800:220:1:248:1893:25c8:1946", family: 6 as const }]
const lookup = vi.fn(async () => PUBLIC)
const RSS = "<rss><channel><item><title>Loadstar update</title><link>https://theloadstar.com/story/1</link><pubDate>Fri, 14 Aug 2026 00:00:00 GMT</pubDate></item></channel></rss>"

beforeEach(() => {
  calls.length = 0
  lookup.mockClear()
  onEnd = () => {}
})

describe("defaultTransport at the Node request boundary", () => {
  it("ends the GET request, reads the response and the Feed is parsed", async () => {
    onEnd = call => call.respond(200, { "content-type": "application/rss+xml; charset=utf-8" }, [RSS.slice(0, 40), RSS.slice(40)])
    const provider = createPublicFeedProvider({ sources: [rssSource], fetch: { lookup }, now: () => new Date("2026-08-14T06:00:00.000Z") })
    const items = await provider.getFeedItems([], [])
    expect(calls).toHaveLength(1)
    const [call] = calls
    expect(call.request.end).toHaveBeenCalledTimes(1)
    expect(call.options.method).toBe("GET")
    expect(call.url.toString()).toBe(rssSource.url)
    expect(call.options.headers.accept).toContain("application/rss+xml")
    expect(call.options.signal).toBeInstanceOf(AbortSignal)
    // address pinning: the socket lookup only ever returns the validated addresses
    const pinned = await new Promise(resolve => call.options.lookup("attacker.example", { all: true }, (_error: unknown, list: unknown) => resolve(list)))
    expect(pinned).toEqual(PUBLIC.map(address => ({ address: address.address, family: address.family })))
    expect(items.map(item => item.title)).toContain("Loadstar update")
  })

  it("maps a socket timeout to fetch_timeout and destroys the request", async () => {
    onEnd = call => call.request.emit("timeout")
    const result = await secureFetchArticle(rssSource.url, { policy: feedListFetchPolicy(rssSource), lookup, timeoutMs: 50 })
    expect(result).toMatchObject({ ok: false, code: "fetch_timeout" })
    expect(calls[0].options.timeout).toBe(50)
    expect(calls[0].request.end).toHaveBeenCalledTimes(1)
    expect(calls[0].request.destroy).toHaveBeenCalled()
  })

  it("maps a request error to fetch_failed, destroys the request once and ignores late events", async () => {
    onEnd = (call) => {
      call.request.emit("error", new Error("ECONNRESET"))
      call.request.emit("timeout")
    }
    const result = await secureFetchArticle(rssSource.url, { policy: feedListFetchPolicy(rssSource), lookup })
    expect(result).toMatchObject({ ok: false, code: "fetch_failed", message: "ECONNRESET" })
    expect(calls[0].request.destroy).toHaveBeenCalledTimes(1)
  })

  it("stops an oversized body, destroying response and request", async () => {
    let response: PassThrough | undefined
    onEnd = (call) => {
      response = call.respond(200, { "content-type": "application/rss+xml" }, ["x".repeat(40), "y".repeat(40)])
    }
    const result = await secureFetchArticle(rssSource.url, { policy: feedListFetchPolicy(rssSource), lookup, maxBytes: 50 })
    expect(result).toMatchObject({ ok: false, code: "body_too_large" })
    expect(response?.destroyed).toBe(true)
    expect(calls[0].request.destroy).toHaveBeenCalled()
  })

  it("never reaches the Node request for a private address", async () => {
    const result = await secureFetchArticle(rssSource.url, { policy: feedListFetchPolicy(rssSource), lookup: async () => [{ address: "10.0.0.5", family: 4 as const }] })
    expect(result).toMatchObject({ ok: false, code: "blocked_address" })
    expect(calls).toHaveLength(0)
  })
})
