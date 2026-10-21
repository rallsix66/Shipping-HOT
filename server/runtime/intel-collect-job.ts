import { randomUUID } from "node:crypto"
import type { Database } from "db0"
import { IntelRepository } from "#/database/intel"
import { type IntelCollectOutcome, type IntelFetchDeps, collectIntelSource } from "#/intel/collect"
import { type IntelSourceSeed, intelSourceSeeds } from "#/intel/sources"
import type { RuntimeJob, SyncResult } from "#/runtime/background-runtime"

export const INTEL_COLLECT_JOB_ID = "intel-collect"
export const INTEL_COLLECT_CAPABILITY = "intel_collect"

export interface IntelCollectJobOptions {
  db: Database
  /** Default false: the job is off unless explicitly enabled. */
  enabled?: boolean
  /** Required to do any work; this job has no network default. Callers supply the reviewed dependencies. */
  fetch?: IntelFetchDeps
  seeds?: readonly IntelSourceSeed[]
  intervalMs?: number
  now?: () => Date
  /** Optional outer observation stop: finish the current source, never start another one. */
  signal?: AbortSignal
}

export interface IntelCollectJob extends RuntimeJob {
  readonly executorId: string
  /**
   * Confirms this executor has stopped so another executor may recover its leftover runs.
   * Rejects with `intel_executor_busy` while a run is active; after end, run() is refused with `intel_executor_ended`.
   */
  end: () => Promise<void>
}

/**
 * Registers on the single BackgroundRuntime through registry.ts; default disabled and no implicit registry sources/fetcher.
 * Each instance is one executor. It only recovers runs of executors confirmed ended; it never infers that a run is dead from
 * its age. Crash leftovers are handled by the explicit `recoverIntelRunsAtExclusiveStartup` step.
 */
export function createIntelCollectJob(options: IntelCollectJobOptions): IntelCollectJob {
  const repository = new IntelRepository(options.db)
  const now = options.now ?? (() => new Date())
  const seeds = options.seeds ?? intelSourceSeeds
  const executorId = randomUUID()
  let registered = false
  let active = false
  let ended = false

  return {
    id: INTEL_COLLECT_JOB_ID,
    providerId: INTEL_COLLECT_JOB_ID,
    capability: INTEL_COLLECT_CAPABILITY,
    intervalMs: options.intervalMs ?? 15 * 60 * 1000,
    enabled: options.enabled ?? false,
    executorId,
    async end() {
      if (active) throw new Error("intel_executor_busy: cannot end while a run is active")
      ended = true
      if (registered) await repository.endExecutor(executorId, now().toISOString())
    },
    async run(): Promise<SyncResult> {
      if (ended) return { status: "failed", errorCode: "intel_executor_ended", errorMessage: "this executor has ended; create a new job instance" }
      if (options.signal?.aborted) return { status: "skipped", errorCode: "intel_collection_stopped", preserveRuntimeEvidence: true }
      if (active) return { status: "skipped", errorCode: "job_running" }
      if (!options.fetch) return { status: "skipped", errorCode: "offline_fetcher_not_configured", preserveRuntimeEvidence: true }
      active = true
      try {
        return await runOnce(options.fetch)
      } finally {
        active = false
      }
    },
  }

  async function runOnce(fetchDeps: IntelFetchDeps): Promise<SyncResult> {
    const startedAt = now().toISOString()
    let due: Set<string>
    try {
      if (!registered) {
        await repository.registerExecutor(executorId, startedAt)
        registered = true
      }
      await repository.recoverRunsOfEndedExecutors(startedAt)
      for (const seed of seeds) await repository.upsertSource(seed, startedAt)
      due = new Set((await repository.listDueSources(startedAt)).map(source => source.id))
    } catch (error) {
      return { status: "failed", errorCode: "intel_storage_unavailable", errorMessage: (error instanceof Error ? error.message : "storage unavailable").slice(0, 300) }
    }
    let read = 0
    let written = 0
    let failed = 0
    let attempted = 0
    let storageUnavailable = 0
    for (const seed of seeds.filter(item => due.has(item.id))) {
      if (options.signal?.aborted) break
      let outcome: IntelCollectOutcome
      try {
        outcome = await collectIntelSource(repository, seed, fetchDeps, now(), executorId)
      } catch (error) {
        outcome = { status: "storage_unavailable", runId: null, errorCode: "collect_threw", storageError: error instanceof Error ? error.message : "collect threw" }
      }
      if (outcome.status === "skipped") continue
      attempted++
      if (outcome.status === "storage_unavailable") {
        storageUnavailable++
        continue
      }
      if (outcome.status === "failed") {
        failed++
        continue
      }
      read += outcome.itemsSeen
      written += outcome.itemsNew + outcome.itemsRevised
    }
    if (storageUnavailable > 0) return { status: "failed", errorCode: "intel_storage_unavailable", errorMessage: `${storageUnavailable} source run(s) could not be recorded`, recordsRead: read, recordsWritten: written }
    if (attempted > 0 && failed === attempted) return { status: "failed", errorCode: "intel_all_sources_failed", recordsRead: read, recordsWritten: written }
    return { status: "success", recordsRead: read, recordsWritten: written }
  }
}

/**
 * Explicit, exclusive startup recovery. Call only at process startup, before any intel executor runs, in a deployment
 * where this process is the only executor (current: single local Windows process). Not called by any job instance.
 */
export async function recoverIntelRunsAtExclusiveStartup(db: Database, now: Date = new Date()): Promise<number> {
  return new IntelRepository(db).recoverAllRunsAtExclusiveStartup(now.toISOString())
}
