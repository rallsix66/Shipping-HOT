import { randomUUID } from "node:crypto"
import type { Database } from "db0"

export type IntelAnalysisStep = "prefilter" | "extract" | "severity" | "severity_tiebreak"
export type IntelAnalysisStatus = "completed" | "failed" | "unknown" | "denied" | "skipped" | "reused"
export type IntelAnalysisProvenance = "ai" | "system"

export interface IntelAnalysisRecord {
  id: string
  itemId: string
  versionId: string
  contentHash: string
  step: IntelAnalysisStep
  attemptIndex: number
  status: IntelAnalysisStatus
  providerId: string | null
  modelId: string | null
  modelName: string | null
  promptHash: string | null
  outputJson: string | null
  provenance: IntelAnalysisProvenance
  basis: string
  receiptId: string | null
  errorCode: string | null
  createdAt: string
}

export interface IntelAnalysisWrite {
  itemId: string
  versionId: string
  contentHash: string
  step: IntelAnalysisStep
  attemptIndex?: number
  status: IntelAnalysisStatus
  providerId?: string | null
  modelId?: string | null
  modelName?: string | null
  promptHash?: string | null
  output?: unknown
  provenance: IntelAnalysisProvenance
  basis: string
  receiptId?: string | null
  errorCode?: string | null
  createdAt?: string
}

type Row = Record<string, unknown>

function mapRow(row: Row): IntelAnalysisRecord {
  return {
    id: String(row.id),
    itemId: String(row.item_id),
    versionId: String(row.version_id),
    contentHash: String(row.content_hash),
    step: row.step as IntelAnalysisStep,
    attemptIndex: Number(row.attempt_index),
    status: row.status as IntelAnalysisStatus,
    providerId: row.provider_id == null ? null : String(row.provider_id),
    modelId: row.model_id == null ? null : String(row.model_id),
    modelName: row.model_name == null ? null : String(row.model_name),
    promptHash: row.prompt_hash == null ? null : String(row.prompt_hash),
    outputJson: row.output_json == null ? null : String(row.output_json),
    provenance: row.provenance as IntelAnalysisProvenance,
    basis: String(row.basis),
    receiptId: row.receipt_id == null ? null : String(row.receipt_id),
    errorCode: row.error_code == null ? null : String(row.error_code),
    createdAt: String(row.created_at),
  }
}

export class IntelAnalysisRepository {
  constructor(private readonly db: Database) {}

  async insert(entry: IntelAnalysisWrite): Promise<IntelAnalysisRecord> {
    const id = randomUUID()
    const createdAt = entry.createdAt ?? new Date().toISOString()
    const outputJson = entry.output === undefined ? null : JSON.stringify(entry.output)
    await this.db.prepare(`
      INSERT INTO intel_analysis (
        id, item_id, version_id, content_hash, step, attempt_index, status,
        provider_id, model_id, model_name, prompt_hash, output_json,
        provenance, basis, receipt_id, error_code, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      entry.itemId,
      entry.versionId,
      entry.contentHash,
      entry.step,
      entry.attemptIndex ?? 1,
      entry.status,
      entry.providerId ?? null,
      entry.modelId ?? null,
      entry.modelName ?? null,
      entry.promptHash ?? null,
      outputJson,
      entry.provenance,
      entry.basis,
      entry.receiptId ?? null,
      entry.errorCode ?? null,
      createdAt,
    )
    const row = await this.db.prepare("SELECT * FROM intel_analysis WHERE id = ?").get(id) as Row
    return mapRow(row)
  }

  async listForVersion(itemId: string, versionId: string): Promise<IntelAnalysisRecord[]> {
    const rows = await this.db.prepare(
      "SELECT * FROM intel_analysis WHERE item_id = ? AND version_id = ? ORDER BY created_at, attempt_index",
    ).all(itemId, versionId) as Row[]
    return rows.map(mapRow)
  }

  /**
   * Find a reusable completed/reused analysis for the same material version + step + model + prompt.
   * Failed/unknown/denied rows are never reused as success.
   */
  async findReusable(input: {
    itemId: string
    versionId: string
    contentHash: string
    step: IntelAnalysisStep
    modelId: string
    promptHash: string
  }): Promise<IntelAnalysisRecord | null> {
    const row = await this.db.prepare(`
      SELECT * FROM intel_analysis
      WHERE item_id = ? AND version_id = ? AND content_hash = ?
        AND step = ? AND model_id = ? AND prompt_hash = ?
        AND status IN ('completed', 'reused')
      ORDER BY created_at DESC
      LIMIT 1
    `).get(
      input.itemId,
      input.versionId,
      input.contentHash,
      input.step,
      input.modelId,
      input.promptHash,
    ) as Row | undefined
    return row ? mapRow(row) : null
  }
}
