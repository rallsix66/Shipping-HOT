import { appendFileSync, existsSync, mkdirSync, realpathSync, writeFileSync } from "node:fs"
import { basename, dirname, join, relative, resolve } from "node:path"
import process from "node:process"
import NativeDatabase from "better-sqlite3"
import { createDatabase } from "db0"
import sqliteConnector from "db0/connectors/better-sqlite3"
import type { IntelFetchDeps } from "#/intel/collect"
import { IntelRepository } from "#/database/intel"
import { bootstrapBackgroundRuntime, getBackgroundRuntime, shutdownBackgroundRuntime } from "#/runtime/bootstrap"
import { createIntelCollectJob } from "#/runtime/intel-collect-job"
import { productionIntelOptions } from "#/runtime/intel-production"
import { type IntelObservationConfig, type ObservationEvent, createObservationNetwork, validateObservationConfig } from "#/runtime/intel-observation-network"
import type { BackgroundRuntime, BackgroundRuntimeOptions } from "#/runtime/background-runtime"

let observationActive = false

/** A new direct child of repo/.tmp only. Existing databases/runs are never resumed or reset. */
export function validateObservationDirectory(workspace: string, directory: string): string {
  const root = realpathSync(workspace)
  const tmp = realpathSync(join(root, ".tmp"))
  if (tmp !== join(root, ".tmp") || relative(root, tmp).startsWith("..") || dirname(realpathSync(directory)) !== tmp || resolve(directory) !== realpathSync(directory) || !/^r2-intel-observe-[a-z0-9-]{1,64}$/.test(basename(directory))) throw new Error("observation_directory_invalid")
  if (existsSync(join(directory, ".data")) || existsSync(join(directory, "manifest.json")) || existsSync(join(directory, "events.jsonl"))) throw new Error("observation_run_exists")
  return realpathSync(directory)
}

