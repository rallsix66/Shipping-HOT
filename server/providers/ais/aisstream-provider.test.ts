import { describe, expect, it } from "vitest"
import { type AisStreamSocket, createAisStreamTrackingProvider, mapAisStreamPosition } from "#/providers/ais/aisstream-provider"

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
    expect(state.sent).toMatchObject({ APIKey: "test-key", FiltersShipMMSI: ["413393620"], FilterMessageTypes: ["PositionReport"] })
    expect(positions).toHaveLength(1)
    expect(positions[0]).toMatchObject({ mmsi: "413393620", latitude: 22.48, longitude: 113.91 })
  })

  it("rejects a missing API key before opening a socket", async () => {
    const provider = createAisStreamTrackingProvider({ apiKeyResolver: async () => undefined })
    await expect(provider.getLatestPositions([{ vesselId: "vessel-1", mmsi: "413393620" }])).rejects.toThrow("aisstream_api_key_missing")
  })
})
