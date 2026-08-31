import { Buffer } from "node:buffer"
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

function socketWithPayloads(payloads: Record<string, unknown>[]) {
  return {
    onopen: null as (() => void) | null,
    onmessage: null as ((event: { data: unknown }) => void) | null,
    onerror: null as ((event: unknown) => void) | null,
    onclose: null as (() => void) | null,
    closed: false,
    send() {
      for (const payload of payloads) this.onmessage?.({ data: JSON.stringify(payload) })
    },
    close() {
      this.closed = true
    },
  }
}

function socketWithData(data: unknown[]) {
  return {
    onopen: null as (() => void) | null,
    onmessage: null as ((event: { data: unknown }) => void) | null,
    onerror: null as ((event: unknown) => void) | null,
    onclose: null as (() => void) | null,
    closed: false,
    send() {
      for (const value of data) this.onmessage?.({ data: value })
    },
    close() {
      this.closed = true
    },
  }
}

function areaPosition(mmsi: string, time_utc: string, status = 1) {
  return {
    MessageType: "PositionReport",
    MetaData: { MMSI: mmsi, time_utc },
    Message: { PositionReport: { UserID: Number(mmsi), Latitude: 22.48, Longitude: 113.91, Sog: 0.2, NavigationalStatus: status } },
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

  it("fails closed on a missing key without scheduling a socket retry", async () => {
    let socketCount = 0
    const session = new AisAreaSession({ apiKeyResolver: async () => undefined, reconnectDelaysMs: [10], socketFactory: () => {
      socketCount++
      throw new Error("socket must not be created")
    } })
    await expect(session.getPortMetrics([mockPorts[0]])).rejects.toMatchObject({ name: "ProviderError", code: "auth_failed" })
    await new Promise(resolve => setTimeout(resolve, 30))
    expect(socketCount).toBe(0)
    session.close()
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

  it.each([
    ["Uint8Array", () => new TextEncoder().encode(JSON.stringify(areaPosition("477123400", "2026-08-19T00:00:00.000Z")))],
    ["ArrayBuffer", () => new TextEncoder().encode(JSON.stringify(areaPosition("477123400", "2026-08-19T00:00:00.000Z"))).buffer],
    ["Buffer", () => Buffer.from(JSON.stringify(areaPosition("477123400", "2026-08-19T00:00:00.000Z")))],
  ] as const)("decodes %s PositionReport frames through the hardened parser", async (_name, frame) => {
    const socket = socketWithData([frame()])
    const session = new AisAreaSession({ apiKey: "test-key", now: () => new Date("2026-08-19T00:00:10.000Z"), initialObservationWaitMs: 25, minimumSampleSize: 1, socketFactory: () => {
      setTimeout(() => socket.onopen?.(), 0)
      return socket
    } })
    const [metric] = await session.getPortMetrics([mockPorts[0]])
    expect(metric).toMatchObject({ sampleSize: 1, coverage: "usable", sourceUpdatedAt: "2026-08-19T00:00:00.000Z" })
    expect(session.liveStats).toMatchObject({ positionReportsReceived: 1, validPositionReports: 1, assignedPortSamples: 1, sourceTimestampPresent: 1 })
    session.close()
  })

  it("decodes Blob PositionReport and SubscriptionConfirmation frames", async () => {
    const socket = socketWithData([
      new Blob([JSON.stringify({ MessageType: "SubscriptionConfirmation" })]),
      new Blob([JSON.stringify(areaPosition("477123400", "2026-08-19T00:00:00.000Z"))]),
    ])
    const session = new AisAreaSession({ apiKey: "test-key", now: () => new Date("2026-08-19T00:00:10.000Z"), initialObservationWaitMs: 25, minimumSampleSize: 1, socketFactory: () => {
      setTimeout(() => socket.onopen?.(), 0)
      return socket
    } })
    const [metric] = await session.getPortMetrics([mockPorts[0]])
    expect(metric).toMatchObject({ sampleSize: 1, coverage: "usable" })
    expect(session.liveStats).toMatchObject({ subscriptionConfirmations: 1, positionReportsReceived: 1, assignedPortSamples: 1 })
    session.close()
  })

  it("ignores malformed binary JSON and does not create an observation", async () => {
    const socket = socketWithData([new Uint8Array([123, 34, 77, 101, 115, 115, 97, 103, 101])])
    const session = new AisAreaSession({ apiKey: "test-key", initialObservationWaitMs: 5, socketFactory: () => {
      setTimeout(() => socket.onopen?.(), 0)
      return socket
    } })
    const [metric] = await session.getPortMetrics([mockPorts[0]])
    expect(metric).toMatchObject({ sampleSize: 0, coverage: "no_observation" })
    expect(session.liveStats).toMatchObject({ positionReportsReceived: 0, validPositionReports: 0, assignedPortSamples: 0 })
    session.close()
  })

  it("enforces the shared AIS identity, coordinate, and source timestamp trust boundary", async () => {
    const invalidFrames = [
      areaPosition("12345678", "2026-08-19T00:00:00.000Z"),
      { MessageType: "PositionReport", MetaData: { MMSI: "477123400", time_utc: "2026-08-19T00:00:00.000Z" }, Message: { PositionReport: { UserID: 477123401, Latitude: 22.48, Longitude: 113.91, Sog: 0.2 } } },
      { MessageType: "PositionReport", MetaData: { MMSI: "477123400", time_utc: "2026-08-19T00:00:00.000Z" }, Message: { PositionReport: { UserID: 477123400, Latitude: 91, Longitude: 113.91, Sog: 0.2 } } },
      { MessageType: "PositionReport", MetaData: { MMSI: "477123400" }, Message: { PositionReport: { UserID: 477123400, Latitude: 22.48, Longitude: 113.91, Sog: 0.2 } } },
    ]
    const socket = socketWithData(invalidFrames.map(frame => new TextEncoder().encode(JSON.stringify(frame))))
    const session = new AisAreaSession({ apiKey: "test-key", now: () => new Date("2026-08-19T00:00:10.000Z"), initialObservationWaitMs: 25, minimumSampleSize: 1, socketFactory: () => {
      setTimeout(() => socket.onopen?.(), 0)
      return socket
    } })
    const [metric] = await session.getPortMetrics([mockPorts[0]])
    expect(metric).toMatchObject({ sampleSize: 0, coverage: "no_observation" })
    expect(session.liveStats).toMatchObject({ positionReportsReceived: 4, validPositionReports: 0, assignedPortSamples: 0, sourceTimestampPresent: 0, distinctMmsi: 0 })
    session.close()
  })

  it("maps binary protocol errors to the canonical ProviderError", async () => {
    const socket = socketWithData([new Blob([JSON.stringify({ MessageType: "Error", error: { code: "subscription_failed" } })])])
    const session = new AisAreaSession({ apiKey: "test-key", initialObservationWaitMs: 10, reconnectDelaysMs: [], socketFactory: () => {
      setTimeout(() => socket.onopen?.(), 0)
      return socket
    } })
    await expect(session.getPortMetrics([mockPorts[0]])).rejects.toMatchObject({ name: "ProviderError", code: "provider_contract_changed" })
    session.close()
  })

  it("uses the injected Port Directory coordinate for the area boundary", async () => {
    const socket = socketWithPayloads([])
    const session = new AisAreaSession({
      apiKey: "test-key",
      initialObservationWaitMs: 0,
      minimumSampleSize: 1,
      portDirectory: { getPortCoordinate: async (unlocode) => {
        expect(unlocode).toBe("CNSHK")
        return { latitude: 1.23, longitude: 4.56 }
      } },
      socketFactory: () => {
        setTimeout(() => socket.onopen?.(), 0)
        return socket
      },
    })
    await session.getPortMetrics([mockPorts[0]])
    expect(session.currentConfigs[0]).toMatchObject({ portId: "port-shekou", center: { latitude: 1.23, longitude: 4.56 } })
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

  it("marks a historical metric degraded when a healthy socket has no fresh observation", async () => {
    const socket = socketWithPayloads([])
    const session = new AisAreaSession({ apiKey: "test-key", initialObservationWaitMs: 0, socketFactory: () => {
      setTimeout(() => socket.onopen?.(), 0)
      return socket
    } })
    const previous = {
      portId: "port-shekou",
      sampleSize: 5,
      activeVesselCount: 5,
      anchoredCount: 2,
      mooredCount: 0,
      lowSpeedCount: 5,
      stationaryRatio: 0.4,
      ambiguousSampleCount: 0,
      trend: "stable" as const,
      consecutiveRisingWindows: 0,
      bbox: { south: 22, west: 113, north: 23, east: 114 },
      boundarySource: "configured_heuristic" as const,
      coverage: "usable" as const,
      lowSpeedThresholdKnots: 1,
      minimumSampleSize: 5,
      sourceUpdatedAt: "2026-08-19T00:00:00.000Z",
      updatedAt: "2026-08-19T00:00:00.000Z",
      stale: false,
      sourceStatus: "healthy" as const,
      provenance: aisstreamAreaDerivedProvenance,
      fetchedAt: "2026-08-19T00:00:01.000Z",
    }

    const [result] = await session.getPortMetrics([mockPorts[0]], [previous])
    expect(result).toMatchObject({ coverage: "stale", stale: true, sourceStatus: "degraded", error: "AIS area observations stale", sourceUpdatedAt: previous.sourceUpdatedAt })
    expect(result.errorCode).toBeUndefined()
    expect(result.fetchedAt).not.toBe(previous.fetchedAt)
    session.close()
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

  it("closes an opened socket on error and schedules exactly one reconnect", async () => {
    const sockets: ReturnType<typeof socketWithPayloads>[] = []
    const provider = createAisStreamAreaProvider({ apiKey: "test-key", initialObservationWaitMs: 0, reconnectDelaysMs: [10], socketFactory: () => {
      const socket = socketWithPayloads([])
      const close = socket.close
      socket.close = () => {
        close.call(socket)
        socket.onclose?.()
      }
      sockets.push(socket)
      setTimeout(() => socket.onopen?.(), 0)
      return socket
    } })

    await provider.getPortMetrics([mockPorts[0]])
    sockets[0].onerror?.(new Error("network unavailable"))
    expect(sockets[0].closed).toBe(true)
    await new Promise(resolve => setTimeout(resolve, 5))
    expect(sockets).toHaveLength(1)
    await new Promise(resolve => setTimeout(resolve, 30))
    expect(sockets).toHaveLength(2)
    provider.close()
  })

  it.each([
    ["auth_failed", new Error("unauthorized")],
    ["provider_contract_changed", new Error("subscription failed")],
  ] as const)("closes an opened socket without reconnecting for %s", async (_code, error) => {
    const sockets: ReturnType<typeof socketWithPayloads>[] = []
    const provider = createAisStreamAreaProvider({ apiKey: "test-key", initialObservationWaitMs: 0, reconnectDelaysMs: [10], socketFactory: () => {
      const socket = socketWithPayloads([])
      const close = socket.close
      socket.close = () => {
        close.call(socket)
        socket.onclose?.()
      }
      sockets.push(socket)
      setTimeout(() => socket.onopen?.(), 0)
      return socket
    } })

    await provider.getPortMetrics([mockPorts[0]])
    sockets[0].onerror?.(error)
    expect(sockets[0].closed).toBe(true)
    await new Promise(resolve => setTimeout(resolve, 30))
    expect(sockets).toHaveLength(1)
    provider.close()
  })

  it("stops automatic reconnects after the configured retry budget", async () => {
    const sockets: ReturnType<typeof socketWithMessage>[] = []
    const provider = createAisStreamAreaProvider({ apiKey: "test-key", initialObservationWaitMs: 0, reconnectDelaysMs: [10, 20, 30], socketFactory: () => {
      const socket = socketWithMessage()
      sockets.push(socket)
      if (sockets.length === 1) setTimeout(() => socket.onopen?.(), 0)
      else setTimeout(() => socket.onclose?.(), 0)
      return socket
    } })
    await provider.getPortMetrics([mockPorts[0]])
    sockets[0].onclose?.()

    await new Promise(resolve => setTimeout(resolve, 200))
    expect(sockets).toHaveLength(4)
    await new Promise(resolve => setTimeout(resolve, 100))
    expect(sockets).toHaveLength(4)
  })

  it("recovers when the initial socket fails and the first retry opens", async () => {
    const sockets: ReturnType<typeof socketWithMessage>[] = []
    const provider = createAisStreamAreaProvider({ apiKey: "test-key", initialObservationWaitMs: 0, reconnectDelaysMs: [10, 20], socketFactory: () => {
      const socket = socketWithMessage()
      sockets.push(socket)
      if (sockets.length === 1) setTimeout(() => socket.onclose?.(), 0)
      else setTimeout(() => socket.onopen?.(), 0)
      return socket
    } })
    await expect(provider.getPortMetrics([mockPorts[0]])).rejects.toMatchObject({ name: "ProviderError", code: "provider_unavailable" })
    await new Promise(resolve => setTimeout(resolve, 35))
    expect(sockets).toHaveLength(2)

    await expect(provider.getPortMetrics([mockPorts[0]])).resolves.toHaveLength(1)
  })

  it("starts a fresh retry cycle on a new explicit request after exhaustion", async () => {
    const sockets: ReturnType<typeof socketWithMessage>[] = []
    const provider = createAisStreamAreaProvider({ apiKey: "test-key", initialObservationWaitMs: 0, reconnectDelaysMs: [10], socketFactory: () => {
      const socket = socketWithMessage()
      sockets.push(socket)
      if (sockets.length === 1 || sockets.length === 3) setTimeout(() => socket.onopen?.(), 0)
      else setTimeout(() => socket.onclose?.(), 0)
      return socket
    } })
    await provider.getPortMetrics([mockPorts[0]])
    sockets[0].onclose?.()
    await new Promise(resolve => setTimeout(resolve, 45))
    expect(sockets).toHaveLength(2)

    await provider.getPortMetrics([mockPorts[0]])
    expect(sockets).toHaveLength(3)
  })

  it("resets the retry budget after a reconnect succeeds", async () => {
    const sockets: ReturnType<typeof socketWithMessage>[] = []
    const provider = createAisStreamAreaProvider({ apiKey: "test-key", initialObservationWaitMs: 0, reconnectDelaysMs: [10, 20], socketFactory: () => {
      const socket = socketWithMessage()
      sockets.push(socket)
      if (sockets.length <= 2) setTimeout(() => socket.onopen?.(), 0)
      else setTimeout(() => socket.onclose?.(), 0)
      return socket
    } })
    await provider.getPortMetrics([mockPorts[0]])
    sockets[0].onclose?.()
    await new Promise(resolve => setTimeout(resolve, 35))
    expect(sockets).toHaveLength(2)

    sockets[1].onclose?.()
    await new Promise(resolve => setTimeout(resolve, 80))
    expect(sockets).toHaveLength(4)
  })

  it("does not reset retry backoff on an open without a valid PositionReport", async () => {
    const sockets: ReturnType<typeof socketWithPayloads>[] = []
    const provider = createAisStreamAreaProvider({ apiKey: "test-key", initialObservationWaitMs: 0, reconnectDelaysMs: [10, 20], socketFactory: () => {
      const socket = socketWithPayloads([])
      sockets.push(socket)
      setTimeout(() => socket.onopen?.(), 0)
      return socket
    } })
    await provider.getPortMetrics([mockPorts[0]])
    sockets[0].onclose?.()
    await new Promise(resolve => setTimeout(resolve, 30))
    expect(sockets).toHaveLength(2)
    sockets[1].onclose?.()
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(sockets).toHaveLength(2)
    await new Promise(resolve => setTimeout(resolve, 30))
    expect(sockets).toHaveLength(3)
    provider.close()
  })

  it("ignores a Blob that finishes decoding after the session closes", async () => {
    let release!: () => void
    const blob = new Blob(["unused"])
    Object.defineProperty(blob, "text", { value: async () => await new Promise<string>((resolve) => {
      release = () => resolve(JSON.stringify(areaPosition("477123400", "2026-08-19T00:00:00.000Z")))
    }) })
    const socket = socketWithData([blob])
    const session = new AisAreaSession({ apiKey: "test-key", initialObservationWaitMs: 0, socketFactory: () => {
      setTimeout(() => socket.onopen?.(), 0)
      return socket
    } })
    await session.getPortMetrics([mockPorts[0]])
    session.close()
    release()
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(session.observationCount).toBe(0)
  })

  it("assigns a delayed frame to the config captured at arrival despite a later config", async () => {
    let release!: () => void
    let sends = 0
    const blob = new Blob(["unused"])
    Object.defineProperty(blob, "text", { value: async () => await new Promise<string>((resolve) => {
      release = () => resolve(JSON.stringify(areaPosition("477123400", "2026-08-19T00:00:00.000Z")))
    }) })
    const socket = socketWithData([blob])
    const originalSend = socket.send
    socket.send = () => {
      sends++
      if (sends === 1) originalSend.call(socket)
    }
    const session = new AisAreaSession({ apiKey: "test-key", now: () => new Date("2026-08-19T00:00:10.000Z"), initialObservationWaitMs: 1_100, minimumSampleSize: 1, socketFactory: () => {
      setTimeout(() => socket.onopen?.(), 0)
      return socket
    } })
    const first = session.getPortMetrics([mockPorts[0]])
    await new Promise(resolve => setTimeout(resolve, 1_050))
    const second = session.getPortMetrics([mockPorts[1]])
    release()
    const [firstMetric] = await first
    const [secondMetric] = await second
    expect(firstMetric).toMatchObject({ portId: mockPorts[0].id, sampleSize: 1, coverage: "usable" })
    expect(secondMetric).toMatchObject({ portId: mockPorts[1].id, sampleSize: 0, coverage: "no_observation" })
    session.close()
  })

  it("cancels a pending reconnect when the session closes", async () => {
    const sockets: ReturnType<typeof socketWithMessage>[] = []
    const session = new AisAreaSession({ apiKey: "test-key", initialObservationWaitMs: 0, reconnectDelaysMs: [30], socketFactory: () => {
      const socket = socketWithMessage()
      sockets.push(socket)
      setTimeout(() => socket.onopen?.(), 0)
      return socket
    } })
    await session.getPortMetrics([mockPorts[0]])
    sockets[0].onclose?.()
    session.close()

    await new Promise(resolve => setTimeout(resolve, 60))
    expect(sockets).toHaveLength(1)
    expect(session.currentConfigs).toEqual([])
  })

  it("prunes expired observations from the Map while retaining fresh ones", async () => {
    let now = new Date("2026-08-19T00:00:10.000Z")
    const socket = socketWithMessage()
    const session = new AisAreaSession({ apiKey: "test-key", now: () => now, initialObservationWaitMs: 0, minimumSampleSize: 1, socketFactory: () => {
      setTimeout(() => socket.onopen?.(), 0)
      return socket
    } })
    await session.getPortMetrics([mockPorts[0]])
    expect(session.observationCount).toBe(1)
    now = new Date("2026-08-19T00:05:00.000Z")
    await session.getPortMetrics([mockPorts[0]])
    expect(session.observationCount).toBe(1)
    now = new Date("2026-08-19T00:16:00.000Z")
    const stale = await session.getPortMetrics([mockPorts[0]])
    expect(session.observationCount).toBe(0)
    expect(stale[0]).toMatchObject({ sourceStatus: "degraded", coverage: "stale", stale: true, error: "AIS area observations stale", sourceUpdatedAt: "2026-08-19T00:00:00.000Z" })
    expect(stale[0].errorCode).toBeUndefined()
  })

  it("reports never_succeeded when the first connected window has no valid observation", async () => {
    const socket = socketWithPayloads([])
    const session = new AisAreaSession({ apiKey: "test-key", initialObservationWaitMs: 0, minimumSampleSize: 1, socketFactory: () => {
      setTimeout(() => socket.onopen?.(), 0)
      return socket
    } })
    const [metric] = await session.getPortMetrics([mockPorts[0]])
    expect(metric).toMatchObject({ sourceStatus: "never_succeeded", coverage: "no_observation", stale: true })
    expect(session.liveStats).toMatchObject({ socketOpened: 1, subscriptionsSent: 1, positionReportsReceived: 0, validPositionReports: 0, distinctMmsi: 0 })
  })

  it("enforces the observation hard cap and replaces the same MMSI", async () => {
    const socket = socketWithPayloads([
      areaPosition("477123400", "2026-08-19T00:00:00.000Z"),
      areaPosition("477123401", "2026-08-19T00:01:00.000Z"),
      areaPosition("477123402", "2026-08-19T00:02:00.000Z"),
      areaPosition("477123402", "2026-08-19T00:03:00.000Z", 0),
    ])
    const session = new AisAreaSession({ apiKey: "test-key", now: () => new Date("2026-08-19T00:04:00.000Z"), initialObservationWaitMs: 0, minimumSampleSize: 1, maxObservations: 2, socketFactory: () => {
      setTimeout(() => socket.onopen?.(), 0)
      return socket
    } })
    const [metric] = await session.getPortMetrics([mockPorts[0]])
    expect(session.observationCount).toBe(2)
    expect(metric.sampleSize).toBe(2)
    expect(metric.observationWindow?.startAt).toBe("2026-08-19T00:01:00.000Z")
    expect(session.liveStats).toMatchObject({ socketOpened: 1, subscriptionsSent: 1, subscriptionBboxCount: 1, positionReportsReceived: 4, validPositionReports: 4, assignedPortSamples: 4, sourceTimestampPresent: 4, distinctMmsi: 2 })
  })
})
