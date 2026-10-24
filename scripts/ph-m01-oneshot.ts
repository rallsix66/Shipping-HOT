import { lookup } from "node:dns/promises"
import { existsSync, mkdirSync, readFileSync, realpathSync } from "node:fs"
import { isAbsolute, relative, resolve, sep } from "node:path"
import { parseArgs } from "node:util"
import NativeDatabase from "better-sqlite3"
import { createDatabase } from "db0"
import type { Database } from "db0"
import { initShippingTables } from "#/database/shipping"
import type { IntelFetchDeps } from "#/intel/collect"
import { registeredIntelSources } from "#/intel/sources/registry"
import { type IntelCollectJob, createIntelCollectJob } from "#/runtime/intel-collect-job"
import { acquireIntelDatabaseOwnership } from "#/runtime/intel-ownership"
import { type IntelProductionDependencies, productionIntelOptions } from "#/runtime/intel-production"
import { type ArticleTransport, defaultTransport } from "#/services/article-fetch-security"
import type { SyncResult } from "#/runtime/background-runtime"

type SqliteHandle = InstanceType<typeof NativeDatabase>

/** PH-M01 only. This file is one manual entry, not a multi-source runner. */
export const PH_M01_CATALOG_ID = "PH-M01"
export const PH_M01_SOURCE_ID = "intel:ph-m01"
export const PH_M01_FEED_URL = "https://portcalls.com/feed/"
export const PH_M01_HOST = "portcalls.com"
export const PH_M01_MAX_HTTP_REQUESTS = 4
export const PH_M01_DNS_WAIT_MS = 10_000
export const PH_M01_DATE_SEMANTICS = "rss Date.parse(pubDate|published|dc:date|created) to UTC ISO; unparseable stays null; RSS stores no dateEvidence; description is not a stored block"

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308])
const RUN_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/

export const liveFetchFactory = {
  create(): IntelFetchDeps {
    return {
      lookup: async host => (await lookup(host, { all: true })).map(row => ({ address: row.address, family: row.family as 4 | 6 })),
      transport: defaultTransport,
    }
  },
}

export interface PhM01BudgetState {
  httpRequests: number
  lookupCalls: number
  redirectResponses: number
  budgetRejections: number
  detailRequests: number
  otherHostRequests: number
  dns: "not_called" | "ok" | "timed_out" | "aborted" | "failed"
}

export interface PhM01OneshotRequest {
  mode?: "plan" | "execute"
  workspace: string
  runId?: string
  fetch?: IntelFetchDeps
  acquireOwnership?: IntelProductionDependencies["acquireOwnership"]
  signal?: AbortSignal
  now?: () => Date
  dnsWaitMs?: number
}

export interface PhM01OneshotSummary {
  mode: "plan" | "execute"
  selection: {
    catalogId: "PH-M01"
    sourceId: "intel:ph-m01"
    url: "https://portcalls.com/feed/"
    allowedHosts: ["portcalls.com"]
    persistence: "disallowed"
    registryEnabled: false
    selectedEnabled: true
    parsedSeeds: 1
  }
  httpRequests: number
  lookupCalls: number
  redirectResponses: number
  budgetRejections: number
  detailRequests: number
  otherHostRequests: number
  recordsRead: number | null
  recordsWritten: number | null
  itemsNew: number | null
  itemsRevised: number | null
  itemsUnchanged: number | null
  contentScope: "metadata_only" | null
  descriptionPersisted: boolean
  dateEvidenceRows: number | null
  dateSemantics: typeof PH_M01_DATE_SEMANTICS
  jobStatus: SyncResult["status"] | null
  jobErrorCode: string | null
  jobEnabled: boolean | null
  runStatus: string | null
  runErrorCode: string | null
  runInvoked: boolean
  enabledCatalogIds: string[]
  dns: PhM01BudgetState["dns"]
  cancellation: "none" | "during_run"
  cleanup: string[]
  reason: string
  exit: "planned" | "collected" | "failed" | "cancelled"
  exitCode: 0 | 1 | 2
  databasePath: string | null
  lockMatchesDatabase: boolean | null
  ownershipReleased: boolean
  databaseClosed: boolean
  network: "not_started" | "injected" | "live_unverified"
  liveVerified: false
}

