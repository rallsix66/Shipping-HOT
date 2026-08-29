import { randomUUID } from "node:crypto"
import type { Database } from "db0"
import type { ProviderRuntimeRecord, SyncRunRecord } from "#/providers/contracts"

type RuntimeStatus = ProviderRuntimeRecord["status"]

export interface CreateSyncRunInput {
  providerId: string
  capability: string
  startedAt?: string
}

export interface CompleteSyncRunInput {
  id: string
  completedAt?: string
  status: Exclude<SyncRunRecord["status"], "running">
  recordsRead?: number
  recordsWritten?: number
  errorCode?: string | null
  errorMessage?: string | null
}

export interface ProviderRuntimePatch {
  providerId: string
  capability: string
  status?: RuntimeStatus
  lastRequestAt?: string | null
  lastSuccessAt?: string | null
  lastFailureAt?: string | null
  lastSourceUpdatedAt?: string | null
  nextSyncAt?: string | null
  consecutiveFailures?: number
  errorCode?: string | null
  errorMessage?: string | null
  updatedAt?: string
}

export interface ProviderUsagePatch {
  providerId: string
  capability: string
  succeeded?: boolean
  failed?: boolean
  records?: number
  calledAt?: string
  errorCode?: string
}

interface ProviderRuntimeRow {
  provider_id: string
  capability: string
  status: RuntimeStatus
  last_request_at?: string | null
  last_success_at?: string | null
  last_failure_at?: string | null
  last_source_updated_at?: string | null
  next_sync_at?: string | null
  consecutive_failures: number
  error_code?: string | null
  error_message?: string | null
  updated_at: string
}

interface SyncRunRow {
  id: string
  provider_id: string
  capability: string
  started_at: string
  completed_at?: string | null
  status: SyncRunRecord["status"]
  records_read?: number | null
  records_written?: number | null
  error_code?: string | null
  error_message?: string | null
}

function rows<T>(value: unknown): T[] {
  if (Array.isArray(value)) return value as T[]
  if (value && typeof value === "object" && Array.isArray((value as { results?: unknown[] }).results)) {
    return (value as { results: T[] }).results
  }
  return []
}

function optionalString(value: string | null | undefined): string | undefined {
  return value ?? undefined
}

function toProviderRuntime(row: ProviderRuntimeRow): ProviderRuntimeRecord {
  return {
    providerId: row.provider_id,
    capability: row.capability,
    status: row.status,
    lastRequestAt: optionalString(row.last_request_at),
    lastSuccessAt: optionalString(row.last_success_at),
    lastFailureAt: optionalString(row.last_failure_at),
    lastSourceUpdatedAt: optionalString(row.last_source_updated_at),
    nextSyncAt: optionalString(row.next_sync_at),
    consecutiveFailures: Number(row.consecutive_failures),
    errorCode: optionalString(row.error_code),
    errorMessage: optionalString(row.error_message),
    updatedAt: row.updated_at,
  }
}

function toSyncRun(row: SyncRunRow): SyncRunRecord {
  return {
    id: row.id,
    providerId: row.provider_id,
    capability: row.capability,
    startedAt: row.started_at,
    completedAt: optionalString(row.completed_at),
    status: row.status,
    recordsRead: row.records_read ?? undefined,
    recordsWritten: row.records_written ?? undefined,
    errorCode: optionalString(row.error_code),
    errorMessage: optionalString(row.error_message),
  }
}

export class RuntimeRepository {
  constructor(private readonly db: Database) {}

  async createSyncRun(input: CreateSyncRunInput): Promise<SyncRunRecord> {
    const record: SyncRunRecord = {
      id: randomUUID(),
      providerId: input.providerId,
      capability: input.capability,
      startedAt: input.startedAt ?? new Date().toISOString(),
      status: "running",
    }
    await this.db.prepare(`
      INSERT INTO sync_runs (id, provider_id, capability, started_at, status)
      VALUES (?, ?, ?, ?, ?)
    `).run(record.id, record.providerId, record.capability, record.startedAt, record.status)
    return record
  }

  async completeSyncRun(input: CompleteSyncRunInput): Promise<void> {
    await this.db.prepare(`
      UPDATE sync_runs
      SET completed_at = ?, status = ?, records_read = ?, records_written = ?, error_code = ?, error_message = ?
      WHERE id = ?
    `).run(
      input.completedAt ?? new Date().toISOString(),
      input.status,
      input.recordsRead ?? null,
      input.recordsWritten ?? null,
      input.errorCode ?? null,
      input.errorMessage ?? null,
      input.id,
    )
  }

