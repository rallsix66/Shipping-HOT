import { Buffer } from "node:buffer"
import { describe, expect, it, vi } from "vitest"
import { AISSTREAM_MAX_MMSI_PER_REQUEST, createAisStreamTrackingProvider, mapAisStreamPosition } from "#/providers/ais/aisstream-provider"
import type { AisStreamProviderOptions, AisStreamSocket } from "#/providers/ais/aisstream-provider"

function socketForFrames(frames: readonly unknown[]): { socket: AisStreamSocket, sent?: Record<string, unknown> } {
  const state: { socket: AisStreamSocket, sent?: Record<string, unknown> } = {
    socket: {
      onopen: null,
      onmessage: null,
      onerror: null,
      onclose: null,
      send: (data) => {
        state.sent = JSON.parse(data) as Record<string, unknown>
        for (const frame of frames) state.socket.onmessage?.({ data: frame })
      },
      close: () => undefined,
    },
  }
  return state
}

function socketFor(message: unknown): { socket: AisStreamSocket, sent?: Record<string, unknown> } {
  return socketForFrames([JSON.stringify(message)])
}

function utf8(message: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(message))
}

const positionReportMessage = {
  MessageType: "PositionReport",
  MetaData: { MMSI: "413393620", time_utc: "2026-08-24T00:00:00.000Z" },
  Message: { PositionReport: { UserID: "413393620", Latitude: 22.48, Longitude: 113.91 } },
}

type TimingOptions = Pick<AisStreamProviderOptions, "connectionTimeoutMs" | "observationWindowMs" | "timeoutMs">

function providerForFrames(frames: readonly unknown[], options: TimingOptions = {}): { provider: ReturnType<typeof createAisStreamTrackingProvider>, state: ReturnType<typeof socketForFrames> } {
  const state = socketForFrames(frames)
  const provider = createAisStreamTrackingProvider({
    apiKey: "test-key",
    ...options,
    socketFactory: () => {
      setTimeout(() => state.socket.onopen?.(), 0)
      return state.socket
    },
  })
  return { provider, state }
}

function providerForSchedule(schedule: (socket: AisStreamSocket) => void, options: TimingOptions = {}): { provider: ReturnType<typeof createAisStreamTrackingProvider>, state: ReturnType<typeof socketForFrames> } {
  const state = socketForFrames([])
  state.socket.send = (data) => {
    state.sent = JSON.parse(data) as Record<string, unknown>
    schedule(state.socket)
  }
  const provider = createAisStreamTrackingProvider({
    apiKey: "test-key",
    ...options,
    socketFactory: () => {
      setTimeout(() => state.socket.onopen?.(), 0)
      return state.socket
    },
  })
  return { provider, state }
}

