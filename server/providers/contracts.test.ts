import { describe, expect, it } from "vitest"
import { ProviderError, providerFailureCode, providerHttpError } from "./contracts"

describe("provider failure contract", () => {
  it.each([
    [401, undefined, "auth_failed"],
    [403, "forbidden by policy", "provider_forbidden"],
    [403, "feature not available on this plan", "entitlement_missing"],
    [429, undefined, "rate_limited"],
    [500, undefined, "provider_unavailable"],
    [504, undefined, "provider_timeout"],
    [422, undefined, "provider_contract_changed"],
  ])("maps %s responses without overclaiming entitlement", (status, context, expected) => {
    expect(providerFailureCode(status, context)).toBe(expected)
  })

  it("preserves timeout and malformed-response causes as ProviderError", () => {
    expect(providerHttpError("Feed", 408).code).toBe("provider_timeout")
    expect(new ProviderError("provider_contract_changed", "malformed response").code).toBe("provider_contract_changed")
  })
})
