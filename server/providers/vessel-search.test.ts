import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it, vi } from "vitest"
import { MockVesselSearchProvider, configureVesselSearchProvider, createGfwVesselSearchProvider, createVesselApiSearchProvider, normalizeGfwSearchResponse } from "./vessel-search"
import { FileSecretStore } from "#/secrets/file-secret-store"
import { ProviderError } from "#/providers/contracts"

function gfwIdentity(overrides: Record<string, unknown>) {
  return {
    id: "gfw-default-id",
    ssvid: "413393620",
    shipname: "DONG FANG FU",
    flag: "CHN",
    callsign: "BPCL3",
    imo: 9162423,
    transmissionDateFrom: "2022-01-01T00:00:00.000Z",
    transmissionDateTo: "2026-01-01T00:00:00.000Z",
    ...overrides,
  }
}

function gfwEntry(identity: Record<string, unknown>, shiptypes = ["CARGO"]) {
  return {
    dataset: "public-global-vessel-identity:latest",
    registryInfo: [],
    registryOwners: [],
    combinedSourcesInfo: [{ vesselId: identity.id, shiptypes }],
    selfReportedInfo: [identity],
  }
}

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
      expect(environmentProvider.providerId).toBe("vesselapi")
      await environmentProvider.search({ query: "DONG FANG FU", field: "name" })
      expect(fetcher).toHaveBeenLastCalledWith(
        "https://api.vesselapi.com/v1/search/vessels?filter.name=dong+fang+fu",
        { headers: { Accept: "application/json", Authorization: "Bearer environment-secret" } },
      )

      const fileProvider = await configureVesselSearchProvider(
        { SHIPPING_DATA_MODE: "real", SHIPPING_VESSEL_SEARCH_PROVIDER: "vesselapi" },
        fileStore,
      )
      expect(fileProvider.providerId).toBe("vesselapi")
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

  it("keeps Mock Mode isolated when FileSecretStore has a VesselAPI key", async () => {
    const directory = await mkdtemp(join(tmpdir(), "shipping-hot-vesselapi-mock-"))
    const path = join(directory, "provider-secrets.json")
    const fetcher = vi.fn(async () => {
      throw new Error("VesselAPI fetch must not run in Mock Mode")
    })
    vi.stubGlobal("fetch", fetcher)
    try {
      const fileStore = new FileSecretStore({ path, environment: {} })
      await fileStore.set("vesselapi", "file-secret")

      const provider = await configureVesselSearchProvider(
        { SHIPPING_DATA_MODE: "mock", SHIPPING_VESSEL_SEARCH_PROVIDER: "mock" },
        fileStore,
      )
      expect(provider).toBe(MockVesselSearchProvider)
      await expect(provider.search({ query: "EVER GLORY", field: "name" })).resolves.toEqual([expect.objectContaining({ source: "mock-vessel-search" })])
      expect(fetcher).not.toHaveBeenCalled()
    } finally {
      vi.unstubAllGlobals()
      await rm(directory, { recursive: true, force: true })
    }
  })
})

