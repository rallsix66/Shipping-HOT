// Adapted from AIHOT@44578fa packages/backend/src/providers/receipts.ts (MIT, third_party/aihot/LICENSE).
// Changes: SQLite (db0) instead of Postgres; `pg_advisory_xact_lock` + `FOR UPDATE` replaced by a BEGIN IMMEDIATE
// claim per logical key; the `budgets` table replaced by the existing budget decision over provider_usage;
// the API key comes from the existing SecretStore; estimated and actual cost are kept apart; no automatic
// release of unknown outcomes (upstream admin/runs.ts is not ported).
//
// 1. A logical request has a stable key bound to provider, capability, purpose, model and identity.
// 2. Before calling, a placeholder receipt and an attempt are committed in one BEGIN IMMEDIATE transaction.
// 3. A received response is stored and reused; it is never bought again for the same key.
// 4. A request whose outcome is unknown (timeout after sending, crash mid-flight) is never re-sent automatically,
//    including after a restart.
import { createHash, randomUUID } from "node:crypto"
import type { Database } from "db0"
import type { SecretStore } from "#/providers/contracts"
import { recordProviderUsageInTransaction } from "#/database/runtime-jobs"
import { type PaidBudgetCode, decidePaidBudget, paidBudgetWindow } from "#/services/paid-budget"
import { SharedBudgetGateError, type SharedLlmBudgetGate, assertSharedLlmBudgetInTransaction } from "#/intel/llm/shared-budget"
import type { PaidClaimBudgetConfig } from "#/services/shared-llm-budget-settings"

export type PaidGateCode = `paid_${PaidBudgetCode}` | "paid_secret_missing" | "paid_capability_disabled" | "paid_budget_currency_mismatch" | "paid_budget_currency_mixed" | "paid_budget_currency_unknown" | "paid_budget_scope_invalid"

/** No request was sent: budget or credential gate. */
export class PaidGateError extends Error {
  readonly code: PaidGateCode
  constructor(code: PaidGateCode) {
    super(code)
    this.name = "PaidGateError"
    this.code = code
  }
}

/** The request estimate is not a finite, non-negative number: rejected before anything is claimed or sent. */
export class PaidCostError extends Error {
  readonly code = "paid_invalid_estimate"
  constructor(message: string) {
    super(message)
    this.name = "PaidCostError"
  }
}

export class ReceiptBusyError extends Error {
  readonly receiptId: string
  constructor(receiptId: string) {
    super(`Receipt ${receiptId} is in flight`)
    this.name = "ReceiptBusyError"
    this.receiptId = receiptId
  }
}

export class ReceiptUnknownError extends Error {
  readonly receiptId: string
  constructor(receiptId: string, message: string) {
    super(message)
    this.name = "ReceiptUnknownError"
    this.receiptId = receiptId
  }
}

/** Raised by a call when the provider clearly did not accept (and will not bill) the request. */
export class ProviderRejectedError extends Error {
  readonly status: number | null
  readonly retryable: boolean
  constructor(message: string, status: number | null, retryable: boolean) {
    super(message)
    this.name = "ProviderRejectedError"
    this.status = status
    this.retryable = retryable
  }
}

export interface CallOutcome {
  response: unknown
  requestId?: string | null
  usage?: { tokensIn?: number, tokensOut?: number } | null
  /** basis 'actual' only when the provider returned a billed amount; anything else is an estimate. */
  cost?: { amount: number, currency: string, basis: "actual" | "estimated" } | null
}

export interface ReceiptRequest {
  providerId: string
  capability: string
  model?: string | null
  purpose: string
  subject?: string | null
  /** Everything that determines the output. Hashed into the logical key; only a redacted summary is stored. */
  identity: unknown
  /** Stored for diagnosis; must not contain secrets. */
  requestSummary?: Record<string, unknown>
  /** Distinguishes an explicit re-run from recovery of the same request. */
  attemptTag?: string
  /** Pre-call estimate, reserved against the budget while the attempt is pending. */
  estimatedCost: number
}

