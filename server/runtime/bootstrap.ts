import process from "node:process"
import type { Database } from "db0"
import { initShippingTables } from "#/database/shipping"
import { RuntimeRepository } from "#/database/runtime-jobs"
import type { AisTrackingProvider } from "#/providers/ais/contracts"
import type { AisAreaProvider } from "#/providers/aisstream-area"
import { createAisAreaProviderForDatabase, createAisLiveStreamProvider } from "#/providers/ais"
import { BackgroundRuntime, type RuntimeJob } from "#/runtime/background-runtime"
import { getDefaultRuntimeJobs } from "#/runtime/registry"
import { AisLiveTracker } from "#/runtime/ais-live-tracker"
import { isAisStreamingEnabled } from "#/runtime/ais-streaming-config"

interface RuntimeGlobalState {
  runtime?: BackgroundRuntime
  aisLiveTracker?: AisLiveTracker
  aisAreaProvider?: AisAreaProvider
  bootstrapPromise?: Promise<BackgroundRuntime>
  bootstrapFailed?: boolean
  signalHandlers?: { SIGINT: () => void, SIGTERM: () => void }
}

const globalKey = Symbol.for("shipping-hot.background-runtime")

function globalState(): RuntimeGlobalState {
  const root = globalThis as typeof globalThis & { [globalKey]?: RuntimeGlobalState }
  return root[globalKey] ??= {}
}

function runtimeEnabled(): boolean {
  return process.env.SHIPPING_RUNTIME_ENABLED?.trim().toLowerCase() !== "false"
}

export interface BootstrapBackgroundRuntimeOptions {
  database?: Database
  repository?: RuntimeRepository
  jobs?: RuntimeJob[]
  aisProvider?: AisTrackingProvider
  aisAreaProvider?: AisAreaProvider
  aisLiveTracker?: AisLiveTracker
  enabled?: boolean
  installSignalHandlers?: boolean
}

function installSignalHandlers() {
  const state = globalState()
  if (state.signalHandlers) return
  const stop = () => {
    void shutdownBackgroundRuntime()
  }
  state.signalHandlers = { SIGINT: stop, SIGTERM: stop }
  process.once("SIGINT", stop)
  process.once("SIGTERM", stop)
}

function removeSignalHandlers() {
  const state = globalState()
  if (!state.signalHandlers) return
  process.removeListener("SIGINT", state.signalHandlers.SIGINT)
  process.removeListener("SIGTERM", state.signalHandlers.SIGTERM)
  state.signalHandlers = undefined
}

export async function bootstrapBackgroundRuntime(options: BootstrapBackgroundRuntimeOptions = {}): Promise<BackgroundRuntime> {
  const state = globalState()
  if (state.runtime) return state.runtime
  if (state.bootstrapPromise) return state.bootstrapPromise
  state.bootstrapFailed = false
  state.bootstrapPromise = (async () => {
    const database = options.database ?? useDatabase()
    const dataMode = process.env.SHIPPING_DATA_MODE === "real" ? "real" : "mock"
    await initShippingTables(database, dataMode)
    const runtime = new BackgroundRuntime(options.repository ?? new RuntimeRepository(database))
    const aisAreaEnabled = dataMode === "real" && process.env.SHIPPING_AIS_AREA_PROVIDER?.trim().toLowerCase() === "aisstream"
    const aisAreaProvider = aisAreaEnabled
      ? options.aisAreaProvider ?? createAisAreaProviderForDatabase(database, { dataMode })
      : undefined
    for (const job of options.jobs ?? getDefaultRuntimeJobs({ database, dataMode, aisProvider: options.aisProvider, aisAreaProvider })) runtime.register(job)
    const shouldStart = options.enabled ?? runtimeEnabled()
    let aisLiveTracker: AisLiveTracker | undefined
    try {
      if (shouldStart && isAisStreamingEnabled(dataMode)) {
        aisLiveTracker = options.aisLiveTracker ?? new AisLiveTracker({
          database,
          dataMode,
          provider: createAisLiveStreamProvider(),
        })
        await aisLiveTracker.start()
      }
      if (shouldStart) await runtime.start()
      state.runtime = runtime
      state.aisLiveTracker = aisLiveTracker
      state.aisAreaProvider = aisAreaProvider
      if (options.installSignalHandlers ?? false) installSignalHandlers()
      return runtime
    } catch (error) {
      await aisLiveTracker?.stop()
      await aisAreaProvider?.close()
      runtime.stop()
      throw error
    }
  })()
  try {
    return await state.bootstrapPromise
  } catch (error) {
    state.runtime = undefined
    state.aisLiveTracker = undefined
    state.aisAreaProvider = undefined
    state.bootstrapFailed = true
    removeSignalHandlers()
    throw error
  } finally {
    state.bootstrapPromise = undefined
  }
}

export function getBackgroundRuntime(): BackgroundRuntime | undefined {
  return globalState().runtime
}

export function getAisLiveTracker(): AisLiveTracker | undefined {
  return globalState().aisLiveTracker
}

export function getAisAreaProvider(): AisAreaProvider | undefined {
  return globalState().aisAreaProvider
}

export function hasBackgroundRuntimeBootstrapFailed(): boolean {
  return globalState().bootstrapFailed === true
}

export function isBackgroundRuntimeEnabled(): boolean {
  return runtimeEnabled()
}

export async function shutdownBackgroundRuntime(): Promise<void> {
  const state = globalState()
  const runtime = state.runtime
  const aisAreaProvider = state.aisAreaProvider
  const aisLiveTracker = state.aisLiveTracker
  runtime?.stop()
  state.runtime = undefined
  state.aisAreaProvider = undefined
  state.aisLiveTracker = undefined
  await aisAreaProvider?.close()
  await aisLiveTracker?.stop()
  state.bootstrapPromise = undefined
  state.bootstrapFailed = undefined
  removeSignalHandlers()
}