describe("gfw vessel search adapter", () => {
  it("uses the documented endpoint, dataset, limit and Bearer header without exposing the token in results", async () => {
    let requestedUrl = ""
    let requestedHeaders: Record<string, string> | undefined
    const provider = createGfwVesselSearchProvider({
      apiToken: "gfw-secret-value",
      endpoint: "https://example.test/v3/vessels/search",
      fetcher: async (url, init) => {
        requestedUrl = url
        requestedHeaders = init?.headers
        return { ok: true, status: 200, json: async () => ({ limit: 20, since: null, total: 0, entries: [], metadata: {} }) }
      },
    })

    await expect(provider.search({ query: " HANSA   BREITENBURG " })).resolves.toEqual([])
    const url = new URL(requestedUrl)
    expect(url.pathname).toBe("/v3/vessels/search")
    expect(url.searchParams.get("query")).toBe("hansa breitenburg")
    expect(url.searchParams.get("datasets[0]")).toBe("public-global-vessel-identity:latest")
    expect(url.searchParams.get("limit")).toBe("20")
    expect(requestedHeaders).toEqual({ Accept: "application/json", Authorization: "Bearer gfw-secret-value" })
  })

  it("groups HANSA historical identities by IMO and selects the latest identity independent of response order", () => {
    const entries = [
      gfwEntry(gfwIdentity({ id: "97db6280-e316-f58c-043d-1740bbb210f9", shipname: "HANSA BREITENBURG", imo: 9155391, ssvid: "636090756", callsign: "A8ET3", flag: "LBR", transmissionDateFrom: "2012-01-01T01:26:05Z", transmissionDateTo: "2026-06-08T00:50:04Z" })),
      gfwEntry(gfwIdentity({ id: "6561869d3-3c29-f6bb-24ab-ff765f60e1a2", shipname: "HANSA BREITENB5RG", imo: 9155391, ssvid: "770308484", callsign: "A8ET3", flag: "URY", transmissionDateFrom: "2024-12-04T07:46:34Z", transmissionDateTo: "2024-12-04T10:28:07Z" })),
      gfwEntry(gfwIdentity({ id: "c208e013b-bd7e-8fd3-126e-8c91e6958831", shipname: "HANSA BREITENBURG", imo: 9155391, ssvid: "538090733", callsign: "V7B3029", flag: "MHL", transmissionDateFrom: "2026-06-08T00:49:32Z", transmissionDateTo: "2026-08-28T23:59:58Z" })),
    ]
    const normal = normalizeGfwSearchResponse({ entries }, { query: "HANSA BREITENBURG", field: "name" }, "2026-08-31T00:00:00.000Z")
    const reversed = normalizeGfwSearchResponse({ entries: [...entries].reverse() }, { query: "HANSA BREITENBURG", field: "name" }, "2026-08-31T00:00:00.000Z")
    expect(normal).toEqual(reversed)
    expect(normal).toHaveLength(1)
    expect(normal[0]).toMatchObject({ id: "imo:9155391", name: "HANSA BREITENBURG", imo: "9155391", mmsi: "538090733", callsign: "V7B3029", flag: "MHL", type: "CARGO", providerRecordId: "c208e013b-bd7e-8fd3-126e-8c91e6958831" })
    expect(normal[0].identityHistory?.map(identity => identity.mmsi)).toEqual(["538090733", "636090756", "770308484"])
    expect(normal[0].identityHistory).toHaveLength(3)
  })

  it("keeps same-name vessels with different IMO values separate while merging same-IMO MMSIs", () => {
    const results = normalizeGfwSearchResponse({ entries: [
      gfwEntry(gfwIdentity({ id: "dong-a", ssvid: "413335562", imo: 4837047, transmissionDateTo: "2024-01-01T00:00:00Z" })),
      gfwEntry(gfwIdentity({ id: "dong-b", ssvid: "413393620", imo: 9162423, transmissionDateTo: "2025-01-01T00:00:00Z" })),
      gfwEntry(gfwIdentity({ id: "dong-c", ssvid: "413977000", imo: 9162423, transmissionDateTo: "2026-01-01T00:00:00Z" })),
    ] }, { query: "DONG FANG FU", field: "name" }, "2026-08-31T00:00:00.000Z")
    expect(results).toHaveLength(2)
    expect(results.map(result => result.imo).sort()).toEqual(["4837047", "9162423"])
    expect(results.find(result => result.imo === "9162423")?.identityHistory?.map(identity => identity.mmsi).sort()).toEqual(["413393620", "413977000"])
  })

  it("uses explicit deterministic rules for open-ended, invalid and missing transmission dates", () => {
    const results = normalizeGfwSearchResponse({ entries: [
      gfwEntry(gfwIdentity({ id: "dated", ssvid: "111111111", imo: undefined, transmissionDateTo: "2025-01-01T00:00:00Z" })),
      gfwEntry(gfwIdentity({ id: "open-ended", ssvid: "222222222", imo: undefined, transmissionDateTo: undefined, transmissionDateFrom: "2024-01-01T00:00:00Z" })),
      gfwEntry(gfwIdentity({ id: "invalid-date", ssvid: "333333333", imo: undefined, transmissionDateTo: "not-a-date", transmissionDateFrom: "2026-01-01T00:00:00Z" })),
    ] }, { query: "DONG FANG FU", field: "name" })
    expect(results[0]).toMatchObject({ id: "mmsi:222222222", mmsi: "222222222" })
    expect(results.map(result => result.id)).toEqual(["mmsi:222222222", "mmsi:111111111", "mmsi:333333333"])
  })

  it("uses MMSI or provider identity conservatively when IMO is absent", () => {
    const results = normalizeGfwSearchResponse({ entries: [
      gfwEntry(gfwIdentity({ id: "mmsi-a", ssvid: "111111111", imo: undefined })),
      gfwEntry(gfwIdentity({ id: "mmsi-b", ssvid: "222222222", imo: undefined })),
      gfwEntry(gfwIdentity({ id: "name-only-a", ssvid: undefined, imo: undefined })),
      gfwEntry(gfwIdentity({ id: "name-only-b", ssvid: undefined, imo: undefined })),
    ] }, { query: "DONG FANG FU", field: "name" })
    expect(results.map(result => result.id)).toEqual(expect.arrayContaining(["mmsi:111111111", "mmsi:222222222", "gfw:name-only-a", "gfw:name-only-b"]))
    expect(results).toHaveLength(4)
  })

  it("never promotes registryInfo ids to canonical GFW provider ids", () => {
    const results = normalizeGfwSearchResponse({ entries: [{
      registryInfo: [{ id: "registry-only-id", shipname: "UNKNOWN VESSEL" }],
      combinedSourcesInfo: [],
      selfReportedInfo: [],
    }] }, { query: "UNKNOWN VESSEL", field: "name" })
    expect(results).toHaveLength(1)
    expect(results[0].id).not.toBe("gfw:registry-only-id")
    expect(results[0].id).toMatch(/^gfw:unidentified:/)
  })

  it("fails closed on malformed 200 responses and preserves provider failure taxonomy", async () => {
    expect(() => normalizeGfwSearchResponse({ vessels: [] }, { query: "HANSA BREITENBURG" })).toThrowError(new ProviderError("provider_contract_changed", "GFW vessel search response schema is invalid", 200))
    for (const [status, code] of [[401, "auth_failed"], [403, "provider_forbidden"], [429, "rate_limited"], [503, "provider_unavailable"]] as const) {
      const provider = createGfwVesselSearchProvider({ apiToken: "secret", fetcher: async () => ({ ok: false, status, json: async () => ({ error: "safe-error" }) }) })
      await expect(provider.search({ query: "HANSA BREITENBURG" })).rejects.toMatchObject({ code, status })
    }
  })

  it("selects the explicit real provider, detects ambiguity, and never live-fetches in Mock Mode", async () => {
    const values = { gfw: "gfw-secret", vesselapi: "vesselapi-secret" }
    const store = { get: async (providerId: string) => values[providerId as keyof typeof values], set: async () => undefined, delete: async () => undefined, has: async (providerId: string) => Boolean(values[providerId as keyof typeof values]), source: async () => "environment" as const }
    await expect((await configureVesselSearchProvider({ SHIPPING_DATA_MODE: "real", SHIPPING_VESSEL_SEARCH_PROVIDER: "gfw" }, store)).providerId).toBe("gfw")
    await expect((await configureVesselSearchProvider({ SHIPPING_DATA_MODE: "real", SHIPPING_VESSEL_SEARCH_PROVIDER: "vesselapi" }, store)).providerId).toBe("vesselapi")
    await expect((await configureVesselSearchProvider({ SHIPPING_DATA_MODE: "real" }, store)).providerId).toBe("unavailable")
    const mock = await configureVesselSearchProvider({ SHIPPING_DATA_MODE: "mock", GFW_API_TOKEN: values.gfw, VESSELAPI_API_KEY: values.vesselapi }, store)
    expect(mock).toBe(MockVesselSearchProvider)
  })
})
