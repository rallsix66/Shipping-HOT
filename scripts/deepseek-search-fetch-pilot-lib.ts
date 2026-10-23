/**
 * DeepSeek Search/Fetch one-shot pilot (R2 offline + gated execute).
 *
 * Defaults to plan-only (zero outbound). `--execute` may outbound only after
 * an atomic per-capability attempt reservation (hard ≤10) and CNY milli budget.
 * Credentials: process-once via `--key-from-stdin` or Windows SecureString prompt;
 * never argv, never disk, never main `.data/provider-secrets.json`.
 */
import { Buffer } from "node:buffer"
import { createHash, randomUUID } from "node:crypto"
import { mkdirSync } from "node:fs"
import { dirname, isAbsolute, join, resolve } from "node:path"
import process from "node:process"
import { spawnSync } from "node:child_process"
import NativeDatabase from "better-sqlite3"
import { createDatabase } from "db0"
import {
  DEEPSEEK_FETCH_CAPABILITY,
  DEEPSEEK_SEARCH_CAPABILITY,
  DEEPSEEK_SEARCH_FETCH_PROVIDER_ID,
  DEEPSEEK_SEARCH_FETCH_UNIT_COST_CNY,
} from "#/intel/discovery/deepseek-search-fetch-policy"
import { type SearchFetchServiceConfig, runDeepSeekFetch, runDeepSeekSearch } from "#/intel/discovery/search-fetch-service"
import { initShippingTables } from "#/database/shipping"
import type { SecretStore } from "#/providers/contracts"
import type { InjectedFetcher } from "#/providers/deepseek/search-fetch-client"
import { containsSecretLike } from "#/intel/discovery/candidate-trim"

export const PILOT_ID = "ds-pilot-2026-10-23-r1" as const
export const PILOT_LEDGER_RELATIVE = ".tmp/deepseek-pilot-2026-10-23/pilot-attempt-ledger.sqlite3"
export const PILOT_PAID_DB_RELATIVE = ".tmp/deepseek-pilot-2026-10-23/pilot-paid.sqlite3"
export const MAX_ATTEMPTS_PER_CAPABILITY = 10
/** Integer millicents of CNY (0.001 CNY). 0.05 CNY = 50. */
export const BUDGET_MILLI_CNY = 50
/** 0.005 CNY = 5 milli-CNY. Compare only as integers. */
export const UNIT_COST_MILLI_CNY = 5

/** First-round Search queries (exact). Fetch list stays empty until review. */
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

export const FIRST_ROUND_FETCH_TARGETS: readonly string[] = []

export type PilotCapability = typeof DEEPSEEK_SEARCH_CAPABILITY | typeof DEEPSEEK_FETCH_CAPABILITY
export type AttemptStatus = "reserved" | "succeeded" | "failed" | "unknown"

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
}
export interface ReserveFail {
  ok: false
  code: "attempt_limit_reached" | "budget_limit_reached" | "ledger_pilot_mismatch"
  attempts: number
  reservedMilli: number
}
export type ReserveResult = ReserveOk | ReserveFail

export interface OutboundOutcome {
  ok: boolean
  unknown?: boolean
  errorCode?: string
  detail?: string
}

export interface PilotOutbound {
  search: (query: string, attemptId: string) => Promise<OutboundOutcome>
  fetch: (url: string, attemptId: string) => Promise<OutboundOutcome>
}

export type MemorySecretStore = SecretStore & {
  clear: () => void
  peekConfigured: () => boolean
}

export interface PilotOptions {
  cwd?: string
  ledgerPath?: string
  paidDbPath?: string
  pilotId?: string
  mode: "plan" | "execute"
  searchQueries?: readonly string[]
  fetchTargets?: readonly string[]
  maxAttempts?: number
  budgetMilli?: number
  unitMilli?: number
  readKey?: () => Promise<string | undefined>
  outbound?: PilotOutbound
  /** When set with live outbound, inject fetcher into Search/Fetch client (tests only). */
  injectedFetcher?: InjectedFetcher
  now?: () => Date
}

export interface PilotOpResult {
  capability: PilotCapability
  operationKey: string
  label: string
  outcome:
    | "planned"
    | "duplicate_skipped"
    | "reserved_failed"
    | "succeeded"
    | "failed"
    | "unknown"
    | "missing_api_key"
  attemptId?: string
  errorCode?: string
}

