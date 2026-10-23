import { describe, expect, it } from "vitest"
import {
  DeepSeekToolsClientError,
  type InjectedFetcher,
  assertPublicHttpUrl,
  deepSeekFetch,
  deepSeekSearch,
} from "./search-fetch-client"
import { ProviderRejectedError } from "#/intel/llm/receipts"

function ok(body: unknown): Awaited<ReturnType<InjectedFetcher>> {
  return {
    status: 200,
    ok: true,
    text: async () => JSON.stringify(body),
    headers: { get: () => null },
  }
}

describe("assertPublicHttpUrl", () => {
  it("rejects private, userinfo, and non-http", () => {
    expect(() => assertPublicHttpUrl("http://192.168.1.1/")).toThrow(DeepSeekToolsClientError)
    expect(() => assertPublicHttpUrl("http://127.0.0.1/")).toThrow(DeepSeekToolsClientError)
    expect(() => assertPublicHttpUrl("https://user:pass@example.com/")).toThrow(DeepSeekToolsClientError)
    expect(() => assertPublicHttpUrl("ftp://example.com/")).toThrow(DeepSeekToolsClientError)
    expect(assertPublicHttpUrl("https://example.com/a").toString()).toBe("https://example.com/a")
  })
})

describe("deepSeekSearch / deepSeekFetch client", () => {
  it("maps 401 to ProviderRejectedError and never embeds localization", async () => {
    const bodies: string[] = []
    const fetcher: InjectedFetcher = async (_url, init) => {
      bodies.push(init?.body ?? "")
      return { status: 401, ok: false, text: async () => "nope", headers: { get: () => null } }
    }
    await expect(deepSeekSearch({ query: "q" }, { apiKey: "k", fetcher }))
      .rejects
      .toBeInstanceOf(ProviderRejectedError)
    expect(bodies[0]).not.toMatch(/localization/)
    expect(JSON.parse(bodies[0]!)).toMatchObject({ need_content: false, count: 10 })
  })

  it("returns empty content for HTTP 200 empty body", async () => {
    const fetcher: InjectedFetcher = async () => ok({ title: "", content: "" })
    const result = await deepSeekFetch({ url: "https://example.com/e" }, { apiKey: "k", fetcher })
    expect(result.content).toBe("")
  })
})
