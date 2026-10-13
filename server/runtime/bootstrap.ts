import process from "node:process"
import type { Database } from "db0"
import { initShippingTables } from "#/database/shipping"
import { RuntimeRepository } from "#/database/runtime-jobs"
import { BackgroundRuntime, type BackgroundRuntimeOptions, type RuntimeJob } from "#/runtime/background-runtime"
import { type RuntimeRegistryOptions, getDefaultRuntimeJobs } from "#/runtime/registry"
import { INTEL_COLLECT_JOB_ID, type IntelCollectJob, recoverIntelRunsAtExclusiveStartup } from "#/runtime/intel-collect-job"

interface RuntimeGlobalState {
  runtime?: BackgroundRuntime
  bootstrapPromise?: Promise<BackgroundRuntime>
  bootstrapFailed?: boolean
  signalHandlers?: { SIGINT: () => void, SIGTERM: () => void }
  intelJobs?: IntelCollectJob[]
  intelOwnership?: { release: () => Promise<void> }
  shutdownPromise?: Promise<void>
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
  registry?: Omit<RuntimeRegistryOptions, "database" | "dataMode" | "now">
  runtimeOptions?: BackgroundRuntimeOptions
  /**
   * Caller must acquire exclusive ownership for this exact DB, across all processes/executors,
   * before resolving. Keep the lease for the runtime lifetime; fail if another owner is active.
   * No built-in live lock provider or stale-lock removal. Required for explicitly enabled intel.
   */
  acquireIntelOwnership?: () => Promise<{ release: () => Promise<void> }>
  /** Only with acquired exclusive ownership; never inferred from run age or a second bootstrap. */
  recoverInterruptedIntel?: boolean
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
  if (state.shutdownPromise) await state.shutdownPromise
  if (state.runtime) return state.runtime
  if (state.bootstrapPromise) return state.bootstrapPromise
  if (state.intelOwnership) throw new Error("intel_previous_ownership_not_released")
  state.bootstrapFailed = false
  state.bootstrapPromise = (async () => {
    const database = options.database ?? useDatabase()
    const dataMode = process.env.SHIPPING_DATA_MODE === "real" ? "real" : "mock"
    const jobs = options.jobs ?? getDefaultRuntimeJobs({ ...options.registry, database, dataMode, now: options.runtimeOptions?.now })
    const intelJobs = jobs.filter(job => job.id === INTEL_COLLECT_JOB_ID) as IntelCollectJob[]
    if (intelJobs.length > 1) throw new Error("intel_duplicate_registration")
    if (intelJobs.some(job => typeof job.end !== "function")) throw new Error("intel_executor_lifecycle_required")
    if ((intelJobs.some(job => job.enabled) || options.recoverInterruptedIntel) && !options.acquireIntelOwnership) throw new Error("intel_exclusive_ownership_required")
    if (options.acquireIntelOwnership && (intelJobs.some(job => job.enabled) || options.recoverInterruptedIntel)) {
      const ownership = await options.acquireIntelOwnership()
      if (!ownership || typeof ownership.release !== "function") throw new Error("intel_ownership_lease_invalid")
      state.intelOwnership = ownership
    }
    const runtime = new BackgroundRuntime(options.repository ?? new RuntimeRepository(database), options.runtimeOptions)
    state.intelJobs = intelJobs
    const shouldStart = options.enabled ?? runtimeEnabled()
    try {
      await initShippingTables(database, dataMode)
      for (const job of jobs) runtime.register(job)
      if (options.recoverInterruptedIntel) await recoverIntelRunsAtExclusiveStartup(database, options.runtimeOptions?.now?.() ?? new Date())
      if (shouldStart) await runtime.start()
      state.runtime = runtime
      if (options.installSignalHandlers ?? false) installSignalHandlers()
      return runtime
    } catch (error) {
      runtime.stop()
      await runtime.drain()
      for (const job of intelJobs) await job.end()
      await state.intelOwnership?.release()
      state.intelOwnership = undefined
      state.intelJobs = undefined
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
  if (state.shutdownPromise) return state.shutdownPromise
  state.shutdownPromise = (async () => {
    const runtime = state.runtime ?? await state.bootstrapPromise
    runtime?.stop()
    await runtime?.drain()
    for (const job of state.intelJobs ?? []) await job.end()
    await state.intelOwnership?.release()
    state.intelJobs = undefined
    state.intelOwnership = undefined
    state.runtime = undefined
    state.bootstrapPromise = undefined
    state.bootstrapFailed = undefined
    removeSignalHandlers()
  })()
  try {
    await state.shutdownPromise
  } finally {
    state.shutdownPromise = undefined
  }
}
