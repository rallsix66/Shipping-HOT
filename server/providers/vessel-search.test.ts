import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it, vi } from "vitest"
import { configureVesselSearchProvider, createVesselApiSearchProvider } from "./vessel-search"
import { FileSecretStore } from "#/secrets/file-secret-store"

describe("vesselapi search adapter", () => {
  it("uses the official filters and vessels response schema", async () => {
    const requestedUrls: string[] = []
    let requestedHeaders: Record<string, string> | undefined
    const fetcher = vi.fn(async (url: string, init?: { headers?: Record<string, string> }) => {
      requestedUrls.push(url)
      requestedHeaders = init?.headers
      return {
        ok: true,
        status: 200,
        json: async () => ({
          vessels: [{
            name: "EVER GIVEN",
            imo: 9321483,
            mmsi: 477045900,
            call_sign: "H3RC",
            vessel_type: "Container Ship",
            country: "Panama",
          }],
        }),
      }
    })
    const provider = createVesselApiSearchProvider({ apiKey: "secret", endpoint: "https://example.test/v1/search/vessels", fetcher })

    for (const [query, parameter, value] of [
      [{ query: "EVER GIVEN", field: "name" as const }, "filter.name", "ever given"],
      [{ query: "9321483", field: "imo" as const }, "filter.imo", "9321483"],
      [{ query: "477045900", field: "mmsi" as const }, "filter.mmsi", "477045900"],
      [{ query: "H3RC", field: "callsign" as const }, "filter.callsign", "h3rc"],
    ] as const) {
      await provider.search(query)
      const url = new URL(requestedUrls.at(-1)!)
      expect(url.searchParams.get(parameter)).toBe(value)
      expect([...url.searchParams.keys()]).toContain(parameter)
    }

    const results = await provider.search({ query: "9321483", field: "imo" })
    expect(new URL(requestedUrls.at(-1)!).searchParams.get("filter.imo")).toBe("9321483")
    expect(requestedHeaders).toEqual({ Accept: "application/json", Authorization: "Bearer secret" })
    expect(results).toEqual([expect.objectContaining({ name: "EVER GIVEN", imo: "9321483", mmsi: "477045900", callsign: "H3RC", type: "Container Ship", flag: "Panama", source: "vesselapi", source_type: "real" })])
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

  it("uses the environment secret before the FileSecretStore fallback", async () => {
    const directory = await mkdtemp(join(tmpdir(), "shipping-hot-vesselapi-"))
    const path = join(directory, "provider-secrets.json")
    try {
      const fileStore = new FileSecretStore({ path, environment: {} })
      await fileStore.set("vesselapi", "file-secret")

      const fetcher = vi.fn(async (_url: string) => ({
        ok: true,
        status: 200,
        json: async () => ({ vessels: [{ name: "DONG FANG FU" }] }),
        headers: { get: () => null },
      }))
      vi.stubGlobal("fetch", fetcher)
      const environmentStore = new FileSecretStore({ path, environment: { VESSELAPI_API_KEY: "environment-secret" } })
      const environmentProvider = await configureVesselSearchProvider(
        { SHIPPING_DATA_MODE: "real", SHIPPING_VESSEL_SEARCH_PROVIDER: "vesselapi" },
        environmentStore,
      )
      await environmentProvider.search({ query: "DONG FANG FU", field: "name" })
      expect(fetcher).toHaveBeenLastCalledWith(
        "https://api.vesselapi.com/v1/search/vessels?filter.name=dong+fang+fu",
        { headers: { Accept: "application/json", Authorization: "Bearer environment-secret" } },
      )

      const fileProvider = await configureVesselSearchProvider(
        { SHIPPING_DATA_MODE: "real", SHIPPING_VESSEL_SEARCH_PROVIDER: "vesselapi" },
        fileStore,
      )
      await fileProvider.search({ query: "DONG FANG FU", field: "name" })
      expect(fetcher).toHaveBeenLastCalledWith(
        "https://api.vesselapi.com/v1/search/vessels?filter.name=dong+fang+fu",
        { headers: { Accept: "application/json", Authorization: "Bearer file-secret" } },
      )
    } finally {
      vi.unstubAllGlobals()
      await rm(directory, { recursive: true, force: true })
    }
  })
})