function positionMessage(mmsi: string): Record<string, unknown> {
  return {
    MessageType: "PositionReport",
    MetaData: { MMSI: mmsi, time_utc: "2026-08-24T00:00:00.000Z" },
    Message: { PositionReport: { UserID: mmsi, Latitude: 22.48, Longitude: 113.91 } },
  }
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

  it("rejects when the socket does not open before the connection timeout", async () => {
    vi.useFakeTimers()
    try {
      const socket: AisStreamSocket = { onopen: null, onmessage: null, onerror: null, onclose: null, send: () => undefined, close: () => undefined }
      const provider = createAisStreamTrackingProvider({ apiKey: "test-key", connectionTimeoutMs: 25, observationWindowMs: 50, socketFactory: () => socket })
      const pending = provider.getLatestPositions([{ vesselId: "vessel-1", mmsi: "413393620" }])
      const expectation = expect(pending).rejects.toMatchObject({ code: "provider_timeout", message: "aisstream_timeout" })
      await vi.advanceTimersByTimeAsync(24)
      await vi.advanceTimersByTimeAsync(1)
      await expectation
    } finally {
      vi.useRealTimers()
    }
  })

  it("resolves an empty result only after the observation window", async () => {
    vi.useFakeTimers()
    try {
      const { provider } = providerForFrames([], { connectionTimeoutMs: 5, observationWindowMs: 25 })
      const pending = provider.getLatestPositions([{ vesselId: "vessel-1", mmsi: "413393620" }])
      let settled = false
      void pending.then(
        () => {
          settled = true
        },
        () => {
          settled = true
        },
      )
      await vi.advanceTimersByTimeAsync(24)
      expect(settled).toBe(false)
      await vi.advanceTimersByTimeAsync(1)
      await expect(pending).resolves.toEqual([])
    } finally {
      vi.useRealTimers()
    }
  })

  it("decodes a Uint8Array UTF-8 PositionReport frame", async () => {
    const { provider } = providerForFrames([utf8(positionReportMessage)])
    await expect(provider.getLatestPositions([{ vesselId: "vessel-1", mmsi: "413393620" }])).resolves.toMatchObject([
      { mmsi: "413393620", latitude: 22.48, longitude: 113.91, source: "aisstream", sourceType: "real" },
    ])
  })

  it("decodes an ArrayBuffer UTF-8 PositionReport frame", async () => {
    const { provider } = providerForFrames([utf8(positionReportMessage).buffer])
    await expect(provider.getLatestPositions([{ vesselId: "vessel-1", mmsi: "413393620" }])).resolves.toMatchObject([
      { mmsi: "413393620", latitude: 22.48, longitude: 113.91 },
    ])
  })

  it("decodes a Node Buffer UTF-8 PositionReport frame", async () => {
    const { provider } = providerForFrames([Buffer.from(JSON.stringify(positionReportMessage))])
    await expect(provider.getLatestPositions([{ vesselId: "vessel-1", mmsi: "413393620" }])).resolves.toMatchObject([
      { mmsi: "413393620", latitude: 22.48, longitude: 113.91 },
    ])
  })

  it("decodes a Blob UTF-8 PositionReport frame when Blob is available", async () => {
    if (typeof Blob === "undefined") return
    const { provider } = providerForFrames([new Blob([JSON.stringify(positionReportMessage)])])
    await expect(provider.getLatestPositions([{ vesselId: "vessel-1", mmsi: "413393620" }])).resolves.toMatchObject([
      { mmsi: "413393620", latitude: 22.48, longitude: 113.91 },
    ])
  })

  it("waits through SubscriptionConfirmation and resolves [] at the observation deadline", async () => {
    vi.useFakeTimers()
    try {
      const { provider } = providerForFrames([utf8({ MessageType: "SubscriptionConfirmation" })], { connectionTimeoutMs: 5, observationWindowMs: 25 })
      const pending = provider.getLatestPositions([{ vesselId: "vessel-1", mmsi: "413393620" }])
      let settled = false
      void pending.then(
        () => {
          settled = true
        },
        () => {
          settled = true
        },
      )
      await vi.advanceTimersByTimeAsync(24)
      expect(settled).toBe(false)
      await vi.advanceTimersByTimeAsync(1)
      await expect(pending).resolves.toEqual([])
    } finally {
      vi.useRealTimers()
    }
  })

  it("fails closed for malformed binary JSON without creating a position", async () => {
    const { provider } = providerForFrames([new Uint8Array([0x7B, 0x6E, 0x6F, 0x74, 0x2D, 0x6A, 0x73, 0x6F, 0x6E])], { timeoutMs: 20 })
    await expect(provider.getLatestPositions([{ vesselId: "vessel-1", mmsi: "413393620" }])).resolves.toEqual([])
  })

  it("returns a single observed target without waiting for the full observation window", async () => {
    vi.useFakeTimers()
    try {
      const { provider } = providerForSchedule((socket) => {
        setTimeout(() => socket.onmessage?.({ data: JSON.stringify(positionMessage("413393620")) }), 10)
      }, { connectionTimeoutMs: 5, observationWindowMs: 30_000 })
      const pending = provider.getLatestPositions([{ vesselId: "vessel-1", mmsi: "413393620" }])
      await vi.advanceTimersByTimeAsync(10)
      await expect(pending).resolves.toMatchObject([{ mmsi: "413393620" }])
    } finally {
      vi.useRealTimers()
    }
  })

  it("returns partial observations when the window expires", async () => {
    vi.useFakeTimers()
    try {
      const { provider } = providerForSchedule((socket) => {
        setTimeout(() => socket.onmessage?.({ data: JSON.stringify(positionMessage("413393620")) }), 10)
      }, { connectionTimeoutMs: 5, observationWindowMs: 25 })
      const pending = provider.getLatestPositions([
        { vesselId: "vessel-1", mmsi: "413393620" },
        { vesselId: "vessel-2", mmsi: "413393621" },
      ])
      await vi.advanceTimersByTimeAsync(24)
      await vi.advanceTimersByTimeAsync(1)
      await expect(pending).resolves.toMatchObject([{ mmsi: "413393620" }])
    } finally {
      vi.useRealTimers()
    }
  })

  it("finishes early when all tracked targets have been observed", async () => {
    vi.useFakeTimers()
    try {
      const { provider } = providerForSchedule((socket) => {
        setTimeout(() => socket.onmessage?.({ data: JSON.stringify(positionMessage("413393620")) }), 10)
        setTimeout(() => socket.onmessage?.({ data: JSON.stringify(positionMessage("413393621")) }), 20)
      }, { connectionTimeoutMs: 5, observationWindowMs: 30_000 })
      const pending = provider.getLatestPositions([
        { vesselId: "vessel-1", mmsi: "413393620" },
        { vesselId: "vessel-2", mmsi: "413393621" },
      ])
      await vi.advanceTimersByTimeAsync(20)
      await expect(pending).resolves.toHaveLength(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it("keeps positions received before a connection close", async () => {
    vi.useFakeTimers()
    try {
      const { provider } = providerForSchedule((socket) => {
        setTimeout(() => {
          socket.onmessage?.({ data: JSON.stringify(positionMessage("413393620")) })
          setTimeout(() => socket.onclose?.(), 1)
        }, 10)
      }, { connectionTimeoutMs: 5, observationWindowMs: 30_000 })
      const pending = provider.getLatestPositions([{ vesselId: "vessel-1", mmsi: "413393620" }])
      await vi.advanceTimersByTimeAsync(11)
      await expect(pending).resolves.toMatchObject([{ mmsi: "413393620" }])
    } finally {
      vi.useRealTimers()
    }
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

  it("preserves the ProviderError taxonomy for binary protocol errors", async () => {
    const { provider } = providerForFrames([utf8({ error: "invalid API key: super-secret-key" })], { timeoutMs: 50 })
    await expect(provider.getLatestPositions([{ vesselId: "vessel-1", mmsi: "413393620" }])).rejects.toMatchObject({ code: "auth_failed", message: "aisstream_auth_failed" })
  })

  it("rejects a missing API key before opening a socket", async () => {
    const provider = createAisStreamTrackingProvider({ apiKeyResolver: async () => undefined })
    await expect(provider.getLatestPositions([{ vesselId: "vessel-1", mmsi: "413393620" }])).rejects.toThrow("aisstream_api_key_missing")
  })
})
