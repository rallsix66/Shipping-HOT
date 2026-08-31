import type { Database } from "db0"
import type { VesselWatchlistItem } from "@shared/vessel-search"
import type { ProviderFailureCode, ProviderRuntimeRecord } from "#/providers/contracts"
import { ProviderError, providerErrorFromUnknown } from "#/providers/contracts"
import { AisPositionRepository } from "#/database/ais-positions"
import type { AisLiveStreamHandle, AisLiveStreamProvider, AisPosition, AisTrackingVessel } from "#/providers/ais/contracts"
import { AIS_TRACKING_CAPABILITY } from "#/providers/ais/contracts"
import { RuntimeRepository } from "#/database/runtime-jobs"
import { createVesselWatchlistService } from "#/search/vessel-watchlist"
import { AIS_LIVE_RATE_LIMIT_RECONNECT_DELAY_MS, AIS_LIVE_RECONNECT_DELAYS_MS, getConfiguredAisWatchlistRefreshSeconds } from "#/runtime/ais-streaming-config"
import type { ShippingDataMode } from "#/database/runtime"

export interface AisLiveTrackerStatus {
  running: boolean
  targetCount: number
  socketCount: number
  confirmedSocketCount: number
  lastMessageAt?: string
  lastPersistedAt?: string
  reconnectAttempt: number
  errorCode?: string
  providerStatus: ProviderRuntimeRecord["status"]
  lastSuccessAt?: string
  lastSourceUpdatedAt?: string
}

export interface AisLiveTrackerOptions {
  database: Database
  dataMode: ShippingDataMode
  provider: AisLiveStreamProvider
  repository?: RuntimeRepository
  refreshSeconds?: number
  now?: () => Date
  setTimeout?: typeof globalThis.setTimeout
  clearTimeout?: typeof globalThis.clearTimeout
  reconnectDelaysMs?: readonly number[]
}

function errorFor(error: unknown): ProviderError {
  if (error instanceof ProviderError) return error
  return providerErrorFromUnknown("aisstream", error)
}

function targetKey(targets: readonly AisTrackingVessel[]): string {
  return targets.map(target => `${target.vesselId}:${target.mmsi}`).join("|")
}

function currentTargets(items: readonly VesselWatchlistItem[]): AisTrackingVessel[] {
  const unique = new Map<string, AisTrackingVessel>()
  for (const item of items) {
    if (!item.aisEnabled || !item.aisTrackingAvailable || !item.mmsi) continue
    const target = { vesselId: item.id, mmsi: item.mmsi }
    const current = unique.get(target.mmsi)
    if (!current || target.vesselId.localeCompare(current.vesselId) < 0) unique.set(target.mmsi, target)
  }
  return [...unique.values()].sort((left, right) => left.mmsi.localeCompare(right.mmsi) || left.vesselId.localeCompare(right.vesselId))
}

export class AisLiveTracker {
  private readonly watchlist: ReturnType<typeof createVesselWatchlistService>
  private readonly positions: AisPositionRepository
  private readonly runtime: RuntimeRepository
  private readonly now: () => Date
  private readonly setTimer: typeof globalThis.setTimeout
  private readonly clearTimer: typeof globalThis.clearTimeout
  private readonly refreshSeconds: number
  private readonly reconnectDelaysMs: readonly number[]
  private running = false
  private targets: AisTrackingVessel[] = []
  private targetSnapshot?: string
  private activeHandle?: AisLiveStreamHandle
  private generation = 0
  private closedGenerations = new Set<number>()
  private reconcileTimer?: ReturnType<typeof setTimeout>
  private reconnectTimer?: ReturnType<typeof setTimeout>
  private reconcilePromise?: Promise<void>
  private writeQueue: Promise<void> = Promise.resolve()
  private lastMessageAt?: string
  private lastPersistedAt?: string
  private reconnectAttempt = 0
  private errorCode?: string
  private providerStatus: ProviderRuntimeRecord["status"] = "never_succeeded"
  private lastSuccessAt?: string
  private lastSourceUpdatedAt?: string

