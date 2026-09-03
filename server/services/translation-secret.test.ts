import { describe, expect, it } from "vitest"
import { TRANSLATION_SECRET_MAX_LENGTH, parseTranslationSecretBody } from "./translation-secret"

describe("translation Secret API payload boundary", () => {
  it("accepts only one trimmed DeepSeek apiKey field", () => {
    expect(parseTranslationSecretBody({ apiKey: "  deepseek-secret  " })).toBe("deepseek-secret")
  })

  it("rejects empty, oversized, and unexpected payloads", () => {
    for (const body of [undefined, null, {}, { apiKey: "   " }, { apiKey: "secret", extra: true }, { apiKey: "x".repeat(TRANSLATION_SECRET_MAX_LENGTH + 1) }]) {
      expect(() => parseTranslationSecretBody(body)).toThrow()
    }
  })

  it("does not include the submitted key in validation errors", () => {
    expect(() => parseTranslationSecretBody({ apiKey: "  " })).toThrow("secret_required")
    expect(() => parseTranslationSecretBody({ apiKey: "secret", extra: "do-not-echo" })).toThrow("secret_payload_invalid")
  })
})
