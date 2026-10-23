/**
 * DeepSeek Search/Fetch one-shot pilot (R2).
 *
 * Fixed isolation contract for this round:
 * - pilotId, attempt≤10, budget 50 milli-CNY, unit 5 — not CLI-overridable
 * - ledger + paid DB under projectRoot/.tmp/deepseek-pilot-2026-10-23/ only
 * - project root comes from the script location (CLI), not arbitrary cwd
 * - test path injection only with mock outbound or injectedFetcher (no live bypass)
 *
 * Default plan-only (read-only ledger inspect; zero writes). `--execute --key-from-stdin`
 * may outbound after atomic attempt reserve. Credentials: stdin once; never argv/disk/chat.
 */
import { Buffer } from "node:buffer"
import { createHash, randomUUID } from "node:crypto"
import { type Stats, existsSync, lstatSync, mkdirSync, realpathSync, statSync } from "node:fs"
import { dirname, join, resolve, sep } from "node:path"
import process from "node:process"
import { spawn } from "node:child_process"
import NativeDatabase from "better-sqlite3"
import { createDatabase } from "db0"
import {
  DEEPSEEK_FETCH_CAPABILITY,
  DEEPSEEK_SEARCH_CAPABILITY,
  DEEPSEEK_SEARCH_FETCH_PROVIDER_ID,
  DEEPSEEK_SEARCH_FETCH_UNIT_COST_CNY,
} from "#/intel/discovery/deepseek-search-fetch-policy"
import { containsSecretLike } from "#/intel/discovery/candidate-trim"
import {
  type FetchTargetReview,
  type IntelPersistence,
  type SearchFetchServiceConfig,
  runDeepSeekFetch,
  runDeepSeekSearch,
} from "#/intel/discovery/search-fetch-service"
import { initShippingTables } from "#/database/shipping"
import type { SecretStore } from "#/providers/contracts"
import {
  type InjectedFetcher,
  type PreflightResultCode,
  preflightKeyAndDefaultSearchRequest,
} from "#/providers/deepseek/search-fetch-client"

export const PILOT_ID = "ds-pilot-2026-10-23-r1" as const
export const PILOT_DIR_RELATIVE = ".tmp/deepseek-pilot-2026-10-23"
export const PILOT_LEDGER_FILENAME = "pilot-attempt-ledger.sqlite3"
export const PILOT_PAID_DB_FILENAME = "pilot-paid.sqlite3"
export const MAX_ATTEMPTS_PER_CAPABILITY = 10
/** Integer milli-CNY (0.001 CNY). 0.05 CNY = 50. Not CLI-overridable. */
export const BUDGET_MILLI_CNY = 50
/** 0.005 CNY = 5 milli-CNY. Not CLI-overridable. */
export const UNIT_COST_MILLI_CNY = 5

export const FIRST_ROUND_SEARCH_QUERIES: readonly string[] = [
  "PPA Philippines Ports Authority Manila port advisory 2026",
  "PPA helpdesk advisory Manila South Harbor",
  "ppa.com.ph port news Manila terminal notice",
  "MARINA Philippines marine notice port advisory 2026",
  "PortCalls Asia Manila port congestion delay notice",
  "PAT Port Authority of Thailand Laem Chabang announcement 2026",
  "Thai Marine Department md.go.th port notice Laem Chabang",
  "Laem Chabang port closure typhoon advisory Thailand",
] as const

/** First round: empty. Future entries must carry per-URL reviewed persistence + targetReview. */
export const FIRST_ROUND_FETCH_TARGETS: readonly PilotFetchTarget[] = []

export type PilotCapability = typeof DEEPSEEK_SEARCH_CAPABILITY | typeof DEEPSEEK_FETCH_CAPABILITY
export type AttemptStatus = "reserved" | "succeeded" | "failed" | "unknown"

export interface PilotFetchTarget {
  url: string
  /** Reviewed persistence for this URL only. Script never upgrades this. */
  persistence: IntelPersistence
  /** Reviewed local security decision bound to this URL. */
  targetReview: FetchTargetReview
}

export interface PilotLedger {
  native: InstanceType<typeof NativeDatabase>
  path: string
  pilotId: string
  close: () => void
}

export interface ReserveOk {
  ok: true
  attemptId: string
  fresh: boolean
  status: AttemptStatus
  receiptId: string | null
  resultSummaryJson: string | null
}

export interface ReserveFail {
  ok: false
  code: "attempt_limit_reached" | "budget_limit_reached" | "ledger_pilot_mismatch"
  attempts: number
  reservedMilli: number
}

export type ReserveResult = ReserveOk | ReserveFail

export interface TrimmedCandidateView {
  url: string
  title: string
  providerDate: string | null
  titleUrlHash: string
}

export interface OutboundOutcome {
  ok: boolean
  unknown?: boolean
  errorCode?: string
  detail?: string
  receiptId?: string
  reused?: boolean
  billable?: boolean
  upstreamResultCount?: number
  candidates?: TrimmedCandidateView[]
  metaEmpty?: boolean
}

export interface PilotOutbound {
  search: (query: string, attemptId: string) => Promise<OutboundOutcome>
  fetch: (target: PilotFetchTarget, attemptId: string) => Promise<OutboundOutcome>
}

export type MemorySecretStore = SecretStore & {
  clear: () => void
  peekConfigured: () => boolean
}

export type PilotLstat = (path: string) => Stats

export interface PilotOptions {
  mode: "plan" | "execute"
  /** Absolute project root (directory that contains `scripts/` and `.tmp/`). */
  projectRoot: string
  searchQueries?: readonly string[]
  fetchTargets?: readonly PilotFetchTarget[]
  readKey?: () => Promise<string | undefined>
  /** Mock outbound. Enables testIsolationName. */
  outbound?: PilotOutbound
  /** Synthetic HTTP for createLiveOutbound. Enables testIsolationName. No live net. */
  injectedFetcher?: InjectedFetcher
  /**
   * Test-only directory name under projectRoot/.tmp/. Refused without outbound mock
   * or injectedFetcher (cannot open a live-network bypass with alternate DBs).
   */
  testIsolationName?: string
  now?: () => Date
  /** Test-only lstat override for dangling-link probes. Requires testIsolationName. */
  lstat?: PilotLstat
}

