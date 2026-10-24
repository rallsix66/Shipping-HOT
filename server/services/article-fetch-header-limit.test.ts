import { createServer, maxHeaderSize as nodeDefaultHeaderSize } from "node:http"
import type { AddressInfo } from "node:net"
import { describe, expect, it, vi } from "vitest"
import type { ArticleSourcePolicy } from "@shared/article"
import { type ArticleTransport, type SourceHeaderLimitConfig, defaultTransport, secureFetchArticle } from "./article-fetch-security"

const URL = "https://www.maersk.com/news"
const PUBLIC = [{ address: "93.184.216.34", family: 4 as const }]
const headerLimit = (): SourceHeaderLimitConfig => ({ sourceId: "intel:xx-k01", url: URL, maxHeaderSize: 32768 })
const policy = (patch: Partial<ArticleSourcePolicy> = {}): ArticleSourcePolicy => ({ sourceId: "intel:xx-k01", status: "allowed", fetchAllowed: true, persistence: "disallowed", allowedHosts: ["www.maersk.com"], allowedContentTypes: ["text/html"], ...patch })
const response = { status: 200, headers: { "content-type": "text/html" }, body: "synthetic" }

/**
 * Only this test adapter maps the injected source transport to a loopback HTTP fixture.
 * secureFetchArticle validates the source first; the real defaultTransport and Node parser
 * consume the resulting options. No external DNS/socket, TLS bypass or policy change is used.
 * Actual TLS option preservation is covered by article-fetch-transport.test.ts.
 */
async function withNativeHeaders<T>(bytes: number, run: (transport: ArticleTransport, observed: { headerLimit?: number, errorCode?: string }) => Promise<T>, spec: { body?: string, stall?: boolean, onRequest?: () => void } = {}): Promise<T> {
  const server = createServer((_req, res) => {
    spec.onRequest?.()
    if (spec.stall) return
    res.writeHead(200, { "content-type": "text/html", "x-synthetic-header": "x".repeat(bytes) })
    res.end(spec.body ?? "<html>synthetic</html>")
  })
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject)
      resolve()
    })
  })
  const local = new globalThis.URL(`http://127.0.0.1:${(server.address() as AddressInfo).port}/synthetic`)
  const observed: { headerLimit?: number, errorCode?: string } = {}
  const transport: ArticleTransport = async (_url, _addresses, options) => {
    observed.headerLimit = options.maxHeaderSize
    try {
      return await defaultTransport(local, [{ address: "127.0.0.1", family: 4 }], options)
    } catch (error) {
      // Never serialize the Error or rawPacket, even though the fixture is synthetic.
      observed.errorCode = (error as NodeJS.ErrnoException).code
      throw error
    }
  }
  try {
    return await run(transport, observed)
  } finally {
    server.closeAllConnections()
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
  }
}

