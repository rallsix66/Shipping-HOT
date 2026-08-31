import { describe, expect, it, vi } from "vitest"
import type { SecretStore } from "#/providers/contracts"
import type { AisStreamSocket } from "#/providers/ais/aisstream-provider"
import { createAisTrackingProvider, getConfiguredAisStreamTiming } from "#/providers/ais"

const secretStore: SecretStore = {
  get: async () => "test-key",
  source: async () => "environment",
  has: async () => true,
  set: async () => undefined,
  delete: async () => undefined,
}

function emptySocket(): AisStreamSocket {
  return { onopen: null, onmessage: null, onerror: null, onclose: null, send: () => undefined, close: () => undefined }
}

describe("ais provider factory timing", () => {
  it("reads finite positive connection and observation windows from the environment", () => {
    expect(getConfiguredAisStreamTiming({ SHIPPING_AIS_CONNECTION_TIMEOUT_MS: "7000", SHIPPING_AIS_OBSERVATION_WINDOW_MS: "45000" })).toEqual({
      connectionTimeoutMs: 7000,
      observationWindowMs: 45000,
    })
  })

  it("falls back independently for invalid or non-positive environment values", () => {
    expect(getConfiguredAisStreamTiming({ SHIPPING_AIS_CONNECTION_TIMEOUT_MS: "0", SHIPPING_AIS_OBSERVATION_WINDOW_MS: "-1" })).toEqual({
      connectionTimeoutMs: 5000,
      observationWindowMs: 30000,
    })
    expect(getConfiguredAisStreamTiming({ SHIPPING_AIS_CONNECTION_TIMEOUT_MS: "abc", SHIPPING_AIS_OBSERVATION_WINDOW_MS: "Infinity" })).toEqual({
      connectionTimeoutMs: 5000,
      observationWindowMs: 30000,
    })
  })

  it("uses the configured factory windows without shortening the observation phase", async () => {
    const previousConnection = process.env.SHIPPING_AIS_CONNECTION_TIMEOUT_MS
    const previousObservation = process.env.SHIPPING_AIS_OBSERVATION_WINDOW_MS
    vi.useFakeTimers()
    try {
      process.env.SHIPPING_AIS_CONNECTION_TIMEOUT_MS = "7000"
      process.env.SHIPPING_AIS_OBSERVATION_WINDOW_MS = "45000"
      const socket = emptySocket()
      const provider = createAisTrackingProvider({
        providerId: "aisstream",
        dataMode: "real",
        secretStore,
        socketFactory: () => {
          setTimeout(() => socket.onopen?.(), 6000)
          return socket
        },
      })
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
      await Promise.resolve()
      await vi.advanceTimersByTimeAsync(6000)
      expect(settled).toBe(false)
      await vi.advanceTimersByTimeAsync(44999)
      expect(settled).toBe(false)
      await vi.advanceTimersByTimeAsync(1)
      await expect(pending).resolves.toEqual([])
    } finally {
      if (previousConnection === undefined) delete process.env.SHIPPING_AIS_CONNECTION_TIMEOUT_MS
      else process.env.SHIPPING_AIS_CONNECTION_TIMEOUT_MS = previousConnection
      if (previousObservation === undefined) delete process.env.SHIPPING_AIS_OBSERVATION_WINDOW_MS
      else process.env.SHIPPING_AIS_OBSERVATION_WINDOW_MS = previousObservation
      vi.useRealTimers()
    }
  })
})
