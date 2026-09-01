import { describe, expect, it } from "vitest"
import type { ProviderError } from "#/providers/contracts"
import { createVesselApiVoyageProvider, normalizeVesselApiVoyageObservation } from "#/providers/voyage/vesselapi-provider"

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })
}

function etaPayload(overrides: Record<string, unknown> = {}): unknown {
  return {
    vesselEta: {
      destination: "Manila",
      destination_port: "PHMNL",
      eta: "2026-09-03T08:00:00Z",
      timestamp: "2026-09-01T08:00:00Z",
      imo: "9162423",
      mmsi: "413393620",
      vessel_name: "TEST VESSEL",
      draught: 8.2,
      ...overrides,
    },
  }
}

function eventPayload(event: "Arrival" | "Departure", overrides: Record<string, unknown> = {}): unknown {
  return {
    portEvent: {
      event,
      timestamp: "2026-08-31T18:00:00Z",
      port: { unlo_code: "CNSHK", name: "Shekou" },
      vessel: { imo: "9162423", mmsi: "413393620" },
      ...overrides,
    },
  }
}

function fetchQueue(responses: Response[]): { fetcher: (input: string, init?: RequestInit) => Promise<Response>, urls: string[] } {
  const urls: string[] = []
  let index = 0
  return {
    urls,
    fetcher: async (input) => {
      urls.push(input)
      const next = responses[index++]
      if (!next) throw new Error("unexpected_fetch")
      return next
    },
  }
}

const vessel = { vesselId: "vessel-1", imo: "9162423", mmsi: "413393620" }

