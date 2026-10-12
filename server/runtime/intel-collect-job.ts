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
  /** Required to do any work. R2 first slice only wires offline fetchers (fixtures); there is no network default. */
  fetch?: IntelFetchDeps
  seeds?: readonly IntelSourceSeed[]
  intervalMs?: number
  now?: () => Date
}

export interface IntelCollectJob extends RuntimeJob {
  readonly executorId: string
  /** Confirms this executor has stopped so another executor may recover its leftover runs. */
  end: () => Promise<void>
}

/**
 * Registers on the single BackgroundRuntime as an ordinary RuntimeJob; no second scheduler. Not added to registry.ts in this slice.
 * Each instance is one executor. It only recovers runs of executors confirmed ended; it never infers that a run is dead from
 * its age. Crash leftovers are handled by the explicit `recoverIntelRunsAtExclusiveStartup` step.
 */
export function createIntelCollectJob(options: IntelCollectJobOptions): IntelCollectJob {
  const repository = new IntelRepository(options.db)
  const now = options.now ?? (() => new Date())
  const seeds = options.seeds ?? intelSourceSeeds
  const executorId = randomUUID()
  let registered = false

  return {
    id: INTEL_COLLECT_JOB_ID,
    providerId: INTEL_COLLECT_JOB_ID,
    capability: INTEL_COLLECT_CAPABILITY,
    intervalMs: options.intervalMs ?? 15 * 60 * 1000,
    enabled: options.enabled ?? false,
    executorId,
    async end() {
      if (registered) await repository.endExecutor(executorId, now().toISOString())
    },
    async run(): Promise<SyncResult> {
      if (!options.fetch) return { status: "skipped", errorCode: "offline_fetcher_not_configured", preserveRuntimeEvidence: true }
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
        let outcome: IntelCollectOutcome
        try {
          outcome = await collectIntelSource(repository, seed, options.fetch, now(), executorId)
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
    },
  }
}

/**
 * Explicit, exclusive startup recovery. Call only at process startup, before any intel executor runs, in a deployment
 * where this process is the only executor (current: single local Windows process). Not called by any job instance.
 */
export async function recoverIntelRunsAtExclusiveStartup(db: Database, now: Date = new Date()): Promise<number> {
  return new IntelRepository(db).recoverAllRunsAtExclusiveStartup(now.toISOString())
}
