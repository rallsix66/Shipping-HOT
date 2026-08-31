import NativeDatabase from "better-sqlite3"
import { createDatabase } from "db0"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { AisLiveStreamHandle, AisLiveStreamOptions, AisLiveStreamProvider, AisPosition } from "#/providers/ais/contracts"
import { ProviderError } from "#/providers/contracts"
import { VesselMetadataRepository } from "#/database/vessel-search"
import { initShippingTables } from "#/database/shipping"
import { VesselWatchlistService } from "#/search/vessel-watchlist"
import { RuntimeRepository } from "#/database/runtime-jobs"
import { AisLiveTracker } from "#/runtime/ais-live-tracker"
import { bootstrapBackgroundRuntime, getAisLiveTracker, getBackgroundRuntime, shutdownBackgroundRuntime } from "#/runtime/bootstrap"

function createNativeDatabase(path = ":memory:", failBegin = false) {
  const native = new NativeDatabase(path)
  const failBeginState = { value: failBegin }
  const database = createDatabase({
    name: "sqlite",
    dialect: "sqlite",
    getInstance: () => native,
    exec: (sql: string) => native.exec(sql),
    prepare: (sql: string) => {
      if (failBeginState.value && sql.trim().toUpperCase() === "BEGIN") throw new Error("sqlite_write_failed")
      const statement = native.prepare(sql)
      return {
        all: async (...params: (string | number | boolean | null | undefined)[]) => statement.all(...params),
        get: async (...params: (string | number | boolean | null | undefined)[]) => statement.get(...params),
        run: async (...params: (string | number | boolean | null | undefined)[]) => {
          const result = statement.run(...params)
          return { success: result.changes > 0, changes: result.changes, lastInsertRowid: result.lastInsertRowid }
        },
      }
    },
    dispose: () => native.close(),
  } as never)
  return { database, native, failBeginState }
}

interface OpenStream extends AisLiveStreamHandle {
  options: AisLiveStreamOptions
  closed: boolean
  confirmed: boolean
  closeCalls: number
  confirm: () => Promise<void>
  position: (value: AisPosition) => Promise<void>
  closeUnexpected: (error?: Error) => Promise<void>
}

class FakeLiveProvider implements AisLiveStreamProvider {
  readonly providerId = "aisstream"
  readonly streams: OpenStream[] = []

  async openStream(options: AisLiveStreamOptions): Promise<AisLiveStreamHandle> {
    const stream = {} as OpenStream
    stream.options = options
    stream.closed = false
    stream.confirmed = false
    stream.closeCalls = 0
    Object.defineProperties(stream, {
      socketCount: { get: () => stream.closed ? 0 : 1 },
      confirmedSocketCount: { get: () => stream.closed ? 0 : stream.confirmed ? 1 : 0 },
    })
    stream.close = async () => {
      stream.closed = true
      stream.closeCalls++
    }
    stream.confirm = async () => {
      if (!stream.closed) {
        stream.confirmed = true
        await options.callbacks.onSubscriptionConfirmed?.()
      }
    }
    stream.position = async (value) => {
      if (!stream.closed) await options.callbacks.onPosition(value)
    }
    stream.closeUnexpected = async (error) => {
      if (!stream.closed) {
        stream.closed = true
        await options.callbacks.onClose?.(error)
      }
    }
    this.streams.push(stream)
    return stream
  }
}

function realPosition(mmsi: string, timestamp = "2026-08-31T00:00:01.000Z"): AisPosition {
  return {
    mmsi,
    latitude: 1.2,
    longitude: 103.8,
    speed: 4.5,
    course: 90,
    heading: 91,
    navigationStatus: "under_way",
    timestamp,
    source: "aisstream",
    sourceType: "real",
  }
}