describe("vesselapi voyage provider", () => {
  it("normalizes ETA, keeps the trusted source timestamp, and resolves destination through Port Directory", async () => {
    const queue = fetchQueue([response(etaPayload())])
    const provider = createVesselApiVoyageProvider({
      apiKey: "test-secret",
      fetcher: queue.fetcher,
      includeLastPortEvent: false,
      portDirectory: { resolvePortIdentity: async value => value === "PHMNL" ? "PHMNL" : undefined },
    })

    await expect(provider.getVoyages([vessel])).resolves.toEqual([expect.objectContaining({
      vesselId: "vessel-1",
      imo: "9162423",
      mmsi: "413393620",
      destinationPortId: "PHMNL",
      originPortId: undefined,
      voyageNumber: undefined,
      status: "unknown",
      eta: "2026-09-03T08:00:00.000Z",
      timestamp: "2026-09-01T08:00:00.000Z",
      lastUpdatedAt: "2026-09-01T08:00:00.000Z",
      source: "vesselapi",
      sourceType: "real",
    })])
    expect(new URL(queue.urls[0]).searchParams.get("filter.idType")).toBe("imo")
  })

  it("prefers IMO and falls back to MMSI only when IMO is absent", async () => {
    const imoQueue = fetchQueue([response(etaPayload())])
    const imoProvider = createVesselApiVoyageProvider({ apiKey: "test-secret", fetcher: imoQueue.fetcher, includeLastPortEvent: false })
    await imoProvider.getVoyages([{ vesselId: "imo-vessel", imo: "9162423", mmsi: "413393620" }])
    expect(new URL(imoQueue.urls[0]).pathname).toContain("/vessel/9162423/eta")
    expect(new URL(imoQueue.urls[0]).searchParams.get("filter.idType")).toBe("imo")

    const mmsiQueue = fetchQueue([response(etaPayload({ imo: undefined }))])
    const mmsiProvider = createVesselApiVoyageProvider({ apiKey: "test-secret", fetcher: mmsiQueue.fetcher, includeLastPortEvent: false })
    await mmsiProvider.getVoyages([{ vesselId: "mmsi-vessel", mmsi: "413393620" }])
    expect(new URL(mmsiQueue.urls[0]).pathname).toContain("/vessel/413393620/eta")
    expect(new URL(mmsiQueue.urls[0]).searchParams.get("filter.idType")).toBe("mmsi")
  })

  it.each([
    [{ imo: "9162424" }, "provider_contract_changed"],
    [{ mmsi: "413393621" }, "provider_contract_changed"],
    [{ imo: "9162423", mmsi: "413393621" }, "provider_contract_changed"],
    [{ imo: undefined, mmsi: undefined }, "provider_contract_changed"],
  ] as const)("rejects an ETA response identity mismatch or absence: %j", async (identity, code) => {
    const queue = fetchQueue([response(etaPayload(identity))])
    const provider = createVesselApiVoyageProvider({ apiKey: "test-secret", fetcher: queue.fetcher, includeLastPortEvent: false })
    await expect(provider.getVoyages([vessel])).rejects.toMatchObject({ code })
  })

  it("accepts an IMO-only response when the requested IMO matches", async () => {
    const queue = fetchQueue([response(etaPayload({ mmsi: undefined }))])
    const provider = createVesselApiVoyageProvider({ apiKey: "test-secret", fetcher: queue.fetcher, includeLastPortEvent: false })
    await expect(provider.getVoyages([vessel])).resolves.toEqual([expect.objectContaining({ imo: "9162423", mmsi: "413393620" })])
  })

  it("accepts a matching MMSI-only request and rejects a mismatched MMSI", async () => {
    const matchingQueue = fetchQueue([response(etaPayload({ imo: undefined }))])
    const matchingProvider = createVesselApiVoyageProvider({ apiKey: "test-secret", fetcher: matchingQueue.fetcher, includeLastPortEvent: false })
    await expect(matchingProvider.getVoyages([{ vesselId: "mmsi-vessel", mmsi: "413393620" }])).resolves.toHaveLength(1)

    const mismatchQueue = fetchQueue([response(etaPayload({ imo: undefined, mmsi: "413393621" }))])
    const mismatchProvider = createVesselApiVoyageProvider({ apiKey: "test-secret", fetcher: mismatchQueue.fetcher, includeLastPortEvent: false })
    await expect(mismatchProvider.getVoyages([{ vesselId: "mmsi-vessel", mmsi: "413393620" }])).rejects.toMatchObject({ code: "provider_contract_changed" })
  })

  it("does not request a vessel without a legal IMO or MMSI", async () => {
    let calls = 0
    const provider = createVesselApiVoyageProvider({
      apiKey: "test-secret",
      fetcher: async () => {
        calls++
        return response(etaPayload())
      },
      includeLastPortEvent: false,
    })
    await expect(provider.getVoyages([{ vesselId: "unknown-vessel" }])).resolves.toEqual([])
    expect(calls).toBe(0)
  })

  it("fails closed for an unknown destination and does not fabricate voyage metadata", async () => {
    const queue = fetchQueue([response(etaPayload({ destination_port: "UNKNOWN" }))])
    const provider = createVesselApiVoyageProvider({
      apiKey: "test-secret",
      fetcher: queue.fetcher,
      includeLastPortEvent: false,
      portDirectory: { resolvePortIdentity: async () => undefined },
    })
    const [record] = await provider.getVoyages([vessel])
    expect(record).toMatchObject({ destinationPortId: undefined, originPortId: undefined, voyageNumber: undefined, status: "unknown" })
  })

  it("returns no observation when ETA is absent", async () => {
    const queue = fetchQueue([response({ vesselEta: null })])
    const provider = createVesselApiVoyageProvider({ apiKey: "test-secret", fetcher: queue.fetcher, includeLastPortEvent: false })
    await expect(provider.getVoyages([vessel])).resolves.toEqual([])
  })

  it.each([
    [401, "auth_failed"],
    [403, "provider_forbidden"],
    [429, "rate_limited"],
    [503, "provider_unavailable"],
  ] as const)("maps HTTP %s to %s", async (status, code) => {
    const queue = fetchQueue([response({ error: { code: "request_failed", message: "safe provider error" } }, status)])
    const provider = createVesselApiVoyageProvider({ apiKey: "test-secret", fetcher: queue.fetcher, includeLastPortEvent: false })
    await expect(provider.getVoyages([vessel])).rejects.toMatchObject({ code, status })
  })

  it("maps explicit feature_not_available to entitlement_missing", async () => {
    const queue = fetchQueue([response({ error: { code: "feature_not_available", message: "ETA is not included" } }, 403)])
    const provider = createVesselApiVoyageProvider({ apiKey: "test-secret", fetcher: queue.fetcher, includeLastPortEvent: false })
    await expect(provider.getVoyages([vessel])).rejects.toMatchObject({ code: "entitlement_missing", status: 403 })
  })

  it("maps resource_missing to no observation without falling back to Mock", async () => {
    const queue = fetchQueue([response({ error: { code: "resource_missing" } }, 404)])
    const provider = createVesselApiVoyageProvider({ apiKey: "test-secret", fetcher: queue.fetcher, includeLastPortEvent: false })
    await expect(provider.getVoyages([vessel])).resolves.toEqual([])
    expect(provider.providerId).toBe("vesselapi")
  })

  it("maps malformed successful responses to provider_contract_changed", async () => {
    const queue = fetchQueue([response({ unexpected: true })])
    const provider = createVesselApiVoyageProvider({ apiKey: "test-secret", fetcher: queue.fetcher, includeLastPortEvent: false })
    await expect(provider.getVoyages([vessel])).rejects.toMatchObject({ code: "provider_contract_changed", status: 200 })
  })

  it("does not make a network request or expose a secret when the credential is absent", async () => {
    let calls = 0
    const provider = createVesselApiVoyageProvider({
      apiKey: undefined,
      fetcher: async () => {
        calls++
        return response(etaPayload())
      },
    })
    let error: ProviderError | undefined
    try {
      await provider.getVoyages([vessel])
    } catch (value) {
      error = value as ProviderError
    }
    expect(error).toMatchObject({ code: "auth_failed" })
    expect(error?.message).not.toContain("test-secret")
    expect(calls).toBe(0)
  })

  it("uses Departure as the only event that can resolve origin", async () => {
    const departure = await normalizeVesselApiVoyageObservation({
      vessel,
      eta: { eta: "2026-09-03T08:00:00.000Z", timestamp: "2026-09-01T08:00:00.000Z", destinationPort: "PHMNL" },
      portEvent: { event: "Departure", timestamp: "2026-08-31T18:00:00.000Z", port: "CNSHK" },
      resolvePortIdentity: async value => value,
    })
    expect(departure).toMatchObject({ originPortId: "CNSHK", destinationPortId: "PHMNL", etd: undefined, voyageNumber: undefined })

    const arrival = await normalizeVesselApiVoyageObservation({
      vessel,
      eta: { eta: "2026-09-03T08:00:00.000Z", timestamp: "2026-09-01T08:00:00.000Z", destinationPort: "PHMNL" },
      portEvent: { event: "Arrival", timestamp: "2026-08-31T18:00:00.000Z", port: "CNSHK" },
      resolvePortIdentity: async value => value,
    })
    expect(arrival).toMatchObject({ originPortId: undefined, destinationPortId: "PHMNL", etd: undefined })
  })

  it("combines a valid ETA with a latest port event and ignores event 404", async () => {
    const departureQueue = fetchQueue([response(etaPayload()), response(eventPayload("Departure"))])
    const departureProvider = createVesselApiVoyageProvider({
      apiKey: "test-secret",
      fetcher: departureQueue.fetcher,
      portDirectory: { resolvePortIdentity: async value => value },
    })
    await expect(departureProvider.getVoyages([vessel])).resolves.toEqual([expect.objectContaining({ originPortId: "CNSHK" })])

    const missingEventQueue = fetchQueue([response(etaPayload()), response({ error: { code: "resource_missing" } }, 404)])
    const missingEventProvider = createVesselApiVoyageProvider({
      apiKey: "test-secret",
      fetcher: missingEventQueue.fetcher,
      portDirectory: { resolvePortIdentity: async () => undefined },
    })
    await expect(missingEventProvider.getVoyages([vessel])).resolves.toEqual([expect.objectContaining({ originPortId: undefined })])
  })

  it.each([
    [403, { error: { code: "feature_not_available", message: "Port events are not included" } }],
    [403, { error: { code: "forbidden", message: "Port events forbidden" } }],
    [500, { error: { code: "internal_error", message: "temporary" } }],
  ] as const)("preserves ETA when the optional Port Event returns %s", async (status, body) => {
    const queue = fetchQueue([response(etaPayload()), response(body, status)])
    const provider = createVesselApiVoyageProvider({ apiKey: "test-secret", fetcher: queue.fetcher })
    await expect(provider.getVoyages([vessel])).resolves.toEqual([expect.objectContaining({ source: "vesselapi", originPortId: undefined })])
  })

  it("preserves ETA when optional Port Event fails with network error or timeout", async () => {
    const networkProvider = createVesselApiVoyageProvider({
      apiKey: "test-secret",
      fetcher: async (input) => {
        if (input.includes("/eta")) return response(etaPayload())
        throw new Error("network down")
      },
    })
    await expect(networkProvider.getVoyages([vessel])).resolves.toEqual([expect.objectContaining({ source: "vesselapi", originPortId: undefined })])

    const timeoutProvider = createVesselApiVoyageProvider({
      apiKey: "test-secret",
      timeoutMs: 5,
      fetcher: async (input, init) => {
        if (input.includes("/eta")) return response(etaPayload())
        await new Promise<never>((_, reject) => init?.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true }))
        throw new Error("unreachable")
      },
    })
    await expect(timeoutProvider.getVoyages([vessel])).resolves.toEqual([expect.objectContaining({ source: "vesselapi", originPortId: undefined })])
  })

  it("fails Port Event enrichment closed for malformed or mismatched identity", async () => {
    const malformedQueue = fetchQueue([response(etaPayload()), response({ unexpected: true })])
    const malformedProvider = createVesselApiVoyageProvider({ apiKey: "test-secret", fetcher: malformedQueue.fetcher })
    await expect(malformedProvider.getVoyages([vessel])).resolves.toEqual([expect.objectContaining({ source: "vesselapi", originPortId: undefined })])

    const mismatchQueue = fetchQueue([response(etaPayload()), response(eventPayload("Departure", { vessel: { imo: "9162424", mmsi: "413393620" } }))])
    const mismatchProvider = createVesselApiVoyageProvider({ apiKey: "test-secret", fetcher: mismatchQueue.fetcher })
    await expect(mismatchProvider.getVoyages([vessel])).resolves.toEqual([expect.objectContaining({ source: "vesselapi", originPortId: undefined })])
  })

  it("keeps the ETA timestamp authoritative and requires official destination_port", async () => {
    const newerEventQueue = fetchQueue([response(etaPayload({ timestamp: "2026-09-01T08:00:00Z" })), response(eventPayload("Departure", { timestamp: "2026-09-02T08:00:00Z" }))])
    const newerEventProvider = createVesselApiVoyageProvider({ apiKey: "test-secret", fetcher: newerEventQueue.fetcher, portDirectory: { resolvePortIdentity: async value => value } })
    await expect(newerEventProvider.getVoyages([vessel])).resolves.toEqual([expect.objectContaining({ timestamp: "2026-09-01T08:00:00.000Z", lastUpdatedAt: "2026-09-01T08:00:00.000Z" })])

    const missingTimestampQueue = fetchQueue([response(etaPayload({ timestamp: undefined })), response(eventPayload("Departure"))])
    const missingTimestampProvider = createVesselApiVoyageProvider({ apiKey: "test-secret", fetcher: missingTimestampQueue.fetcher })
    await expect(missingTimestampProvider.getVoyages([vessel])).resolves.toEqual([])

    const missingDestinationQueue = fetchQueue([response(etaPayload({ destination_port: undefined }))])
    const missingDestinationProvider = createVesselApiVoyageProvider({ apiKey: "test-secret", fetcher: missingDestinationQueue.fetcher, includeLastPortEvent: false })
    await expect(missingDestinationProvider.getVoyages([vessel])).resolves.toEqual([])
  })

  it("uses a stable destination episode ID across ETA and Port Event changes", async () => {
    const first = await normalizeVesselApiVoyageObservation({
      vessel,
      eta: { eta: "2026-09-03T08:00:00.000Z", timestamp: "2026-09-01T10:00:00.000Z", destinationPort: "PHMNL", imo: "9162423", mmsi: "413393620" },
      resolvePortIdentity: async value => value,
    })
    const second = await normalizeVesselApiVoyageObservation({
      vessel,
      eta: { eta: "2026-09-04T08:00:00.000Z", timestamp: "2026-09-01T11:00:00.000Z", destinationPort: " phmnl ", imo: "9162423", mmsi: "413393620" },
      portEvent: { event: "Departure", timestamp: "2026-09-01T12:00:00.000Z", port: "CNSHK", imo: "9162423", mmsi: "413393620" },
      resolvePortIdentity: async value => value,
    })
    const otherDestination = await normalizeVesselApiVoyageObservation({
      vessel,
      eta: { eta: "2026-09-04T08:00:00.000Z", timestamp: "2026-09-01T12:00:00.000Z", destinationPort: "SGSIN", imo: "9162423", mmsi: "413393620" },
    })
    expect(first?.id).toBe("vesselapi:vessel-1:destination:PHMNL")
    expect(second?.id).toBe(first?.id)
    expect(second?.lastUpdatedAt).toBe("2026-09-01T11:00:00.000Z")
    expect(otherDestination?.id).not.toBe(first?.id)
  })
})
