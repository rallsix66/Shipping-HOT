import type { ProviderRuntimeRecord, SyncRunRecord } from "#/providers/contracts"
import type { RuntimeRepository } from "#/database/runtime-jobs"
import { logger as defaultLogger } from "#/utils/logger"

export type SyncResultStatus = "success" | "failed" | "skipped"

export interface SyncResult {
  status: SyncResultStatus
  recordsRead?: number
  recordsWritten?: number
  sourceUpdatedAt?: string
  errorCode?: string
  errorMessage?: string
}

export interface RuntimeJob {
  id: string
  providerId: string
  capability: string
  intervalMs: number
  enabled: boolean
  run: () => Promise<SyncResult>
}

export type RuntimeExecutionStatus = "idle" | "running" | SyncResultStatus

export interface RuntimeJobStatus {
  id: string
  providerId: string
  capability: string
  intervalMs: number
  enabled: boolean
  status: ProviderRuntimeRecord["status"]
  executionStatus: RuntimeExecutionStatus
  lastSuccessAt?: string
  lastFailureAt?: string
  nextSyncAt?: string
  consecutiveFailures: number
  errorCode?: string
}

export interface BackgroundRuntimeStatus {
  running: boolean
  startedAt?: string
  jobs: RuntimeJobStatus[]
}

export interface RuntimeLogger {
  info: (message: string, ...args: unknown[]) => void
  error: (message: string, ...args: unknown[]) => void
}

export interface BackgroundRuntimeOptions {
  now?: () => Date
  setTimeout?: typeof globalThis.setTimeout
  clearTimeout?: typeof globalThis.clearTimeout
  logger?: RuntimeLogger
}

interface JobState {
  job: RuntimeJob
  providerStatus: ProviderRuntimeRecord["status"]
  executionStatus: RuntimeExecutionStatus
  lastSuccessAt?: string
  lastFailureAt?: string
  nextSyncAt?: string
  consecutiveFailures: number
  errorCode?: string
}

function errorDetails(error: unknown): { errorCode: string, errorMessage: string } {
  if (error instanceof Error) {
    return { errorCode: "job_failed", errorMessage: safeErrorMessage(error.message) }
  }
  return { errorCode: "job_failed", errorMessage: safeErrorMessage(String(error)) }
}

function safeErrorMessage(message: string): string {
  return message
    .replace(/(api[_ -]?key|authorization|bearer|token|secret)\s*[=:]\s*[^\s,;]+/gi, "$1=[redacted]")
    .replace(/([?&](?:key|token|secret|api[_-]?key)=)[^&\s]+/gi, "$1[redacted]")
    .slice(0, 500)
}

function toDelay(nextSyncAt: string | undefined, now: Date, fallbackMs: number): number {
  if (!nextSyncAt) return fallbackMs
  const parsed = Date.parse(nextSyncAt)
  if (!Number.isFinite(parsed)) return fallbackMs
  return Math.max(0, parsed - now.getTime())
}

export class BackgroundRuntime {
  private readonly jobs = new Map<string, JobState>()
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>()
  private readonly inFlight = new Set<string>()
  private readonly now: () => Date
  private readonly setTimer: typeof globalThis.setTimeout
  private readonly clearTimer: typeof globalThis.clearTimeout
  private readonly log: RuntimeLogger
  private running = false
  private startedAt?: string
  private startPromise?: Promise<void>

  constructor(private readonly repository: RuntimeRepository, options: BackgroundRuntimeOptions = {}) {
    this.now = options.now ?? (() => new Date())
    this.setTimer = options.setTimeout ?? globalThis.setTimeout
    this.clearTimer = options.clearTimeout ?? globalThis.clearTimeout
    this.log = options.logger ?? defaultLogger
  }

  register(job: RuntimeJob): void {
    if (!job.id || !job.providerId || !job.capability) throw new Error("runtime_job_identity_required")
    if (!Number.isFinite(job.intervalMs) || job.intervalMs <= 0) throw new Error("runtime_job_interval_invalid")
    if (this.jobs.has(job.id)) return
    this.jobs.set(job.id, {
      job,
      providerStatus: job.enabled ? "never_succeeded" : "disabled",
      executionStatus: "idle",
      consecutiveFailures: 0,
    })
    if (this.running) void this.prepareAndSchedule(this.jobs.get(job.id)!)
  }