  constructor(private readonly options: AisLiveTrackerOptions) {
    this.watchlist = createVesselWatchlistService(options.database, options.dataMode)
    this.positions = new AisPositionRepository(options.database, options.dataMode)
    this.runtime = options.repository ?? new RuntimeRepository(options.database)
    this.now = options.now ?? (() => new Date())
    this.setTimer = options.setTimeout ?? globalThis.setTimeout
    this.clearTimer = options.clearTimeout ?? globalThis.clearTimeout
    this.refreshSeconds = options.refreshSeconds ?? getConfiguredAisWatchlistRefreshSeconds()
    this.reconnectDelaysMs = options.reconnectDelaysMs?.length ? options.reconnectDelaysMs : AIS_LIVE_RECONNECT_DELAYS_MS
  }

  async start(): Promise<void> {
    if (this.running) return
    this.running = true
    this.targetSnapshot = undefined
    this.closedGenerations.clear()
    try {
      await this.enqueueWrite(async () => {
        const persisted = await this.runtime.getProviderRuntime(this.options.provider.providerId, AIS_TRACKING_CAPABILITY)
        if (persisted) {
          this.applyRuntime(persisted)
        } else {
          const created = await this.runtime.updateProviderRuntime({
            providerId: this.options.provider.providerId,
            capability: AIS_TRACKING_CAPABILITY,
            status: "never_succeeded",
            consecutiveFailures: 0,
            updatedAt: this.now().toISOString(),
          })
          this.applyRuntime(created)
        }
      })
      this.scheduleReconcile()
      await this.reconcileNow()
    } catch (error) {
      this.running = false
      this.clearTimers()
      await this.closeActiveStream()
      throw error
    }
  }

  async stop(): Promise<void> {
    this.running = false
    this.clearTimers()
    this.targetSnapshot = undefined
    this.targets = []
    const reconcilePromise = this.reconcilePromise
    await this.closeActiveStream()
    await reconcilePromise?.catch(() => undefined)
    await this.closeActiveStream()
    await this.writeQueue
  }

  async reconcileNow(): Promise<void> {
    if (!this.running) return
    if (this.reconcilePromise) return this.reconcilePromise
    const task = this.reconcile()
    this.reconcilePromise = task
    try {
      await task
    } finally {
      if (this.reconcilePromise === task) this.reconcilePromise = undefined
    }
  }

  getStatus(): AisLiveTrackerStatus {
    return {
      running: this.running,
      targetCount: this.targets.length,
      socketCount: this.activeHandle?.socketCount ?? 0,
      confirmedSocketCount: this.activeHandle?.confirmedSocketCount ?? 0,
      lastMessageAt: this.lastMessageAt,
      lastPersistedAt: this.lastPersistedAt,
      reconnectAttempt: this.reconnectAttempt,
      errorCode: this.errorCode,
      providerStatus: this.providerStatus,
      lastSuccessAt: this.lastSuccessAt,
      lastSourceUpdatedAt: this.lastSourceUpdatedAt,
    }
  }

  private async reconcile(): Promise<void> {
    try {
      const nextTargets = currentTargets(await this.watchlist.list())
      const nextSnapshot = targetKey(nextTargets)
      if (this.targetSnapshot === nextSnapshot) return
      this.targetSnapshot = nextSnapshot
      this.targets = nextTargets
      this.cancelReconnect()
      await this.closeActiveStream()
      if (!nextTargets.length) {
        await this.markNoTargets()
        return
      }
      await this.openTargets(nextTargets)
    } finally {
      if (this.running) this.scheduleReconcile()
    }
  }

