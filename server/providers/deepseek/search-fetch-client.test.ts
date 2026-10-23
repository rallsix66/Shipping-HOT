import { describe, expect, it } from "vitest"
import {
  DEEPSEEK_SEARCH_PATH,
  DEEPSEEK_TOOLS_BASE,
  DeepSeekToolsClientError,
  DeepSeekToolsOutcomeUnknownError,
  type InjectedFetcher,
  assertPublicHttpUrl,
  buildDefaultSearchRequestInit,
  classifyTransportOutcomeCode,
  deepSeekFetch,
  deepSeekSearch,
  normalizeHostname,
  preflightKeyAndDefaultSearchRequest,
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

describe("typed error sanitization (no instanceof passthrough)", () => {
  it("rebuilds poisoned OutcomeUnknown from transport without keeping message", async () => {
    const poison = "Bearer sk-FAKE_TRANSPORT https://evil.example/body"
    // Overwrite message after construct (simulates forged / mutated typed error).
    const boom = new DeepSeekToolsOutcomeUnknownError("request_failed")
    Object.defineProperty(boom, "message", { value: poison, configurable: true })
    const fetcher2: InjectedFetcher = async () => {
      throw boom
    }
    await expect(deepSeekSearch({ query: "x" }, { apiKey: "k", fetcher: fetcher2 }))
      .rejects
      .toMatchObject({ name: "DeepSeekToolsOutcomeUnknownError", code: "request_failed", message: "request_failed" })

    const weird = new DeepSeekToolsOutcomeUnknownError("not_a_real_code")
    Object.defineProperty(weird, "message", { value: poison, configurable: true })
    const fetcher3: InjectedFetcher = async () => {
      throw weird
    }
    await expect(deepSeekSearch({ query: "x" }, { apiKey: "k", fetcher: fetcher3 }))
      .rejects
      .toMatchObject({ code: "request_failed", message: "request_failed" })
  })

  it("rebuilds poisoned ClientError/OutcomeUnknown from readText without keeping message", async () => {
    const poison = "Bearer sk-FAKE_READ https://evil.example/ article-body-secret"
    const fetcher: InjectedFetcher = async () => ({
      status: 200,
      ok: true,
      headers: { get: () => null },
      readText: async () => {
        const err = new DeepSeekToolsClientError("invalid_schema", poison)
        throw err
      },
    })
    await expect(deepSeekSearch({ query: "x" }, { apiKey: "k", fetcher }))
      .rejects
      .toMatchObject({ name: "DeepSeekToolsOutcomeUnknownError", code: "response_read_failed", message: "response_read_failed" })

    const fetcherTooLarge: InjectedFetcher = async () => ({
      status: 200,
      ok: true,
      headers: { get: () => null },
      readText: async () => {
        const err = new DeepSeekToolsOutcomeUnknownError("response_too_large")
        Object.defineProperty(err, "message", { value: poison, configurable: true })
        throw err
      },
    })
    await expect(deepSeekSearch({ query: "x" }, { apiKey: "k", fetcher: fetcherTooLarge }))
      .rejects
      .toMatchObject({ code: "response_too_large", message: "response_too_large" })
  })
})

describe("native Request construct with default Search params (pre-network)", () => {
  it("constructs successfully for a normal fake key", () => {
    const key = "sk-test-default-request-normal"
    const { url, init } = buildDefaultSearchRequestInit(key, "preflight-normal")
    expect(url).toBe(`${DEEPSEEK_TOOLS_BASE}${DEEPSEEK_SEARCH_PATH}`)
    const req = new Request(url, init)
    expect(req.method).toBe("POST")
    expect(req.url).toBe(url)
    expect(preflightKeyAndDefaultSearchRequest(key)).toBe("preflight_ok")
  })

  it("fails before network for non-ASCII fake key (ByteString)", () => {
    const key = "sk-test-假key-café"
    const { url, init } = buildDefaultSearchRequestInit(key)
    expect(() => new Request(url, init)).toThrow(TypeError)
    expect(preflightKeyAndDefaultSearchRequest(key)).toBe("preflight_key_format")
  })

  it("fails before network for newline/control fake keys", () => {
    const newlineKey = "sk-test-fake\nkey"
    const crKey = "sk-test-fake\rkey"
    const nullKey = "sk-test-fake\0key"
    for (const key of [newlineKey, crKey, nullKey]) {
      const { url, init } = buildDefaultSearchRequestInit(key)
      expect(() => new Request(url, init)).toThrow(TypeError)
      expect(preflightKeyAndDefaultSearchRequest(key)).toBe("preflight_key_format")
    }
  })

  it("returns fixed missing code without constructing", () => {
    expect(preflightKeyAndDefaultSearchRequest(undefined)).toBe("preflight_key_missing")
    expect(preflightKeyAndDefaultSearchRequest("")).toBe("preflight_key_missing")
  })
})

describe("transport outcome classification (whitelist name/code/cause.code only)", () => {
  it("maps code and one-level cause.code to fixed classes without leaking message", () => {
    const poison = "Bearer sk-LEAK https://evil.example ECONNRESET secret"
    const withCode = Object.assign(new Error(poison), { code: "ECONNRESET" })
    expect(classifyTransportOutcomeCode(withCode)).toBe("transport_connect")
    const wrapped = new Error(poison)
    Object.assign(wrapped, { cause: Object.assign(new Error(poison), { code: "ENOTFOUND" }) })
    expect(classifyTransportOutcomeCode(wrapped)).toBe("transport_dns")
    const cert = Object.assign(new Error(poison), { code: "CERT_HAS_EXPIRED" })
    expect(classifyTransportOutcomeCode(cert)).toBe("transport_cert")
    const timeout = Object.assign(new Error(poison), { code: "ETIMEDOUT" })
    expect(classifyTransportOutcomeCode(timeout)).toBe("transport_timeout")
  })

  it("maps whitelisted names only; TypeError stays request_failed (not param)", () => {
    // Fetch network failures can also be TypeError — do not attribute param from name alone.
    expect(classifyTransportOutcomeCode(new TypeError("Cannot convert argument to a ByteString"))).toBe("request_failed")
    expect(classifyTransportOutcomeCode(new TypeError("fetch failed"))).toBe("request_failed")
    const te = new Error("timeout")
    te.name = "TimeoutError"
    expect(classifyTransportOutcomeCode(te)).toBe("transport_timeout")
    // Param still via whitelisted code, not name:
    expect(classifyTransportOutcomeCode(Object.assign(new TypeError("bad"), { code: "ERR_INVALID_CHAR" }))).toBe("transport_param")
    expect(classifyTransportOutcomeCode(new Error("ECONNRESET https://evil Bearer sk-X"))).toBe("request_failed")
  })

  it("deepSeekSearch surfaces classified code as OutcomeUnknown without raw message", async () => {
    const poison = "ECONNRESET https://evil.example Bearer sk-LEAKED_CLASSIFY"
    const fetcher: InjectedFetcher = async () => {
      throw Object.assign(new Error(poison), { code: "ECONNRESET" })
    }
    await expect(deepSeekSearch({ query: "x" }, { apiKey: "k", fetcher }))
      .rejects
      .toMatchObject({
        name: "DeepSeekToolsOutcomeUnknownError",
        code: "transport_connect",
        message: "transport_connect",
      })
  })

  it("does not walk cause deeper than one level", () => {
    const deep = new Error("outer")
    Object.assign(deep, {
      cause: {
        cause: Object.assign(new Error("inner"), { code: "ENOTFOUND" }),
      },
    })
    expect(classifyTransportOutcomeCode(deep)).toBe("request_failed")
  })
})