export interface PaidRequestContext {
  db: Database
  secretStore: SecretStore
  /**
   * Capability sub-limit (translation) or ADR-011 per-capability budget (Search/Fetch).
   * With sharedBudget: undefined skips the sub-limit (registry tests); null/number still gated.
   * Without sharedBudget: null/undefined = unconfigured = no call.
   */
  monthlyBudget: number | null | undefined
  currency: string
  now?: () => Date
  /** Optional deadline for the call; hitting it after sending leaves the outcome unknown. */
  timeoutMs?: number
  /**
   * When set, the BEGIN IMMEDIATE claim gates against the shared LLM pool
   * (aggregate usage + pending/unknown) from ShippingSettings.sharedLlmBudget.
   * Translation also passes monthlyBudget as a stricter sub-limit in the same claim.
   * Search/Fetch must omit this (ADR-011 independent budgets).
   * aggregatePaidMonthSpend alone is never an execution gate -- only this path is.
   *
   * Prefer resolveClaimConfig for production paths: outer sharedBudget/monthlyBudget
   * are snapshots that can go stale across SecretStore await + claim queue.
   */
  sharedBudget?: SharedLlmBudgetGate
  /**
   * Controlled config resolver run INSIDE BEGIN IMMEDIATE (same atomic claim).
   * Re-reads authoritative shared pool + translation sub-limit (+ enabled).
   * When present, its result replaces outer sharedBudget/monthlyBudget for the gate.
   */
  resolveClaimConfig?: (db: Database) => Promise<PaidClaimBudgetConfig>
}

export interface ReceiptResult {
  receiptId: string
  response: unknown
  reused: boolean
}

export const PENDING_STALE_MS = 10 * 60 * 1000

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex")
}

/** Stable JSON (sorted keys) for hashing request identities. (AIHOT lib/ids.ts stableJson) */
export function stableJson(value: unknown): string {
  return JSON.stringify(value, (_key, v) => {
    if (v && typeof v === "object" && !Array.isArray(v)) {
      return Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
    }
    return v
  })
}

export function logicalKeyFor(req: ReceiptRequest): string {
  return [req.providerId, req.capability, req.purpose, req.model ?? "-", sha256(stableJson(req.identity)), req.attemptTag ?? "0"].join(":")
}

interface ReceiptRow {
  id: string
  status: string
  response: string | null
  updated_at: string
}

// db0 over one connection cannot nest transactions; claims in this process are serialised here, and
// BEGIN IMMEDIATE serialises them against other connections/processes on the same database file.
let claimChain: Promise<unknown> = Promise.resolve()
function serialised<T>(work: () => Promise<T>): Promise<T> {
  const next = claimChain.then(work, work)
  claimChain = next.catch(() => undefined)
  return next
}

async function immediate<T>(db: Database, work: () => Promise<T>): Promise<T> {
  return serialised(async () => {
    await db.prepare("BEGIN IMMEDIATE").run()
    try {
      const result = await work()
      await db.prepare("COMMIT").run()
      return result
    } catch (error) {
      try {
        await db.prepare("ROLLBACK").run()
      } catch {
        // keep the original error
      }
      throw error
    }
  })
}

/**
 * Estimated budget gate (not a hard cap on actual charges).
 * Month spend = provider_usage estimated_cost + reservations of attempts not yet booked into usage
 * (pending, or unknown with usage_recorded = 0 for rows written before migration 025).
 * Every attempt that may have been billed is booked into provider_usage exactly once (usage_recorded = 1).
 */