export async function startIntelObservation(options: {
  workspace: string
  directory: string
  config: IntelObservationConfig
  fetch: IntelFetchDeps
  codeIdentity: Record<string, unknown>
  evidenceMode: "offline" | "live"
  now?: () => Date
  runtimeOptions?: BackgroundRuntimeOptions
  stopSignal?: AbortSignal
}) {
  if (observationActive || getBackgroundRuntime()) throw new Error("observation_runtime_already_active")
  const config = validateObservationConfig(options.config)
  const directory = validateObservationDirectory(options.workspace, options.directory)
  if (process.env.SHIPPING_DATA_MODE !== "real") throw new Error("observation_real_mode_required")
  const now = options.now ?? (() => new Date())
  const startedAt = now().getTime()
  const databasePath = join(directory, ".data/shipping-hot-v3.sqlite3")
  const database = createDatabase(sqliteConnector({ cwd: directory, path: ".data/shipping-hot-v3.sqlite3" }))
  const repository = new IntelRepository(database)
  let runtime: BackgroundRuntime | undefined
  let booting: Promise<BackgroundRuntime> | undefined
  let ending: Promise<void> | undefined
  let sequence = 0
  const seenRuns = new Set<string>()
  let resolveDone!: (value: Record<string, unknown>) => void
  let rejectDone!: (error: unknown) => void
  const done = new Promise<Record<string, unknown>>((resolve, reject) => {
    resolveDone = resolve
    rejectDone = reject
  })
  void done.catch(() => {})
  const writeEvent = (event: ObservationEvent) => appendFileSync(join(directory, "events.jsonl"), `${JSON.stringify({ sequence: ++sequence, at: now().toISOString(), ...event })}\n`)
  const network = createObservationNetwork({ config, fetch: options.fetch, startedAt, now: () => now().getTime(), record: writeEvent, onStop: () => {
    runtime?.stop()
    if (booting) {
      queueMicrotask(() => {
        void finish()
      })
    }
  } })
  const record = (event: ObservationEvent) => {
    try {
      writeEvent(event)
    } catch {
      network.stop("ledger_failed")
      throw new Error("observation_ledger_failed")
    }
  }
  const production = productionIntelOptions({ env: { SHIPPING_INTEL_ENABLED: "true", SHIPPING_INTEL_SOURCE_IDS: config.sourceIds.join(",") }, cwd: directory, dependencies: { fetch: network.fetch, acquireOwnership: async () => {
    const { acquireIntelDatabaseOwnership } = await import("#/runtime/intel-ownership")
    return acquireIntelDatabaseOwnership(databasePath)
  } } })
  const seeds = production.registry!.intel!.seeds!
  const base = createIntelCollectJob({ db: database, enabled: true, fetch: network.fetch, seeds, signal: network.collectionSignal, now })
  const job = { ...base, async run() {
    const result = await base.run()
    for (const seed of seeds) {
      const source = await repository.getSource(seed.id)
      for (const run of await repository.listRuns(seed.id)) {
        if (seenRuns.has(run.id)) continue
        record({ type: "source_run", sourceId: seed.id, run })
        seenRuns.add(run.id)
      }
      if (source) record({ type: "source_state", sourceId: source.id, status: source.status, failures: source.consecutiveFailures, lastOkAt: source.lastOkAt, nextSyncAt: source.nextSyncAt })
    }
    record({ type: "job_result", result })
    return result
  } }
  const manifest = { evidenceMode: options.evidenceMode, codeIdentity: options.codeIdentity, processCwd: process.cwd(), directory, databasePath, startedAt: new Date(startedAt).toISOString(), until: new Date(startedAt + config.durationMs).toISOString(), config, frequency: { jobTickMinutes: 15, adaptiveMinMinutes: 15, adaptiveMaxMinutes: 60 }, sources: seeds, registeredJobs: [job.id], resumeSupported: false, paidJobsRegistered: false }
  mkdirSync(join(directory, ".data"))
  writeFileSync(databasePath, "", { flag: "wx", mode: 0o600 })
  writeFileSync(join(directory, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, { flag: "wx" })
  writeFileSync(join(directory, "events.jsonl"), "", { flag: "wx" })
  record({ type: "start" })
  const deadlineTimer = setTimeout(() => network.stop("deadline"), config.durationMs)
  const externalStop = () => network.stop("operator_stop")
  observationActive = true
  booting = bootstrapBackgroundRuntime({ database, jobs: [job], enabled: true, acquireIntelOwnership: production.acquireIntelOwnership, recoverInterruptedIntel: true, runtimeOptions: { ...options.runtimeOptions, now } })
  options.stopSignal?.addEventListener("abort", externalStop, { once: true })
  if (options.stopSignal?.aborted) externalStop()
  try {
    runtime = await booting
    try {
      network.check()
    } catch { /* check requests the matching lifecycle stop */ }
  } catch (error) {
    clearTimeout(deadlineTimer)
    options.stopSignal?.removeEventListener("abort", externalStop)
    await database.dispose()
    observationActive = false
    record({ type: "bootstrap_failed" })
    throw error
  }
  return { runtime, done, databasePath, network: network.snapshot, stop: async () => {
    network.stop("operator_stop")
    await done
  } }

  function finish(): Promise<void> {
    return ending ??= (async () => {
      let drained = false
      try {
        await booting
        await shutdownBackgroundRuntime() // stop → drain → executor.end → owned-lock release
        drained = true
        await database.dispose()
        const reopened = new NativeDatabase(databasePath, { readonly: true })
        let counts: Record<string, number>
        let sources: unknown[]
        try {
          reopened.exec("PRAGMA query_only = ON")
          const tables = reopened.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]
          counts = Object.fromEntries(tables.map(row => [row.name, Number((reopened.prepare(`SELECT COUNT(*) AS n FROM "${row.name.replace(/"/g, "\"\"")}"`).get() as { n: number }).n)]))
          const selectedIds = seeds.map(seed => seed.id)
          const parameters = selectedIds.map(() => "?").join(",")
          sources = reopened.prepare(`SELECT id, status, consecutive_failures, next_sync_at, last_ok_at FROM intel_source WHERE id IN (${parameters})`).all(...selectedIds)
          if (Number((reopened.prepare(`SELECT COUNT(*) AS n FROM intel_fetch_run WHERE source_id NOT IN (${parameters})`).get(...selectedIds) as { n: number }).n) !== 0) throw new Error("observation_source_out_of_scope")
          if (tables.some(row => /receipt|attempt|translation_cache/.test(row.name) && counts[row.name] !== 0)) throw new Error("observation_paid_state_nonzero")
          if (Number((reopened.prepare("SELECT COUNT(*) AS n FROM provider_usage WHERE provider_id <> 'intel-collect'").get() as { n: number }).n) !== 0) throw new Error("observation_provider_usage_out_of_scope")
        } finally {
          reopened.close()
        }
        const result = { evidenceMode: options.evidenceMode, stoppedAt: now().toISOString(), elapsedMs: now().getTime() - startedAt, ...network.snapshot(), databasePath, counts, sources, readOnlyReopen: true, ownershipReleased: !existsSync(`${databasePath}.intel-owner.lock`), continuous24hAcceptance: "NOT_GRANTED; clock/sleep/network gaps require independent review" }
        record({ type: "finished", reason: result.reason })
        writeFileSync(join(directory, "result.json"), `${JSON.stringify(result, null, 2)}\n`, { flag: "wx" })
        observationActive = false
        resolveDone(result)
      } catch (error) {
        // No lock deletion, forced DB close, resume or false successful receipt on incomplete drain.
        try {
          record({ type: "shutdown_incomplete" })
        } catch { /* original evidence retained */ }
        if (drained) observationActive = false
        rejectDone(error)
      } finally {
        clearTimeout(deadlineTimer)
        options.stopSignal?.removeEventListener("abort", externalStop)
      }
    })()
  }
}
