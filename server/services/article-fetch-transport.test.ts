import { Buffer } from "node:buffer"
import { EventEmitter } from "node:events"
import { PassThrough } from "node:stream"
import NativeDatabase from "better-sqlite3"
import { createDatabase } from "db0"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { IntelRepository } from "#/database/intel"
import { initShippingTables } from "#/database/shipping"
import { collectIntelSource } from "#/intel/collect"
import { intelSourceSeeds } from "#/intel/sources"
import { extractArticle } from "#/providers/article-extractor"

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
  respond: (status: number, headers: Record<string, string>, chunks: Array<string | Buffer>) => PassThrough
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
      for (const chunk of chunks) response.write(typeof chunk === "string" ? Buffer.from(chunk, "utf8") : chunk)
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

const { secureFetchArticle, defaultTransport } = await import("./article-fetch-security")
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

// Synthetic, independently specified legacy bytes (not UTF-8 strings with a legacy header).
// windows-1258 represents the hook-above as a combining character: no normalization is imposed.
const ENCODED = [
  { label: "gbk", hex: "b8dbbfdacda8d6aa", title: "港口通知", canonical: "gbk" },
  { label: "tis-620", hex: "a1d2c3", title: "การ", canonical: "windows-874" },
  { label: "windows-1258", hex: "4361d26e67", title: "Ca\u0309ng", canonical: "windows-1258" },
]
const WHEN = "2026-08-14T00:00:00.000Z"
function encodedRss(label: string, hex: string, host: string) {
  const word = Buffer.from(hex, "hex")
  return Buffer.concat([
    Buffer.from(`<?xml version="1.0" encoding="${label}"?><rss><channel><item><title>`),
    word,
    Buffer.from(`</title><description>`),
    word,
    Buffer.from(`</description><link>https://${host}/story/encoded</link><pubDate>${WHEN}</pubDate><updated>2026-08-14T01:00:00.000Z</updated></item></channel></rss>`),
  ])
}

async function memoryIntel() {
  const native = new NativeDatabase(":memory:")
  const database = createDatabase({
    name: "sqlite",
    dialect: "sqlite",
    getInstance: () => native,
    exec: (sql: string) => native.exec(sql),
    prepare: (sql: string) => {
      const statement = native.prepare(sql)
      return {
        all: async (...params: any[]) => statement.all(...params),
        get: async (...params: any[]) => statement.get(...params),
        run: async (...params: any[]) => {
          const result = statement.run(...params)
          return { success: result.changes > 0, changes: result.changes, lastInsertRowid: result.lastInsertRowid }
        },
      }
    },
    dispose: () => native.close(),
  } as never)
  await initShippingTables(database, "mock")
  return { native, repository: new IntelRepository(database) }
}

