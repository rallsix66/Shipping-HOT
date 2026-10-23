import { describe, expect, it } from "vitest"
import {
  DeepSeekToolsClientError,
  DeepSeekToolsOutcomeUnknownError,
  type InjectedFetcher,
  assertPublicHttpUrl,
  deepSeekFetch,
  deepSeekSearch,
  normalizeHostname,
  staticReadText,
} from "./search-fetch-client"
import { ProviderRejectedError } from "#/intel/llm/receipts"

function ok(body: unknown): Awaited<ReturnType<InjectedFetcher>> {
  const text = typeof body === "string" ? body : JSON.stringify(body)
  return {
    status: 200,
    ok: true,
    readText: staticReadText(text),
    headers: { get: () => null },
  }
}

function err(status: number, body: string): Awaited<ReturnType<InjectedFetcher>> {
  return {
    status,
    ok: false,
    readText: staticReadText(body),
    headers: { get: () => null },
  }
}

describe("normalizeHostname / assertPublicHttpUrl", () => {
  it("strips brackets and trailing dots", () => {
    expect(normalizeHostname("[::1]")).toBe("::1")
    expect(normalizeHostname("localhost.")).toBe("localhost")
    expect(normalizeHostname("Example.COM.")).toBe("example.com")
  })

  it("rejects private IPv4, docs ranges, localhost., bracketed IPv6, mapped", () => {
    const blocked = [
      "http://192.168.1.1/",
      "http://127.0.0.1/",
      "http://10.0.0.1/",
      "http://172.16.5.1/",
      "http://169.254.1.1/",
      "http://100.64.0.1/",
      "http://192.0.2.1/",
      "http://198.51.100.1/",
      "http://203.0.113.1/",
      "http://0.0.0.0/",
      "http://localhost/",
      "http://localhost./",
      "http://foo.localhost/",
      "http://[::1]/",
      "http://[fe80::1]/",
      "http://[fc00::1]/",
      "http://[fd12::1]/",
      "http://[::ffff:127.0.0.1]/",
      "http://[2001:db8::1]/",
      "https://user:pass@example.com/",
      "ftp://example.com/",
    ]
    for (const url of blocked) {
      expect(() => assertPublicHttpUrl(url), url).toThrow(DeepSeekToolsClientError)
    }
    expect(assertPublicHttpUrl("https://example.com/a").toString()).toBe("https://example.com/a")
  })
})

describe("deepSeekSearch / deepSeekFetch client", () => {
  it("maps 401 to ProviderRejectedError with fixed code and no body/secret echo", async () => {
    const bodies: string[] = []
    const poison = "error: Bearer sk-LEAKEDKEY999 unauthorized SECRET_BODY"
    const fetcher: InjectedFetcher = async (_url, init) => {
      bodies.push(init?.body ?? "")
      return err(401, poison)
    }
    let rejected: unknown
    try {
      await deepSeekSearch({ query: "q" }, { apiKey: "k", fetcher })
    } catch (error) {
      rejected = error
    }
    expect(rejected).toBeInstanceOf(ProviderRejectedError)
    expect((rejected as ProviderRejectedError).message).toBe("deepseek_tools_http_401")
    expect(String((rejected as ProviderRejectedError).message)).not.toMatch(/Bearer|sk-LEAKED|SECRET_BODY/)
    expect(bodies[0]).not.toMatch(/localization/)
    expect(JSON.parse(bodies[0]!)).toMatchObject({ need_content: false, count: 10 })
  })

  it("returns empty content for HTTP 200 clear empty body", async () => {
    const fetcher: InjectedFetcher = async () => ok({ title: "", content: "" })
    const result = await deepSeekFetch({ url: "https://example.com/e" }, { apiKey: "k", fetcher })
    expect(result.content).toBe("")
  })

  it("invalid JSON and wrong schema become OutcomeUnknown (not free reject)", async () => {
    const badJson: InjectedFetcher = async () => ok("not-json{")
    await expect(deepSeekSearch({ query: "q" }, { apiKey: "k", fetcher: badJson }))
      .rejects
      .toBeInstanceOf(DeepSeekToolsOutcomeUnknownError)

    const badSchema: InjectedFetcher = async () => ok({ nope: true })
    await expect(deepSeekSearch({ query: "q" }, { apiKey: "k", fetcher: badSchema }))
      .rejects
      .toMatchObject({ code: "invalid_schema" })

    const badFetch: InjectedFetcher = async () => ok({ title: 1, content: 2 })
    await expect(deepSeekFetch({ url: "https://example.com/x" }, { apiKey: "k", fetcher: badFetch }))
      .rejects
      .toMatchObject({ code: "invalid_schema" })
  })

  it("enforces response byte cap", async () => {
    const big = "x".repeat(100)
    const fetcher: InjectedFetcher = async () => ok(big)
    await expect(deepSeekSearch({ query: "q" }, { apiKey: "k", fetcher, maxBytes: 50 }))
      .rejects
      .toMatchObject({ code: "response_too_large" })
  })

  it("honours abort signal", async () => {
    const ac = new AbortController()
    const fetcher: InjectedFetcher = async (_url, init) => {
      await new Promise<void>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true })
      })
      return ok({ results: [] })
    }
    const pending = deepSeekSearch({ query: "q" }, { apiKey: "k", fetcher, signal: ac.signal })
    ac.abort()
    await expect(pending).rejects.toMatchObject({ code: "request_aborted" })
  })
})

describe("transport error mapping", () => {
  it("maps non-abort transport errors to request_failed without leaking message text", async () => {
    const poison = "ECONNRESET https://evil.example Bearer sk-LEAKED_KEY_999"
    const fetcher: InjectedFetcher = async () => {
      throw new Error(poison)
    }
    await expect(deepSeekSearch({ query: "x" }, { apiKey: "k", fetcher }))
      .rejects
      .toMatchObject({ name: "DeepSeekToolsOutcomeUnknownError", code: "request_failed", message: "request_failed" })
  })
})
