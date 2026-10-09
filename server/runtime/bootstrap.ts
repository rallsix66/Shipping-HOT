import process from "node:process"
import type { Database } from "db0"
import { initShippingTables } from "#/database/shipping"
import { RuntimeRepository } from "#/database/runtime-jobs"
import { BackgroundRuntime, type RuntimeJob } from "#/runtime/background-runtime"
import { getDefaultRuntimeJobs } from "#/runtime/registry"

interface RuntimeGlobalState {
  runtime?: BackgroundRuntime
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
    for (const job of options.jobs ?? getDefaultRuntimeJobs({ database, dataMode })) runtime.register(job)
    const shouldStart = options.enabled ?? runtimeEnabled()
    try {
      if (shouldStart) await runtime.start()
      state.runtime = runtime
      if (options.installSignalHandlers ?? false) installSignalHandlers()
      return runtime
    } catch (error) {
      runtime.stop()
      throw error
    }
  })()
  try {
    return await state.bootstrapPromise
  } catch (error) {
    state.runtime = undefined
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

export function hasBackgroundRuntimeBootstrapFailed(): boolean {
  return globalState().bootstrapFailed === true
}

export function isBackgroundRuntimeEnabled(): boolean {
  return runtimeEnabled()
}

export async function shutdownBackgroundRuntime(): Promise<void> {
  const state = globalState()
  const runtime = state.runtime
  runtime?.stop()
  state.runtime = undefined
  state.bootstrapPromise = undefined
  state.bootstrapFailed = undefined
  removeSignalHandlers()
}