export interface PilotOpResult {
  capability: PilotCapability
  operationKey: string
  label: string
  outcome:
    | "planned"
    | "duplicate_restored"
    | "duplicate_incomplete"
    | "reserved_failed"
    | "succeeded"
    | "failed"
    | "unknown"
    | "missing_api_key"
    | "fetch_refused"
  attemptId?: string
  errorCode?: string
  receiptId?: string
  reused?: boolean
  billable?: boolean
  upstreamResultCount?: number
  candidates?: TrimmedCandidateView[]
}

export interface PilotSummary {
  pilotId: string
  mode: "plan" | "execute"
  projectRoot: string
  ledgerPath: string
  paidDbPath: string
  searchQueries: string[]
  fetchTargetCount: number
  searchAttempts: number
  fetchAttempts: number
  searchReservedMilli: number
  fetchReservedMilli: number
  ops: PilotOpResult[]
  outboundCalls: number
  exitCode: number
  failureCode?: string
  notes: string[]
}

export interface FixedPilotPaths {
  projectRoot: string
  pilotDir: string
  ledgerPath: string
  paidDbPath: string
}

type Native = InstanceType<typeof NativeDatabase>

function assertUnitCostAligned(): void {
  const expected = Math.round(DEEPSEEK_SEARCH_FETCH_UNIT_COST_CNY * 1000)
  if (expected !== UNIT_COST_MILLI_CNY) {
    throw new Error(`unit_cost_mismatch:policy=${expected}:pilot=${UNIT_COST_MILLI_CNY}`)
  }
}

function realPathSafe(path: string): string {
  return realpathSync.native ? realpathSync.native(path) : realpathSync(path)
}

/** Normalize project root; must exist as a directory. */
export function normalizeProjectRoot(projectRoot: string): string {
  const resolved = resolve(projectRoot)
  if (!existsSync(resolved)) {
    throw new Error(`project_root_missing:${resolved}`)
  }
  const st = statSync(resolved)
  if (!st.isDirectory()) {
    throw new Error(`project_root_not_directory:${resolved}`)
  }
  return realPathSafe(resolved)
}

/**
 * lstat a path entry without following links.
 * - ENOENT → null (absent)
 * - symbolic link (dangling or not) → refuse
 * - any other lstat error → fail closed
 */
export function lstatExistingEntry(
  path: string,
  label: string,
  lstat: PilotLstat = lstatSync,
): Stats | null {
  try {
    const st = lstat(path)
    if (st.isSymbolicLink()) {
      throw new Error(`pilot_symlink_refused:${label}`)
    }
    return st
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("pilot_symlink_refused:")) {
      throw error
    }
    const err = error as NodeJS.ErrnoException
    if (err?.code === "ENOENT") return null
    throw new Error(`path_lstat_failed:${label}:${err?.code ?? "unknown"}`)
  }
}

export interface ResolveFixedPilotPathsOptions {
  /** Test-only lstat override (e.g. dangling-link probe). Never wired from CLI. */
  lstat?: PilotLstat
}

/**
 * Resolve fixed pilot DB paths under projectRoot/.tmp/deepseek-pilot-2026-10-23/.
 * Optional testIsolationName replaces the fixed round dir name but must stay under .tmp/.
 * Directory entries are probed with lstat (not existsSync) so dangling symlinks cannot skip checks.
 */
export function resolveFixedPilotPaths(
  projectRoot: string,
  testIsolationName?: string,
  options?: ResolveFixedPilotPathsOptions,
): FixedPilotPaths {
  const lstat = options?.lstat ?? lstatSync
  const root = normalizeProjectRoot(projectRoot)
  if (testIsolationName !== undefined) {
    if (!/^[\w.-]{1,128}$/.test(testIsolationName)) {
      throw new Error("test_isolation_name_invalid")
    }
    if (testIsolationName === "." || testIsolationName === ".." || testIsolationName.includes(sep) || testIsolationName.includes("/") || testIsolationName.includes("\\")) {
      throw new Error("test_isolation_name_path_escape")
    }
  }
  const relDir = testIsolationName ? join(".tmp", testIsolationName) : PILOT_DIR_RELATIVE
  const plannedPilot = resolve(root, relDir)
  const plannedTmp = resolve(root, ".tmp")
  if (!plannedPilot.startsWith(`${plannedTmp}${sep}`) && plannedPilot !== plannedTmp) {
    throw new Error(`pilot_dir_escapes_tmp:${plannedPilot}`)
  }
  if (!plannedPilot.startsWith(`${root}${sep}`)) {
    throw new Error(`pilot_dir_escapes_project:${plannedPilot}`)
  }

  const tmpEntry = lstatExistingEntry(plannedTmp, "tmp", lstat)
  if (tmpEntry && !tmpEntry.isDirectory()) {
    throw new Error(`tmp_not_directory:${plannedTmp}`)
  }
  if (tmpEntry) {
    const realTmp = realPathSafe(plannedTmp)
    if (!realTmp.startsWith(`${root}${sep}`) && realTmp !== root) {
      throw new Error(`tmp_realpath_escapes_project:${realTmp}`)
    }
  }

  const pilotEntry = lstatExistingEntry(plannedPilot, "pilot_dir", lstat)
  if (pilotEntry && !pilotEntry.isDirectory()) {
    throw new Error(`pilot_dir_not_directory:${plannedPilot}`)
  }
  let realPilot = plannedPilot
  if (pilotEntry) {
    realPilot = realPathSafe(plannedPilot)
    const realTmp = tmpEntry ? realPathSafe(plannedTmp) : plannedTmp
    if (!realPilot.startsWith(`${realTmp}${sep}`) && realPilot !== realTmp) {
      throw new Error(`pilot_realpath_escapes_tmp:${realPilot}`)
    }
  }

  for (const name of [PILOT_LEDGER_FILENAME, PILOT_PAID_DB_FILENAME]) {
    const p = join(plannedPilot, name)
    const entry = lstatExistingEntry(p, name, lstat)
    if (!entry) continue
    const realDb = realPathSafe(p)
    if (!realDb.startsWith(`${realPilot}${sep}`) && dirname(realDb) !== realPilot) {
      throw new Error(`pilot_db_realpath_escapes:${name}`)
    }
  }

  return {
    projectRoot: root,
    pilotDir: plannedPilot,
    ledgerPath: join(plannedPilot, PILOT_LEDGER_FILENAME),
    paidDbPath: join(plannedPilot, PILOT_PAID_DB_FILENAME),
  }
}

