import type { Database } from "db0"
import type { TranslationCacheRecord } from "#/providers/contracts"

export interface TranslationCacheLookup {
  entityType: string
  entityId: string
  fieldName: string
  sourceHash: string
  targetLanguage: string
  provider?: string
  model?: string
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
    preferred: Boolean(row.preferred),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

/** SQLite boundary for Translation cache rows. It never calls a Provider. */
export class TranslationRepository {
  constructor(private readonly db: Database) {}

  async findSuccessful(input: TranslationCacheLookup): Promise<TranslationCacheRecord | undefined> {
    const identity = [
      "entity_type = ?",
      "entity_id = ?",
      "field_name = ?",
      "source_hash = ?",
      "target_language = ?",
      "status = 'succeeded'",
    ]
    const params: (string | number)[] = [input.entityType, input.entityId, input.fieldName, input.sourceHash, input.targetLanguage]
    if (input.provider !== undefined && input.model !== undefined) {
      identity.push("provider = ?", "model = ?")
      params.push(input.provider, input.model)
    }
    const result = await this.db.prepare(`
      SELECT *
      FROM translation_cache
      WHERE ${identity.join(" AND ")}
      ORDER BY translated_at DESC, updated_at DESC, provider ASC, model ASC, id ASC
      LIMIT 1
    `).all(...params)
    const row = rows<TranslationCacheRow>(result)[0]
    return row ? toRecord(row) : undefined
  }

  async save(record: TranslationCacheRecord): Promise<TranslationCacheRecord> {
    await this.db.prepare(`
      INSERT INTO translation_cache (
        id, entity_type, entity_id, field_name, source_text, source_hash, source_language,
        target_language, provider, model, translated_text, translated_at, status,
        error_message, preferred, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(entity_type, entity_id, field_name, source_hash, target_language, provider, model) DO UPDATE SET
        source_text = excluded.source_text,
        source_language = excluded.source_language,
        translated_text = excluded.translated_text,
        translated_at = excluded.translated_at,
        status = excluded.status,
        error_message = excluded.error_message,
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
      record.preferred ? 1 : 0,
      record.createdAt,
      record.updatedAt,
    )
    const saved = await this.db.prepare(`
      SELECT * FROM translation_cache
      WHERE entity_type = ? AND entity_id = ? AND field_name = ? AND source_hash = ?
        AND target_language = ? AND provider = ? AND model = ?
    `).get(record.entityType, record.entityId, record.fieldName, record.sourceHash, record.targetLanguage, record.provider, record.model) as TranslationCacheRow | undefined
    if (!saved) throw new Error("translation_cache_write_missing")
    return toRecord(saved)
  }
}