describe("raw legacy bytes through the Node transport", () => {
  it.each(ENCODED)("decodes $label for Feed and intel persistence with existing timestamps", async ({ label, hex, title, canonical }) => {
    const bytes = encodedRss(label, hex, "theloadstar.com")
    // Split every byte, including multibyte characters. No network sockets are opened.
    onEnd = call => call.respond(200, { "content-type": `application/rss+xml; charset=${label}` }, [...bytes].map(byte => Buffer.from([byte])))
    const fetched = await secureFetchArticle(rssSource.url, { policy: feedListFetchPolicy(rssSource), lookup })
    expect(fetched).toMatchObject({ ok: true, rawBody: bytes, decoding: { encoding: canonical, selectedBy: "http", conflict: false, byteLength: bytes.length } })
    const provider = createPublicFeedProvider({ sources: [rssSource], fetch: { lookup }, now: () => new Date("2026-08-14T06:00:00.000Z") })
    const items = await provider.getFeedItems([], [])
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ title, summary: title, sourceUrl: "https://theloadstar.com/story/encoded", publishedAt: WHEN, sourceUpdatedAt: "2026-08-14T01:00:00.000Z" })

    const { native, repository } = await memoryIntel()
    try {
      const seed = intelSourceSeeds.find(entry => entry.catalogId === "TH-W01")!
      await repository.upsertSource(seed, WHEN)
      const intelBytes = encodedRss(label, hex, new URL(seed.url).hostname)
      // XML declaration selects the encoding when HTTP supplies none.
      onEnd = call => call.respond(200, { "content-type": "application/rss+xml" }, [intelBytes])
      const result = await collectIntelSource(repository, seed, { lookup, transport: defaultTransport }, new Date(WHEN))
      expect(result).toMatchObject({ status: "ok_items", itemsNew: 1 })
      const persisted = await repository.listItems(seed.id)
      expect(persisted).toHaveLength(1)
      expect(persisted[0]).toMatchObject({ title, canonicalUrl: `https://${new URL(seed.url).hostname}/story/encoded`, publishedAt: WHEN })
      expect(native.prepare("SELECT source_updated_at FROM intel_item_version WHERE id = ?").get(persisted[0].currentVersionId)).toEqual({ source_updated_at: "2026-08-14T01:00:00.000Z" })
      expect((await repository.readVersionBlocks(persisted[0].currentVersionId!)).some(block => block.text === title)).toBe(true)
      for (const [contentType, badBytes, errorCode] of [
        ["application/rss+xml; charset=unknown", Buffer.from("bad"), "encoding_unsupported"],
        ["application/rss+xml; charset=utf-8", Buffer.from([0xC3, 0x28]), "encoding_invalid"],
      ] as const) {
        onEnd = call => call.respond(200, { "content-type": contentType }, [badBytes])
        expect(await collectIntelSource(repository, seed, { lookup, transport: defaultTransport }, new Date("2026-08-14T02:00:00Z"))).toMatchObject({ status: "failed", errorCode })
        expect(await repository.listItems(seed.id)).toEqual(persisted)
        const retained = await provider.getFeedItems(items, [])
        expect(retained[0]).toMatchObject({ title, sourceUrl: items[0].sourceUrl, publishedAt: WHEN, sourceStatus: "failed", stale: true })
      }
    } finally {
      native.close()
    }
  })

  it("enforces the raw byte cap before decoding, including injected transports", async () => {
    const bytes = Buffer.from([0x81, 0x81, 0x81])
    onEnd = call => call.respond(200, { "content-type": "application/rss+xml; charset=unknown" }, [bytes])
    for (const transport of [undefined, async () => ({ status: 200, headers: { "content-type": "application/rss+xml; charset=unknown" }, body: bytes })]) {
      expect(await secureFetchArticle(rssSource.url, { policy: feedListFetchPolicy(rssSource), lookup, transport, maxBytes: 2 })).toMatchObject({ ok: false, code: "body_too_large" })
    }
  })

  it("keeps the existing HTML Feed path and article UTF-8 extraction working", async () => {
    const htmlSource = shippingFeedSources.find(source => source.id === "shekou-official")!
    const title = "港口通知".repeat(4)
    const htmlBytes = Buffer.concat([
      Buffer.from("<html><head><meta charset=\"gbk\"></head><body><article><a href=\"/ywgg/encoded\">"),
      Buffer.from("b8dbbfdacda8d6aa".repeat(4), "hex"),
      Buffer.from(`</a><time datetime="${WHEN}"></time></article></body></html>`),
    ])
    onEnd = call => call.respond(200, { "content-type": "text/html" }, [htmlBytes])
    const provider = createPublicFeedProvider({ sources: [htmlSource], fetch: { lookup }, now: () => new Date("2026-08-14T06:00:00Z") })
    expect((await provider.getFeedItems([], []))[0]).toMatchObject({ title, publishedAt: WHEN })
    const html = `<html><body><article><h1>港口 UTF-8 Ca\u0309ng</h1><p>${"文章内容。".repeat(40)}</p><p>${"第二段内容。".repeat(40)}</p></article></body></html>`
    onEnd = call => call.respond(200, { "content-type": "text/html; charset=utf-8" }, [Buffer.from(html)])
    const policy = { ...feedListFetchPolicy(htmlSource), persistence: "full" as const, selectors: { container: "article", title: "h1" }, completeness: { minParagraphs: 2, minCharacters: 120 } }
    const fetched = await secureFetchArticle(htmlSource.url, { policy, lookup })
    expect(fetched.ok).toBe(true)
    if (!fetched.ok) throw new Error(fetched.code)
    expect(fetched.body).toBe(html)
    expect(extractArticle(fetched.body, fetched.finalUrl, policy)).toMatchObject({ status: "complete", title: "港口 UTF-8 Ca\u0309ng" })
  })
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