async function seedVessel(database: ReturnType<typeof createNativeDatabase>["database"], id: string, mmsi: string, name = id, watch = true): Promise<void> {
  await new VesselMetadataRepository(database, "real").saveSearch({ query: name }, [{
    id,
    name,
    imo: id.replace("imo:", "") || undefined,
    mmsi,
    source: "gfw",
    fetchedAt: "2026-08-31T00:00:00.000Z",
    source_type: "real",
  }], "gfw", "real", new Date("2026-08-31T00:00:00.000Z"))
  if (watch) await new VesselWatchlistService(database, "real").add(id)
}

async function flush(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}

afterEach(async () => {
  await shutdownBackgroundRuntime()
})

describe("aisLiveTracker", () => {
  it("keeps running with no target without opening a socket", async () => {
    const { database, native } = createNativeDatabase()
    await initShippingTables(database, "real")
    const provider = new FakeLiveProvider()
    const tracker = new AisLiveTracker({ database, dataMode: "real", provider, refreshSeconds: 60 })
    await tracker.start()

    expect(tracker.getStatus()).toMatchObject({ running: true, targetCount: 0, socketCount: 0, errorCode: "no_eligible_ais_targets", providerStatus: "never_succeeded" })
    expect(provider.streams).toHaveLength(0)
    expect(await new RuntimeRepository(database).getProviderRuntime("aisstream", "ais_tracking")).toMatchObject({ status: "never_succeeded", errorCode: "no_eligible_ais_targets", lastSuccessAt: undefined })
    await tracker.stop()
    native.close()
  })

  it("subscribes only the current MMSI and does not reconnect for an unchanged watchlist", async () => {
    const { database, native } = createNativeDatabase()
    await initShippingTables(database, "real")
    await seedVessel(database, "imo:9155391", "538090733", "HANSA BREITENBURG")
    const provider = new FakeLiveProvider()
    const tracker = new AisLiveTracker({ database, dataMode: "real", provider, refreshSeconds: 60 })
    await tracker.start()
    await tracker.reconcileNow()

    expect(provider.streams).toHaveLength(1)
    expect(provider.streams[0].options.vessels).toEqual([{ vesselId: "imo:9155391", mmsi: "538090733" }])
    await provider.streams[0].confirm()
    expect(tracker.getStatus()).toMatchObject({ targetCount: 1, socketCount: 1, confirmedSocketCount: 1, providerStatus: "never_succeeded", lastSuccessAt: undefined })
    await tracker.reconcileNow()
    expect(provider.streams).toHaveLength(1)

    await tracker.stop()
    native.close()
  })

  it("serializes live writes, deduplicates history and marks runtime healthy after persistence", async () => {
    const { database, native } = createNativeDatabase()
    await initShippingTables(database, "real")
    await seedVessel(database, "imo:9951604", "563185100", "PSA SHURI CS08")
    const provider = new FakeLiveProvider()
    const tracker = new AisLiveTracker({ database, dataMode: "real", provider, refreshSeconds: 60 })
    await tracker.start()
    const stream = provider.streams[0]
    await stream.confirm()
    await Promise.all([stream.position(realPosition("563185100")), stream.position(realPosition("563185100"))])
    await flush()

    expect(native.prepare("SELECT COUNT(*) AS count FROM ais_positions").get()).toEqual({ count: 1 })
    expect(native.prepare("SELECT COUNT(*) AS count FROM ais_latest_positions").get()).toEqual({ count: 1 })
    expect(await new RuntimeRepository(database).getProviderRuntime("aisstream", "ais_tracking")).toMatchObject({ status: "healthy", lastSuccessAt: expect.any(String), lastSourceUpdatedAt: "2026-08-31T00:00:01.000Z", consecutiveFailures: 0, errorCode: undefined })
    expect(tracker.getStatus()).toMatchObject({ lastMessageAt: expect.any(String), lastPersistedAt: expect.any(String), providerStatus: "healthy" })

    await tracker.stop()
    native.close()
  })

  it("marks the runtime degraded after a post-success stream failure", async () => {
    const { database, native } = createNativeDatabase()
    await initShippingTables(database, "real")
    await seedVessel(database, "imo:9951604", "563185100", "PSA SHURI CS08")
    const provider = new FakeLiveProvider()
    const tracker = new AisLiveTracker({ database, dataMode: "real", provider, refreshSeconds: 60 })
    await tracker.start()
    const stream = provider.streams[0]
    await stream.position(realPosition("563185100"))
    await flush()
    const runtimeBeforeClose = await new RuntimeRepository(database).getProviderRuntime("aisstream", "ais_tracking")

    await stream.closeUnexpected(new ProviderError("provider_unavailable", "aisstream_connection_closed"))

    expect(await new RuntimeRepository(database).getProviderRuntime("aisstream", "ais_tracking")).toMatchObject({
      status: "degraded",
      lastSuccessAt: runtimeBeforeClose?.lastSuccessAt,
      lastSourceUpdatedAt: "2026-08-31T00:00:01.000Z",
      errorCode: "provider_unavailable",
    })
    expect(tracker.getStatus()).toMatchObject({ providerStatus: "degraded", lastSuccessAt: runtimeBeforeClose?.lastSuccessAt, lastSourceUpdatedAt: "2026-08-31T00:00:01.000Z" })

    await tracker.stop()
    native.close()
  })

  it("keeps persistence failure observable without claiming provider health", async () => {
    const { database, native, failBeginState } = createNativeDatabase()
    await initShippingTables(database, "real")
    await seedVessel(database, "imo:9951604", "563185100", "PSA SHURI CS08")
    failBeginState.value = true
    const provider = new FakeLiveProvider()
    const tracker = new AisLiveTracker({ database, dataMode: "real", provider, refreshSeconds: 60 })
    await tracker.start()
    await provider.streams[0].position(realPosition("563185100"))

    expect(tracker.getStatus()).toMatchObject({ providerStatus: "failed", errorCode: "ais_persistence_failed" })
    expect(await new RuntimeRepository(database).getProviderRuntime("aisstream", "ais_tracking")).toMatchObject({ status: "failed", errorCode: "ais_persistence_failed", lastSuccessAt: undefined })
    expect(native.prepare("SELECT COUNT(*) AS count FROM ais_positions").get()).toEqual({ count: 0 })

    await tracker.stop()
    native.close()
  })

  it("rebuilds streams when the watchlist changes and removes old MMSIs", async () => {
    const { database, native } = createNativeDatabase()
    await initShippingTables(database, "real")
    await seedVessel(database, "imo:1000001", "413393620", "ONE")
    await seedVessel(database, "imo:1000002", "413393621", "TWO", false)
    const provider = new FakeLiveProvider()
    const tracker = new AisLiveTracker({ database, dataMode: "real", provider, refreshSeconds: 60 })
    await tracker.start()
    const first = provider.streams[0]

    await tracker.reconcileNow()
    expect(provider.streams).toHaveLength(1)
    await new VesselWatchlistService(database, "real").add("imo:1000002")
    await tracker.reconcileNow()
    expect(provider.streams).toHaveLength(2)
    expect(first.closed).toBe(true)
    expect(provider.streams[1].options.vessels.map(vessel => vessel.mmsi)).toEqual(["413393620", "413393621"])

    await new VesselWatchlistService(database, "real").remove("imo:1000001")
    await tracker.reconcileNow()
    expect(provider.streams).toHaveLength(3)
    expect(provider.streams[2].options.vessels.map(vessel => vessel.mmsi)).toEqual(["413393621"])
    await tracker.stop()
    native.close()
  })

  it("backs off transient failures, waits at least a minute for rate limits and stops on terminal errors", async () => {
    vi.useFakeTimers()
    const { database, native } = createNativeDatabase()
    try {
      await initShippingTables(database, "real")
      await seedVessel(database, "imo:1000003", "413393622", "THREE")
      const provider = new FakeLiveProvider()
      const tracker = new AisLiveTracker({ database, dataMode: "real", provider, refreshSeconds: 60 })
      await tracker.start()
      await provider.streams[0].closeUnexpected(new ProviderError("provider_unavailable", "aisstream_connection_closed"))
      expect(tracker.getStatus()).toMatchObject({ reconnectAttempt: 1, errorCode: "provider_unavailable", providerStatus: "failed" })
      await vi.advanceTimersByTimeAsync(999)
      expect(provider.streams).toHaveLength(1)
      await vi.advanceTimersByTimeAsync(1)
      await flush()
      expect(provider.streams).toHaveLength(2)
      await provider.streams[1].confirm()
      expect(tracker.getStatus()).toMatchObject({ providerStatus: "failed", lastSuccessAt: undefined, reconnectAttempt: 0 })
      await provider.streams[1].closeUnexpected(new ProviderError("rate_limited", "aisstream_rate_limited"))
      expect(tracker.getStatus().reconnectAttempt).toBe(1)
      await vi.advanceTimersByTimeAsync(59_999)
      expect(provider.streams).toHaveLength(2)
      await vi.advanceTimersByTimeAsync(1)
      await flush()
      expect(provider.streams).toHaveLength(3)
      await provider.streams[2].closeUnexpected(new ProviderError("auth_failed", "aisstream_auth_failed"))
      await vi.advanceTimersByTimeAsync(60_000)
      expect(provider.streams).toHaveLength(3)
      await tracker.stop()
    } finally {
      native.close()
      vi.useRealTimers()
    }
  })

  it("closes streams and clears reconciliation/reconnect timers on shutdown", async () => {
    vi.useFakeTimers()
    const { database, native } = createNativeDatabase()
    try {
      await initShippingTables(database, "real")
      await seedVessel(database, "imo:1000004", "413393623", "FOUR")
      const provider = new FakeLiveProvider()
      const tracker = new AisLiveTracker({ database, dataMode: "real", provider, refreshSeconds: 30 })
      await tracker.start()
      const stream = provider.streams[0]
      await tracker.stop()
      expect(stream.closeCalls).toBe(1)
      expect(tracker.getStatus()).toMatchObject({ running: false, socketCount: 0, confirmedSocketCount: 0 })
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      native.close()
      vi.useRealTimers()
    }
  })
})

