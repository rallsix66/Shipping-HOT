import type { Database } from "db0"
import { IntelRepository } from "#/database/intel"
import { type IntelFetchDeps, collectIntelSource } from "#/intel/collect"
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

/** Registers on the single BackgroundRuntime as an ordinary RuntimeJob; no second scheduler. Not added to registry.ts in this slice. */
export function createIntelCollectJob(options: IntelCollectJobOptions): RuntimeJob {
  const repository = new IntelRepository(options.db)
  const now = options.now ?? (() => new Date())
  const seeds = options.seeds ?? intelSourceSeeds
  const processStartedAt = now().toISOString()
  let recovered = false

  return {
    id: INTEL_COLLECT_JOB_ID,
    providerId: INTEL_COLLECT_JOB_ID,
    capability: INTEL_COLLECT_CAPABILITY,
    intervalMs: options.intervalMs ?? 15 * 60 * 1000,
    enabled: options.enabled ?? false,
    async run(): Promise<SyncResult> {
      if (!options.fetch) return { status: "skipped", errorCode: "offline_fetcher_not_configured", preserveRuntimeEvidence: true }
      const startedAt = now()
      if (!recovered) {
        await repository.recoverInterruptedRuns(processStartedAt, startedAt.toISOString())
        recovered = true
      }
      for (const seed of seeds) await repository.upsertSource(seed, startedAt.toISOString())
      const due = new Set((await repository.listDueSources(startedAt.toISOString())).map(source => source.id))
      let read = 0
      let written = 0
      let failed = 0
      let attempted = 0
      for (const seed of seeds.filter(item => due.has(item.id))) {
        const outcome = await collectIntelSource(repository, seed, options.fetch, now())
        if (outcome.status === "skipped") continue
        attempted++
        if (outcome.status === "failed") {
          failed++
          continue
        }
        read += outcome.itemsSeen
        written += outcome.itemsNew + outcome.itemsRevised
      }
      if (attempted > 0 && failed === attempted) return { status: "failed", errorCode: "intel_all_sources_failed", recordsRead: read, recordsWritten: written }
      return { status: "success", recordsRead: read, recordsWritten: written }
    },
  }
}
