import { createHash } from "node:crypto"
import type { Database } from "db0"
import type { ProviderUsagePatch } from "#/database/runtime-jobs"
import { recordProviderUsageInTransaction } from "#/database/runtime-jobs"
import type { TranslationCacheRecord } from "#/providers/contracts"

export interface TranslationCacheLookup {
  entityType: string
  entityId: string
  fieldName: string
  sourceHash: string
  targetLanguage: string
}

export interface TranslationCacheExactLookup extends TranslationCacheLookup {
  provider: string
  model: string
}

export interface TranslationWorkClaimInput extends TranslationCacheExactLookup {
  sourceText: string
  sourceLanguage?: string
  now: string
  leaseUntil: string
}

export interface TranslationLeaseIdentity extends TranslationCacheExactLookup {
  leaseUntil: string
}

export interface TranslationCacheStatistics {
  total: number
  succeeded: number
  pending: number
  failed: number
}

export interface TranslationRequeueInput {
  provider: string
  model: string
  eligibleIdentities: readonly TranslationCacheExactLookup[]
  errorCodes: readonly string[]
  limit?: number
  reason: string
  now: string
}

export interface TranslationRequeueResult {
  selected: number
  requeued: number
  skipped: number
}

interface TranslationCacheRow {
  id: string
  entity_type: string
  entity_id: string
  field_name: string
  source_text: string
  source_hash: string
  source_language?: string | null
  target_language: string
  provider: string
  model: string
  translated_text?: string | null
  translated_at?: string | null
  status: TranslationCacheRecord["status"]
  error_message?: string | null
  retry_count?: number | null
  next_retry_at?: string | null
  retryable?: number | boolean | null
  lease_until?: string | null
  last_error_code?: string | null
  preferred: number | boolean
  created_at: string
  updated_at: string
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

function toRecord(row: TranslationCacheRow): TranslationCacheRecord {
  return {
    id: row.id,
    entityType: row.entity_type,
    entityId: row.entity_id,
    fieldName: row.field_name,
    sourceText: row.source_text,
    sourceHash: row.source_hash,
    sourceLanguage: optionalString(row.source_language),
    targetLanguage: row.target_language,
    provider: row.provider,
    model: row.model,
    translatedText: optionalString(row.translated_text),
    translatedAt: optionalString(row.translated_at),
    status: row.status,
    errorMessage: optionalString(row.error_message),
    retryCount: Number(row.retry_count ?? 0),
    nextRetryAt: optionalString(row.next_retry_at),
    retryable: Boolean(row.retryable),
    leaseUntil: optionalString(row.lease_until),
    lastErrorCode: optionalString(row.last_error_code),
    preferred: Boolean(row.preferred),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function workId(input: TranslationCacheExactLookup): string {
  const identity = [input.entityType, input.entityId, input.fieldName, input.sourceHash, input.targetLanguage, input.provider, input.model].join("\u0000")
  return `translation:${createHash("sha256").update(identity, "utf8").digest("hex")}`
}

function whereIdentity(input: TranslationCacheExactLookup): { sql: string, params: string[] } {
  return {
    sql: "entity_type = ? AND entity_id = ? AND field_name = ? AND source_hash = ? AND target_language = ? AND provider = ? AND model = ?",
    params: [input.entityType, input.entityId, input.fieldName, input.sourceHash, input.targetLanguage, input.provider, input.model],
  }
}

function isFuture(value: string | null | undefined, now: string): boolean {
  if (!value) return false
  const parsed = Date.parse(value)
  const nowMs = Date.parse(now)
  return Number.isFinite(parsed) && Number.isFinite(nowMs) && parsed > nowMs
}

function safeReason(reason: string): string {
  return reason.replace(/\b(?:api[-_ ]?key|authorization|bearer|token|secret)\b[^\r\n]{0,256}/gi, "[redacted]").slice(0, 500)
}

const transactionTails = new WeakMap<object, Promise<void>>()

async function transaction<T>(db: Database, work: () => Promise<T>): Promise<T> {
  const key = db as unknown as object
  const previous = transactionTails.get(key) ?? Promise.resolve()
  let release!: () => void
  const current = new Promise<void>((resolve) => {
    release = resolve
  })
  const tail = previous.then(() => current)
  transactionTails.set(key, tail)
  await previous
  try {
    await db.prepare("BEGIN IMMEDIATE").run()
    try {
      const result = await work()
      await db.prepare("COMMIT").run()
      return result
    } catch (error) {
      try {
        await db.prepare("ROLLBACK").run()
      } catch {
        // Preserve the original lifecycle error.
      }
      throw error
    }
  } finally {
    release()
    if (transactionTails.get(key) === tail) transactionTails.delete(key)
  }
}

export class TranslationRepository {
  constructor(private readonly db: Database) {}

  async getStatistics(providerId?: string): Promise<TranslationCacheStatistics> {
    const result = await this.db.prepare(`
      SELECT status, COUNT(*) AS count
      FROM translation_cache
      ${providerId ? "WHERE provider = ?" : ""}
      GROUP BY status
    `).all(...(providerId ? [providerId] : []))
    const counts = { total: 0, succeeded: 0, pending: 0, failed: 0 }
    for (const row of rows<{ status?: string, count?: number }>(result)) {
      if (row.status === "succeeded" || row.status === "pending" || row.status === "failed") counts[row.status] = Number(row.count ?? 0)
    }
    counts.total = counts.succeeded + counts.pending + counts.failed
    return counts
  }

  async findExactSuccessful(input: TranslationCacheExactLookup): Promise<TranslationCacheRecord | undefined> {
    const result = await this.db.prepare(`
      SELECT *
      FROM translation_cache
      WHERE entity_type = ? AND entity_id = ? AND field_name = ? AND source_hash = ?
        AND target_language = ? AND provider = ? AND model = ? AND status = 'succeeded'
      ORDER BY translated_at DESC, updated_at DESC, provider ASC, model ASC, id ASC
      LIMIT 1
    `).all(input.entityType, input.entityId, input.fieldName, input.sourceHash, input.targetLanguage, input.provider, input.model)
    const row = rows<TranslationCacheRow>(result)[0]
    return row ? toRecord(row) : undefined
  }

  async findHistoricalSuccessful(input: TranslationCacheLookup): Promise<TranslationCacheRecord | undefined> {
    const result = await this.db.prepare(`
      SELECT *
      FROM translation_cache
      WHERE entity_type = ? AND entity_id = ? AND field_name = ? AND source_hash = ?
        AND target_language = ? AND status = 'succeeded'
      ORDER BY translated_at DESC, provider ASC, model ASC, id ASC
      LIMIT 1
    `).all(input.entityType, input.entityId, input.fieldName, input.sourceHash, input.targetLanguage)
    const row = rows<TranslationCacheRow>(result)[0]
    return row ? toRecord(row) : undefined
  }

  async findWork(input: TranslationCacheExactLookup): Promise<TranslationCacheRecord | undefined> {
    const where = whereIdentity(input)
    const row = await this.db.prepare(`SELECT * FROM translation_cache WHERE ${where.sql}`).get(...where.params) as TranslationCacheRow | undefined
    return row ? toRecord(row) : undefined
  }

  async save(record: TranslationCacheRecord): Promise<TranslationCacheRecord> {
    const retryCountProvided = record.retryCount !== undefined
    const nextRetryAtProvided = record.nextRetryAt !== undefined
    const retryableProvided = record.retryable !== undefined
    const leaseUntilProvided = record.leaseUntil !== undefined
    const lastErrorCodeProvided = record.lastErrorCode !== undefined
    await this.db.prepare(`
      INSERT INTO translation_cache (
        id, entity_type, entity_id, field_name, source_text, source_hash, source_language,
        target_language, provider, model, translated_text, translated_at, status,
        error_message, retry_count, next_retry_at, retryable, lease_until, last_error_code,
        preferred, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(entity_type, entity_id, field_name, source_hash, target_language, provider, model) DO UPDATE SET
        source_text = excluded.source_text,
        source_language = excluded.source_language,
        translated_text = excluded.translated_text,
        translated_at = excluded.translated_at,
        status = excluded.status,
        error_message = excluded.error_message,
        retry_count = CASE WHEN ? = 1 THEN excluded.retry_count ELSE translation_cache.retry_count END,
        next_retry_at = CASE WHEN ? = 1 THEN excluded.next_retry_at ELSE translation_cache.next_retry_at END,
        retryable = CASE WHEN ? = 1 THEN excluded.retryable ELSE translation_cache.retryable END,
        lease_until = CASE WHEN ? = 1 THEN excluded.lease_until ELSE translation_cache.lease_until END,
        last_error_code = CASE WHEN ? = 1 THEN excluded.last_error_code ELSE translation_cache.last_error_code END,
        preferred = excluded.preferred,
        updated_at = excluded.updated_at
    `).run(
      record.id,
      record.entityType,
      record.entityId,
      record.fieldName,
      record.sourceText,
      record.sourceHash,
      record.sourceLanguage ?? null,
      record.targetLanguage,
      record.provider,
      record.model,
      record.translatedText ?? null,
      record.translatedAt ?? null,
      record.status,
      record.errorMessage ?? null,
      record.retryCount ?? 0,
      record.nextRetryAt ?? null,
      record.retryable ? 1 : 0,
      record.leaseUntil ?? null,
      record.lastErrorCode ?? null,
      record.preferred ? 1 : 0,
      record.createdAt,
      record.updatedAt,
      retryCountProvided ? 1 : 0,
      nextRetryAtProvided ? 1 : 0,
      retryableProvided ? 1 : 0,
      leaseUntilProvided ? 1 : 0,
      lastErrorCodeProvided ? 1 : 0,
    )
    const saved = await this.findWork({
      entityType: record.entityType,
      entityId: record.entityId,
      fieldName: record.fieldName,
      sourceHash: record.sourceHash,
      targetLanguage: record.targetLanguage,
      provider: record.provider,
      model: record.model,
    })
    if (!saved) throw new Error("translation_cache_write_missing")
    return saved
  }

  async claimTranslationWork(input: TranslationWorkClaimInput): Promise<TranslationCacheRecord | undefined> {
    return transaction(this.db, async () => {
      const where = whereIdentity(input)
      const existing = await this.db.prepare(`SELECT * FROM translation_cache WHERE ${where.sql}`).get(...where.params) as TranslationCacheRow | undefined
      if (existing?.status === "succeeded") return undefined
      if (existing?.status === "pending") {
        if (isFuture(existing.lease_until, input.now)) return undefined
        await this.recoverStaleLeaseInTransaction(input, "provider_attempt_unknown")
        return undefined
      }
      if (existing?.status === "failed" && (!existing.retryable || isFuture(existing.next_retry_at, input.now))) return undefined

      if (existing) {
        await this.db.prepare(`
          UPDATE translation_cache SET
            source_text = ?, source_language = ?, translated_text = NULL, translated_at = NULL,
            status = 'pending', error_message = NULL, next_retry_at = NULL, retryable = 1,
            lease_until = ?, last_error_code = NULL, preferred = 0, updated_at = ?
          WHERE ${where.sql} AND status = 'failed'
        `).run(input.sourceText, input.sourceLanguage ?? null, input.leaseUntil, input.now, ...where.params)
      } else {
        await this.db.prepare(`
          INSERT INTO translation_cache (
            id, entity_type, entity_id, field_name, source_text, source_hash, source_language,
            target_language, provider, model, translated_text, translated_at, status,
            error_message, retry_count, next_retry_at, retryable, lease_until, last_error_code,
            preferred, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, 'pending', NULL, 0, NULL, 1, ?, NULL, 0, ?, ?)
        `).run(
          workId(input),
          input.entityType,
          input.entityId,
          input.fieldName,
          input.sourceText,
          input.sourceHash,
          input.sourceLanguage ?? null,
          input.targetLanguage,
          input.provider,
          input.model,
          input.leaseUntil,
          input.now,
          input.now,
        )
      }
      return this.findWork(input)
    })
  }

  async completeTranslationSuccess(input: TranslationLeaseIdentity & { translatedText: string, translatedAt: string, now: string, providerUsage?: ProviderUsagePatch }): Promise<TranslationCacheRecord> {
    await transaction(this.db, async () => {
      const where = whereIdentity(input)
      const result = await this.db.prepare(`
        UPDATE translation_cache SET
        translated_text = ?, translated_at = ?, status = 'succeeded', error_message = NULL,
          retryable = 0, next_retry_at = NULL, lease_until = NULL, last_error_code = NULL,
          preferred = 1, updated_at = ?
        WHERE ${where.sql} AND status = 'pending' AND lease_until = ?
      `).run(input.translatedText, input.translatedAt, input.now, ...where.params, input.leaseUntil)
      if (!result.success) throw new Error("translation_claim_not_owned")
      if (input.providerUsage) await recordProviderUsageInTransaction(this.db, input.providerUsage)
    })
    const saved = await this.findWork(input)
    if (!saved) throw new Error("translation_cache_finalize_missing")
    return saved
  }

  async completeRetryableFailure(input: TranslationLeaseIdentity & { errorCode: string, errorMessage: string, nextRetryAt: string, now: string, providerUsage?: ProviderUsagePatch }): Promise<TranslationCacheRecord> {
    await transaction(this.db, async () => {
      const where = whereIdentity(input)
      const result = await this.db.prepare(`
        UPDATE translation_cache SET
          translated_text = NULL, translated_at = NULL, status = 'failed',
          error_message = ?, retry_count = retry_count + 1, retryable = 1,
          next_retry_at = ?, lease_until = NULL, last_error_code = ?, preferred = 0, updated_at = ?
        WHERE ${where.sql} AND status = 'pending' AND lease_until = ?
      `).run(safeReason(input.errorMessage), input.nextRetryAt, input.errorCode, input.now, ...where.params, input.leaseUntil)
      if (!result.success) throw new Error("translation_claim_not_owned")
      if (input.providerUsage) await recordProviderUsageInTransaction(this.db, input.providerUsage)
    })
    const saved = await this.findWork(input)
    if (!saved) throw new Error("translation_cache_finalize_missing")
    return saved
  }

  async completeNonRetryableFailure(input: TranslationLeaseIdentity & { errorCode: string, errorMessage: string, now: string, providerUsage?: ProviderUsagePatch }): Promise<TranslationCacheRecord> {
    await transaction(this.db, async () => {
      const where = whereIdentity(input)
      const result = await this.db.prepare(`
        UPDATE translation_cache SET
          translated_text = NULL, translated_at = NULL, status = 'failed',
          error_message = ?, retryable = 0, next_retry_at = NULL, lease_until = NULL,
          last_error_code = ?, preferred = 0, updated_at = ?
        WHERE ${where.sql} AND status = 'pending' AND lease_until = ?
      `).run(safeReason(input.errorMessage), input.errorCode, input.now, ...where.params, input.leaseUntil)
      if (!result.success) throw new Error("translation_claim_not_owned")
      if (input.providerUsage) await recordProviderUsageInTransaction(this.db, input.providerUsage)
    })
    const saved = await this.findWork(input)
    if (!saved) throw new Error("translation_cache_finalize_missing")
    return saved
  }

  async releaseTranslationClaim(input: TranslationLeaseIdentity & { errorCode: string, errorMessage: string, retryable: boolean, nextRetryAt?: string }): Promise<TranslationCacheRecord | undefined> {
    const updatedAt = input.nextRetryAt ?? new Date().toISOString()
    const where = whereIdentity(input)
    await this.db.prepare(`
      UPDATE translation_cache SET
        status = 'failed', error_message = ?, retryable = ?, next_retry_at = ?, lease_until = NULL,
        last_error_code = ?, preferred = 0, updated_at = ?
      WHERE ${where.sql} AND status = 'pending' AND lease_until = ?
    `).run(safeReason(input.errorMessage), input.retryable ? 1 : 0, input.nextRetryAt ?? null, input.errorCode, updatedAt, ...where.params, input.leaseUntil)
    return this.findWork(input)
  }

  private async recoverStaleLeaseInTransaction(input: TranslationCacheExactLookup & { now: string }, reason: string): Promise<void> {
    const where = whereIdentity(input)
    await this.db.prepare(`
      UPDATE translation_cache SET
        status = 'failed', retryable = 0, next_retry_at = NULL, lease_until = NULL,
        last_error_code = 'provider_attempt_unknown', error_message = ?, updated_at = ?
      WHERE ${where.sql} AND status = 'pending'
    `).run(safeReason(reason), input.now, ...where.params)
  }

  async recoverStaleLease(input: TranslationCacheExactLookup & { now: string, reason?: string }): Promise<boolean> {
    return transaction(this.db, async () => {
      const where = whereIdentity(input)
      const existing = await this.db.prepare(`SELECT lease_until FROM translation_cache WHERE ${where.sql} AND status = 'pending'`).get(...where.params) as { lease_until?: string | null } | undefined
      if (!existing || isFuture(existing.lease_until, input.now)) return false
      await this.recoverStaleLeaseInTransaction(input, input.reason ?? "provider_attempt_unknown")
      return true
    })
  }

  async recoverStaleLeases(input: { provider: string, model: string, now: string, limit?: number }): Promise<number> {
    const limit = Math.max(1, Math.min(Math.floor(input.limit ?? 100), 1000))
    return transaction(this.db, async () => {
      const candidates = rows<TranslationCacheRow>(await this.db.prepare(`
        SELECT * FROM translation_cache
        WHERE provider = ? AND model = ? AND status = 'pending'
          AND (lease_until IS NULL OR lease_until <= ?)
        ORDER BY updated_at ASC, id ASC
        LIMIT ?
      `).all(input.provider, input.model, input.now, limit))
      let recovered = 0
      for (const candidate of candidates) {
        const identity: TranslationCacheExactLookup = {
          entityType: candidate.entity_type,
          entityId: candidate.entity_id,
          fieldName: candidate.field_name,
          sourceHash: candidate.source_hash,
          targetLanguage: candidate.target_language,
          provider: candidate.provider,
          model: candidate.model,
        }
        const where = whereIdentity(identity)
        const result = await this.db.prepare(`
          UPDATE translation_cache SET
            status = 'failed', retryable = 0, next_retry_at = NULL, lease_until = NULL,
            last_error_code = 'provider_attempt_unknown', error_message = 'provider_attempt_unknown', updated_at = ?
          WHERE ${where.sql} AND status = 'pending' AND (lease_until IS NULL OR lease_until <= ?)
        `).run(input.now, ...where.params, input.now)
        recovered += result.success ? 1 : 0
      }
      return recovered
    })
  }

  async requeueTranslationFailures(input: TranslationRequeueInput): Promise<TranslationRequeueResult> {
    const limit = Math.max(1, Math.min(Math.floor(input.limit ?? 100), 100))
    const allowedCodes = [...new Set(input.errorCodes)].filter(Boolean)
    if (!allowedCodes.length) return { selected: 0, requeued: 0, skipped: 0 }
    const identities = input.eligibleIdentities
      .filter(identity => identity.provider === input.provider && identity.model === input.model)
      .slice(0, limit)
    return transaction(this.db, async () => {
      let requeued = 0
      const codePlaceholders = allowedCodes.map(() => "?").join(", ")
      for (const identity of identities) {
        const where = whereIdentity(identity)
        const result = await this.db.prepare(`
          UPDATE translation_cache SET
            retryable = 1, retry_count = 0, next_retry_at = ?, lease_until = NULL,
            error_message = ?, preferred = 0, updated_at = ?
          WHERE ${where.sql} AND provider = ? AND model = ? AND status = 'failed'
            AND retryable = 0 AND last_error_code IN (${codePlaceholders})
        `).run(input.now, safeReason(input.reason), input.now, ...where.params, input.provider, input.model, ...allowedCodes)
        requeued += result.success ? 1 : 0
      }
      return { selected: identities.length, requeued, skipped: identities.length - requeued }
    })
  }
}
