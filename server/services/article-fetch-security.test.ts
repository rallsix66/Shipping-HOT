import { describe, expect, it } from "vitest"
import type { ArticleSourcePolicy } from "@shared/article"
import { type ArticleTransport, type ResolvedAddress, isBlockedAddress, secureFetchArticle } from "./article-fetch-security"
import { resolveArticleSourcePolicy } from "./source-policy"

function policy(overrides: Partial<ArticleSourcePolicy> = {}): ArticleSourcePolicy {
  return {
    sourceId: "test-source",
    status: "allowed",
    fetchAllowed: true,
    persistence: "full",
    allowedHosts: ["news.example.com"],
    allowedContentTypes: ["text/html"],
    ...overrides,
  }
}

const publicLookup = async (): Promise<ResolvedAddress[]> => [{ address: "93.184.216.34", family: 4 }]

function transportReturning(overrides: Partial<{ status: number, headers: Record<string, string>, body: string }> = {}): ArticleTransport {
  return async () => ({ status: overrides.status ?? 200, headers: overrides.headers ?? { "content-type": "text/html" }, body: overrides.body ?? "<html>ok</html>" })
}

describe("article source policy resolver", () => {
  it("fails closed for unconfigured sources and marks The Loadstar as disallowed", () => {
    expect(resolveArticleSourcePolicy("the-loadstar")).toMatchObject({ status: "disallowed", fetchAllowed: false, persistence: "disallowed" })
    expect(resolveArticleSourcePolicy("shekou-official")).toMatchObject({ status: "allowed", fetchAllowed: true, persistence: "full" })
    expect(resolveArticleSourcePolicy("does-not-exist")).toMatchObject({ status: "unconfigured", fetchAllowed: false })
  })
})

describe("isBlockedAddress", () => {
  it("blocks loopback, private, link-local, metadata, multicast and mapped addresses", () => {
    for (const address of [
      { address: "127.0.0.1", family: 4 as const },
      { address: "10.0.0.5", family: 4 as const },
      { address: "192.168.1.1", family: 4 as const },
      { address: "172.16.4.4", family: 4 as const },
      { address: "169.254.169.254", family: 4 as const },
      { address: "224.0.0.1", family: 4 as const },
      { address: "::1", family: 6 as const },
      { address: "fe80::1", family: 6 as const },
      { address: "fc00::1", family: 6 as const },
      { address: "ff02::1", family: 6 as const },
      { address: "::ffff:127.0.0.1", family: 6 as const },
    ]) {
      expect(isBlockedAddress(address), address.address).toBe(true)
    }
    expect(isBlockedAddress({ address: "93.184.216.34", family: 4 })).toBe(false)
    expect(isBlockedAddress({ address: "2606:2800:220:1:248:1893:25c8:1946", family: 6 })).toBe(false)
  })
})

describe("secureFetchArticle", () => {
  it("fetches a normal public path, binding to the validated address", async () => {
    const result = await secureFetchArticle("https://news.example.com/article/1", {
      policy: policy(),
      lookup: publicLookup,
      transport: transportReturning(),
    })
    expect(result).toMatchObject({ ok: true, status: 200, finalUrl: "https://news.example.com/article/1" })
  })

  it("rejects credentials, non-allowlisted hosts and plain HTTP without allowHttp", async () => {
    await expect(secureFetchArticle("https://user:pass@news.example.com/a", { policy: policy(), lookup: publicLookup, transport: transportReturning() })).resolves.toMatchObject({ ok: false, code: "credentials_not_allowed" })
    await expect(secureFetchArticle("https://evil.example.net/a", { policy: policy(), lookup: publicLookup, transport: transportReturning() })).resolves.toMatchObject({ ok: false, code: "host_not_allowed" })
    await expect(secureFetchArticle("http://news.example.com/a", { policy: policy(), lookup: publicLookup, transport: transportReturning() })).resolves.toMatchObject({ ok: false, code: "http_not_allowed" })
  })

  it("rejects DNS results that include any private or special address", async () => {
    const mixed = async (): Promise<ResolvedAddress[]> => [{ address: "93.184.216.34", family: 4 }, { address: "10.0.0.2", family: 4 }]
    await expect(secureFetchArticle("https://news.example.com/a", { policy: policy(), lookup: mixed, transport: transportReturning() })).resolves.toMatchObject({ ok: false, code: "blocked_address" })
  })

  it("re-checks every redirect hop and rejects HTTPS to HTTP downgrade or redirect loops", async () => {
    const redirectTo = (location: string): ArticleTransport => async () => ({ status: 302, headers: { location }, body: "" })
    const redirectOnceTo = (location: string): ArticleTransport => async url => url.hostname === "news.example.com"
      ? { status: 302, headers: { location }, body: "" }
      : { status: 200, headers: { "content-type": "text/html" }, body: "ok" }
    await expect(secureFetchArticle("https://news.example.com/a", {
      policy: policy({ allowedHosts: ["news.example.com", "other.example.com"] }),
      lookup: publicLookup,
      transport: redirectOnceTo("https://other.example.com/b"),
      maxRedirects: 1,
    })).resolves.toMatchObject({ ok: true, finalUrl: "https://other.example.com/b", hops: 1 })

    await expect(secureFetchArticle("https://news.example.com/a", {
      policy: policy({ allowedHosts: ["news.example.com", "private.example.com"] }),
      lookup: async hostname => hostname === "private.example.com" ? [{ address: "10.0.0.9", family: 4 }] : [{ address: "93.184.216.34", family: 4 }],
      transport: redirectTo("https://private.example.com/x"),
      maxRedirects: 2,
    })).resolves.toMatchObject({ ok: false, code: "blocked_address" })

    await expect(secureFetchArticle("https://news.example.com/a", {
      policy: policy({ allowHttp: true }),
      lookup: publicLookup,
      transport: redirectTo("http://news.example.com/a"),
      maxRedirects: 2,
    })).resolves.toMatchObject({ ok: false, code: "https_downgrade" })

    await expect(secureFetchArticle("https://news.example.com/a", {
      policy: policy(),
      lookup: publicLookup,
      transport: redirectTo("https://news.example.com/a"),
      maxRedirects: 2,
    })).resolves.toMatchObject({ ok: false, code: "redirect_limit" })
  })

  it("surfaces oversized body and timeout transport failures", async () => {
    await expect(secureFetchArticle("https://news.example.com/a", {
      policy: policy(),
      lookup: publicLookup,
      transport: async () => {
        throw new Error("body_too_large")
      },
    })).resolves.toMatchObject({ ok: false, code: "body_too_large" })
    await expect(secureFetchArticle("https://news.example.com/a", {
      policy: policy(),
      lookup: publicLookup,
      transport: async () => {
        throw new Error("fetch_timeout")
      },
    })).resolves.toMatchObject({ ok: false, code: "fetch_timeout" })
  })
})