export function assertTestIsolationAllowed(options: PilotOptions): void {
  if (options.lstat && !options.testIsolationName) {
    throw new Error("lstat_override_requires_test_isolation")
  }
  if (!options.testIsolationName) return
  if (options.outbound || options.injectedFetcher) return
  throw new Error("test_isolation_requires_mock_or_injected_fetcher")
}

export function searchOperationKey(query: string): string {
  const norm = query.trim().replace(/\s+/g, " ")
  const digest = createHash("sha256").update(`search\0${norm}`, "utf8").digest("hex").slice(0, 32)
  return `search:${digest}`
}

export function fetchOperationKey(url: string): string {
  const norm = url.trim()
  const digest = createHash("sha256").update(`fetch\0${norm}`, "utf8").digest("hex").slice(0, 32)
  return `fetch:${digest}`
}

export function createMemorySecretStore(initial?: string): MemorySecretStore {
  let value = initial
  return {
    get: async (id) => {
      return id === DEEPSEEK_SEARCH_FETCH_PROVIDER_ID ? value : undefined
    },
    set: async (id, secret) => {
      if (id === DEEPSEEK_SEARCH_FETCH_PROVIDER_ID) value = secret
    },
    delete: async (id) => {
      if (id === DEEPSEEK_SEARCH_FETCH_PROVIDER_ID) value = undefined
    },
    has: async id => id === DEEPSEEK_SEARCH_FETCH_PROVIDER_ID && Boolean(value),
    source: async (id) => {
      if (id === DEEPSEEK_SEARCH_FETCH_PROVIDER_ID && value) return "environment"
      return "missing"
    },
    clear: () => {
      value = undefined
    },
    peekConfigured: () => Boolean(value),
  }
}

/** Redact secret-like tokens; never echo an apiKey substring. */
export function sanitizePilotText(text: string, apiKey?: string): string {
  let out = String(text ?? "")
  if (apiKey && apiKey.length >= 4) {
    out = out.split(apiKey).join("[redacted]")
  }
  out = out.replace(/(Bearer\s+)\S+/gi, "$1[redacted]")
  out = out.replace(/(authorization\s*[:=]\s*)\S+/gi, "$1[redacted]")
  out = out.replace(/\bsk-\w{8,}\b/g, "[redacted]")
  if (containsSecretLike(out, apiKey)) {
    return "[redacted]"
  }
  return out.slice(0, 500)
}

export function sanitizeCandidateViews(candidates: readonly TrimmedCandidateView[] | undefined, apiKey?: string): TrimmedCandidateView[] {
  if (!candidates) return []
  return candidates.map(c => ({
    url: sanitizePilotText(c.url, apiKey),
    title: sanitizePilotText(c.title, apiKey),
    providerDate: c.providerDate ? sanitizePilotText(c.providerDate, apiKey) : null,
    titleUrlHash: c.titleUrlHash,
  }))
}

export function buildResultSummaryJson(input: {
  receiptId?: string
  reused?: boolean
  billable?: boolean
  upstreamResultCount?: number
  candidates?: TrimmedCandidateView[]
  metaEmpty?: boolean
}, apiKey?: string): string {
  return JSON.stringify({
    receiptId: input.receiptId ?? null,
    reused: Boolean(input.reused),
    billable: Boolean(input.billable),
    upstreamResultCount: input.upstreamResultCount ?? null,
    candidates: sanitizeCandidateViews(input.candidates, apiKey),
    metaEmpty: input.metaEmpty ?? null,
  })
}

export function parseResultSummaryJson(raw: string | null): {
  receiptId?: string
  reused?: boolean
  billable?: boolean
  upstreamResultCount?: number
  candidates?: TrimmedCandidateView[]
} {
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>
    const candidatesRaw = Array.isArray(parsed.candidates) ? parsed.candidates : []
    const candidates: TrimmedCandidateView[] = []
    for (const item of candidatesRaw) {
      if (!item || typeof item !== "object") continue
      const row = item as Record<string, unknown>
      if (typeof row.url !== "string" || typeof row.title !== "string" || typeof row.titleUrlHash !== "string") continue
      candidates.push({
        url: row.url,
        title: row.title,
        providerDate: typeof row.providerDate === "string" ? row.providerDate : null,
        titleUrlHash: row.titleUrlHash,
      })
    }
    return {
      receiptId: typeof parsed.receiptId === "string" ? parsed.receiptId : undefined,
      reused: Boolean(parsed.reused),
      billable: Boolean(parsed.billable),
      upstreamResultCount: typeof parsed.upstreamResultCount === "number" ? parsed.upstreamResultCount : undefined,
      candidates,
    }
  } catch {
    return {}
  }
}

export function assertFetchTargetAuthorized(target: PilotFetchTarget): void {
  if (target.persistence === "disallowed") {
    throw new Error("fetch_refused:persistence_disallowed")
  }
  if (target.targetReview.status === "locally_rejected") {
    throw new Error(`fetch_refused:locally_rejected:${target.targetReview.code}`)
  }
  if (target.targetReview.status !== "syntactically_allowed") {
    throw new Error("fetch_refused:review_incomplete")
  }
}

export function openPilotLedger(path: string, pilotId: string): PilotLedger {
  mkdirSync(dirname(path), { recursive: true })
  const native = new NativeDatabase(path)
  native.exec("PRAGMA journal_mode = WAL")
  native.exec(`
    CREATE TABLE IF NOT EXISTS pilot_meta (
      pilot_id TEXT PRIMARY KEY NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS pilot_attempt (
      id TEXT PRIMARY KEY NOT NULL,
      pilot_id TEXT NOT NULL,
      capability TEXT NOT NULL,
      operation_key TEXT NOT NULL,
      status TEXT NOT NULL,
      reserved_milli INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      finished_at TEXT,
      error_code TEXT,
      receipt_id TEXT,
      result_summary_json TEXT,
      UNIQUE (pilot_id, capability, operation_key)
    );
    CREATE INDEX IF NOT EXISTS idx_pilot_attempt_cap
      ON pilot_attempt (pilot_id, capability);
  `)
  // Additive columns for ledgers created before summary fields existed.
  const cols = native.prepare("PRAGMA table_info(pilot_attempt)").all() as Array<{ name: string }>
  const names = new Set(cols.map(c => c.name))
  if (!names.has("receipt_id")) {
    native.exec("ALTER TABLE pilot_attempt ADD COLUMN receipt_id TEXT")
  }
  if (!names.has("result_summary_json")) {
    native.exec("ALTER TABLE pilot_attempt ADD COLUMN result_summary_json TEXT")
  }
  const row = native.prepare("SELECT pilot_id FROM pilot_meta LIMIT 1").get() as { pilot_id: string } | undefined
  if (row && row.pilot_id !== pilotId) {
    native.close()
    throw new Error(`ledger_pilot_mismatch:expected=${pilotId}:found=${row.pilot_id}`)
  }
  if (!row) {
    native.prepare("INSERT INTO pilot_meta (pilot_id, created_at) VALUES (?, ?)").run(pilotId, new Date().toISOString())
  }
  return {
    native,
    path,
    pilotId,
    close: () => {
      try {
        native.close()
      } catch {
        /* already closed */
      }
    },
  }
}