describe("source-bound response-header budget with actual Node parsing", () => {
  it("keeps the installed Node default at 16 KiB and rejects a 20 KiB header without opt-in", async () => {
    expect(nodeDefaultHeaderSize).toBe(16384)
    await withNativeHeaders(20 * 1024, async (transport, observed) => {
      expect(await secureFetchArticle(URL, { policy: policy(), lookup: async () => PUBLIC, transport })).toMatchObject({ ok: false, code: "fetch_failed" })
      expect(observed.headerLimit).toBeUndefined()
      expect(observed.errorCode).toBe("HPE_HEADER_OVERFLOW")
    })
  })
  it("accepts the same synthetic 20 KiB header only with the exact 32 KiB opt-in", async () => {
    await withNativeHeaders(20 * 1024, async (transport, observed) => {
      const result = await secureFetchArticle(URL, { policy: policy(), sourceHeaderLimit: headerLimit(), lookup: async () => PUBLIC, transport, timeoutMs: 10000, maxBytes: 524288, maxRedirects: 0 })
      expect(result).toMatchObject({ ok: true, status: 200, body: "<html>synthetic</html>", hops: 0 })
      expect(observed.headerLimit).toBe(32768)
      expect(observed.errorCode).toBeUndefined()
    })
  })
  it("still rejects an actual synthetic 40 KiB header with opt-in", async () => {
    await withNativeHeaders(40 * 1024, async (transport, observed) => {
      expect(await secureFetchArticle(URL, { policy: policy(), sourceHeaderLimit: headerLimit(), lookup: async () => PUBLIC, transport })).toMatchObject({ ok: false, code: "fetch_failed" })
      expect(observed.headerLimit).toBe(32768)
      expect(observed.errorCode).toBe("HPE_HEADER_OVERFLOW")
    })
  })
  it("leaves another source on the actual default parser limit", async () => {
    await withNativeHeaders(20 * 1024, async (transport, observed) => {
      expect(await secureFetchArticle("https://other.example.com/news", { policy: policy({ sourceId: "other", allowedHosts: ["other.example.com"] }), lookup: async () => PUBLIC, transport })).toMatchObject({ ok: false, code: "fetch_failed" })
      expect(observed.headerLimit).toBeUndefined()
      expect(observed.errorCode).toBe("HPE_HEADER_OVERFLOW")
    })
  })
  it("retains the real 512 KiB response-body ceiling", async () => {
    await withNativeHeaders(20 * 1024, async (transport) => {
      expect(await secureFetchArticle(URL, { policy: policy(), sourceHeaderLimit: headerLimit(), lookup: async () => PUBLIC, transport, maxBytes: 524288 })).toMatchObject({ ok: false, code: "body_too_large" })
    }, { body: "x".repeat(524289) })
  })
  it("retains the real transport timeout", async () => {
    await withNativeHeaders(0, async (transport) => {
      expect(await secureFetchArticle(URL, { policy: policy(), sourceHeaderLimit: headerLimit(), lookup: async () => PUBLIC, transport, timeoutMs: 100 })).toMatchObject({ ok: false, code: "fetch_timeout" })
    }, { stall: true })
  })
  it("propagates cancellation to the real Node request", async () => {
    const controller = new AbortController()
    await withNativeHeaders(0, async (transport, observed) => {
      const result = await secureFetchArticle(URL, { policy: policy(), sourceHeaderLimit: headerLimit(), lookup: async () => PUBLIC, transport, signal: controller.signal })
      expect(result.ok).toBe(false)
      expect(observed.errorCode).toBe("ABORT_ERR")
    }, { stall: true, onRequest: () => controller.abort() })
  })
})

