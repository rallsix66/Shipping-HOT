import { describe, expect, it } from "vitest"
import { mockPorts, mockVessels } from "@shared/shipping-fixtures"
import type { FeedItem, Vessel } from "@shared/shipping"
import { detectShippingEvents } from "@shared/shipping-engine"
import { mergeWeatherFeedItems } from "../shipping-store"
import { configureProviders, createAisStreamVesselProvider, createOpenMeteoWeatherProvider, disabledProviderData, normalizeProviderTimestamp, providerResult } from "./shipping"

describe("shipping Provider failure boundaries", () => {
  it("includes all eight V1 focus ports in the seed", () => {
    expect(mockPorts.map(port => port.unlocode).sort()).toEqual([
      "CNSHK",
      "CNYTN",
      "CNNSA",
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

  it("uses Mock when AISStream is selected without an API key", () => {
    const configured = configureProviders({ SHIPPING_VESSEL_PROVIDER: "aisstream" })
    expect(configured.modes.vessel).toBe("mock")
    expect(configured.providers.vessel).not.toBeUndefined()
  })

  it("does not query or erase watched vessels that have no MMSI", async () => {
    const vesselWithoutMmsi = { ...mockVessels[0], mmsi: undefined }
    const result = await createAisStreamVesselProvider({
      apiKey: "test-key",
      socketFactory: () => {
        throw new Error("socket should not be created")
      },
    }).getVessels([vesselWithoutMmsi])
    expect(result[0]).toMatchObject({ id: vesselWithoutMmsi.id, stale: true, sourceStatus: "degraded" })
  })

  it("normalizes the official MetaData payload and preserves a mixed vessel list", async () => {
    let subscription: Record<string, unknown> | undefined
    const socket = {
      onopen: null as (() => void) | null,
      onmessage: null as ((event: { data: unknown }) => void) | null,
      onerror: null as ((event: unknown) => void) | null,
      onclose: null as (() => void) | null,
      send(value: string) {
        subscription = JSON.parse(value)
        this.onmessage?.({ data: JSON.stringify({
          MessageType: "PositionReport",
          MetaData: { MMSI: "477123400", ShipName: "EVER GLORY", time_utc: "2026-08-13T09:00:00.000Z" },
          Message: { PositionReport: { UserID: 477123400, Latitude: 22.3, Longitude: 114.2, Sog: 4.5, Cog: 180, NavigationalStatus: 0 } },
        }) })
        this.onmessage?.({ data: JSON.stringify({
          MessageType: "PositionReport",
          MetaData: { MMSI: "219876500", ShipName: "MAERSK SALTORO", time_utc: "2026-08-13T09:00:00.000Z" },
          Message: { PositionReport: { UserID: 219876500, Latitude: 14.6, Longitude: 121, Sog: 12, Cog: 42, NavigationalStatus: 0 } },
        }) })
      },
      close() {},
    }
    const result = await createAisStreamVesselProvider({ apiKey: "test-key", timeoutMs: 100, socketFactory: () => {
      setTimeout(() => socket.onopen?.(), 0)
      return socket
    } }).getVessels([mockVessels[0], { ...mockVessels[1], mmsi: undefined }, mockVessels[2]])
    expect(subscription?.FiltersShipMMSI).toEqual(["477123400"])
    expect(result).toHaveLength(3)
    expect(result.find(vessel => vessel.id === "vessel-ever-glory")).toMatchObject({ name: "EVER GLORY", latitude: 22.3, speed: 4.5, sourceStatus: "healthy", updatedAt: "2026-08-13T09:00:00.000Z" })
    expect(result.find(vessel => vessel.id === "vessel-maersk-saltoro")).toMatchObject({ stale: true, sourceStatus: "degraded", error: "MMSI unavailable for real vessel lookup" })
    expect(result.find(vessel => vessel.id === "vessel-cosco-harmony")).toMatchObject({ sourceStatus: "degraded" })
  })

  it("keeps partial AIS success and degrades only vessels without an update", async () => {
    const socket = {
      onopen: null as (() => void) | null,
      onmessage: null as ((event: { data: unknown }) => void) | null,
      onerror: null as ((event: unknown) => void) | null,
      onclose: null as (() => void) | null,
      send() {
        this.onmessage?.({ data: JSON.stringify({
          MessageType: "PositionReport",
          MetaData: { MMSI: "477123400", ShipName: "EVER GLORY", time_utc: "2026-08-13T09:00:00.000Z" },
          Message: { PositionReport: { UserID: 477123400, Latitude: 22.3, Longitude: 114.2 } },
        }) })
      },
      close() {},
    }
    const result = await createAisStreamVesselProvider({ apiKey: "test-key", timeoutMs: 20, socketFactory: () => {
      setTimeout(() => socket.onopen?.(), 0)
      return socket
    } }).getVessels([mockVessels[0], mockVessels[2], { ...mockVessels[1], isWatched: false }])
    expect(result).toHaveLength(3)
    expect(result.find(vessel => vessel.id === "vessel-ever-glory")).toMatchObject({ latitude: 22.3, longitude: 114.2, stale: false, sourceStatus: "healthy" })
    expect(result.find(vessel => vessel.id === "vessel-cosco-harmony")).toMatchObject({ stale: true, sourceStatus: "degraded" })
    expect(result.find(vessel => vessel.id === "vessel-maersk-saltoro")).toEqual({ ...mockVessels[1], isWatched: false })
  })

  it("rejects when no watched MMSI receives an AIS position", async () => {
    const provider = createAisStreamVesselProvider({ apiKey: "test-key", timeoutMs: 20, socketFactory: () => {
      const socket = {
        onopen: null as (() => void) | null,
        onmessage: null as ((event: { data: unknown }) => void) | null,
        onerror: null as ((event: unknown) => void) | null,
        onclose: null as (() => void) | null,
        send() {},
        close() {},
      }
      setTimeout(() => socket.onopen?.(), 0)
      return socket
    } })
    await expect(provider.getVessels([mockVessels[0]])).rejects.toThrow("timed out")
  })

  it("uses PositionReport.UserID fallback when MetaData is missing", async () => {
    const result = await createAisStreamVesselProvider({ apiKey: "test-key", timeoutMs: 100, socketFactory: () => {
      const socket = {
        onopen: null as (() => void) | null,
        onmessage: null as ((event: { data: unknown }) => void) | null,
        onerror: null as ((event: unknown) => void) | null,
        onclose: null as (() => void) | null,
        send() {
          this.onmessage?.({ data: JSON.stringify({ MessageType: "PositionReport", Message: { PositionReport: { UserID: 477123400, Latitude: 22.3, Longitude: 114.2 } } }) })
        },
        close() {},
      }
      setTimeout(() => socket.onopen?.(), 0)
      return socket
    } }).getVessels([mockVessels[0]])
    expect(result[0]).toMatchObject({ mmsi: "477123400", name: "EVER GLORY", updatedAt: undefined, stale: true, sourceStatus: "degraded" })
  })

  it("normalizes Open-Meteo warning and keeps normal weather quiet", async () => {
    const fetcher = async (url: string) => ({
      ok: true,
      status: 200,
      async json() {
        return url.includes("marine-api")
          ? { current: { time: "2026-08-13T09:00:00.000Z", wave_height: 3 } }
          : { current: { time: "2026-08-13T09:00:00.000Z", wind_speed_10m: 20, wind_gusts_10m: 25 } }
      },
    })
    const provider = createOpenMeteoWeatherProvider({ fetcher })
    const warning = await provider.getFeedItems([mockPorts[0]])
    expect(warning[0]).toMatchObject({ severity: "warning", relatedPortIds: ["port-shekou"], sourceStatus: "healthy" })

    const normalProvider = createOpenMeteoWeatherProvider({ fetcher: async (_url: string) => ({
      ok: true,
      status: 200,
      async json() {
        return { current: { time: "2026-08-13T09:00:00.000Z", wave_height: 0.5, wind_speed_10m: 10, wind_gusts_10m: 15 } }
      },
    }) })
    expect(await normalProvider.getFeedItems([mockPorts[0]])).toEqual([])
  })

  it("normalizes Open-Meteo unix timestamps without local timezone drift", async () => {
    const unixTime = Math.floor(Date.parse("2026-08-13T09:00:00.000Z") / 1000)
    const provider = createOpenMeteoWeatherProvider({ fetcher: async (url: string) => ({
      ok: true,
      status: 200,
      async json() {
        return url.includes("marine-api")
          ? { current: { time: unixTime, wave_height: 3 } }
          : { current: { time: unixTime, wind_speed_10m: 20, wind_gusts_10m: 25 } }
      },
    }) })
    expect(await provider.getFeedItems([mockPorts[0]])).toMatchObject([{ publishedAt: "2026-08-13T09:00:00.000Z", updatedAt: "2026-08-13T09:00:00.000Z" }])
    expect(normalizeProviderTimestamp("2026-08-13T09:00")).toBeUndefined()
  })

  it("replaces only weather FeedItems and isolates weather failures", () => {
    const nonWeather: FeedItem = { id: "port-notice", sourceId: "mock-port-notice", category: "port_notice", type: "port_disruption", title: "Port notice", summary: "Notice", sourceUrl: "https://example.com/port", publishedAt: "2026-08-13T09:00:00.000Z", severity: "warning", relatedPortIds: ["port-shekou"], relatedVesselIds: [], relatedVoyageIds: [], stale: false, sourceStatus: "healthy" }
    const oldWeather: FeedItem = { ...nonWeather, id: "old-weather", sourceId: "open-meteo-marine", category: "weather", type: "weather_risk", title: "Old weather", relatedPortIds: ["port-shekou"] }
    const newWeather: FeedItem = { ...oldWeather, id: "new-weather", title: "New weather" }
    const replaced = mergeWeatherFeedItems([nonWeather, oldWeather], [newWeather])
    expect(replaced).toEqual([nonWeather, newWeather])

    const failedWeather = providerResult<FeedItem>({ status: "rejected", reason: new Error("weather outage") }, [oldWeather])
    expect(mergeWeatherFeedItems([nonWeather, oldWeather], failedWeather)).toEqual([nonWeather, expect.objectContaining({ id: "old-weather", stale: true, sourceStatus: "failed" })])
  })

  it("marks malformed and HTTP-failed weather responses as provider failures", async () => {
    const malformed = createOpenMeteoWeatherProvider({ fetcher: async () => ({
      ok: true,
      status: 200,
      async json() {
        return {}
      },
    }) })
    await expect(malformed.getFeedItems([mockPorts[0]])).rejects.toThrow("malformed")
    const failed = createOpenMeteoWeatherProvider({ fetcher: async () => ({
      ok: false,
      status: 503,
      async json() {
        return {}
      },
    }) })
    await expect(failed.getFeedItems([mockPorts[0]])).rejects.toThrow("503")
  })

  it("feeds normalized real vessel and weather signals into the existing Event/HOT pipeline", async () => {
    const vessel = (await createAisStreamVesselProvider({ apiKey: "test-key", timeoutMs: 100, socketFactory: () => {
      const socket = {
        onopen: null as (() => void) | null,
        onmessage: null as ((event: { data: unknown }) => void) | null,
        onerror: null as ((event: unknown) => void) | null,
        onclose: null as (() => void) | null,
        send() {
          this.onmessage?.({ data: JSON.stringify({ MessageType: "PositionReport", MetaData: { MMSI: "477123400", ShipName: "EVER GLORY", time_utc: "2026-08-13T09:00:00.000Z" }, Message: { PositionReport: { UserID: 477123400, Latitude: 22.3, Longitude: 114.2, Sog: 0, Cog: 0, NavigationalStatus: 1 } } }) })
        },
        close() {},
      }
      setTimeout(() => socket.onopen?.(), 0)
      return socket
    } }).getVessels([mockVessels[0]])).find(item => item.id === "vessel-ever-glory")!
    const weather = (await createOpenMeteoWeatherProvider({ fetcher: async (url: string) => ({
      ok: true,
      status: 200,
      async json() {
        return url.includes("marine-api")
          ? { current: { time: "2026-08-13T09:00:00.000Z", wave_height: 5 } }
          : { current: { time: "2026-08-13T09:00:00.000Z", wind_speed_10m: 20, wind_gusts_10m: 25 } }
      },
    }) }).getFeedItems([mockPorts[0]]))[0]
    const snapshot = { ...structuredClone({ vessels: mockVessels, ports: mockPorts, voyages: [], feedItems: [] }), vessels: [{ ...vessel, statusChangedAt: "2026-08-13T07:00:00.000Z" }], feedItems: [weather] }
    const events = detectShippingEvents(snapshot.vessels, snapshot.ports, snapshot.voyages, snapshot.feedItems, { ...({ refreshInterval: 15, sourceEnabled: true, providerEnabled: true, retentionDays: 30 } as const), eventThresholds: { anchoredHours: 2, delayMinutes: 60, congestionLevel: "high" as const } }, [], "2026-08-13T10:00:00.000Z")
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "vessel_anchored", vesselId: "vessel-ever-glory" }),
      expect.objectContaining({ type: "weather_risk", feedItemId: "weather-port-shekou" }),
    ]))
  })
})
