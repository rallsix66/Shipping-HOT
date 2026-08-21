import { describe, expect, it, vi } from "vitest"
import { createVesselApiSearchProvider } from "./vessel-search"

describe("vesselapi search adapter", () => {
  it("requests discovery metadata and does not expose position fields", async () => {
    let requestedUrl = ""
    let requestedHeaders: Record<string, string> | undefined
    const fetcher = vi.fn(async (url: string, init?: { headers?: Record<string, string> }) => {
      requestedUrl = url
      requestedHeaders = init?.headers
      return {
        ok: true,
        status: 200,
        json: async () => ({ results: [{ id: "vessel-1", name: "EVER GLORY", IMO: 9876543, MMSI: 477123400, Callsign: "9V1234", ship_type: "Container ship", flag_code: "SG", latitude: 1, longitude: 2 }] }),
      }
    })
    const provider = createVesselApiSearchProvider({ apiKey: "secret", endpoint: "https://example.test/v1/search/vessels", fetcher })
    const results = await provider.search({ query: "9876543", field: "imo" })

    expect(new URL(requestedUrl).searchParams.get("imo")).toBe("9876543")
    expect(requestedHeaders).toEqual({ Accept: "application/json", Authorization: "Bearer secret" })
    expect(results).toEqual([expect.objectContaining({ name: "EVER GLORY", imo: "9876543", mmsi: "477123400", callsign: "9V1234", type: "Container ship", flag: "SG", source: "vesselapi", source_type: "real" })])
    expect(results[0]).not.toHaveProperty("latitude")
    expect(results[0]).not.toHaveProperty("longitude")
  })

  it("fails explicitly on an unavailable upstream", async () => {
    const provider = createVesselApiSearchProvider({
      apiKey: "secret",
      fetcher: async () => ({ ok: false, status: 429, json: async () => ({}) }),
    })
    await expect(provider.search({ query: "EVER GLORY" })).rejects.toThrow("VesselAPI search failed (429)")
  })
})
