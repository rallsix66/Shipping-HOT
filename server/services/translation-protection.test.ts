import { describe, expect, it } from "vitest"
import { protectTranslationText, restoreAndValidateProtectedTranslation } from "./translation-protection"
import { ProviderError } from "#/providers/contracts"

describe("translation literal protection", () => {
  it("protects shipping identifiers, dates, numbers, URLs, and known terms", () => {
    const source = "IMO 9876543 / MMSI 123456789: AB123 at SGSIN on 2026-09-02, 12:30, 12.5N 113.2E, https://example.com/status"
    const protectedText = protectTranslationText(source, ["AB123"])
    expect(protectedText.placeholders.map(item => item.literal)).toEqual(expect.arrayContaining(["IMO 9876543", "MMSI 123456789", "AB123", "SGSIN", "2026-09-02", "12:30", "12.5N", "113.2E", "https://example.com/status"]))
    expect(protectedText.protectedText).not.toContain("9876543")
    expect(restoreAndValidateProtectedTranslation(protectedText, protectedText.protectedText)).toBe(source)
  })

  it("restores reordered placeholders by marker identity and rejects changes", () => {
    const protectedText = protectTranslationText("Voyage AB123 reaches SGSIN on 2026-09-02")
    const reordered = [...protectedText.placeholders].reverse().map(item => item.marker).join(" ")
    const restored = restoreAndValidateProtectedTranslation(protectedText, reordered)
    expect(restored).toBe([...protectedText.placeholders].reverse().map(item => item.literal).join(" "))
    expect(() => restoreAndValidateProtectedTranslation(protectedText, protectedText.placeholders.slice(0, -1).map(item => item.marker).join(" "))).toThrowError(ProviderError)
    expect(() => restoreAndValidateProtectedTranslation(protectedText, `${protectedText.protectedText} ${protectedText.placeholders[0].marker}`)).toThrowError(ProviderError)
    expect(() => restoreAndValidateProtectedTranslation(protectedText, protectedText.protectedText.replace("SHIPPING_HOT_LITERAL", "SHIPPING_HOT_L1TERAL"))).toThrowError(ProviderError)
  })
})