/**
 * Plan-only ledger inspect: readonly + fileMustExist. Never mkdir / CREATE / WAL migrate.
 */
export function readPilotLedgerSnapshot(ledgerPath: string, pilotId: string): {
  present: boolean
  searchAttempts: number
  fetchAttempts: number
  searchReservedMilli: number
  fetchReservedMilli: number
  note?: string
} {
  if (!existsSync(ledgerPath)) {
    return {
      present: false,
      searchAttempts: 0,
      fetchAttempts: 0,
      searchReservedMilli: 0,
      fetchReservedMilli: 0,
      note: "ledger_absent",
    }
  }
  let native: Native
  try {
    native = new NativeDatabase(ledgerPath, { readonly: true })
  } catch (error) {
    return {
      present: false,
      searchAttempts: 0,
      fetchAttempts: 0,
      searchReservedMilli: 0,
      fetchReservedMilli: 0,
      note: `ledger_unreadable:${error instanceof Error ? error.message : String(error)}`,
    }
  }
  try {
    const meta = native.prepare("SELECT pilot_id FROM pilot_meta LIMIT 1").get() as { pilot_id: string } | undefined
    if (!meta) {
      return {
        present: true,
        searchAttempts: 0,
        fetchAttempts: 0,
        searchReservedMilli: 0,
        fetchReservedMilli: 0,
        note: "ledger_meta_missing",
      }
    }
    if (meta.pilot_id !== pilotId) {
      return {
        present: true,
        searchAttempts: 0,
        fetchAttempts: 0,
        searchReservedMilli: 0,
        fetchReservedMilli: 0,
        note: `ledger_pilot_mismatch:found=${meta.pilot_id}`,
      }
    }
    return {
      present: true,
      searchAttempts: countAttempts(native, pilotId, DEEPSEEK_SEARCH_CAPABILITY),
      fetchAttempts: countAttempts(native, pilotId, DEEPSEEK_FETCH_CAPABILITY),
      searchReservedMilli: sumReservedMilli(native, pilotId, DEEPSEEK_SEARCH_CAPABILITY),
      fetchReservedMilli: sumReservedMilli(native, pilotId, DEEPSEEK_FETCH_CAPABILITY),
    }
  } finally {
    try {
      native.close()
    } catch {
      /* ignore */
    }
  }
}

export function countAttempts(native: Native, pilotId: string, capability: PilotCapability): number {
  const row = native.prepare(
    "SELECT COUNT(*) AS c FROM pilot_attempt WHERE pilot_id = ? AND capability = ?",
  ).get(pilotId, capability) as { c: number }
  return Number(row.c)
}

export function sumReservedMilli(native: Native, pilotId: string, capability: PilotCapability): number {
  const row = native.prepare(
    "SELECT COALESCE(SUM(reserved_milli), 0) AS s FROM pilot_attempt WHERE pilot_id = ? AND capability = ?",
  ).get(pilotId, capability) as { s: number }
  return Number(row.s)
}

/**
 * Atomically reserve one attempt before any outbound.
 * Same (pilotId, capability, operationKey) never creates a second row.
 */
export function reserveAttempt(
  native: Native,
  input: {
    pilotId: string
    capability: PilotCapability
    operationKey: string
    /** Test-only overrides for direct reserveAttempt unit tests. runPilot ignores these. */
    unitMilli?: number
    budgetMilli?: number
    maxAttempts?: number
    now?: Date
  },
): ReserveResult {
  const unitMilli = input.unitMilli ?? UNIT_COST_MILLI_CNY
  const budgetMilli = input.budgetMilli ?? BUDGET_MILLI_CNY
  const maxAttempts = input.maxAttempts ?? MAX_ATTEMPTS_PER_CAPABILITY
  const nowIso = (input.now ?? new Date()).toISOString()

  native.exec("BEGIN IMMEDIATE")
  try {
    const meta = native.prepare("SELECT pilot_id FROM pilot_meta LIMIT 1").get() as { pilot_id: string } | undefined
    if (!meta || meta.pilot_id !== input.pilotId) {
      native.exec("ROLLBACK")
      return { ok: false, code: "ledger_pilot_mismatch", attempts: 0, reservedMilli: 0 }
    }

    const existing = native.prepare(
      `SELECT id, status, receipt_id, result_summary_json
       FROM pilot_attempt WHERE pilot_id = ? AND capability = ? AND operation_key = ?`,
    ).get(input.pilotId, input.capability, input.operationKey) as {
      id: string
      status: AttemptStatus
      receipt_id: string | null
      result_summary_json: string | null
    } | undefined
    if (existing) {
      native.exec("COMMIT")
      return {
        ok: true,
        attemptId: existing.id,
        fresh: false,
        status: existing.status,
        receiptId: existing.receipt_id,
        resultSummaryJson: existing.result_summary_json,
      }
    }

    const attempts = countAttempts(native, input.pilotId, input.capability)
    const reservedMilli = sumReservedMilli(native, input.pilotId, input.capability)

    if (attempts >= maxAttempts) {
      native.exec("ROLLBACK")
      return { ok: false, code: "attempt_limit_reached", attempts, reservedMilli }
    }
    if (reservedMilli + unitMilli > budgetMilli) {
      native.exec("ROLLBACK")
      return { ok: false, code: "budget_limit_reached", attempts, reservedMilli }
    }

    const attemptId = randomUUID()
    native.prepare(
      `INSERT INTO pilot_attempt
        (id, pilot_id, capability, operation_key, status, reserved_milli, created_at, finished_at, error_code, receipt_id, result_summary_json)
       VALUES (?, ?, ?, ?, 'reserved', ?, ?, NULL, NULL, NULL, NULL)`,
    ).run(attemptId, input.pilotId, input.capability, input.operationKey, unitMilli, nowIso)
    native.exec("COMMIT")
    return {
      ok: true,
      attemptId,
      fresh: true,
      status: "reserved",
      receiptId: null,
      resultSummaryJson: null,
    }
  } catch (error) {
    try {
      native.exec("ROLLBACK")
    } catch {
      /* ignore */
    }
    throw error
  }
}

