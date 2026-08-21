import { describe, expect, it } from "vitest"
import { detectVesselSearchField, normalizeVesselSearchQuery, stableVesselMetadataId, vesselSearchCacheKey } from "./vessel-search"

describe("vessel search domain", () => {
  it("normalizes names and detects numeric identifiers", () => {
    expect(normalizeVesselSearchQuery({ query: "  EVER   GLORY " })).toEqual({ query: "ever glory", field: "name" })
    expect(detectVesselSearchField("9876543")).toBe("imo")
    expect(detectVesselSearchField("477123400")).toBe("mmsi")
    expect(vesselSearchCacheKey({ query: "EVER GLORY", field: "name" })).toBe("name:ever glory")
  })

  it("uses IMO first for a stable metadata identity", () => {
    expect(stableVesselMetadataId("vesselapi", { imo: "9876543", mmsi: "477123400", name: "EVER GLORY" })).toBe("imo:9876543")
    expect(stableVesselMetadataId("vesselapi", { providerRecordId: "vessel-1", mmsi: "477123400", name: "EVER GLORY" })).toBe("vesselapi:vessel-1")
    expect(stableVesselMetadataId("vesselapi", { mmsi: "477123400", name: "EVER GLORY" })).toBe("mmsi:477123400")
  })
})
