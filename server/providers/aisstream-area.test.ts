import { describe, expect, it } from "vitest"
import { mockPorts } from "@shared/shipping-fixtures"
import { AisAreaSession, aisAreaSubscription, aisstreamAreaDerivedProvenance, createAisStreamAreaProvider } from "./aisstream-area"

function socketWithMessage() {
  return {
    onopen: null as (() => void) | null,
    onmessage: null as ((event: { data: unknown }) => void) | null,
    onerror: null as ((event: unknown) => void) | null,
    onclose: null as (() => void) | null,
    sent: [] as Record<string, unknown>[],
    closed: false,
    send(value: string) {
      this.sent.push(JSON.parse(value))
      this.onmessage?.({ data: JSON.stringify({
        MessageType: "PositionReport",
        MetaData: { MMSI: "477123400", time_utc: "2026-08-19T00:00:00.000Z" },
        Message: { PositionReport: { UserID: 477123400, Latitude: 22.48, Longitude: 113.91, Sog: 0.2, NavigationalStatus: 1 } },
      }) })
    },
    close() {
      this.closed = true
    },
  }
}

describe("area stream boundary", () => {
  it("does not create a socket without watched ports", async () => {
    let socketCount = 0
    const provider = createAisStreamAreaProvider({ apiKey: "test-key", socketFactory: () => {
      socketCount++
      throw new Error("should not connect")
    } })
    expect(await provider.getPortMetrics([mockPorts.find(port => !port.isWatched)!])).toEqual([])
    expect(socketCount).toBe(0)
  })

  it("uses only small watched-port boxes and never sends FiltersShipMMSI", async () => {
    const socket = socketWithMessage()
    let socketCount = 0
    const provider = createAisStreamAreaProvider({ apiKey: "test-key", now: () => new Date("2026-08-19T00:00:10.000Z"), initialObservationWaitMs: 0, minimumSampleSize: 1, socketFactory: () => {
      socketCount++
      setTimeout(() => socket.onopen?.(), 0)
      return socket
    } })
    const metrics = await provider.getPortMetrics([mockPorts[0], mockPorts[1]])
    expect(socketCount).toBe(1)
    expect(socket.sent[0]).toMatchObject({ FilterMessageTypes: ["PositionReport"] })
    expect(socket.sent[0]).not.toHaveProperty("FiltersShipMMSI")
    expect((socket.sent[0].BoundingBoxes as unknown[]).length).toBe(2)
    expect(metrics[0]).toMatchObject({ portId: "port-shekou", sampleSize: 1, coverage: "usable", provenance: aisstreamAreaDerivedProvenance })
    expect(metrics[0]).not.toHaveProperty("waitingHours")
  })

  it("ignores malformed and non-position messages, and preserves same-source last-known only on failure", async () => {
    const session = new AisAreaSession({ apiKey: "test-key", initialObservationWaitMs: 0, socketFactory: () => {
      throw new Error("network unavailable")
    } })
    const previous = {
      portId: "port-shekou",
      sampleSize: 5,
      activeVesselCount: 5,
      anchoredCount: 5,
      mooredCount: 0,
      lowSpeedCount: 5,
      stationaryRatio: 1,
      ambiguousSampleCount: 0,
      trend: "stable" as const,
      consecutiveRisingWindows: 0,
      bbox: { south: 22, west: 113, north: 23, east: 114 },
      boundarySource: "configured_heuristic" as const,
      coverage: "usable" as const,
      lowSpeedThresholdKnots: 1,
      minimumSampleSize: 5,
      stale: false,
      sourceStatus: "healthy" as const,
      provenance: aisstreamAreaDerivedProvenance,
      fetchedAt: "2026-08-19T00:00:00.000Z",
    }
    const result = await session.getPortMetrics([mockPorts[0]], [previous])
    expect(result[0]).toMatchObject({ portId: "port-shekou", stale: true, sourceStatus: "failed", coverage: "stale", provenance: aisstreamAreaDerivedProvenance })
  })

  it("keeps watched AIS subscriptions separate from area subscriptions", () => {
    const payload = aisAreaSubscription("test-key", [])
    expect(payload).toEqual({ APIKey: "test-key", BoundingBoxes: [], FilterMessageTypes: ["PositionReport"] })
    expect(payload).not.toHaveProperty("FiltersShipMMSI")
  })

  it("reuses the session socket and debounces a subscription replacement", async () => {
    const socket = socketWithMessage()
    let socketCount = 0
    const provider = createAisStreamAreaProvider({ apiKey: "test-key", now: () => new Date("2026-08-19T00:00:10.000Z"), initialObservationWaitMs: 0, minimumSampleSize: 1, socketFactory: () => {
      socketCount++
      setTimeout(() => socket.onopen?.(), 0)
      return socket
    } })
    await provider.getPortMetrics([mockPorts[0]])
    await provider.getPortMetrics([mockPorts[0]])
    expect(socketCount).toBe(1)
    expect(socket.sent).toHaveLength(1)
    await provider.getPortMetrics([mockPorts[1]])
    await new Promise(resolve => setTimeout(resolve, 50))
    expect(socket.sent).toHaveLength(1)
    await new Promise(resolve => setTimeout(resolve, 1050))
    expect(socket.sent).toHaveLength(2)
  })

  it("reconnects with finite backoff and closes after idle", async () => {
    const sockets: ReturnType<typeof socketWithMessage>[] = []
    const provider = createAisStreamAreaProvider({ apiKey: "test-key", now: () => new Date("2026-08-19T00:00:10.000Z"), initialObservationWaitMs: 0, minimumSampleSize: 1, reconnectDelaysMs: [20], idleCloseMs: 100, socketFactory: () => {
      const socket = socketWithMessage()
      sockets.push(socket)
      setTimeout(() => socket.onopen?.(), 0)
      return socket
    } })
    await provider.getPortMetrics([mockPorts[0]])
    sockets[0].onclose?.()
    await new Promise(resolve => setTimeout(resolve, 5))
    expect(sockets).toHaveLength(1)
    await new Promise(resolve => setTimeout(resolve, 35))
    expect(sockets).toHaveLength(2)
    await new Promise(resolve => setTimeout(resolve, 120))
    expect(sockets[1].closed).toBe(true)
  })
})