interface RunSnapshot {
  recordsRead: number | null
  recordsWritten: number | null
  itemsNew: number | null
  itemsRevised: number | null
  itemsUnchanged: number | null
  contentScope: "metadata_only" | null
  descriptionPersisted: boolean
  dateEvidenceRows: number | null
  runStatus: string | null
  runErrorCode: string | null
  enabledCatalogIds: string[]
  runCount: number
}

function emptyBudget(): PhM01BudgetState {
  return { httpRequests: 0, lookupCalls: 0, redirectResponses: 0, budgetRejections: 0, detailRequests: 0, otherHostRequests: 0, dns: "not_called" }
}

function inertFetch(): IntelFetchDeps {
  return {
    lookup: async () => {
      throw new Error("ph_m01_plan_network")
    },
    transport: async () => {
      throw new Error("ph_m01_plan_network")
    },
  }
}

function selectionEnv(): NodeJS.ProcessEnv {
  return { SHIPPING_INTEL_ENABLED: "true", SHIPPING_INTEL_SOURCE_IDS: PH_M01_CATALOG_ID, SHIPPING_RUNTIME_ENABLED: "true" }
}

function assertPhM01Seed(seed: { id: string, catalogId: string, url: string, persistence: string, allowedHosts: readonly string[], kind: string, enabled: boolean } | undefined, parsedSeeds: number) {
  const registered = registeredIntelSources.find(item => item.catalogId === PH_M01_CATALOG_ID)
  if (!registered || registered.enabled !== false || registered.url !== PH_M01_FEED_URL || registered.persistence !== "disallowed" || registered.allowedHosts.length !== 1 || registered.allowedHosts[0] !== PH_M01_HOST) throw new Error("ph_m01_registry_contract")
  if (parsedSeeds !== 1 || !seed || seed.catalogId !== PH_M01_CATALOG_ID || seed.id !== PH_M01_SOURCE_ID || seed.url !== PH_M01_FEED_URL || seed.persistence !== "disallowed" || seed.kind !== "rss" || seed.enabled !== true || seed.allowedHosts.length !== 1 || seed.allowedHosts[0] !== PH_M01_HOST) throw new Error("ph_m01_selection_invalid")
  if (seed.allowedHosts.some(host => host !== PH_M01_HOST)) throw new Error("ph_m01_host_expanded")
}

export function selectPhM01(dependencies: IntelProductionDependencies) {
  const options = productionIntelOptions({ env: selectionEnv(), dependencies })
  const seeds = options.registry?.intel?.seeds ?? []
  const seed = seeds[0]
  assertPhM01Seed(seed, seeds.length)
  if (!options.registry?.intel?.fetch) throw new Error("ph_m01_fetch_missing")
  return { seed, fetch: options.registry.intel.fetch }
}

export function resolvePhM01Paths(workspace: string, runId: string) {
  if (!RUN_ID_PATTERN.test(runId)) throw new Error("ph_m01_run_id_invalid")
  const root = resolve(workspace)
  const tmp = resolve(root, ".tmp")
  const directory = resolve(tmp, `ph-m01-oneshot-${runId}`)
  const lexical = relative(tmp, directory)
  if (!lexical || lexical === ".." || lexical.startsWith(`..${sep}`) || isAbsolute(lexical)) throw new Error("ph_m01_directory_escape")
  const databasePath = resolve(directory, "ph-m01.sqlite3")
  return { directory, databasePath }
}

function assertRealPathContained(workspace: string, directory: string) {
  const tmp = realpathSync(resolve(workspace, ".tmp"))
  const realDirectory = realpathSync(directory)
  const contained = relative(tmp, realDirectory)
  if (!contained || contained === ".." || contained.startsWith(`..${sep}`) || isAbsolute(contained)) throw new Error("ph_m01_directory_escape")
  return realDirectory
}