  async start(): Promise<void> {
    if (this.running) return this.startPromise
    this.running = true
    this.startedAt = this.now().toISOString()
    this.startPromise = (async () => {
      for (const state of this.jobs.values()) await this.prepareAndSchedule(state)
      this.log.info("runtime started", { jobs: this.jobs.size })
    })()
    try {
      await this.startPromise
    } finally {
      this.startPromise = undefined
    }
  }

  stop(): void {
    if (!this.running) return
    this.running = false
    for (const timer of this.timers.values()) this.clearTimer(timer)
    this.timers.clear()
    this.log.info("runtime stopped")
  }

  async runNow(jobId: string): Promise<SyncResult> {
    const state = this.jobs.get(jobId)
    if (!state) return { status: "skipped", errorCode: "job_not_found" }
    if (!this.running) return { status: "skipped", errorCode: "runtime_stopped" }
    if (!state.job.enabled) return { status: "skipped", errorCode: "job_disabled" }
    return this.execute(state)
  }

  getStatus(): BackgroundRuntimeStatus {
    return {
      running: this.running,
      startedAt: this.startedAt,
      jobs: [...this.jobs.values()].map(state => ({
        id: state.job.id,
        providerId: state.job.providerId,
        capability: state.job.capability,
        intervalMs: state.job.intervalMs,
        enabled: state.job.enabled,
        status: state.providerStatus,
        executionStatus: state.executionStatus,
        lastSuccessAt: state.lastSuccessAt,
        lastFailureAt: state.lastFailureAt,
        nextSyncAt: state.nextSyncAt,
        consecutiveFailures: state.consecutiveFailures,
        errorCode: state.errorCode,
      })),
    }
  }

  private async prepareAndSchedule(state: JobState): Promise<void> {
    if (!this.running) return
    if (!state.job.enabled) {
      state.providerStatus = "disabled"
      state.nextSyncAt = undefined
      await this.repository.updateProviderRuntime({
        providerId: state.job.providerId,
        capability: state.job.capability,
        status: "disabled",
        nextSyncAt: null,
        updatedAt: this.now().toISOString(),
      })
      return
    }
    const persisted = await this.repository.getProviderRuntime(state.job.providerId)
    if (persisted) {
      state.providerStatus = persisted.status
      state.lastSuccessAt = persisted.lastSuccessAt
      state.lastFailureAt = persisted.lastFailureAt
      state.nextSyncAt = persisted.nextSyncAt
      state.consecutiveFailures = persisted.consecutiveFailures
      state.errorCode = persisted.errorCode
    } else {
      const nextSyncAt = new Date(this.now().getTime() + state.job.intervalMs).toISOString()
      const created = await this.repository.updateProviderRuntime({
        providerId: state.job.providerId,
        capability: state.job.capability,
        status: "never_succeeded",
        nextSyncAt,
        consecutiveFailures: 0,
        updatedAt: this.now().toISOString(),
      })
      state.nextSyncAt = created.nextSyncAt
    }
    this.schedule(state, toDelay(state.nextSyncAt, this.now(), state.job.intervalMs))
  }

  private schedule(state: JobState, delayMs: number): void {
    if (!this.running || !state.job.enabled) return
    const existing = this.timers.get(state.job.id)
    if (existing) this.clearTimer(existing)
    const nextSyncAt = new Date(this.now().getTime() + delayMs).toISOString()
    state.nextSyncAt = nextSyncAt
    const timer = this.setTimer(() => {
      this.timers.delete(state.job.id)
      void this.execute(state).finally(() => {
        if (this.running) this.schedule(state, state.job.intervalMs)
      })
    }, delayMs)
    this.timers.set(state.job.id, timer)
  }