async function monthSpend(db: Database, req: ReceiptRequest, now: Date): Promise<number> {
  // ADR-011: per provider_id × capability (Search/Fetch independent). Scoped aggregate is optional and separate.
  const window = paidBudgetWindow(now)
  const usage = await db.prepare(`
    SELECT COALESCE(SUM(estimated_cost), 0) AS spend FROM provider_usage
    WHERE provider_id = ? AND capability = ? AND window_start >= ? AND window_start < ?
  `).get(req.providerId, req.capability, window.from, window.to) as { spend: number }
  const pending = await db.prepare(`
    SELECT COALESCE(SUM(estimated_cost), 0) AS spend FROM paid_receipt_attempt
    WHERE provider_id = ? AND capability = ? AND usage_recorded = 0 AND status IN ('pending', 'unknown') AND started_at >= ? AND started_at < ?
  `).get(req.providerId, req.capability, window.from, window.to) as { spend: number }
  return Number(usage.spend) + Number(pending.spend)
}

function mapSharedBudgetError(error: SharedBudgetGateError): PaidGateError {
  if (error.code === "budget_currency_mismatch") return new PaidGateError("paid_budget_currency_mismatch")
  if (error.code === "budget_currency_mixed") return new PaidGateError("paid_budget_currency_mixed")
  if (error.code === "budget_currency_unknown") return new PaidGateError("paid_budget_currency_unknown")
  if (error.code === "budget_scope_invalid") return new PaidGateError("paid_budget_scope_invalid")
  return new PaidGateError(`paid_${error.code}`)
}

async function checkBudget(ctx: PaidRequestContext, req: ReceiptRequest, now: Date, claimConfig?: PaidClaimBudgetConfig): Promise<void> {
  const sharedBudget = claimConfig?.sharedBudget ?? ctx.sharedBudget
  const monthlyBudget = claimConfig ? claimConfig.monthlyBudget : ctx.monthlyBudget
  if (claimConfig?.enabled === false) {
    throw new PaidGateError("paid_capability_disabled")
  }
  if (sharedBudget) {
    try {
      await assertSharedLlmBudgetInTransaction(ctx.db, sharedBudget, ctx.currency, req.estimatedCost, now)
    } catch (error) {
      if (error instanceof SharedBudgetGateError) throw mapSharedBudgetError(error)
      throw error
    }
    // Dual gate: capability sub-limit (e.g. translation.monthlyBudget) still applies
    // inside the same BEGIN IMMEDIATE claim. Shared pool must never relax it.
    // Registry chat/embedding omit monthlyBudget (undefined) so only the pool applies.
    // Explicit null still fail-closes as unconfigured for the sub-limit.
    if (monthlyBudget !== undefined) {
      const sub = decidePaidBudget(monthlyBudget, await monthSpend(ctx.db, req, now), req.estimatedCost)
      if (sub) throw new PaidGateError(`paid_${sub}`)
    }
    return
  }
  // ADR-011 default: per provider_id x capability (Search/Fetch independent).
  const code = decidePaidBudget(monthlyBudget, await monthSpend(ctx.db, req, now), req.estimatedCost)
  if (code) throw new PaidGateError(`paid_${code}`)
}

async function startAttempt(db: Database, receiptId: string, attempt: number, req: ReceiptRequest, nowIso: string): Promise<string> {
  const id = randomUUID()
  await db.prepare(`
    INSERT INTO paid_receipt_attempt (id, receipt_id, attempt, provider_id, capability, model, status, estimated_cost, currency, started_at)
    VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, NULL, ?)
  `).run(id, receiptId, attempt, req.providerId, req.capability, req.model ?? null, req.estimatedCost, nowIso)
  return id
}

interface AttemptRow {
  id: string
  provider_id: string
  capability: string
  estimated_cost: number
  currency: string | null
  usage_recorded: number
}

/**
 * Closes one pending attempt as unknown or failed and books it into provider_usage in the same transaction.
 * Idempotent per attempt: only a row still 'pending' changes, and usage is booked only while usage_recorded = 0.
 * Unknown keeps its estimate (it may have been billed); a clear rejection is booked at 0.
 */