describe("continuous streaming activation", () => {
  it("starts one tracker and omits the bounded AIS job in Real streaming mode", async () => {
    const previous = {
      dataMode: process.env.SHIPPING_DATA_MODE,
      aisProvider: process.env.SHIPPING_AIS_PROVIDER,
      streaming: process.env.SHIPPING_AIS_STREAMING_ENABLED,
      runtime: process.env.SHIPPING_RUNTIME_ENABLED,
    }
    const { database, native } = createNativeDatabase()
    try {
      process.env.SHIPPING_DATA_MODE = "real"
      process.env.SHIPPING_AIS_PROVIDER = "aisstream"
      process.env.SHIPPING_AIS_STREAMING_ENABLED = "true"
      process.env.SHIPPING_RUNTIME_ENABLED = "true"
      await initShippingTables(database, "real")
      const provider = new FakeLiveProvider()
      const tracker = new AisLiveTracker({ database, dataMode: "real", provider, refreshSeconds: 60 })
      const first = await bootstrapBackgroundRuntime({ database, jobs: [], aisLiveTracker: tracker, enabled: true })
      const second = await bootstrapBackgroundRuntime({ database, jobs: [{ id: "ignored", providerId: "ignored", capability: "ignored", intervalMs: 60_000, enabled: true, run: async () => ({ status: "success" as const }) }], aisLiveTracker: tracker, enabled: true })
      expect(second).toBe(first)
      expect(getBackgroundRuntime()).toBe(first)
      expect(getAisLiveTracker()).toBe(tracker)
      expect(tracker.getStatus().running).toBe(true)
      expect(provider.streams).toHaveLength(0)
    } finally {
      await shutdownBackgroundRuntime()
      native.close()
      for (const [name, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[name === "dataMode" ? "SHIPPING_DATA_MODE" : name === "aisProvider" ? "SHIPPING_AIS_PROVIDER" : name === "streaming" ? "SHIPPING_AIS_STREAMING_ENABLED" : "SHIPPING_RUNTIME_ENABLED"]
        else process.env[name === "dataMode" ? "SHIPPING_DATA_MODE" : name === "aisProvider" ? "SHIPPING_AIS_PROVIDER" : name === "streaming" ? "SHIPPING_AIS_STREAMING_ENABLED" : "SHIPPING_RUNTIME_ENABLED"] = value
      }
    }
  })

  it("does not start the tracker in Mock mode even when streaming is requested", async () => {
    const previousDataMode = process.env.SHIPPING_DATA_MODE
    const previousProvider = process.env.SHIPPING_AIS_PROVIDER
    const previousStreaming = process.env.SHIPPING_AIS_STREAMING_ENABLED
    const { database, native } = createNativeDatabase()
    try {
      process.env.SHIPPING_DATA_MODE = "mock"
      process.env.SHIPPING_AIS_PROVIDER = "aisstream"
      process.env.SHIPPING_AIS_STREAMING_ENABLED = "true"
      const provider = new FakeLiveProvider()
      const tracker = new AisLiveTracker({ database, dataMode: "mock", provider, refreshSeconds: 60 })
      await bootstrapBackgroundRuntime({ database, jobs: [], aisLiveTracker: tracker, enabled: true })
      expect(getAisLiveTracker()).toBeUndefined()
      expect(tracker.getStatus().running).toBe(false)
      expect(provider.streams).toHaveLength(0)
    } finally {
      await shutdownBackgroundRuntime()
      native.close()
      if (previousDataMode === undefined) delete process.env.SHIPPING_DATA_MODE
      else process.env.SHIPPING_DATA_MODE = previousDataMode
      if (previousProvider === undefined) delete process.env.SHIPPING_AIS_PROVIDER
      else process.env.SHIPPING_AIS_PROVIDER = previousProvider
      if (previousStreaming === undefined) delete process.env.SHIPPING_AIS_STREAMING_ENABLED
      else process.env.SHIPPING_AIS_STREAMING_ENABLED = previousStreaming
    }
  })

  it("cleans tracker state when tracker bootstrap fails", async () => {
    const previousDataMode = process.env.SHIPPING_DATA_MODE
    const previousProvider = process.env.SHIPPING_AIS_PROVIDER
    const previousStreaming = process.env.SHIPPING_AIS_STREAMING_ENABLED
    const { database, native } = createNativeDatabase()
    try {
      process.env.SHIPPING_DATA_MODE = "real"
      process.env.SHIPPING_AIS_PROVIDER = "aisstream"
      process.env.SHIPPING_AIS_STREAMING_ENABLED = "true"
      await initShippingTables(database, "real")
      const failingRepository = { getProviderRuntime: async () => {
        throw new Error("tracker_bootstrap_failed")
      } } as unknown as RuntimeRepository
      const tracker = new AisLiveTracker({ database, dataMode: "real", provider: new FakeLiveProvider(), repository: failingRepository })
      await expect(bootstrapBackgroundRuntime({ database, jobs: [], aisLiveTracker: tracker, enabled: true })).rejects.toThrow("tracker_bootstrap_failed")
      expect(getBackgroundRuntime()).toBeUndefined()
      expect(getAisLiveTracker()).toBeUndefined()
    } finally {
      await shutdownBackgroundRuntime()
      native.close()
      if (previousDataMode === undefined) delete process.env.SHIPPING_DATA_MODE
      else process.env.SHIPPING_DATA_MODE = previousDataMode
      if (previousProvider === undefined) delete process.env.SHIPPING_AIS_PROVIDER
      else process.env.SHIPPING_AIS_PROVIDER = previousProvider
      if (previousStreaming === undefined) delete process.env.SHIPPING_AIS_STREAMING_ENABLED
      else process.env.SHIPPING_AIS_STREAMING_ENABLED = previousStreaming
    }
  })
})
