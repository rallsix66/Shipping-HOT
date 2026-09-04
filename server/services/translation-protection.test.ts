import { describe, expect, it } from "vitest"
import { TranslationValidationError, protectTranslationText, restoreAndValidateProtectedTranslation } from "./translation-protection"

describe("translation literal protection", () => {
  it("round-trips ordinary text without placeholders", () => {
    const protectedText = protectTranslationText("Plain text without protected literals")
    expect(protectedText.placeholders).toEqual([])
    expect(restoreAndValidateProtectedTranslation(protectedText, "普通文本")).toBe("普通文本")
  })

  it("protects shipping identifiers, dates, numbers, URLs, and known terms", () => {
    const source = "IMO 9876543 / MMSI 123456789: AB123 at SGSIN on 2026-09-02, 12:30, 12.5N 113.2E, https://example.com/status"
    const protectedText = protectTranslationText(source, ["AB123"])
    expect(protectedText.placeholders.map(item => item.literal)).toEqual(expect.arrayContaining(["IMO 9876543", "MMSI 123456789", "AB123", "SGSIN", "2026-09-02", "12:30", "12.5N", "113.2E", "https://example.com/status"]))
    expect(protectedText.placeholders.every(item => /^__SH_\d+_[A-F0-9]{10}__$/.test(item.marker))).toBe(true)
    expect(protectedText.placeholders.every(item => item.marker.length < 24)).toBe(true)
    expect(protectedText.protectedText).not.toContain("9876543")
    expect(restoreAndValidateProtectedTranslation(protectedText, protectedText.protectedText)).toBe(source)
  })

  it("restores reordered placeholders by marker identity", () => {
    const protectedText = protectTranslationText("Voyage AB123 reaches SGSIN on 2026-09-02")
    const reordered = [...protectedText.placeholders].reverse().map(item => item.marker).join(" ")
    const restored = restoreAndValidateProtectedTranslation(protectedText, reordered)
    expect(restored).toBe([...protectedText.placeholders].reverse().map(item => item.literal).join(" "))
  })

  it.each([
    ["missing", (markers: string[]): string => markers.slice(0, -1).join(" ")],
    ["duplicate", (markers: string[]): string => [...markers, markers[0]].join(" ")],
    ["mutated", (markers: string[]): string => markers.map(marker => marker.replace("__SH_", "__SX_")).join(" ")],
    ["unknown", (markers: string[]): string => [...markers, "__SH_99_FFFFFFFFFF__"].join(" ")],
    ["residual", (_markers: string[]): string => "__SH_BAD__"],
  ] as const)("rejects %s markers with a Translation validation error", (_label, output) => {
    const protectedText = protectTranslationText("Voyage AB123 reaches SGSIN on 2026-09-02")
    expect(() => restoreAndValidateProtectedTranslation(protectedText, output(protectedText.placeholders.map(item => item.marker))))
      .toThrowError(new TranslationValidationError())
  })

  it("avoids source collisions with marker-like source text", () => {
    const sourceMarker = "__SH_0_AAAAAAAA00__"
    const source = `Notice ${sourceMarker} at 2026-09-02`
    const protectedText = protectTranslationText(source)
    expect(protectedText.placeholders.map(item => item.literal)).toContain(sourceMarker)
    expect(protectedText.placeholders.map(item => item.marker)).not.toContain(sourceMarker)
    expect(protectedText.protectedText).not.toContain(sourceMarker)
    expect(restoreAndValidateProtectedTranslation(protectedText, protectedText.protectedText)).toBe(source)
  })
})