async function closeAttempt(db: Database, attemptId: string, status: "unknown" | "failed", reason: string, nowIso: string, latencyMs: number | null, currency: string): Promise<boolean> {
  const attempt = await db.prepare("SELECT id, provider_id, capability, estimated_cost, currency, usage_recorded FROM paid_receipt_attempt WHERE id = ? AND status = 'pending'").get(attemptId) as AttemptRow | undefined
  if (!attempt) return false
  await db.prepare("UPDATE paid_receipt_attempt SET status = ?, error = ?, latency_ms = COALESCE(?, latency_ms), finished_at = ?, usage_recorded = 1 WHERE id = ? AND status = 'pending'").run(status, reason, latencyMs, nowIso, attemptId)
  if (attempt.usage_recorded === 0) {
    await recordProviderUsageInTransaction(db, { providerId: attempt.provider_id, capability: attempt.capability, failed: true, estimatedCost: status === "failed" ? 0 : Number(attempt.estimated_cost), currency, calledAt: nowIso, errorCode: status === "failed" ? "paid_provider_rejected" : "paid_result_unknown" })
  }
  return true
}

async function markUnknown(db: Database, receiptId: string, reason: string, nowIso: string): Promise<void> {
  const receipt = await db.prepare("SELECT currency FROM paid_receipt WHERE id = ?").get(receiptId) as { currency: string | null } | undefined
  await db.prepare("UPDATE paid_receipt SET status = 'unknown', error = ?, updated_at = ? WHERE id = ? AND status = 'pending'").run(reason, nowIso, receiptId)
  const pending = await db.prepare("SELECT id FROM paid_receipt_attempt WHERE receipt_id = ? AND status = 'pending'").all(receiptId) as Array<{ id: string }>
  for (const row of pending) await closeAttempt(db, row.id, "unknown", reason, nowIso, null, receipt?.currency ?? "USD")
}

function validCost(amount: unknown): amount is number {
  return typeof amount === "number" && Number.isFinite(amount) && amount >= 0
}

type Claim =
  | { kind: "reuse", row: ReceiptRow }
  | { kind: "busy", row: ReceiptRow }
  | { kind: "unknown", row: ReceiptRow }
  | { kind: "call", id: string, attemptId: string }

class Timeout extends Error {}

/**
 * Runs a paid request at most once per logical key and returns its raw response.
 * The caller parses the response and commits business results, then calls completeReceipt.
 */