describe("source-header configuration and safety boundaries", () => {
  async function refusedBeforeDNS(config: unknown, target = URL, sourcePolicy = policy()) {
    const lookup = vi.fn(async () => PUBLIC)
    const transport = vi.fn(async () => response)
    expect(await secureFetchArticle(target, { policy: sourcePolicy, sourceHeaderLimit: config as SourceHeaderLimitConfig, lookup, transport })).toMatchObject({ ok: false, code: "source_header_limit_invalid" })
    expect(lookup).not.toHaveBeenCalled()
    expect(transport).not.toHaveBeenCalled()
  }
  it.each([0, -1, 1.5, 16384, 32767, 32769, 65536, Infinity, Number.NaN, "32768", null, undefined])("rejects unapproved header size %s before DNS", async (value) => {
    await refusedBeforeDNS({ ...headerLimit(), maxHeaderSize: value })
  })
  it.each([null, [], {}, { ...headerLimit(), extra: true }])("rejects malformed configuration %j before DNS", async (value) => {
    await refusedBeforeDNS(value)
  })
  it("rejects both a wrong declared source and a wrong policy source before DNS", async () => {
    await refusedBeforeDNS({ ...headerLimit(), sourceId: "other" })
    await refusedBeforeDNS(headerLimit(), URL, policy({ sourceId: "other" }))
  })
  it.each(["https://www.maersk.com/news/", "https://www.maersk.com/news?x=1", "https://www.maersk.com/news#x", "https://www.maersk.com:443/news", "http://www.maersk.com/news", "https://other.example.com/news"])("rejects unapproved initial URL %s before DNS", async (target) => {
    await refusedBeforeDNS(headerLimit(), target)
    await refusedBeforeDNS({ ...headerLimit(), url: target })
  })
  it.each(["https://www.maersk.com/other", "https://other.example.com/news"])("refuses a different redirect target before its DNS %s", async (location) => {
    const lookup = vi.fn(async () => PUBLIC)
    const transport = vi.fn(async () => ({ status: 302, headers: { location }, body: "" }))
    expect(await secureFetchArticle(URL, { policy: policy({ allowedHosts: ["www.maersk.com", "other.example.com"] }), sourceHeaderLimit: headerLimit(), lookup, transport })).toMatchObject({ ok: false, code: "source_header_limit_invalid" })
    expect(lookup).toHaveBeenCalledTimes(1)
    expect(transport).toHaveBeenCalledTimes(1)
  })
  it("keeps an explicitly zero redirect budget", async () => {
    const lookup = vi.fn(async () => PUBLIC)
    const transport = vi.fn(async () => ({ status: 302, headers: { location: "https://www.maersk.com/other" }, body: "" }))
    expect(await secureFetchArticle(URL, { policy: policy(), sourceHeaderLimit: headerLimit(), lookup, transport, maxRedirects: 0 })).toMatchObject({ ok: false, code: "redirect_limit" })
    expect(lookup).toHaveBeenCalledTimes(1)
    expect(transport).toHaveBeenCalledTimes(1)
  })
  it("snapshots the opt-in before awaiting DNS and retains pinning and request limits", async () => {
    const mutable = headerLimit()
    const transport = vi.fn(async () => response)
    await secureFetchArticle(URL, { policy: policy(), sourceHeaderLimit: mutable, transport, lookup: async () => {
      mutable.url = "https://other.example.com/news"
      mutable.maxHeaderSize = 65536
      return PUBLIC
    }, maxRedirects: 0 })
    expect(transport).toHaveBeenCalledWith(new globalThis.URL(URL), PUBLIC, expect.objectContaining({ maxHeaderSize: 32768, maxBytes: 524288, timeoutMs: 10000, headers: { "user-agent": "shipping-hot-article/1.0", "accept": "text/html,application/xhtml+xml", "accept-encoding": "identity" } }))
  })
  it("still rejects any blocked address in a mixed DNS answer before transport", async () => {
    const transport = vi.fn(async () => response)
    expect(await secureFetchArticle(URL, { policy: policy(), sourceHeaderLimit: headerLimit(), lookup: async () => [...PUBLIC, { address: "127.0.0.1", family: 4 }], transport })).toMatchObject({ ok: false, code: "blocked_address" })
    expect(transport).not.toHaveBeenCalled()
  })
  it("retains content type validation", async () => {
    expect(await secureFetchArticle(URL, { policy: policy(), sourceHeaderLimit: headerLimit(), lookup: async () => PUBLIC, transport: async () => ({ ...response, headers: { "content-type": "application/pdf" } }) })).toMatchObject({ ok: false, code: "content_type_unsupported" })
  })
  it("rejects pre-aborted requests before DNS", async () => {
    const controller = new AbortController()
    controller.abort()
    const lookup = vi.fn(async () => PUBLIC)
    expect(await secureFetchArticle(URL, { policy: policy(), sourceHeaderLimit: headerLimit(), lookup, signal: controller.signal })).toMatchObject({ ok: false, code: "fetch_timeout" })
    expect(lookup).not.toHaveBeenCalled()
  })
  it("also bounds direct transport input before any socket", async () => {
    await expect(defaultTransport(new globalThis.URL(URL), PUBLIC, { timeoutMs: 10000, maxBytes: 524288, headers: {}, maxHeaderSize: 65536 as never })).rejects.toThrow("source_header_limit_invalid")
  })
})
