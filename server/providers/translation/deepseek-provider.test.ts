import { describe, expect, it } from "vitest"
import { DEEPSEEK_DEFAULT_MODEL, DEEPSEEK_PRICING_REFERENCE, createDeepSeekTranslationProvider, estimateDeepSeekCost, isDeepSeekPeakHour } from "./deepseek-provider"
import { ProviderError } from "#/providers/contracts"

const request = {
  sourceText: "Port delay",
  sourceLanguage: "en",
  targetLanguage: "zh-CN",
  entityType: "translation_test",
  entityId: "test",
  fieldName: "summary",
}

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })
}

describe("deepSeek translation provider foundation", () => {
  it("sends the fixed official chat completion contract and parses usage", async () => {
    let captured: { input: string, init?: RequestInit } | undefined
    const provider = createDeepSeekTranslationProvider({ apiKey: "secret-value", fetcher: async (input, init) => {
      captured = { input, init }
      return response({ choices: [{ message: { content: "港口延误" } }], usage: { prompt_tokens: 10, prompt_cache_hit_tokens: 4, prompt_cache_miss_tokens: 6, completion_tokens: 8, total_tokens: 18 } })
    } })
    await expect(provider.translate(request)).resolves.toEqual({ translatedText: "港口延误", usage: { promptTokens: 10, promptCacheHitTokens: 4, promptCacheMissTokens: 6, completionTokens: 8, totalTokens: 18 } })
    expect(provider.providerId).toBe("deepseek")
    expect(provider.model).toBe(DEEPSEEK_DEFAULT_MODEL)
    expect(captured?.input).toBe("https://api.deepseek.com/chat/completions")
    expect(captured?.init?.method).toBe("POST")
    expect(captured?.init?.headers).toMatchObject({ "Accept": "application/json", "Content-Type": "application/json", "Authorization": "Bearer secret-value" })
    const body = JSON.parse(String(captured?.init?.body)) as Record<string, unknown>
    expect(body).toMatchObject({ model: "deepseek-v4-flash", thinking: { type: "disabled" }, stream: false })
    expect(body).not.toHaveProperty("tools")
    expect(body).not.toHaveProperty("reasoning_effort")
  })

  it.each([
    [401, "auth_failed"],
    [403, "provider_forbidden"],
    [429, "rate_limited"],
    [500, "provider_unavailable"],
  ] as const)("maps HTTP %s to %s without exposing credentials", async (status, code) => {
    const provider = createDeepSeekTranslationProvider({ apiKey: "secret-value", fetcher: async () => response({ error: { code: "bad_request", message: "safe provider message" } }, status) })
    const error = await provider.translate(request).catch(value => value)
    expect(error).toBeInstanceOf(ProviderError)
    expect((error as ProviderError).code).toBe(code)
    expect(String(error)).not.toContain("secret-value")
  })

  it("distinguishes an entitlement response and rejects malformed or empty content", async () => {
    const entitlement = createDeepSeekTranslationProvider({ apiKey: "secret-value", fetcher: async () => response({ error: { message: "plan restriction" } }, 403) })
    await expect(entitlement.translate(request)).rejects.toMatchObject({ code: "entitlement_missing" })
    for (const body of [{}, { choices: [] }, { choices: [{ message: { content: "" } }] }]) {
      const provider = createDeepSeekTranslationProvider({ apiKey: "secret-value", fetcher: async () => response(body) })
      await expect(provider.translate(request)).rejects.toMatchObject({ code: "provider_contract_changed" })
    }
  })

  it("fails closed when the key is missing and maps network and timeout failures", async () => {
    const missing = createDeepSeekTranslationProvider({ apiKey: "" })
    await expect(missing.translate(request)).rejects.toMatchObject({ code: "auth_failed" })
    const network = createDeepSeekTranslationProvider({ apiKey: "secret-value", fetcher: async () => {
      throw new Error("network down")
    } })
    await expect(network.translate(request)).rejects.toMatchObject({ code: "provider_unavailable" })
    const timeout = createDeepSeekTranslationProvider({ apiKey: "secret-value", timeoutMs: 5, fetcher: async (_, init) => new Promise<Response>((_, reject) => init?.signal?.addEventListener("abort", () => reject(new Error("aborted")))) })
    await expect(timeout.translate(request)).rejects.toMatchObject({ code: "provider_timeout" })
  })

  it("uses the current official USD price snapshot for deterministic cost estimates", () => {
    const offPeak = new Date("2026-09-02T12:00:00.000Z")
    const peak = new Date("2026-09-02T02:00:00.000Z")
    expect(isDeepSeekPeakHour(offPeak)).toBe(false)
    expect(isDeepSeekPeakHour(peak)).toBe(true)
    expect(estimateDeepSeekCost({ promptCacheHitTokens: 1_000_000, promptCacheMissTokens: 1_000_000, completionTokens: 1_000_000 }, offPeak)).toBeCloseTo(0.887)
    expect(estimateDeepSeekCost({ promptCacheHitTokens: 1_000_000, promptCacheMissTokens: 1_000_000, completionTokens: 1_000_000 }, peak)).toBeCloseTo(1.774)
    expect(DEEPSEEK_PRICING_REFERENCE).toBe("deepseek-official-2026-09-02")
  })
})
