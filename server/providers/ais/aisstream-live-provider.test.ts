import { describe, expect, it, vi } from "vitest"
import type { AisLiveStreamOptions, AisLiveStreamProvider, AisPosition, AisTrackingVessel } from "#/providers/ais/contracts"
import { createAisStreamLiveProvider } from "#/providers/ais/aisstream-live-provider"
import type { AisStreamSocket } from "#/providers/ais/aisstream-provider"

interface TestSocket extends AisStreamSocket {
  open: () => void
  message: (data: unknown) => void
  closeCount: number
  sent?: Record<string, unknown>
}

function socket(): TestSocket {
  const value = {} as TestSocket
  value.onopen = null
  value.onmessage = null
  value.onerror = null
  value.onclose = null
  value.closeCount = 0
  value.send = (data) => {
    value.sent = JSON.parse(data) as Record<string, unknown>
  }
  value.close = () => {
    value.closeCount++
  }
  value.open = () => value.onopen?.()
  value.message = data => value.onmessage?.({ data })
  return value
}

function position(mmsi: string): Record<string, unknown> {
  return {
    MessageType: "PositionReport",
    MetaData: { MMSI: mmsi, time_utc: "2026-08-31T00:00:00.000Z" },
    Message: { PositionReport: { UserID: mmsi, Latitude: 1.2, Longitude: 103.8, Sog: 4.5, Cog: 90, TrueHeading: 91, NavigationalStatus: 0 } },
  }
}

const target = (mmsi: string, vesselId = `vessel-${mmsi}`): AisTrackingVessel => ({ vesselId, mmsi })

async function flushMessages(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
  await new Promise<void>(resolve => setTimeout(resolve, 0))
}

function openProvider(sockets: TestSocket[]): { provider: AisLiveStreamProvider, options: AisLiveStreamOptions & { callbacks: { onPosition: ReturnType<typeof vi.fn>, onSubscriptionConfirmed: ReturnType<typeof vi.fn>, onError: ReturnType<typeof vi.fn>, onClose: ReturnType<typeof vi.fn> } } } {
  let index = 0
  const provider = createAisStreamLiveProvider({ apiKey: "test-key", socketFactory: () => sockets[index++] })
  const options = {
    vessels: [target("413393620")],
    callbacks: {
      onPosition: vi.fn((_position: AisPosition) => undefined),
      onSubscriptionConfirmed: vi.fn(() => undefined),
      onError: vi.fn((_error: Error) => undefined),
      onClose: vi.fn((_error?: Error) => undefined),
    },
  }
  return { provider, options }
}

describe("aisstream live provider", () => {
  it("uses the shared binary parser and forwards a Blob PositionReport", async () => {
    const liveSocket = socket()
    const { provider, options } = openProvider([liveSocket])
    const handle = await provider.openStream(options)
    liveSocket.open()
    liveSocket.message(new Blob([JSON.stringify({ MessageType: "SubscriptionConfirmation" })]))
    liveSocket.message(new Blob([JSON.stringify(position("413393620"))]))
    await flushMessages()

    expect(liveSocket.sent).toMatchObject({
      BoundingBoxes: [[[-90, -180], [90, 180]]],
      FiltersShipMMSI: ["413393620"],
      FilterMessageTypes: ["PositionReport"],
    })
    expect(options.callbacks.onSubscriptionConfirmed).toHaveBeenCalledTimes(1)
    expect(options.callbacks.onPosition).toHaveBeenCalledWith(expect.objectContaining({ mmsi: "413393620", source: "aisstream", sourceType: "real" }))
    expect(handle.socketCount).toBe(1)
    expect(handle.confirmedSocketCount).toBe(1)
    await handle.close()
    expect(liveSocket.closeCount).toBe(1)
  })

  it("deduplicates, sorts and batches current MMSIs into 50-target subscriptions", async () => {
    const sockets = Array.from({ length: 2 }, () => socket())
    let index = 0
    const provider = createAisStreamLiveProvider({ apiKey: "test-key", socketFactory: () => sockets[index++] })
    const vessels = Array.from({ length: 51 }, (_, index) => target(String(413393620 + index)))
    vessels.push(target("413393620", "duplicate"))
    const handle = await provider.openStream({ vessels, callbacks: { onPosition: vi.fn() } })
    sockets.forEach(value => value.open())
    expect(handle.socketCount).toBe(2)
    expect(sockets[0].sent?.FiltersShipMMSI).toEqual(Array.from({ length: 50 }, (_, offset) => String(413393620 + offset)))
    expect(sockets[1].sent?.FiltersShipMMSI).toEqual(["413393670"])
    await handle.close()
  })

  it("does not open a socket for an empty target set", async () => {
    const factory = vi.fn(() => socket())
    const provider = createAisStreamLiveProvider({ apiKey: "test-key", socketFactory: factory })
    const handle = await provider.openStream({ vessels: [], callbacks: { onPosition: vi.fn() } })
    expect(factory).not.toHaveBeenCalled()
    expect(handle.socketCount).toBe(0)
  })

  it("fails a binary protocol error with the existing ProviderError taxonomy", async () => {
    const liveSocket = socket()
    const { provider, options } = openProvider([liveSocket])
    const handle = await provider.openStream(options)
    liveSocket.open()
    liveSocket.message(new Uint8Array(new TextEncoder().encode(JSON.stringify({ error: "invalid API key: hidden" }))))
    await flushMessages()

    expect(options.callbacks.onError).toHaveBeenCalledWith(expect.objectContaining({ code: "auth_failed", message: "aisstream_auth_failed" }))
    expect(options.callbacks.onClose).toHaveBeenCalledWith(expect.objectContaining({ code: "auth_failed" }))
    expect(handle.socketCount).toBe(0)
  })

  it("ignores malformed, wrong-MMSI, missing-timestamp and invalid-coordinate frames", async () => {
    const liveSocket = socket()
    const { provider, options } = openProvider([liveSocket])
    const handle = await provider.openStream(options)
    liveSocket.open()
    liveSocket.message(new Uint8Array([0x7B, 0x6E, 0x6F, 0x74, 0x2D, 0x6A, 0x73, 0x6F, 0x6E]))
    liveSocket.message(JSON.stringify(position("413393621")))
    liveSocket.message(JSON.stringify({ ...position("413393620"), MetaData: { MMSI: "413393620" } }))
    liveSocket.message(JSON.stringify({ ...position("413393620"), Message: { PositionReport: { UserID: "413393620", Latitude: 91, Longitude: 103.8 } } }))
    await flushMessages()

    expect(options.callbacks.onPosition).not.toHaveBeenCalled()
    await handle.close()
  })
})