export function createPhM01BoundedFetch(inner: IntelFetchDeps, signal: AbortSignal, dnsWaitMs: number, state = emptyBudget()) {
  if (!Number.isSafeInteger(dnsWaitMs) || dnsWaitMs <= 0 || dnsWaitMs > PH_M01_DNS_WAIT_MS) throw new Error("ph_m01_dns_wait_invalid")
  const lookupHost: IntelFetchDeps["lookup"] = async (host) => {
    state.lookupCalls += 1
    if (signal.aborted) {
      state.dns = "aborted"
      throw new Error("ph_m01_dns_aborted")
    }
    let timer: NodeJS.Timeout | undefined
    let onAbort: (() => void) | undefined
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        state.dns = "timed_out"
        reject(new Error("ph_m01_dns_timeout"))
      }, dnsWaitMs)
      timer.unref()
    })
    const aborted = new Promise<never>((_, reject) => {
      onAbort = () => {
        state.dns = "aborted"
        reject(new Error("ph_m01_dns_aborted"))
      }
      signal.addEventListener("abort", onAbort, { once: true })
    })
    try {
      const addresses = await Promise.race([inner.lookup(host), timeout, aborted])
      if (state.dns === "not_called") state.dns = "ok"
      return addresses
    } catch (error) {
      if (state.dns === "not_called") state.dns = "failed"
      throw error
    } finally {
      if (timer) clearTimeout(timer)
      if (onAbort) signal.removeEventListener("abort", onAbort)
    }
  }
  const transport: ArticleTransport = async (url, addresses, options) => {
    if (signal.aborted) throw new Error("fetch_timeout")
    if (state.httpRequests >= PH_M01_MAX_HTTP_REQUESTS) {
      state.budgetRejections += 1
      throw new Error("ph_m01_http_budget_exhausted")
    }
    state.httpRequests += 1
    if (url.hostname !== PH_M01_HOST) state.otherHostRequests += 1
    else if (url.pathname !== "/feed/") state.detailRequests += 1
    const linked = options.signal ? AbortSignal.any([options.signal, signal]) : signal
    try {
      const response = await inner.transport(url, addresses, { ...options, signal: linked })
      if (REDIRECT_STATUSES.has(response.status)) state.redirectResponses += 1
      return response
    } catch (error) {
      if (signal.aborted) throw new Error("fetch_timeout")
      throw error
    }
  }
  return { fetch: { lookup: lookupHost, transport }, state }
}

function openDatabase(databasePath: string) {
  const native = new NativeDatabase(databasePath)
  const database = createDatabase({
    name: "sqlite",
    dialect: "sqlite",
    getInstance: () => native,
    exec: (sql: string) => native.exec(sql),
    prepare: (sql: string) => {
      const statement = native.prepare(sql)
      return {
        all: async (...params: Array<string | number | boolean | null | undefined>) => statement.all(...params),
        get: async (...params: Array<string | number | boolean | null | undefined>) => statement.get(...params),
        run: async (...params: Array<string | number | boolean | null | undefined>) => ({ success: true, ...statement.run(...params) }),
      }
    },
    dispose: () => native.close(),
  } as never) as Database
  return { native, database }
}