export function finalizeAttempt(
  native: Native,
  input: {
    attemptId: string
    status: Exclude<AttemptStatus, "reserved">
    errorCode?: string
    receiptId?: string
    resultSummaryJson?: string
    now?: Date
  },
): void {
  const nowIso = (input.now ?? new Date()).toISOString()
  native.prepare(
    `UPDATE pilot_attempt
     SET status = ?,
         finished_at = ?,
         error_code = COALESCE(?, error_code),
         receipt_id = COALESCE(?, receipt_id),
         result_summary_json = COALESCE(?, result_summary_json)
     WHERE id = ? AND status = 'reserved'`,
  ).run(
    input.status,
    nowIso,
    input.errorCode ?? null,
    input.receiptId ?? null,
    input.resultSummaryJson ?? null,
    input.attemptId,
  )
}

/**
 * Decode stdin key bytes as **strict UTF-8** only (UTF-8 BOM allowed).
 * No UTF-16 / encoding heuristics: NUL-polluted or non-UTF-8 input is a fixed
 * format failure — never reinterpreted into a plausible key.
 * Strips a leading UTF-8 BOM and trims only leading/trailing whitespace (pipe CRLF).
 * Does not loosen Authorization ByteString rules (interior controls still fail later).
 */
export type KeyStdinDecodeResult =
  | { ok: true, key: string }
  | { ok: false }

export function decodeKeyStdinBuffer(buf: Buffer): KeyStdinDecodeResult {
  // Raw NUL => reject (typical of UTF-16LE pipes). Do not reinterpret.
  for (let i = 0; i < buf.length; i += 1) {
    if (buf[i] === 0x00) return { ok: false }
  }
  let offset = 0
  if (buf.length >= 3 && buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF) {
    offset = 3
  }
  let text: string
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(buf.subarray(offset))
  } catch {
    return { ok: false }
  }
  // Defense: decoded NUL (should not appear if raw scan passed)
  if (text.includes("\u0000")) return { ok: false }
  const key = text.replace(/^\uFEFF/, "").trim()
  return { ok: true, key }
}

/** Thrown when stdin bytes are not strict UTF-8 / contain NUL. Message is fixed code only. */
export class KeyStdinDecodeError extends Error {
  readonly code = "preflight_key_format" as const
  constructor() {
    super("preflight_key_format")
    this.name = "KeyStdinDecodeError"
  }
}

export async function readKeyFromStdin(): Promise<string | undefined> {
  if (process.stdin.isTTY) return undefined
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  const decoded = decodeKeyStdinBuffer(Buffer.concat(chunks))
  if (!decoded.ok) throw new KeyStdinDecodeError()
  return decoded.key.length > 0 ? decoded.key : undefined
}

/**
 * Execute key source: stdin only (SecureString → pipe on Windows).
 * No interactive Read-Host inside Node (conflicts with -NonInteractive hosts).
 */
/**
 * Explicit preflight only: key format + default Search Request construct.
 * Zero fetch, zero DB, zero attempt, zero credential persistence.
 * Returns fixed codes only (no key length/fingerprint/Request object).
 * Does not attribute past unknown receipts; diagnostic aid for a future attempt only.
 */
export function runPreflightKeyRequest(apiKey: string | undefined): PreflightResultCode {
  return preflightKeyAndDefaultSearchRequest(apiKey)
}

export async function resolveExecuteKey(opts: {
  keyFromStdin: boolean
  readKey?: () => Promise<string | undefined>
}): Promise<string | undefined> {
  if (opts.readKey) return opts.readKey()
  if (opts.keyFromStdin) return readKeyFromStdin()
  return undefined
}

function lookupReceiptIdForAttempt(native: Native, attemptId: string, error: unknown): string | undefined {
  if (error && typeof error === "object" && "receiptId" in error) {
    const id = (error as { receiptId?: unknown }).receiptId
    if (typeof id === "string" && id.length > 0) return id
  }
  try {
    const row = native.prepare(
      "SELECT id FROM paid_receipt WHERE subject = ? ORDER BY created_at DESC LIMIT 1",
    ).get(attemptId) as { id: string } | undefined
    return row?.id
  } catch {
    return undefined
  }
}

function wrapDb(native: Native) {
  return createDatabase({
    name: "sqlite",
    dialect: "sqlite",
    getInstance: () => native,
    exec: (sql: string) => native.exec(sql),
    prepare: (sql: string) => {
      const statement = native.prepare(sql)
      return {
        all: async (...params: (string | number | boolean | null | undefined)[]) => statement.all(...params),
        get: async (...params: (string | number | boolean | null | undefined)[]) => statement.get(...params),
        run: async (...params: (string | number | boolean | null | undefined)[]) => {
          const result = statement.run(...params)
          return { success: result.changes > 0, changes: result.changes, lastInsertRowid: result.lastInsertRowid }
        },
      }
    },
    dispose: () => native.close(),
  } as never)
}

