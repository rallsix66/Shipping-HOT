import { describe, expect, it } from "vitest"
import { mockPorts, mockVessels } from "@shared/shipping-fixtures"
import type { Vessel } from "@shared/shipping"
import { disabledProviderData, providerResult } from "./shipping"

describe("shipping Provider failure boundaries", () => {
  it("includes all eight V1 focus ports in the seed", () => {
    expect(mockPorts.map(port => port.unlocode).sort()).toEqual([
      "CNSHK",
      "CNYTN",
      "CNSNA",
      "THLCH",
      "MYPKG",
      "PHMNL",
      "IDJKT",
      "VNSGN",
    ].sort())
  })

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