export interface PilotSummary {
  pilotId: string
  mode: "plan" | "execute"
  ledgerPath: string
  searchQueries: string[]
  fetchTargets: string[]
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

type Native = InstanceType<typeof NativeDatabase>

function assertUnitCostAligned(): void {
  const expected = Math.round(DEEPSEEK_SEARCH_FETCH_UNIT_COST_CNY * 1000)
  if (expected !== UNIT_COST_MILLI_CNY) {
    throw new Error(`unit_cost_mismatch:policy=${expected}:pilot=${UNIT_COST_MILLI_CNY}`)
  }
}

export function shippingRepoRoot(cwd = process.cwd()): string {
  return resolve(cwd)
}

export function defaultLedgerPath(cwd = process.cwd()): string {
  return join(shippingRepoRoot(cwd), PILOT_LEDGER_RELATIVE)
}

export function defaultPaidDbPath(cwd = process.cwd()): string {
  return join(shippingRepoRoot(cwd), PILOT_PAID_DB_RELATIVE)
}

export function resolveUnderCwd(cwd: string, path: string): string {
  return isAbsolute(path) ? path : join(shippingRepoRoot(cwd), path)
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
    get: async id => (id === DEEPSEEK_SEARCH_FETCH_PROVIDER_ID ? value : undefined),
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

/** Redact secret-like tokens and never echo an apiKey substring. */
export function sanitizePilotText(text: string, apiKey?: string): string {
  let out = String(text ?? "")
  if (apiKey && apiKey.length >= 4) {
    out = out.split(apiKey).join("[redacted]")
  }
  out = out.replace(/(Bearer\s+)\S+/gi, "$1[redacted]")
  out = out.replace(/(authorization["']?\s*[:=]\s*["']?)[^"',\s}]+/gi, "$1[redacted]")
  out = out.replace(/\bsk-[\w-]{8,}\b/g, "[redacted]")
  if (containsSecretLike(out, apiKey)) {
    return "[redacted]"
  }
  return out.slice(0, 500)
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
      UNIQUE (pilot_id, capability, operation_key)
    );
    CREATE INDEX IF NOT EXISTS idx_pilot_attempt_cap
      ON pilot_attempt (pilot_id, capability);
  `)
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
 * Same (pilotId, capability, operationKey) never creates a second row (no double-spend).
 * Uses BEGIN IMMEDIATE so concurrent processes serialize on the ledger file.
 */
export function reserveAttempt(
  native: Native,
  input: {
    pilotId: string
    capability: PilotCapability
    operationKey: string
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
      "SELECT id, status FROM pilot_attempt WHERE pilot_id = ? AND capability = ? AND operation_key = ?",
    ).get(input.pilotId, input.capability, input.operationKey) as { id: string, status: AttemptStatus } | undefined
    if (existing) {
      native.exec("COMMIT")
      return { ok: true, attemptId: existing.id, fresh: false, status: existing.status }
    }

    const attempts = countAttempts(native, input.pilotId, input.capability)
    const reservedMilli = sumReservedMilli(native, input.pilotId, input.capability)

    if (attempts >= maxAttempts) {
      native.exec("ROLLBACK")
      return { ok: false, code: "attempt_limit_reached", attempts, reservedMilli }
    }
    // Integer compare only — never float ≈10.
    if (reservedMilli + unitMilli > budgetMilli) {
      native.exec("ROLLBACK")
      return { ok: false, code: "budget_limit_reached", attempts, reservedMilli }
    }

    const attemptId = randomUUID()
    native.prepare(
      `INSERT INTO pilot_attempt
        (id, pilot_id, capability, operation_key, status, reserved_milli, created_at, finished_at, error_code)
       VALUES (?, ?, ?, ?, 'reserved', ?, ?, NULL, NULL)`,
    ).run(attemptId, input.pilotId, input.capability, input.operationKey, unitMilli, nowIso)
    native.exec("COMMIT")
    return { ok: true, attemptId, fresh: true, status: "reserved" }
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
    now?: Date
  },
): void {
  const nowIso = (input.now ?? new Date()).toISOString()
  native.prepare(
    `UPDATE pilot_attempt
     SET status = ?, finished_at = ?, error_code = COALESCE(?, error_code)
     WHERE id = ? AND status = 'reserved'`,
  ).run(input.status, nowIso, input.errorCode ?? null, input.attemptId)
}

export async function readKeyFromStdin(): Promise<string | undefined> {
  if (process.stdin.isTTY) return undefined
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  const text = Buffer.concat(chunks).toString("utf8").replace(/^\uFEFF/, "").trim()
  return text.length > 0 ? text : undefined
}

/**
 * Windows: PowerShell Read-Host -AsSecureString → one-shot plaintext to this process only.
 * Does not echo, does not write disk, does not put the key on argv.
 */
export function promptKeyViaPowerShellSecureString(): string | undefined {
  if (process.platform !== "win32") return undefined
  const ps = `
$ErrorActionPreference = 'Stop'
$sec = Read-Host -AsSecureString 'DeepSeek API key (SecureString, not echoed)'
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec)
try {
  $plain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
  if (-not $plain) { exit 2 }
  [Console]::Out.Write($plain)
} finally {
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
  if ($sec -is [IDisposable]) { $sec.Dispose() }
  $plain = $null
}
`
  const result = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", ps], {
    encoding: "utf8",
    windowsHide: true,
    stdio: ["inherit", "pipe", "inherit"],
  })
  if (result.status !== 0) return undefined
  const key = String(result.stdout ?? "").replace(/\r?\n$/, "")
  return key.length > 0 ? key : undefined
}

export async function resolveExecuteKey(opts: {
  keyFromStdin?: boolean
  readKey?: () => Promise<string | undefined>
  allowSecurePrompt?: boolean
}): Promise<string | undefined> {
  if (opts.readKey) return opts.readKey()
  if (opts.keyFromStdin) return readKeyFromStdin()
  if (opts.allowSecurePrompt !== false && process.platform === "win32" && process.stdin.isTTY) {
    return promptKeyViaPowerShellSecureString()
  }
  return undefined
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
  monthlyBudgetSearch?: number
  monthlyBudgetFetch?: number
}): Promise<{ outbound: PilotOutbound, dispose: () => void }> {
  mkdirSync(dirname(input.paidDbPath), { recursive: true })
  const native = new NativeDatabase(input.paidDbPath)
  const db = wrapDb(native)
  await initShippingTables(db, "mock")
  const budgetSearch = input.monthlyBudgetSearch ?? BUDGET_MILLI_CNY / 1000
  const budgetFetch = input.monthlyBudgetFetch ?? BUDGET_MILLI_CNY / 1000
  const config: SearchFetchServiceConfig = {
    db,
    secretStore: input.secrets,
    enabled: true,
    monthlyBudgetSearch: budgetSearch,
    monthlyBudgetFetch: budgetFetch,
    fetcher: input.injectedFetcher,
  }
  const outbound: PilotOutbound = {
    search: async (query, attemptId) => {
      try {
        await runDeepSeekSearch(config, { query, purpose: "ds_pilot_2026_10_23_r1", subject: attemptId })
        return { ok: true }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        const name = error instanceof Error ? error.name : "Error"
        const unknown = /unknown/i.test(name) || /unknown/i.test(message)
        return {
          ok: false,
          unknown,
          errorCode: sanitizePilotText(name),
          detail: sanitizePilotText(message),
        }
      }
    },
    fetch: async (url, attemptId) => {
      try {
        await runDeepSeekFetch(config, { url, purpose: "ds_pilot_2026_10_23_r1", subject: attemptId, persistence: "excerpt_only" })
        return { ok: true }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        const name = error instanceof Error ? error.name : "Error"
        const unknown = /unknown/i.test(name) || /unknown/i.test(message)
        return {
          ok: false,
          unknown,
          errorCode: sanitizePilotText(name),
          detail: sanitizePilotText(message),
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

export async function runPilot(options: PilotOptions): Promise<PilotSummary> {
  assertUnitCostAligned()
  const cwd = options.cwd ?? process.cwd()
  const pilotId = options.pilotId ?? PILOT_ID
  const ledgerPath = options.ledgerPath ?? defaultLedgerPath(cwd)
  const searchQueries = [...(options.searchQueries ?? FIRST_ROUND_SEARCH_QUERIES)]
  const fetchTargets = [...(options.fetchTargets ?? FIRST_ROUND_FETCH_TARGETS)]
  const maxAttempts = options.maxAttempts ?? MAX_ATTEMPTS_PER_CAPABILITY
  const budgetMilli = options.budgetMilli ?? BUDGET_MILLI_CNY
  const unitMilli = options.unitMilli ?? UNIT_COST_MILLI_CNY
  const now = options.now ?? (() => new Date())
  const notes: string[] = []
  const ops: PilotOpResult[] = []
  let outboundCalls = 0
  let failureCode: string | undefined
  let exitCode = 0

  if (options.mode === "plan") {
    notes.push("plan_only: no attempt reservation, no outbound, Fetch list empty until review")
    for (const query of searchQueries) {
      ops.push({
        capability: DEEPSEEK_SEARCH_CAPABILITY,
        operationKey: searchOperationKey(query),
        label: query,
        outcome: "planned",
      })
    }
    for (const url of fetchTargets) {
      ops.push({
        capability: DEEPSEEK_FETCH_CAPABILITY,
        operationKey: fetchOperationKey(url),
        label: url,
        outcome: "planned",
      })
    }
    if (fetchTargets.length === 0) {
      notes.push("fetch_targets: [] (no Fetch this round; do not raise disallowed licenses to pad)")
    }
    // Read-only open if ledger exists so summary shows durable counters.
    let searchAttempts = 0
    let fetchAttempts = 0
    let searchReservedMilli = 0
    let fetchReservedMilli = 0
    try {
      const ledger = openPilotLedger(ledgerPath, pilotId)
      try {
        searchAttempts = countAttempts(ledger.native, pilotId, DEEPSEEK_SEARCH_CAPABILITY)
        fetchAttempts = countAttempts(ledger.native, pilotId, DEEPSEEK_FETCH_CAPABILITY)
        searchReservedMilli = sumReservedMilli(ledger.native, pilotId, DEEPSEEK_SEARCH_CAPABILITY)
        fetchReservedMilli = sumReservedMilli(ledger.native, pilotId, DEEPSEEK_FETCH_CAPABILITY)
      } finally {
        ledger.close()
      }
    } catch {
      notes.push("ledger_absent_or_unreadable_in_plan")
    }
    return {
      pilotId,
      mode: "plan",
      ledgerPath,
      searchQueries,
      fetchTargets,
      searchAttempts,
      fetchAttempts,
      searchReservedMilli,
      fetchReservedMilli,
      ops,
      outboundCalls: 0,
      exitCode: 0,
      notes,
    }
  }

  // execute
  const key = options.readKey ? await options.readKey() : undefined
  const secrets = createMemorySecretStore(key)
  if (!key) {
    failureCode = "missing_api_key"
    exitCode = 2
    notes.push("missing_api_key: zero outbound, zero new reservations")
    secrets.clear()
    return {
      pilotId,
      mode: "execute",
      ledgerPath,
      searchQueries,
      fetchTargets,
      searchAttempts: 0,
      fetchAttempts: 0,
      searchReservedMilli: 0,
      fetchReservedMilli: 0,
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

  const ledger = openPilotLedger(ledgerPath, pilotId)
  let disposeLive: (() => void) | undefined
  let outbound = options.outbound
  try {
    if (!outbound) {
      const live = await createLiveOutbound({
        paidDbPath: options.paidDbPath ?? defaultPaidDbPath(cwd),
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
        unitMilli,
        budgetMilli,
        maxAttempts,
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
        ops.push({
          capability: DEEPSEEK_SEARCH_CAPABILITY,
          operationKey,
          label: query,
          outcome: "duplicate_skipped",
          attemptId: reserved.attemptId,
          errorCode: `duplicate:${reserved.status}`,
        })
        continue
      }
      outboundCalls += 1
      const result = await outbound.search(query, reserved.attemptId)
      const status: Exclude<AttemptStatus, "reserved"> = result.ok ? "succeeded" : result.unknown ? "unknown" : "failed"
      finalizeAttempt(ledger.native, {
        attemptId: reserved.attemptId,
        status,
        errorCode: result.errorCode ? sanitizePilotText(result.errorCode, key) : undefined,
        now: now(),
      })
      ops.push({
        capability: DEEPSEEK_SEARCH_CAPABILITY,
        operationKey,
        label: query,
        outcome: status,
        attemptId: reserved.attemptId,
        errorCode: result.errorCode ? sanitizePilotText(result.errorCode, key) : undefined,
      })
      if (!result.ok && exitCode === 0) {
        exitCode = 4
        failureCode = status === "unknown" ? "outbound_unknown" : "outbound_failed"
      }
    }

    if (fetchTargets.length === 0) {
      notes.push("fetch_targets: [] — zero Fetch attempts this round")
    }
    for (const url of fetchTargets) {
      const operationKey = fetchOperationKey(url)
      const reserved = reserveAttempt(ledger.native, {
        pilotId,
        capability: DEEPSEEK_FETCH_CAPABILITY,
        operationKey,
        unitMilli,
        budgetMilli,
        maxAttempts,
        now: now(),
      })
      if (!reserved.ok) {
        ops.push({
          capability: DEEPSEEK_FETCH_CAPABILITY,
          operationKey,
          label: url,
          outcome: "reserved_failed",
          errorCode: reserved.code,
        })
        failureCode = reserved.code
        exitCode = 3
        break
      }
      if (!reserved.fresh) {
        ops.push({
          capability: DEEPSEEK_FETCH_CAPABILITY,
          operationKey,
          label: url,
          outcome: "duplicate_skipped",
          attemptId: reserved.attemptId,
          errorCode: `duplicate:${reserved.status}`,
        })
        continue
      }
      outboundCalls += 1
      const result = await outbound.fetch(url, reserved.attemptId)
      const status: Exclude<AttemptStatus, "reserved"> = result.ok ? "succeeded" : result.unknown ? "unknown" : "failed"
      finalizeAttempt(ledger.native, {
        attemptId: reserved.attemptId,
        status,
        errorCode: result.errorCode ? sanitizePilotText(result.errorCode, key) : undefined,
        now: now(),
      })
      ops.push({
        capability: DEEPSEEK_FETCH_CAPABILITY,
        operationKey,
        label: url,
        outcome: status,
        attemptId: reserved.attemptId,
        errorCode: result.errorCode ? sanitizePilotText(result.errorCode, key) : undefined,
      })
    }

    const summary: PilotSummary = {
      pilotId,
      mode: "execute",
      ledgerPath,
      searchQueries,
      fetchTargets,
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
    return summary
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
  ledgerPath?: string
  paidDbPath?: string
  pilotId?: string
}

export function parsePilotArgs(argv: string[]): CliArgs {
  const out: CliArgs = { help: false, execute: false, keyFromStdin: false }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!
    if (arg === "--help" || arg === "-h") {
      out.help = true
    } else if (arg === "--execute") {
      out.execute = true
    } else if (arg === "--key-from-stdin") {
      out.keyFromStdin = true
    } else if (arg === "--ledger") {
      out.ledgerPath = argv[++i]
    } else if (arg === "--paid-db") {
      out.paidDbPath = argv[++i]
    } else if (arg === "--pilot-id") {
      out.pilotId = argv[++i]
    } else if (arg === "--dry-run" || arg === "--plan-only") {
      out.execute = false
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
    "  --execute          Allow outbound after atomic attempt reserve (requires key)",
    "  --key-from-stdin   Read API key once from stdin (no echo if piped from SecureString)",
    "  --ledger <path>    Override attempt ledger sqlite path",
    "  --paid-db <path>   Override isolated paid_receipt sqlite path",
    "  --pilot-id <id>    Override fixed pilot id (default ds-pilot-2026-10-23-r1)",
    "  --plan-only|--dry-run  Force plan mode (default)",
    "",
    "Windows SecureString → stdin (key never on argv / never on disk):",
    "  $sec = Read-Host -AsSecureString 'DeepSeek API key'",
    "  $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec)",
    "  $key = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)",
    "  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)",
    "  $key | node --import tsx/esm --experimental-loader ./scripts/tsx-alias-loader.mjs ./scripts/deepseek-search-fetch-pilot.ts --execute --key-from-stdin",
    "  $key = $null; [GC]::Collect()",
    "",
    "Hard gates: attempt≤10/capability (BEGIN IMMEDIATE) AND budget 50 milli-CNY (0.05 CNY).",
    "First round: listed PH/TH Search queries only; Fetch list empty.",
    "Does not read main .data/provider-secrets.json.",
  ]
  console.log(lines.join("\n"))
}

export function summaryForStdout(summary: PilotSummary): Record<string, unknown> {
  return {
    pilotId: summary.pilotId,
    mode: summary.mode,
    ledgerPath: summary.ledgerPath.replace(/\\/g, "/"),
    searchQueryCount: summary.searchQueries.length,
    fetchTargetCount: summary.fetchTargets.length,
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
    })),
  }
}