function readSnapshot(native: SqliteHandle): RunSnapshot {
  const runs = native.prepare("SELECT status, error_code, items_seen, items_new, items_revised FROM intel_fetch_run").all() as Array<{ status: string, error_code: string | null, items_seen: number, items_new: number, items_revised: number }>
  const blocks = native.prepare("SELECT block_type, text FROM intel_item_block").all() as Array<{ block_type: string, text: string }>
  const versions = native.prepare("SELECT content_scope, date_evidence FROM intel_item_version").all() as Array<{ content_scope: string, date_evidence: string | null }>
  const enabled = native.prepare("SELECT catalog_id FROM intel_source WHERE enabled = 1 ORDER BY catalog_id").all() as Array<{ catalog_id: string }>
  const run = runs.length === 1 ? runs[0] : undefined
  const scopes = new Set(versions.map(row => row.content_scope))
  return {
    recordsRead: run ? run.items_seen : null,
    recordsWritten: run ? run.items_new + run.items_revised : null,
    itemsNew: run ? run.items_new : null,
    itemsRevised: run ? run.items_revised : null,
    itemsUnchanged: run ? run.items_seen - run.items_new - run.items_revised : null,
    contentScope: scopes.size === 1 && scopes.has("metadata_only") ? "metadata_only" : null,
    descriptionPersisted: blocks.some(block => block.block_type !== "title") || versions.some(row => row.content_scope !== "metadata_only"),
    dateEvidenceRows: versions.filter(row => row.date_evidence !== null).length,
    runStatus: run?.status ?? null,
    runErrorCode: run?.error_code ?? null,
    enabledCatalogIds: enabled.map(row => row.catalog_id),
    runCount: runs.length,
  }
}

function classify(result: SyncResult | undefined, snapshot: RunSnapshot | undefined, state: PhM01BudgetState, cancellation: "none" | "during_run") {
  if (cancellation === "during_run") return { exit: "cancelled" as const, exitCode: 2 as const, reason: "cancelled" }
  if (!result || result.status === "skipped") return { exit: "failed" as const, exitCode: 1 as const, reason: "skipped" }
  if (result.status === "failed") return { exit: "failed" as const, exitCode: 1 as const, reason: "source_failed" }
  if (state.httpRequests === 0) return { exit: "failed" as const, exitCode: 1 as const, reason: "not_requested" }
  if (!snapshot || snapshot.runCount !== 1) return { exit: "failed" as const, exitCode: 1 as const, reason: "run_count_rejected" }
  if ((snapshot.recordsRead ?? 0) <= 0) return { exit: "failed" as const, exitCode: 1 as const, reason: "empty_result" }
  if (state.detailRequests > 0 || state.otherHostRequests > 0) return { exit: "failed" as const, exitCode: 1 as const, reason: "detail_or_host_rejected" }
  if (!snapshot || snapshot.descriptionPersisted || snapshot.contentScope !== "metadata_only" || snapshot.enabledCatalogIds.length !== 1 || snapshot.enabledCatalogIds[0] !== PH_M01_CATALOG_ID || snapshot.dateEvidenceRows !== 0) return { exit: "failed" as const, exitCode: 1 as const, reason: "content_scope_rejected" }
  return { exit: "collected" as const, exitCode: 0 as const, reason: "collected" }
}

const selectionSummary = {
  catalogId: PH_M01_CATALOG_ID,
  sourceId: PH_M01_SOURCE_ID,
  url: PH_M01_FEED_URL,
  allowedHosts: [PH_M01_HOST] as ["portcalls.com"],
  persistence: "disallowed" as const,
  registryEnabled: false as const,
  selectedEnabled: true as const,
  parsedSeeds: 1 as const,
} satisfies PhM01OneshotSummary["selection"]

function baseSummary(mode: "plan" | "execute", network: PhM01OneshotSummary["network"], state: PhM01BudgetState): PhM01OneshotSummary {
  return {
    mode,
    selection: selectionSummary,
    httpRequests: state.httpRequests,
    lookupCalls: state.lookupCalls,
    redirectResponses: state.redirectResponses,
    budgetRejections: state.budgetRejections,
    detailRequests: state.detailRequests,
    otherHostRequests: state.otherHostRequests,
    recordsRead: null,
    recordsWritten: null,
    itemsNew: null,
    itemsRevised: null,
    itemsUnchanged: null,
    contentScope: mode === "plan" ? "metadata_only" : null,
    descriptionPersisted: false,
    dateEvidenceRows: null,
    dateSemantics: PH_M01_DATE_SEMANTICS,
    jobStatus: null,
    jobErrorCode: null,
    jobEnabled: null,
    runStatus: null,
    runErrorCode: null,
    runInvoked: false,
    enabledCatalogIds: [],
    dns: state.dns,
    cancellation: "none",
    cleanup: [],
    reason: mode === "plan" ? "planned" : "failed",
    exit: mode === "plan" ? "planned" : "failed",
    exitCode: mode === "plan" ? 0 : 1,
    databasePath: null,
    lockMatchesDatabase: null,
    ownershipReleased: false,
    databaseClosed: false,
    network,
    liveVerified: false,
  }
}

