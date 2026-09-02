import { describe, expect, it } from "vitest"
import { FakeTranslationProvider } from "./fake-provider"
import { approvedRuntimeJobKeys } from "#/services/v3-readiness"

describe("fake translation provider", () => {
  it("returns a deterministic local result and records no external work", async () => {
    const provider = new FakeTranslationProvider()
    const request = {
      sourceText: "Port delay",
      sourceLanguage: "en",
      targetLanguage: "zh-CN",
      entityType: "feed_item",
      entityId: "feed-1",
      fieldName: "title",
    }

    await expect(provider.translate(request)).resolves.toEqual({ translatedText: "[zh-CN] Port delay" })
    expect(provider.providerId).toBe("fake-translation")
    expect(provider.model).toBe("fake-v1")
    expect(provider.calls).toEqual([request])
    expect(approvedRuntimeJobKeys("real").some(key => key.includes("translation"))).toBe(false)
  })
})