  private async openTargets(targets: readonly AisTrackingVessel[]): Promise<void> {
    const generation = ++this.generation
    this.closedGenerations.delete(generation)
    try {
      const handle = await this.options.provider.openStream({
        vessels: targets,
        callbacks: {
          onPosition: position => this.handlePosition(generation, position, targets),
          onSubscriptionConfirmed: () => this.handleSubscriptionConfirmed(generation),
          onError: error => this.handleStreamError(generation, error),
          onClose: error => this.handleStreamClose(generation, error),
        },
      })
      if (!this.running || generation !== this.generation || this.closedGenerations.has(generation)) {
        await handle.close()
        return
      }
      this.activeHandle = handle
      await this.enqueueWrite(async () => {
        await this.runtime.updateProviderRuntime({
          providerId: this.options.provider.providerId,
          capability: AIS_TRACKING_CAPABILITY,
          lastRequestAt: this.now().toISOString(),
          updatedAt: this.now().toISOString(),
        })
      })
    } catch (error) {
      await this.handleStreamClose(generation, errorFor(error))
    }
  }

  private handleSubscriptionConfirmed(generation: number): Promise<void> {
    if (!this.running || generation !== this.generation || this.closedGenerations.has(generation)) return Promise.resolve()
    this.reconnectAttempt = 0
    this.errorCode = undefined
    return this.enqueueWrite(async () => {
      const current = await this.runtime.getProviderRuntime(this.options.provider.providerId, AIS_TRACKING_CAPABILITY)
      const updated = await this.runtime.updateProviderRuntime({
        providerId: this.options.provider.providerId,
        capability: AIS_TRACKING_CAPABILITY,
        status: current?.status ?? "never_succeeded",
        errorCode: null,
        errorMessage: null,
        updatedAt: this.now().toISOString(),
      })
      this.applyRuntime(updated)
    })
  }

  private handlePosition(generation: number, position: AisPosition, targets: readonly AisTrackingVessel[]): Promise<void> {
    if (!this.running || generation !== this.generation || this.closedGenerations.has(generation)) return Promise.resolve()
    this.lastMessageAt = this.now().toISOString()
    return this.enqueueWrite(async () => {
      const persistedAt = this.now().toISOString()
      await this.positions.savePositions([position], targets, persistedAt)
      const updated = await this.runtime.updateProviderRuntime({
        providerId: this.options.provider.providerId,
        capability: AIS_TRACKING_CAPABILITY,
        status: "healthy",
        lastRequestAt: undefined,
        lastSuccessAt: persistedAt,
        lastSourceUpdatedAt: position.timestamp,
        consecutiveFailures: 0,
        errorCode: null,
        errorMessage: null,
        updatedAt: persistedAt,
      })
      this.lastPersistedAt = persistedAt
      this.errorCode = undefined
      this.applyRuntime(updated)
    }).catch(async (error) => {
      await this.handlePersistenceFailure(error)
    })
  }

  private handleStreamError(generation: number, error: Error): Promise<void> {
    if (!this.running || generation !== this.generation) return Promise.resolve()
    this.errorCode = errorFor(error).code
    return Promise.resolve()
  }

  private async handleStreamClose(generation: number, error?: Error): Promise<void> {
    if (!this.running || generation !== this.generation || this.closedGenerations.has(generation)) return
    this.closedGenerations.add(generation)
    this.activeHandle = undefined
    const failure = errorFor(error ?? new Error("aisstream_connection_closed"))
    this.errorCode = failure.code
    await this.markFailure(failure)
    if (!this.isTerminal(failure.code) && this.targets.length) this.scheduleReconnect(failure.code)
  }

  private async markNoTargets(): Promise<void> {
    this.errorCode = "no_eligible_ais_targets"
    await this.enqueueWrite(async () => {
      const current = await this.runtime.getProviderRuntime(this.options.provider.providerId, AIS_TRACKING_CAPABILITY)
      const updated = await this.runtime.updateProviderRuntime({
        providerId: this.options.provider.providerId,
        capability: AIS_TRACKING_CAPABILITY,
        status: current?.lastSuccessAt ? current.status : "never_succeeded",
        errorCode: "no_eligible_ais_targets",
        errorMessage: "No eligible watched vessel with valid MMSI",
        updatedAt: this.now().toISOString(),
      })
      this.applyRuntime(updated)
    })
  }