export async function runPhM01Oneshot(request: PhM01OneshotRequest): Promise<PhM01OneshotSummary> {
  const mode = request.mode ?? "plan"
  if (mode === "plan") {
    selectPhM01({ fetch: inertFetch(), acquireOwnership: async () => {
      throw new Error("ph_m01_plan_ownership")
    } })
    return baseSummary("plan", "not_started", emptyBudget())
  }
  if (!request.runId) throw new Error("ph_m01_run_id_required")
  const dnsWaitMs = request.dnsWaitMs ?? PH_M01_DNS_WAIT_MS
  const signal = request.signal ?? new AbortController().signal
  const network = request.fetch ? "injected" as const : "live_unverified" as const
  const inner = request.fetch ?? liveFetchFactory.create()
  const bounded = createPhM01BoundedFetch(inner, signal, dnsWaitMs)
  selectPhM01({ fetch: bounded.fetch, acquireOwnership: async () => {
    throw new Error("ph_m01_acquire_during_select")
  } })
  const paths = resolvePhM01Paths(request.workspace, request.runId)
  if (existsSync(paths.databasePath)) throw new Error("ph_m01_database_exists")
  if (existsSync(paths.directory)) throw new Error("ph_m01_directory_exists")
  mkdirSync(paths.directory, { recursive: true })
  const directory = assertRealPathContained(request.workspace, paths.directory)
  const databasePath = resolve(directory, "ph-m01.sqlite3")
  if (existsSync(databasePath)) throw new Error("ph_m01_database_exists")
  const summary = baseSummary("execute", network, bounded.state)
  summary.databasePath = databasePath
  let native: SqliteHandle | undefined
  let ownership: { release: () => Promise<void> } | undefined
  let job: IntelCollectJob | undefined
  let runPromise: Promise<SyncResult> | undefined
  let runSettled = false
  let cancellation: "none" | "during_run" = "none"
  const onAbort = () => {
    if (!runSettled) cancellation = "during_run"
  }
  signal.addEventListener("abort", onAbort, { once: true })
  if (signal.aborted) cancellation = "during_run"
  const cleanupFlags = { runSettled: false, jobEnded: false, databaseClosed: false, ownershipReleased: false }
  const cleanup = async () => {
    if (runPromise && !cleanupFlags.runSettled) {
      await runPromise.catch(() => undefined)
      cleanupFlags.runSettled = true
      summary.cleanup.push("run_settled")
    }
    if (job && !cleanupFlags.jobEnded) {
      await job.end()
      cleanupFlags.jobEnded = true
      summary.cleanup.push("job_ended")
      if (native) {
        const executor = native.prepare("SELECT ended_at FROM intel_executor").get() as { ended_at: string | null } | undefined
        if (executor && !executor.ended_at) throw new Error("ph_m01_executor_not_ended")
      }
    }
    if (native && !cleanupFlags.databaseClosed) {
      native.close()
      cleanupFlags.databaseClosed = true
      summary.databaseClosed = true
      summary.cleanup.push("database_closed")
    }
    if (ownership && !cleanupFlags.ownershipReleased) {
      await ownership.release()
      cleanupFlags.ownershipReleased = true
      summary.ownershipReleased = true
      summary.cleanup.push("ownership_released")
    }
  }
  try {
    const opened = openDatabase(databasePath)
    native = opened.native
    await initShippingTables(opened.database, "real")
    const acquire = request.acquireOwnership ?? (() => acquireIntelDatabaseOwnership(databasePath))
    ownership = await acquire()
    const canonical = realpathSync(databasePath)
    const lockPath = `${canonical}.intel-owner.lock`
    const payload = JSON.parse(readFileSync(lockPath, "utf8")) as { database?: string }
    summary.lockMatchesDatabase = payload.database === canonical
    if (!summary.lockMatchesDatabase) throw new Error("ph_m01_lock_database_mismatch")
    job = createIntelCollectJob({ db: opened.database, enabled: false, fetch: bounded.fetch, seeds: [selectPhM01({ fetch: bounded.fetch, acquireOwnership: async () => {
      throw new Error("ph_m01_acquire_during_select")
    } }).seed], now: request.now, signal })
    summary.jobEnabled = job.enabled
    if (job.enabled) throw new Error("ph_m01_job_enabled_gate")
    const activeJob = job
    let runCalls = 0
    runPromise = (async () => {
      runCalls += 1
      if (runCalls !== 1) throw new Error("ph_m01_run_once")
      summary.runInvoked = true
      return activeJob.run()
    })()
    const result = await runPromise
    runSettled = true
    const snapshot = readSnapshot(native)
    const outcome = classify(result, snapshot, bounded.state, cancellation)
    summary.recordsRead = snapshot.recordsRead
    summary.recordsWritten = snapshot.recordsWritten
    summary.itemsNew = snapshot.itemsNew
    summary.itemsRevised = snapshot.itemsRevised
    summary.itemsUnchanged = snapshot.itemsUnchanged
    summary.contentScope = snapshot.contentScope
    summary.descriptionPersisted = snapshot.descriptionPersisted
    summary.dateEvidenceRows = snapshot.dateEvidenceRows
    summary.jobStatus = result.status
    summary.jobErrorCode = result.errorCode ?? null
    summary.runStatus = snapshot.runStatus
    summary.runErrorCode = snapshot.runErrorCode
    summary.enabledCatalogIds = snapshot.enabledCatalogIds
    summary.dns = bounded.state.dns
    summary.cancellation = cancellation
    summary.httpRequests = bounded.state.httpRequests
    summary.lookupCalls = bounded.state.lookupCalls
    summary.redirectResponses = bounded.state.redirectResponses
    summary.budgetRejections = bounded.state.budgetRejections
    summary.detailRequests = bounded.state.detailRequests
    summary.otherHostRequests = bounded.state.otherHostRequests
    await cleanup()
    summary.reason = outcome.reason
    summary.exit = outcome.exit
    summary.exitCode = outcome.exitCode
    return summary
  } catch (error) {
    runSettled = true
    await cleanup()
    throw error
  } finally {
    signal.removeEventListener("abort", onAbort)
  }
}

export function parsePhM01Arguments(args: string[]) {
  if (args.length === 0) return { help: false as const, mode: "plan" as const }
  if (args.length === 1 && args[0] === "--help") return { help: true as const, mode: "plan" as const }
  const parsed = parseArgs({ args, strict: true, allowPositionals: false, tokens: true, options: { "help": { type: "boolean" }, "execute": { type: "boolean" }, "run-id": { type: "string" } } })
  if (parsed.values.help) throw new Error("ph_m01_help_exclusive")
  for (const token of parsed.tokens) {
    if (token.kind === "option" && parsed.tokens.filter(other => other.kind === "option" && other.name === token.name).length > 1) throw new Error("ph_m01_duplicate_argument")
  }
  if (parsed.values.execute !== true) throw new Error("ph_m01_execute_required")
  if (!parsed.values["run-id"] || !RUN_ID_PATTERN.test(parsed.values["run-id"])) throw new Error("ph_m01_run_id_invalid")
  return { help: false as const, mode: "execute" as const, runId: parsed.values["run-id"] }
}
