import { describe, expect, it } from "vitest"
import { disabledProviderData, providerResult } from "./shipping"
import { mockVessels } from "@shared/shipping-fixtures"
import type { Vessel } from "@shared/shipping"

describe("Shipping Provider failure boundaries", () => {
  it("keeps last-known data and marks a failed provider stale", () => {
    const [vessel] = mockVessels
    const result = providerResult<Vessel>({ status: "rejected", reason: new Error("mock outage") }, [vessel])
    expect(result[0]).toMatchObject({ id: vessel.id, stale: true, sourceStatus: "failed", error: "mock outage" })
  })

  it("marks disabled streams without pretending they are fresh", () => {
    const [vessel] = mockVessels
    expect(disabledProviderData([vessel])[0]).toMatchObject({ id: vessel.id, stale: false, sourceStatus: "disabled" })
  })
})
