import { describe, expect, it } from "vitest"
import { AISSTREAM_MAX_MMSI_PER_REQUEST, createAisStreamTrackingProvider, mapAisStreamPosition } from "#/providers/ais/aisstream-provider"
import type { AisStreamSocket } from "#/providers/ais/aisstream-provider"

function socketFor(message: unknown): { socket: AisStreamSocket, sent?: Record<string, unknown> } {
  const state: { socket: AisStreamSocket, sent?: Record<string, unknown> } = {
    socket: {
      onopen: null,
      onmessage: null,
      onerror: null,
      onclose: null,
      send: (data) => {
        state.sent = JSON.parse(data) as Record<string, unknown>
        state.socket.onmessage?.({ data: JSON.stringify(message) })
      },
      close: () => undefined,
    },
  }
  return state
}

describe("aisstream provider", () => {
  it("maps an AISStream PositionReport into the provider contract", () => {
    const position = mapAisStreamPosition({
      MessageType: "PositionReport",
      MetaData: { MMSI: 413393620, time_utc: "2026-08-24T00:00:00.000Z" },
      Message: { PositionReport: { UserID: 413393620, Latitude: 22.48, Longitude: 113.91, Sog: 12.3, Cog: 91, TrueHeading: 90, NavigationalStatus: 0 } },
    }, "2026-08-24T00:00:01.000Z")
    expect(position).toEqual({
      mmsi: "413393620",
      latitude: 22.48,
      longitude: 113.91,
      speed: 12.3,
      course: 91,
      heading: 90,
      navigationStatus: "under_way",
      timestamp: "2026-08-24T00:00:00.000Z",
      source: "aisstream",
      sourceType: "real",
    })
  })

  it("does not normalize a PositionReport without a trusted source timestamp", () => {
    expect(mapAisStreamPosition({
      MessageType: "PositionReport",
      MetaData: { MMSI: "413393620" },
      Message: { PositionReport: { UserID: "413393620", Latitude: 22.48, Longitude: 113.91 } },
    }, "2026-08-24T00:00:01.000Z")).toBeUndefined()
  })

  it("opens a bounded read, subscribes MMSI values and closes after a complete response", async () => {
    const state = socketFor({
      MessageType: "PositionReport",
      MetaData: { MMSI: "413393620", time_utc: "2026-08-24T00:00:00.000Z" },
      Message: { PositionReport: { UserID: "413393620", Latitude: 22.48, Longitude: 113.91, Sog: 12.3, Cog: 91 } },
    })
    const provider = createAisStreamTrackingProvider({
      apiKey: "test-key",
      timeoutMs: 50,
      socketFactory: () => {
        setTimeout(() => state.socket.onopen?.(), 0)
        return state.socket
      },
    })
    const positions = await provider.getLatestPositions([{ vesselId: "vessel-1", mmsi: "413393620" }])
    expect(state.sent).toMatchObject({
      APIKey: "test-key",
      BoundingBoxes: [[[-90, -180], [90, 180]]],
      FiltersShipMMSI: ["413393620"],
      FilterMessageTypes: ["PositionReport"],
    })
    expect(positions).toHaveLength(1)
    expect(positions[0]).toMatchObject({ mmsi: "413393620", latitude: 22.48, longitude: 113.91 })
  })

  it("splits watchlist MMSI values into bounded subscription batches", async () => {
    const mmsis = Array.from({ length: AISSTREAM_MAX_MMSI_PER_REQUEST + 1 }, (_, index) => String(413393620 + index))
    const sent: Array<Record<string, unknown>> = []
    const provider = createAisStreamTrackingProvider({
      apiKey: "test-key",
      timeoutMs: 50,
      socketFactory: () => {
        const socket: AisStreamSocket = {
          onopen: null,
          onmessage: null,
          onerror: null,
          onclose: null,
          send: (data) => {
            const payload = JSON.parse(data) as Record<string, unknown>
            sent.push(payload)
            for (const mmsi of payload.FiltersShipMMSI as string[]) {
              socket.onmessage?.({ data: JSON.stringify({
                MessageType: "PositionReport",
                MetaData: { MMSI: mmsi, time_utc: "2026-08-24T00:00:00.000Z" },
                Message: { PositionReport: { UserID: mmsi, Latitude: 22.48, Longitude: 113.91 } },
              }) })
            }
          },
          close: () => undefined,
        }
        setTimeout(() => socket.onopen?.(), 0)
        return socket
      },
    })
    const positions = await provider.getLatestPositions(mmsis.map((mmsi, index) => ({ vesselId: `vessel-${index}`, mmsi })))
    expect(sent).toHaveLength(2)
    expect(sent.map(payload => (payload.FiltersShipMMSI as string[]).length)).toEqual([50, 1])
    expect(sent.every(payload => JSON.stringify(payload.BoundingBoxes) === JSON.stringify([[[-90, -180], [90, 180]]]))).toBe(true)
    expect(positions).toHaveLength(51)
  })

  it("ignores a PositionReport whose MMSI is outside the watched target set", async () => {
    const state = socketFor({
      MessageType: "PositionReport",
      MetaData: { MMSI: "413393621", time_utc: "2026-08-24T00:00:00.000Z" },
      Message: { PositionReport: { UserID: "413393621", Latitude: 22.48, Longitude: 113.91 } },
    })
    const provider = createAisStreamTrackingProvider({
      apiKey: "test-key",
      timeoutMs: 20,
      socketFactory: () => {
        setTimeout(() => state.socket.onopen?.(), 0)
        return state.socket
      },
    })
    await expect(provider.getLatestPositions([{ vesselId: "vessel-1", mmsi: "413393620" }])).resolves.toEqual([])
  })

  it("rejects an AISStream protocol error with a safe error code", async () => {
    const state = socketFor({ error: "invalid API key: super-secret-key" })
    const provider = createAisStreamTrackingProvider({
      apiKey: "test-key",
      timeoutMs: 50,
      socketFactory: () => {
        setTimeout(() => state.socket.onopen?.(), 0)
        return state.socket
      },
    })
    await expect(provider.getLatestPositions([{ vesselId: "vessel-1", mmsi: "413393620" }])).rejects.toMatchObject({ message: "aisstream_auth_failed" })
  })

  it("rejects a missing API key before opening a socket", async () => {
    const provider = createAisStreamTrackingProvider({ apiKeyResolver: async () => undefined })
    await expect(provider.getLatestPositions([{ vesselId: "vessel-1", mmsi: "413393620" }])).rejects.toThrow("aisstream_api_key_missing")
  })
})