  private async execute(state: JobState): Promise<SyncResult> {
    if (this.inFlight.has(state.job.id)) return { status: "skipped", errorCode: "job_running" }
    if (!this.running || !state.job.enabled) return { status: "skipped", errorCode: "runtime_stopped" }
    this.inFlight.add(state.job.id)
    state.executionStatus = "running"
    const startedAt = this.now().toISOString()
    let syncRun: SyncRunRecord | undefined
    this.log.info("job started", { jobId: state.job.id, providerId: state.job.providerId, capability: state.job.capability })
    try {
      syncRun = await this.repository.createSyncRun({ providerId: state.job.providerId, capability: state.job.capability, startedAt })
      await this.repository.updateProviderRuntime({
        providerId: state.job.providerId,
        capability: state.job.capability,
        lastRequestAt: startedAt,
        updatedAt: startedAt,
      })
      const result = await state.job.run()
      const completedAt = this.now().toISOString()
      const nextSyncAt = new Date(this.now().getTime() + state.job.intervalMs).toISOString()
      if (result.status === "success") {
        await this.repository.completeSyncRun({ id: syncRun.id, completedAt, status: "success", recordsRead: result.recordsRead, recordsWritten: result.recordsWritten })
        const runtime = await this.repository.updateProviderRuntime({
          providerId: state.job.providerId,
          capability: state.job.capability,
          status: "healthy",
          lastRequestAt: startedAt,
          lastSuccessAt: completedAt,
          lastSourceUpdatedAt: result.sourceUpdatedAt ?? null,
          nextSyncAt,
          consecutiveFailures: 0,
          errorCode: null,
          errorMessage: null,
          updatedAt: completedAt,
        })
        this.applyRuntimeState(state, runtime, "success")
        this.log.info("job success", { jobId: state.job.id, providerId: state.job.providerId })
      } else if (result.status === "skipped") {
        await this.repository.completeSyncRun({ id: syncRun.id, completedAt, status: "skipped", recordsRead: result.recordsRead, recordsWritten: result.recordsWritten, errorCode: result.errorCode, errorMessage: result.errorMessage })
        state.executionStatus = "skipped"
      } else {
        const details = { errorCode: result.errorCode ?? "job_failed", errorMessage: safeErrorMessage(result.errorMessage ?? "job failed") }
        await this.repository.completeSyncRun({ id: syncRun.id, completedAt, status: "failed", recordsRead: result.recordsRead, recordsWritten: result.recordsWritten, errorCode: details.errorCode, errorMessage: details.errorMessage })
        const current = await this.repository.getProviderRuntime(state.job.providerId)
        const runtime = await this.repository.updateProviderRuntime({
          providerId: state.job.providerId,
          capability: state.job.capability,
          status: current?.lastSuccessAt ? "degraded" : "failed",
          lastRequestAt: startedAt,
          lastFailureAt: completedAt,
          nextSyncAt,
          consecutiveFailures: (current?.consecutiveFailures ?? 0) + 1,
          errorCode: details.errorCode,
          errorMessage: details.errorMessage,
          updatedAt: completedAt,
        })
        this.applyRuntimeState(state, runtime, "failed")
        this.log.error("job failed", { jobId: state.job.id, providerId: state.job.providerId, errorCode: details.errorCode })
      }
      return result
    } catch (error) {
      const details = errorDetails(error)
      const completedAt = this.now().toISOString()
      if (syncRun) {
        await this.repository.completeSyncRun({ id: syncRun.id, completedAt, status: "failed", errorCode: details.errorCode, errorMessage: details.errorMessage })
      }
      const current = await this.repository.getProviderRuntime(state.job.providerId)
      const runtime = await this.repository.updateProviderRuntime({
        providerId: state.job.providerId,
        capability: state.job.capability,
        status: current?.lastSuccessAt ? "degraded" : "failed",
        lastRequestAt: startedAt,
        lastFailureAt: completedAt,
        nextSyncAt: new Date(this.now().getTime() + state.job.intervalMs).toISOString(),
        consecutiveFailures: (current?.consecutiveFailures ?? 0) + 1,
        errorCode: details.errorCode,
        errorMessage: details.errorMessage,
        updatedAt: completedAt,
      })
      this.applyRuntimeState(state, runtime, "failed")
      this.log.error("job failed", { jobId: state.job.id, providerId: state.job.providerId, errorCode: details.errorCode })
      return { status: "failed", errorCode: details.errorCode, errorMessage: details.errorMessage }
    } finally {
      this.inFlight.delete(state.job.id)
      if (state.executionStatus === "running") state.executionStatus = "failed"
    }
  }

  private applyRuntimeState(state: JobState, runtime: ProviderRuntimeRecord, executionStatus: SyncResultStatus): void {
    state.providerStatus = runtime.status
    state.executionStatus = executionStatus
    state.lastSuccessAt = runtime.lastSuccessAt
    state.lastFailureAt = runtime.lastFailureAt
    state.nextSyncAt = runtime.nextSyncAt
    state.consecutiveFailures = runtime.consecutiveFailures
    state.errorCode = runtime.errorCode
  }
}