  async listSyncRuns(providerId?: string, limit = 100): Promise<SyncRunRecord[]> {
    const boundedLimit = Math.max(1, Math.min(Math.floor(limit), 500))
    const query = providerId
      ? "SELECT * FROM sync_runs WHERE provider_id = ? ORDER BY started_at DESC LIMIT ?"
      : "SELECT * FROM sync_runs ORDER BY started_at DESC LIMIT ?"
    const result = providerId
      ? await this.db.prepare(query).all(providerId, boundedLimit)
      : await this.db.prepare(query).all(boundedLimit)
    return rows<SyncRunRow>(result).map(toSyncRun)
  }

  async getProviderRuntime(providerId: string, capability: string): Promise<ProviderRuntimeRecord | undefined> {
    const row = await this.db.prepare("SELECT * FROM provider_runtime WHERE provider_id = ? AND capability = ?").get(providerId, capability) as ProviderRuntimeRow | undefined
    return row ? toProviderRuntime(row) : undefined
  }

  async listProviderRuntime(): Promise<ProviderRuntimeRecord[]> {
    const result = await this.db.prepare("SELECT * FROM provider_runtime ORDER BY provider_id").all()
    return rows<ProviderRuntimeRow>(result).map(toProviderRuntime)
  }

  async recordProviderUsage(patch: ProviderUsagePatch): Promise<void> {
    const calledAt = patch.calledAt ?? new Date().toISOString()
    const windowStart = `${calledAt.slice(0, 13)}:00:00.000Z`
    const id = `usage:${patch.providerId}:${patch.capability}:${windowStart}`
    await this.db.prepare(`
      INSERT INTO provider_usage (id, provider_id, capability, window_start, request_count, success_count, failure_count, records_count, last_called_at, error_code)
      VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        request_count = provider_usage.request_count + 1,
        success_count = provider_usage.success_count + excluded.success_count,
        failure_count = provider_usage.failure_count + excluded.failure_count,
        records_count = provider_usage.records_count + excluded.records_count,
        last_called_at = excluded.last_called_at,
        error_code = excluded.error_code
    `).run(id, patch.providerId, patch.capability, windowStart, patch.succeeded ? 1 : 0, patch.failed ? 1 : 0, patch.records ?? 0, calledAt, patch.errorCode ?? null)
  }

  async updateProviderRuntime(patch: ProviderRuntimePatch): Promise<ProviderRuntimeRecord> {
    const current = await this.getProviderRuntime(patch.providerId, patch.capability)
    const next: ProviderRuntimeRecord = {
      providerId: patch.providerId,
      capability: patch.capability,
      status: patch.status ?? current?.status ?? "never_succeeded",
      lastRequestAt: patch.lastRequestAt === undefined ? current?.lastRequestAt : patch.lastRequestAt ?? undefined,
      lastSuccessAt: patch.lastSuccessAt === undefined ? current?.lastSuccessAt : patch.lastSuccessAt ?? undefined,
      lastFailureAt: patch.lastFailureAt === undefined ? current?.lastFailureAt : patch.lastFailureAt ?? undefined,
      lastSourceUpdatedAt: patch.lastSourceUpdatedAt === undefined ? current?.lastSourceUpdatedAt : patch.lastSourceUpdatedAt ?? undefined,
      nextSyncAt: patch.nextSyncAt === undefined ? current?.nextSyncAt : patch.nextSyncAt ?? undefined,
      consecutiveFailures: patch.consecutiveFailures ?? current?.consecutiveFailures ?? 0,
      errorCode: patch.errorCode === undefined ? current?.errorCode : patch.errorCode ?? undefined,
      errorMessage: patch.errorMessage === undefined ? current?.errorMessage : patch.errorMessage ?? undefined,
      updatedAt: patch.updatedAt ?? new Date().toISOString(),
    }
    await this.db.prepare(`
      INSERT INTO provider_runtime (
        provider_id, capability, status, last_request_at, last_success_at, last_failure_at,
        last_source_updated_at, next_sync_at, consecutive_failures, error_code, error_message, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(provider_id, capability) DO UPDATE SET
        capability = excluded.capability,
        status = excluded.status,
        last_request_at = excluded.last_request_at,
        last_success_at = excluded.last_success_at,
        last_failure_at = excluded.last_failure_at,
        last_source_updated_at = excluded.last_source_updated_at,
        next_sync_at = excluded.next_sync_at,
        consecutive_failures = excluded.consecutive_failures,
        error_code = excluded.error_code,
        error_message = excluded.error_message,
        updated_at = excluded.updated_at
    `).run(
      next.providerId,
      next.capability,
      next.status,
      next.lastRequestAt ?? null,
      next.lastSuccessAt ?? null,
      next.lastFailureAt ?? null,
      next.lastSourceUpdatedAt ?? null,
      next.nextSyncAt ?? null,
      next.consecutiveFailures,
      next.errorCode ?? null,
      next.errorMessage ?? null,
      next.updatedAt,
    )
    return next
  }
}