export async function paidRequest(ctx: PaidRequestContext, req: ReceiptRequest, call: (apiKey: string) => Promise<CallOutcome>): Promise<ReceiptResult> {
  if (!validCost(req.estimatedCost)) throw new PaidCostError(`estimatedCost must be a finite, non-negative number (got ${String(req.estimatedCost)})`)
  const clock = ctx.now ?? (() => new Date())
  const logicalKey = logicalKeyFor(req)
  const apiKey = (await ctx.secretStore.get(req.providerId))?.trim()

  const claimed: Claim = await immediate(ctx.db, async () => {
    const now = clock()
    const nowIso = now.toISOString()
    // Claim-time authority: re-resolve pool/sub-limit/enabled inside the same BEGIN IMMEDIATE
    // so SecretStore await + claim queue cannot observe a stale outer snapshot.
    const claimConfig = ctx.resolveClaimConfig ? await ctx.resolveClaimConfig(ctx.db) : undefined
    const existing = await ctx.db.prepare("SELECT id, status, response, updated_at FROM paid_receipt WHERE logical_key = ?").get(logicalKey) as ReceiptRow | undefined
    if (existing) {
      if (existing.status === "received" || existing.status === "completed") return { kind: "reuse", row: existing }
      if (existing.status === "pending") {
        if (now.getTime() - Date.parse(existing.updated_at) < PENDING_STALE_MS) return { kind: "busy", row: existing }
        await markUnknown(ctx.db, existing.id, "placeholder went stale without a recorded result", nowIso)
        return { kind: "unknown", row: existing }
      }
      if (existing.status === "unknown") return { kind: "unknown", row: existing }
      // failed: the provider did not take the request, or its answer was unusable; a new attempt is allowed.
      if (!apiKey) throw new PaidGateError("paid_secret_missing")
      await checkBudget(ctx, req, now, claimConfig)
      await ctx.db.prepare("UPDATE paid_receipt SET status = 'pending', attempts = attempts + 1, error = NULL, updated_at = ? WHERE id = ?").run(nowIso, existing.id)
      const { attempts } = await ctx.db.prepare("SELECT attempts FROM paid_receipt WHERE id = ?").get(existing.id) as { attempts: number }
      return { kind: "call", id: existing.id, attemptId: await startAttempt(ctx.db, existing.id, attempts, req, nowIso) }
    }
    if (!apiKey) throw new PaidGateError("paid_secret_missing")
    await checkBudget(ctx, req, now, claimConfig)
    const id = randomUUID()
    await ctx.db.prepare(`
      INSERT INTO paid_receipt (id, logical_key, provider_id, capability, model, purpose, subject, status, request, estimated_cost, currency, attempts, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, 1, ?, ?)
    `).run(id, logicalKey, req.providerId, req.capability, req.model ?? null, req.purpose, req.subject ?? null, JSON.stringify(req.requestSummary ?? {}), req.estimatedCost, ctx.currency, nowIso, nowIso)
    return { kind: "call", id, attemptId: await startAttempt(ctx.db, id, 1, req, nowIso) }
  })

  if (claimed.kind === "reuse") return { receiptId: claimed.row.id, response: claimed.row.response === null ? null : JSON.parse(claimed.row.response), reused: true }
  if (claimed.kind === "busy") throw new ReceiptBusyError(claimed.row.id)
  if (claimed.kind === "unknown") throw new ReceiptUnknownError(claimed.row.id, `Receipt ${claimed.row.id} has an unknown outcome; it is not re-sent automatically`)

  const { id: receiptId, attemptId } = claimed
  const started = clock().getTime()
  let outcome: CallOutcome
  try {
    outcome = await withTimeout(call(apiKey!), ctx.timeoutMs)
  } catch (error) {
    const rejected = error instanceof ProviderRejectedError
    const status = rejected ? "failed" : "unknown"
    // "unknown": the request may have reached the provider (timeout, reset): never re-send automatically.
    const message = (error instanceof Timeout ? "timeout after send" : error instanceof Error ? error.message : String(error)).slice(0, 2000)
    await immediate(ctx.db, async () => {
      const nowIso = clock().toISOString()
      if (await closeAttempt(ctx.db, attemptId, status, message, nowIso, clock().getTime() - started, ctx.currency)) {
        await ctx.db.prepare("UPDATE paid_receipt SET status = ?, error = ?, updated_at = ? WHERE id = ? AND status = 'pending'").run(status, message, nowIso, receiptId)
      }
    })
    if (error instanceof Timeout) throw new ReceiptUnknownError(receiptId, `Receipt ${receiptId} timed out after sending; outcome unknown`)
    throw error
  }

  // Returned costs are accepted only when finite, non-negative and in the budget currency; otherwise the
  // valid request estimate is kept and no actual cost is recorded.
  const returned = outcome.cost ?? null
  const costProblem = !returned
    ? null
    : !validCost(returned.amount)
        ? `returned cost rejected: ${String(returned.amount)}`
        : returned.currency !== ctx.currency
          ? `returned cost rejected: currency ${String(returned.currency)} != ${ctx.currency}`
          : null
  const accepted = returned && !costProblem ? returned : null
  const actual = accepted?.basis === "actual" ? accepted.amount : null
  const estimated = accepted?.basis === "estimated" ? accepted.amount : req.estimatedCost
  const basis = actual === null ? "estimated" : "actual"
  const currency = ctx.currency
  await immediate(ctx.db, async () => {
    const nowIso = clock().toISOString()
    const usage = outcome.usage ? JSON.stringify(outcome.usage) : null
    const attempt = await ctx.db.prepare("SELECT usage_recorded FROM paid_receipt_attempt WHERE id = ?").get(attemptId) as { usage_recorded: number } | undefined
    // A late answer (attempt already recovered to unknown and booked at its estimate) is stored but not booked again.
    const booked = attempt?.usage_recorded === 1
    await ctx.db.prepare(`
      UPDATE paid_receipt SET status = 'received', response = ?, request_id = ?, usage = ?, estimated_cost = ?, actual_cost = ?, currency = ?, cost_basis = ?, error = ?, received_at = ?, updated_at = ?
      WHERE id = ? AND status IN ('pending', 'unknown')
    `).run(JSON.stringify(outcome.response ?? null), outcome.requestId ?? null, usage, estimated, actual, currency, basis, costProblem, nowIso, nowIso, receiptId)
    await ctx.db.prepare(`
      UPDATE paid_receipt_attempt SET status = 'received', request_id = ?, usage = ?, estimated_cost = CASE WHEN usage_recorded = 1 THEN estimated_cost ELSE ? END, actual_cost = ?, currency = ?, cost_basis = ?, latency_ms = ?, finished_at = ?, error = ?, usage_recorded = 1
      WHERE id = ?
    `).run(outcome.requestId ?? null, usage, estimated, actual, currency, basis, clock().getTime() - started, nowIso, costProblem, attemptId)
    if (!booked) await recordProviderUsageInTransaction(ctx.db, { providerId: req.providerId, capability: req.capability, succeeded: true, tokensIn: outcome.usage?.tokensIn, tokensOut: outcome.usage?.tokensOut, estimatedCost: estimated, currency, calledAt: nowIso })
  })
  return { receiptId, response: outcome.response ?? null, reused: false }
}

