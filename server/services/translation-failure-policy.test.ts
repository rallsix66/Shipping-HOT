import { describe, expect, it } from "vitest"
import { isTranslationCircuitBlockingFailure, isTranslationFailureCode, isTranslationRetryableFailure, translationRetryBackoffMs } from "./translation-failure-policy"

describe("translation failure policy", () => {
  it.each([
    [0, 60_000],
    [1, 120_000],
    [2, 240_000],
    [3, 480_000],
    [4, 960_000],
    [5, 1_920_000],
    [6, 3_600_000],
    [7, 3_600_000],
    [99, 3_600_000],
  ])("uses the canonical retry backoff for retryCount %s", (retryCount, expectedMs) => {
    expect(translationRetryBackoffMs(retryCount)).toBe(expectedMs)
  })

  it.each(["auth_failed", "provider_forbidden", "entitlement_missing", "provider_contract_changed"] as const)("classifies %s as circuit-blocking", (code) => {
    expect(isTranslationFailureCode(code)).toBe(true)
    expect(isTranslationCircuitBlockingFailure(code)).toBe(true)
    expect(isTranslationRetryableFailure(code)).toBe(false)
  })

  it.each(["rate_limited", "provider_timeout", "provider_unavailable"] as const)("classifies %s as retryable and non-blocking", (code) => {
    expect(isTranslationFailureCode(code)).toBe(true)
    expect(isTranslationRetryableFailure(code)).toBe(true)
    expect(isTranslationCircuitBlockingFailure(code)).toBe(false)
  })

  it.each([undefined, "feed", "arbitrary"])("does not classify %s as a Translation failure", (code) => {
    expect(isTranslationFailureCode(code)).toBe(false)
    expect(isTranslationRetryableFailure(code)).toBe(false)
    expect(isTranslationCircuitBlockingFailure(code)).toBe(false)
  })
})