export async function createLiveOutbound(input: {
  paidDbPath: string
  secrets: SecretStore
  injectedFetcher?: InjectedFetcher
}): Promise<{ outbound: PilotOutbound, dispose: () => void }> {
  mkdirSync(dirname(input.paidDbPath), { recursive: true })
  const native = new NativeDatabase(input.paidDbPath)
  const db = wrapDb(native)
  await initShippingTables(db, "mock")
  const budgetCny = BUDGET_MILLI_CNY / 1000
  const config: SearchFetchServiceConfig = {
    db,
    secretStore: input.secrets,
    enabled: true,
    monthlyBudgetSearch: budgetCny,
    monthlyBudgetFetch: budgetCny,
    fetcher: input.injectedFetcher,
  }
  const outbound: PilotOutbound = {
    search: async (query, attemptId) => {
      try {
        const out = await runDeepSeekSearch(config, {
          query,
          purpose: "ds_pilot_2026_10_23_r1",
          subject: attemptId,
        })
        return {
          ok: true,
          receiptId: out.receiptId,
          reused: out.reused,
          billable: out.billable,
          upstreamResultCount: out.upstreamResultCount,
          candidates: out.candidates.map(c => ({
            url: c.url,
            title: c.title,
            providerDate: c.providerDate,
            titleUrlHash: c.titleUrlHash,
          })),
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        const name = error instanceof Error ? error.name : "Error"
        const unknown = /unknown/i.test(name) || /unknown/i.test(message)
        return {
          ok: false,
          unknown,
          errorCode: sanitizePilotText(name),
          detail: sanitizePilotText(message),
          // Diagnostic gap fix: paid layer may already have booked a receipt (subject=attemptId)
          // before throwing OutcomeUnknown / ReceiptUnknown; surface id without mutating history rows.
          receiptId: lookupReceiptIdForAttempt(native, attemptId, error),
        }
      }
    },
    fetch: async (target, attemptId) => {
      assertFetchTargetAuthorized(target)
      try {
        const out = await runDeepSeekFetch(config, {
          url: target.url,
          purpose: "ds_pilot_2026_10_23_r1",
          subject: attemptId,
          persistence: target.persistence,
          targetReview: target.targetReview,
        })
        return {
          ok: true,
          receiptId: out.receiptId,
          reused: out.reused,
          billable: out.billable,
          metaEmpty: out.meta.empty,
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        const name = error instanceof Error ? error.name : "Error"
        const unknown = /unknown/i.test(name) || /unknown/i.test(message)
        return {
          ok: false,
          unknown,
          errorCode: sanitizePilotText(name),
          detail: sanitizePilotText(message),
          receiptId: lookupReceiptIdForAttempt(native, attemptId, error),
        }
      }
    },
  }
  return {
    outbound,
    dispose: () => {
      try {
        native.close()
      } catch {
        /* ignore */
      }
    },
  }
}

function restoredOp(
  base: Omit<PilotOpResult, "outcome" | "candidates" | "receiptId" | "reused" | "billable" | "upstreamResultCount">,
  reserved: ReserveOk,
): PilotOpResult {
  const parsed = parseResultSummaryJson(reserved.resultSummaryJson)
  if (reserved.resultSummaryJson) {
    return {
      ...base,
      outcome: "duplicate_restored",
      attemptId: reserved.attemptId,
      receiptId: parsed.receiptId ?? reserved.receiptId ?? undefined,
      reused: true,
      billable: parsed.billable,
      upstreamResultCount: parsed.upstreamResultCount,
      candidates: parsed.candidates,
      errorCode: `duplicate:${reserved.status}`,
    }
  }
  return {
    ...base,
    outcome: "duplicate_incomplete",
    attemptId: reserved.attemptId,
    errorCode: `duplicate:${reserved.status}:no_summary`,
  }
}

export async function runPilot(options: PilotOptions): Promise<PilotSummary> {
  assertUnitCostAligned()
  assertTestIsolationAllowed(options)
  const paths = resolveFixedPilotPaths(options.projectRoot, options.testIsolationName, { lstat: options.lstat })
  const pilotId = PILOT_ID
  const searchQueries = [...(options.searchQueries ?? FIRST_ROUND_SEARCH_QUERIES)]
  const fetchTargets = [...(options.fetchTargets ?? FIRST_ROUND_FETCH_TARGETS)]
  const now = options.now ?? (() => new Date())
  const notes: string[] = []
  const ops: PilotOpResult[] = []
  let outboundCalls = 0
  let failureCode: string | undefined
  let exitCode = 0

  if (options.mode === "plan") {
    notes.push("plan_only: read-only ledger inspect; no reservation; no outbound; Fetch list empty until review")
    for (const query of searchQueries) {
      ops.push({
        capability: DEEPSEEK_SEARCH_CAPABILITY,
        operationKey: searchOperationKey(query),
        label: query,
        outcome: "planned",
      })
    }
    for (const target of fetchTargets) {
      ops.push({
        capability: DEEPSEEK_FETCH_CAPABILITY,
        operationKey: fetchOperationKey(target.url),
        label: target.url,
        outcome: "planned",
      })
    }
    if (fetchTargets.length === 0) {
      notes.push("fetch_targets: [] (no Fetch this round; do not raise disallowed licenses to pad)")
    }
    const snap = readPilotLedgerSnapshot(paths.ledgerPath, pilotId)
    if (snap.note) notes.push(snap.note)
    return {
      pilotId,
      mode: "plan",
      projectRoot: paths.projectRoot,
      ledgerPath: paths.ledgerPath,
      paidDbPath: paths.paidDbPath,
      searchQueries,
      fetchTargetCount: fetchTargets.length,
      searchAttempts: snap.searchAttempts,
      fetchAttempts: snap.fetchAttempts,
      searchReservedMilli: snap.searchReservedMilli,
      fetchReservedMilli: snap.fetchReservedMilli,
      ops,
      outboundCalls: 0,
      exitCode: 0,
      notes,
    }
  }

  // execute — fixed gates only (no override of 10 / 50 / 5)
  const key = options.readKey ? await options.readKey() : undefined
  const secrets = createMemorySecretStore(key)
  if (!key) {
    failureCode = "missing_api_key"
    exitCode = 2
    notes.push("missing_api_key: zero outbound, zero new reservations")
    secrets.clear()
    const snap = readPilotLedgerSnapshot(paths.ledgerPath, pilotId)
    return {
      pilotId,
      mode: "execute",
      projectRoot: paths.projectRoot,
      ledgerPath: paths.ledgerPath,
      paidDbPath: paths.paidDbPath,
      searchQueries,
      fetchTargetCount: fetchTargets.length,
      searchAttempts: snap.searchAttempts,
      fetchAttempts: snap.fetchAttempts,
      searchReservedMilli: snap.searchReservedMilli,
      fetchReservedMilli: snap.fetchReservedMilli,
      ops: searchQueries.map(query => ({
        capability: DEEPSEEK_SEARCH_CAPABILITY,
        operationKey: searchOperationKey(query),
        label: query,
        outcome: "missing_api_key",
        errorCode: "missing_api_key",
      })),
      outboundCalls: 0,
      exitCode,
      failureCode,
      notes,
    }
  }

  // Live network path refused without injectedFetcher when isolation is used;
  // production execute without mock still requires a key (caller responsibility)
  // but never accepts path overrides.
  if (!options.outbound && !options.injectedFetcher) {
    // Still allow wiring createLiveOutbound for true execute later; zero-net policy
    // is enforced by operators not supplying a key / not running --execute yet.
  }

  const ledger = openPilotLedger(paths.ledgerPath, pilotId)
  let disposeLive: (() => void) | undefined
  let outbound = options.outbound
  try {
    if (!outbound) {
      const live = await createLiveOutbound({
        paidDbPath: paths.paidDbPath,
        secrets,
        injectedFetcher: options.injectedFetcher,
      })
      outbound = live.outbound
      disposeLive = live.dispose
    }

    for (const query of searchQueries) {
      const operationKey = searchOperationKey(query)
      const reserved = reserveAttempt(ledger.native, {
        pilotId,
        capability: DEEPSEEK_SEARCH_CAPABILITY,
        operationKey,
        now: now(),
      })
      if (!reserved.ok) {
        ops.push({
          capability: DEEPSEEK_SEARCH_CAPABILITY,
          operationKey,
          label: query,
          outcome: "reserved_failed",
          errorCode: reserved.code,
        })
        failureCode = reserved.code
        exitCode = 3
        break
      }
      if (!reserved.fresh) {
        ops.push(restoredOp({
          capability: DEEPSEEK_SEARCH_CAPABILITY,
          operationKey,
          label: query,
        }, reserved))
        continue
      }
      outboundCalls += 1
      const result = await outbound.search(query, reserved.attemptId)
      const status: Exclude<AttemptStatus, "reserved"> = result.ok ? "succeeded" : result.unknown ? "unknown" : "failed"
      const summaryJson = buildResultSummaryJson(result, key)
      finalizeAttempt(ledger.native, {
        attemptId: reserved.attemptId,
        status,
        errorCode: result.errorCode ? sanitizePilotText(result.errorCode, key) : undefined,
        receiptId: result.receiptId,
        resultSummaryJson: summaryJson,
        now: now(),
      })
      ops.push({
        capability: DEEPSEEK_SEARCH_CAPABILITY,
        operationKey,
        label: query,
        outcome: status,
        attemptId: reserved.attemptId,
        errorCode: result.errorCode ? sanitizePilotText(result.errorCode, key) : undefined,
        receiptId: result.receiptId,
        reused: result.reused,
        billable: result.billable,
        upstreamResultCount: result.upstreamResultCount,
        candidates: sanitizeCandidateViews(result.candidates, key),
      })
      if (!result.ok && exitCode === 0) {
        exitCode = 4
        failureCode = status === "unknown" ? "outbound_unknown" : "outbound_failed"
      }
    }

    if (fetchTargets.length === 0) {
      notes.push("fetch_targets: [] — zero Fetch attempts this round")
    }

    for (const target of fetchTargets) {
      const operationKey = fetchOperationKey(target.url)
      try {
        assertFetchTargetAuthorized(target)
      } catch (error) {
        ops.push({
          capability: DEEPSEEK_FETCH_CAPABILITY,
          operationKey,
          label: target.url,
          outcome: "fetch_refused",
          errorCode: error instanceof Error ? error.message : "fetch_refused",
        })
        failureCode = "fetch_refused"
        exitCode = 5
        break
      }
      const reserved = reserveAttempt(ledger.native, {
        pilotId,
        capability: DEEPSEEK_FETCH_CAPABILITY,
        operationKey,
        now: now(),
      })
      if (!reserved.ok) {
        ops.push({
          capability: DEEPSEEK_FETCH_CAPABILITY,
          operationKey,
          label: target.url,
          outcome: "reserved_failed",
          errorCode: reserved.code,
        })
        failureCode = reserved.code
        exitCode = 3
        break
      }
      if (!reserved.fresh) {
        ops.push(restoredOp({
          capability: DEEPSEEK_FETCH_CAPABILITY,
          operationKey,
          label: target.url,
        }, reserved))
        continue
      }
      outboundCalls += 1
      const result = await outbound.fetch(target, reserved.attemptId)
      const status: Exclude<AttemptStatus, "reserved"> = result.ok ? "succeeded" : result.unknown ? "unknown" : "failed"
      const summaryJson = buildResultSummaryJson(result, key)
      finalizeAttempt(ledger.native, {
        attemptId: reserved.attemptId,
        status,
        errorCode: result.errorCode ? sanitizePilotText(result.errorCode, key) : undefined,
        receiptId: result.receiptId,
        resultSummaryJson: summaryJson,
        now: now(),
      })
      ops.push({
        capability: DEEPSEEK_FETCH_CAPABILITY,
        operationKey,
        label: target.url,
        outcome: status,
        attemptId: reserved.attemptId,
        errorCode: result.errorCode ? sanitizePilotText(result.errorCode, key) : undefined,
        receiptId: result.receiptId,
        reused: result.reused,
        billable: result.billable,
      })
      if (!result.ok) {
        exitCode = exitCode === 0 ? 4 : exitCode
        failureCode = status === "unknown" ? "outbound_unknown" : "outbound_failed"
      }
    }

    return {
      pilotId,
      mode: "execute",
      projectRoot: paths.projectRoot,
      ledgerPath: paths.ledgerPath,
      paidDbPath: paths.paidDbPath,
      searchQueries,
      fetchTargetCount: fetchTargets.length,
      searchAttempts: countAttempts(ledger.native, pilotId, DEEPSEEK_SEARCH_CAPABILITY),
      fetchAttempts: countAttempts(ledger.native, pilotId, DEEPSEEK_FETCH_CAPABILITY),
      searchReservedMilli: sumReservedMilli(ledger.native, pilotId, DEEPSEEK_SEARCH_CAPABILITY),
      fetchReservedMilli: sumReservedMilli(ledger.native, pilotId, DEEPSEEK_FETCH_CAPABILITY),
      ops,
      outboundCalls,
      exitCode,
      failureCode,
      notes,
    }
  } finally {
    secrets.clear()
    disposeLive?.()
    ledger.close()
  }
}

export interface CliArgs {
  help: boolean
  execute: boolean
  keyFromStdin: boolean
  /** Explicit-only: key format + native Request construct. Never default/implicit. */
  preflightKeyRequest: boolean
}

export function parsePilotArgs(argv: string[]): CliArgs {
  const out: CliArgs = { help: false, execute: false, keyFromStdin: false, preflightKeyRequest: false }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!
    if (arg === "--help" || arg === "-h") {
      out.help = true
    } else if (arg === "--execute") {
      out.execute = true
    } else if (arg === "--key-from-stdin") {
      out.keyFromStdin = true
    } else if (arg === "--preflight-key-request") {
      out.preflightKeyRequest = true
    } else if (arg === "--dry-run" || arg === "--plan-only") {
      out.execute = false
    } else if (arg === "--ledger" || arg === "--paid-db" || arg === "--pilot-id" || arg === "--cwd") {
      throw new Error(`arg_forbidden:${arg}`)
    } else {
      throw new Error(`unknown_arg:${arg}`)
    }
  }
  return out
}

export function printHelp(): void {
  const lines = [
    "DeepSeek Search/Fetch pilot (default plan-only; zero outbound).",
    "",
    "Usage:",
    "  node --import tsx/esm --experimental-loader ./scripts/tsx-alias-loader.mjs ./scripts/deepseek-search-fetch-pilot.ts",
    "  node --import tsx/esm --experimental-loader ./scripts/tsx-alias-loader.mjs ./scripts/deepseek-search-fetch-pilot.ts --execute --key-from-stdin",
    "",
    "Flags:",
    "  --execute          Allow outbound after atomic attempt reserve (requires --key-from-stdin)",
    "  --key-from-stdin   Read API key once from stdin (required with --execute or --preflight-key-request)",
    "  --preflight-key-request  Explicit-only: key header format + native Request construct; no fetch/DB/attempt/paid",
    "  --plan-only|--dry-run  Force plan mode (default)",
    "",
    "Forbidden (isolation contract): --ledger, --paid-db, --pilot-id, --cwd",
    "Fixed: pilotId=ds-pilot-2026-10-23-r1; attempt≤10; budget 50 milli-CNY; unit 5.",
    "DBs: <project>/.tmp/deepseek-pilot-2026-10-23/{pilot-attempt-ledger,pilot-paid}.sqlite3",
    "",
    "Windows SecureString → stdin (key never on argv / never on disk / never printed):",
    "  $sec = Read-Host -AsSecureString 'DeepSeek API key'",
    "  $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec)",
    "  $key = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)",
    "  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)",
    "  $key | node --import tsx/esm --experimental-loader ./scripts/tsx-alias-loader.mjs ./scripts/deepseek-search-fetch-pilot.ts --execute --key-from-stdin",
    "  $key = $null",
    "  if ($sec -is [IDisposable]) { $sec.Dispose() }",
    "Note: clearing the PowerShell variable does not guarantee wiping every in-memory",
    "copy of the plaintext. Limits: not on disk, not on argv, not printed; process exit",
    "releases the Node heap. Do not claim full memory erasure.",
    "",
    "First round: listed PH/TH Search queries only; Fetch list empty.",
    "Does not read main .data/provider-secrets.json.",
  ]
  console.log(lines.join("\n"))
}

export function summaryForStdout(summary: PilotSummary): Record<string, unknown> {
  return {
    pilotId: summary.pilotId,
    mode: summary.mode,
    projectRoot: summary.projectRoot.replace(/\\/g, "/"),
    ledgerPath: summary.ledgerPath.replace(/\\/g, "/"),
    paidDbPath: summary.paidDbPath.replace(/\\/g, "/"),
    searchQueryCount: summary.searchQueries.length,
    fetchTargetCount: summary.fetchTargetCount,
    searchAttempts: summary.searchAttempts,
    fetchAttempts: summary.fetchAttempts,
    searchReservedMilli: summary.searchReservedMilli,
    fetchReservedMilli: summary.fetchReservedMilli,
    outboundCalls: summary.outboundCalls,
    exitCode: summary.exitCode,
    failureCode: summary.failureCode ?? null,
    notes: summary.notes,
    ops: summary.ops.map(op => ({
      capability: op.capability,
      operationKey: op.operationKey,
      label: sanitizePilotText(op.label),
      outcome: op.outcome,
      attemptId: op.attemptId ?? null,
      errorCode: op.errorCode ? sanitizePilotText(op.errorCode) : null,
      receiptId: op.receiptId ?? null,
      reused: op.reused ?? null,
      billable: op.billable ?? null,
      upstreamResultCount: op.upstreamResultCount ?? null,
      candidates: op.candidates ?? null,
    })),
  }
}

/** Used by reserve-once worker / tests that need spawn argv without secrets. */
export function runReserveOnceCli(argv: string[]): number {
  const args: {
    projectRoot?: string
    testIsolationName?: string
    capability?: PilotCapability
    operationKey?: string
  } = {}
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i]!
    if (a === "--project-root") args.projectRoot = argv[++i]
    else if (a === "--test-isolation") args.testIsolationName = argv[++i]
    else if (a === "--capability") args.capability = argv[++i] as PilotCapability
    else if (a === "--operation-key") args.operationKey = argv[++i]
    else throw new Error(`unknown_arg:${a}`)
  }
  if (!args.projectRoot || !args.capability || !args.operationKey) {
    throw new Error("reserve_once_missing_args")
  }
  // Worker is mock-isolation only (no live outbound).
  const paths = resolveFixedPilotPaths(args.projectRoot, args.testIsolationName)
  if (!args.testIsolationName) {
    throw new Error("reserve_once_requires_test_isolation")
  }
  const ledger = openPilotLedger(paths.ledgerPath, PILOT_ID)
  try {
    const result = reserveAttempt(ledger.native, {
      pilotId: PILOT_ID,
      capability: args.capability,
      operationKey: args.operationKey,
    })
    process.stdout.write(`${JSON.stringify(result)}\n`)
    return result.ok && result.fresh ? 0 : 1
  } finally {
    ledger.close()
  }
}

/** Spawn helper that exercises real reserveAttempt in a child process (async for concurrency). */
export function spawnReserveOnce(input: {
  projectRoot: string
  testIsolationName: string
  capability: PilotCapability
  operationKey: string
  nodeArgs: string[]
  scriptPath: string
}): Promise<{ status: number | null, stdout: string, stderr: string }> {
  return new Promise((resolvePromise) => {
    const child = spawn(process.execPath, [
      ...input.nodeArgs,
      input.scriptPath,
      "--project-root",
      input.projectRoot,
      "--test-isolation",
      input.testIsolationName,
      "--capability",
      input.capability,
      "--operation-key",
      input.operationKey,
    ], {
      windowsHide: true,
      cwd: input.projectRoot,
      env: process.env,
    })
    let stdout = ""
    let stderr = ""
    child.stdout.setEncoding("utf8")
    child.stderr.setEncoding("utf8")
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk
    })
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk
    })
    child.on("error", (err) => {
      resolvePromise({ status: 1, stdout, stderr: `${stderr}${err.message}` })
    })
    child.on("close", (status) => {
      resolvePromise({ status, stdout, stderr })
    })
  })
}