async function withTimeout<T>(work: Promise<T>, timeoutMs: number | undefined): Promise<T> {
  if (!timeoutMs) return work
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([work, new Promise<never>((_resolve, reject) => (timer = setTimeout(() => reject(new Timeout()), timeoutMs)))])
  } finally {
    clearTimeout(timer)
  }
}

/** Placeholders older than PENDING_STALE_MS become "unknown" (never re-sent). Safe while other callers run. */
export async function markStalePendingReceipts(db: Database, now: Date = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - PENDING_STALE_MS).toISOString()
  return immediate(db, async () => {
    const stale = await db.prepare("SELECT id FROM paid_receipt WHERE status = 'pending' AND updated_at < ?").all(cutoff) as Array<{ id: string }>
    for (const row of stale) await markUnknown(db, row.id, "placeholder went stale without a recorded result", now.toISOString())
    return stale.length
  })
}

/**
 * Explicit exclusive startup step: every placeholder left 'pending' by a stopped process becomes "unknown"
 * at once, so it is never re-sent. Call only at process startup before any paid caller runs (single process).
 */
export async function markPendingReceiptsUnknownAtExclusiveStartup(db: Database, now: Date = new Date()): Promise<number> {
  return immediate(db, async () => {
    const pending = await db.prepare("SELECT id FROM paid_receipt WHERE status = 'pending'").all() as Array<{ id: string }>
    for (const row of pending) await markUnknown(db, row.id, "process stopped while the request was in flight", now.toISOString())
    return pending.length
  })
}

export async function completeReceipt(db: Database, receiptId: string, now: Date = new Date()): Promise<void> {
  const nowIso = now.toISOString()
  await db.prepare("UPDATE paid_receipt SET status = 'completed', completed_at = COALESCE(completed_at, ?), updated_at = ? WHERE id = ? AND status = 'received'").run(nowIso, nowIso, receiptId)
}

/** Marks a received response that could not be used (e.g. unparsable) so a fresh attempt can be made. */
export async function rejectReceivedResponse(db: Database, receiptId: string, reason: string, now: Date = new Date()): Promise<void> {
  await db.prepare("UPDATE paid_receipt SET status = 'failed', error = ?, updated_at = ? WHERE id = ? AND status = 'received'").run(reason.slice(0, 2000), now.toISOString(), receiptId)
}