  private async markFailure(error: ProviderError): Promise<void> {
    await this.enqueueWrite(async () => {
      const current = await this.runtime.getProviderRuntime(this.options.provider.providerId, AIS_TRACKING_CAPABILITY)
      const updated = await this.runtime.updateProviderRuntime({
        providerId: this.options.provider.providerId,
        capability: AIS_TRACKING_CAPABILITY,
        status: current?.lastSuccessAt ? "degraded" : "failed",
        lastFailureAt: this.now().toISOString(),
        consecutiveFailures: (current?.consecutiveFailures ?? 0) + 1,
        errorCode: error.code,
        errorMessage: error.message,
        updatedAt: this.now().toISOString(),
      })
      this.applyRuntime(updated)
    })
  }

  private async handlePersistenceFailure(error: unknown): Promise<void> {
    const persistenceError = new ProviderError("provider_unavailable", `ais_persistence_failed: ${error instanceof Error ? error.message : String(error)}`)
    this.errorCode = "ais_persistence_failed"
    await this.enqueueWrite(async () => {
      const current = await this.runtime.getProviderRuntime(this.options.provider.providerId, AIS_TRACKING_CAPABILITY)
      const updated = await this.runtime.updateProviderRuntime({
        providerId: this.options.provider.providerId,
        capability: AIS_TRACKING_CAPABILITY,
        status: current?.lastSuccessAt ? "degraded" : "failed",
        lastFailureAt: this.now().toISOString(),
        consecutiveFailures: (current?.consecutiveFailures ?? 0) + 1,
        errorCode: "ais_persistence_failed",
        errorMessage: persistenceError.message,
        updatedAt: this.now().toISOString(),
      })
      this.applyRuntime(updated)
    })
  }

  private scheduleReconnect(errorCode: ProviderFailureCode): void {
    if (!this.running || this.reconnectTimer || !this.targets.length) return
    const delay = errorCode === "rate_limited"
      ? AIS_LIVE_RATE_LIMIT_RECONNECT_DELAY_MS
      : this.reconnectDelaysMs[Math.min(this.reconnectAttempt, this.reconnectDelaysMs.length - 1)]
    this.reconnectAttempt = Math.min(this.reconnectAttempt + 1, this.reconnectDelaysMs.length)
    this.reconnectTimer = this.setTimer(() => {
      this.reconnectTimer = undefined
      void this.openTargets(this.targets)
    }, delay)
  }

  private isTerminal(errorCode: ProviderFailureCode): boolean {
    return errorCode === "auth_failed" || errorCode === "provider_contract_changed"
  }

  private async closeActiveStream(): Promise<void> {
    this.generation++
    const handle = this.activeHandle
    this.activeHandle = undefined
    if (handle) await handle.close()
  }

  private scheduleReconcile(): void {
    if (!this.running || this.reconcileTimer) return
    this.reconcileTimer = this.setTimer(() => {
      this.reconcileTimer = undefined
      void this.reconcileNow().catch(() => undefined)
    }, this.refreshSeconds * 1000)
  }

  private cancelReconnect(): void {
    if (!this.reconnectTimer) return
    this.clearTimer(this.reconnectTimer)
    this.reconnectTimer = undefined
    this.reconnectAttempt = 0
  }

  private clearTimers(): void {
    if (this.reconcileTimer) this.clearTimer(this.reconcileTimer)
    if (this.reconnectTimer) this.clearTimer(this.reconnectTimer)
    this.reconcileTimer = undefined
    this.reconnectTimer = undefined
  }

  private applyRuntime(runtime: ProviderRuntimeRecord): void {
    this.providerStatus = runtime.status
    this.lastSuccessAt = runtime.lastSuccessAt
    this.lastSourceUpdatedAt = runtime.lastSourceUpdatedAt
    this.errorCode = runtime.errorCode
  }

  private enqueueWrite<T>(work: () => Promise<T>): Promise<T> {
    const task = this.writeQueue.then(work)
    this.writeQueue = task.then(() => undefined, () => undefined)
    return task
  }
}

export function createAisLiveTracker(options: AisLiveTrackerOptions): AisLiveTracker {
  return new AisLiveTracker(options)
}
