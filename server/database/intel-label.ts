import { randomUUID } from "node:crypto"
import type { Database } from "db0"
import type {
  LabelCategory,
  LabelCoverageSummary,
  LabelDecisionFields,
  LabelDecisionKind,
  LabelDecisionView,
  LabelItemView,
  LabelQueueStatus,
} from "@shared/intel-label"
import { LABEL_CATEGORIES, LABEL_DECISION_KINDS, LABEL_QUEUE_STATUSES } from "@shared/intel-label"

type Row = Record<string, unknown>

export class LabelInputError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "LabelInputError"
  }
}

function asCategory(value: unknown): LabelCategory {
  if (typeof value === "string" && (LABEL_CATEGORIES as readonly string[]).includes(value)) return value as LabelCategory
  throw new LabelInputError("invalid_category")
}

function asQueue(value: unknown): LabelQueueStatus {
  if (typeof value === "string" && (LABEL_QUEUE_STATUSES as readonly string[]).includes(value)) return value as LabelQueueStatus
  throw new LabelInputError("invalid_queue_status")
}

function asKind(value: unknown): LabelDecisionKind {
  if (typeof value === "string" && (LABEL_DECISION_KINDS as readonly string[]).includes(value)) return value as LabelDecisionKind
  throw new LabelInputError("invalid_decision_kind")
}

function parseDecision(raw: string): LabelDecisionFields {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new LabelInputError("invalid_decision_json")
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new LabelInputError("invalid_decision_json")
  const o = parsed as Record<string, unknown>
  const countries = Array.isArray(o.countries) ? o.countries.filter((x): x is string => typeof x === "string") : []
  const ports = Array.isArray(o.ports) ? o.ports.filter((x): x is string => typeof x === "string") : []
  return {
    prefilterKeep: typeof o.prefilterKeep === "boolean" ? o.prefilterKeep : o.prefilterKeep === null ? null : null,
    eventType: typeof o.eventType === "string" ? o.eventType : null,
    countries,
    ports,
    effectiveFrom: typeof o.effectiveFrom === "string" ? o.effectiveFrom : null,
    isOfficialStatement: typeof o.isOfficialStatement === "boolean" ? o.isOfficialStatement : null,
    notes: typeof o.notes === "string" ? o.notes : undefined,
  }
}

function normalizeDecision(input: Partial<LabelDecisionFields> | LabelDecisionFields): LabelDecisionFields {
  const countries = Array.isArray(input.countries) ? input.countries.filter((x): x is string => typeof x === "string").slice(0, 32) : []
  const ports = Array.isArray(input.ports) ? input.ports.filter((x): x is string => typeof x === "string").slice(0, 64) : []
  return {
    prefilterKeep: typeof input.prefilterKeep === "boolean" ? input.prefilterKeep : null,
    eventType: typeof input.eventType === "string" && input.eventType.trim() ? input.eventType.trim().slice(0, 64) : null,
    countries,
    ports,
    effectiveFrom: typeof input.effectiveFrom === "string" && input.effectiveFrom.trim() ? input.effectiveFrom.trim().slice(0, 64) : null,
    isOfficialStatement: typeof input.isOfficialStatement === "boolean" ? input.isOfficialStatement : null,
    notes: typeof input.notes === "string" ? input.notes.slice(0, 2000) : undefined,
  }
}

function mapItem(row: Row): LabelItemView {
  return {
    id: String(row.id),
    itemId: String(row.item_id),
    versionId: String(row.version_id),
    contentHash: String(row.content_hash),
    sourceUrl: String(row.source_url),
    excerpt: row.excerpt == null ? null : String(row.excerpt),
    category: asCategory(row.category),
    language: row.language == null ? null : String(row.language),
    queueStatus: asQueue(row.queue_status),
    title: row.title == null ? null : String(row.title),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  }
}

function mapDecision(row: Row): LabelDecisionView {
  let analysisIds: string[] = []
  if (typeof row.analysis_ids_json === "string" && row.analysis_ids_json) {
    try {
      const parsed = JSON.parse(row.analysis_ids_json)
      if (Array.isArray(parsed)) analysisIds = parsed.filter((x): x is string => typeof x === "string")
    } catch {
      analysisIds = []
    }
  }
  return {
    id: String(row.id),
    labelItemId: String(row.label_item_id),
    itemId: String(row.item_id),
    versionId: String(row.version_id),
    contentHash: String(row.content_hash),
    kind: asKind(row.kind),
    operator: String(row.operator),
    isHuman: Number(row.is_human) === 1,
    decision: parseDecision(String(row.decision_json)),
    analysisIds,
    promptHash: row.prompt_hash == null ? null : String(row.prompt_hash),
    modelId: row.model_id == null ? null : String(row.model_id),
    modelName: row.model_name == null ? null : String(row.model_name),
    clientRequestId: row.client_request_id == null ? null : String(row.client_request_id),
    createdAt: String(row.created_at),
  }
}

export interface EnrollLabelInput {
  itemId: string
  versionId: string
  contentHash: string
  sourceUrl: string
  excerpt: string | null
  title: string | null
  category?: LabelCategory
  language?: string | null
  /** Optional AI prelabel copied from existing analysis — never invents human labels. */
  aiPrelabel?: {
    decision: LabelDecisionFields
    analysisIds?: string[]
    promptHash?: string | null
    modelId?: string | null
    modelName?: string | null
    operator?: string
  }
}

export interface SaveHumanDecisionInput {
  labelItemId: string
  /** Must match enrolled version; rejects stale labels on version change. */
  expectedContentHash: string
  kind: "human_confirm" | "human_correct"
  operator: string
  decision: LabelDecisionFields
  /** Client draft id for idempotent duplicate submit. */
  clientRequestId?: string
}

export class IntelLabelRepository {
  constructor(private readonly db: Database) {}

  async getItem(id: string): Promise<LabelItemView | null> {
    const row = await this.db.prepare("SELECT * FROM intel_label_item WHERE id = ?").get(id) as Row | undefined
    return row ? mapItem(row) : null
  }

  async getByItemVersion(itemId: string, versionId: string): Promise<LabelItemView | null> {
    const row = await this.db.prepare(
      "SELECT * FROM intel_label_item WHERE item_id = ? AND version_id = ?",
    ).get(itemId, versionId) as Row | undefined
    return row ? mapItem(row) : null
  }

  async listItems(input: {
    limit: number
    offset: number
    queueStatus?: LabelQueueStatus | "all"
    category?: LabelCategory | "all"
    language?: string | "all"
  }): Promise<LabelItemView[]> {
    const where: string[] = []
    const args: Array<string | number | boolean | null> = []
    if (input.queueStatus && input.queueStatus !== "all") {
      where.push("queue_status = ?")
      args.push(input.queueStatus)
    }
    if (input.category && input.category !== "all") {
      where.push("category = ?")
      args.push(input.category)
    }
    if (input.language && input.language !== "all") {
      if (input.language === "unset") {
        where.push("language IS NULL")
      } else {
        where.push("language = ?")
        args.push(input.language)
      }
    }
    const sql = `
      SELECT * FROM intel_label_item
      ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY updated_at DESC, id ASC
      LIMIT ? OFFSET ?
    `
    args.push(input.limit + 1, input.offset)
    const rows = await this.db.prepare(sql).all(...args) as Row[]
    return rows.map(mapItem)
  }

  async coverage(): Promise<LabelCoverageSummary> {
    const totals = await this.db.prepare(`
      SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN queue_status = 'human_confirmed' THEN 1 ELSE 0 END) AS human_confirmed,
        SUM(CASE WHEN queue_status = 'ai_prelabeled' THEN 1 ELSE 0 END) AS ai_prelabeled,
        SUM(CASE WHEN queue_status = 'unreviewed' THEN 1 ELSE 0 END) AS unreviewed
      FROM intel_label_item
    `).get() as Row
    const byCat = await this.db.prepare(`
      SELECT category AS key,
        COUNT(*) AS total,
        SUM(CASE WHEN queue_status = 'human_confirmed' THEN 1 ELSE 0 END) AS human_confirmed,
        SUM(CASE WHEN queue_status = 'ai_prelabeled' THEN 1 ELSE 0 END) AS ai_prelabeled,
        SUM(CASE WHEN queue_status = 'unreviewed' THEN 1 ELSE 0 END) AS unreviewed
      FROM intel_label_item
      GROUP BY category
      ORDER BY category
    `).all() as Row[]
    const byLang = await this.db.prepare(`
      SELECT COALESCE(language, 'unset') AS key,
        COUNT(*) AS total,
        SUM(CASE WHEN queue_status = 'human_confirmed' THEN 1 ELSE 0 END) AS human_confirmed,
        SUM(CASE WHEN queue_status = 'ai_prelabeled' THEN 1 ELSE 0 END) AS ai_prelabeled,
        SUM(CASE WHEN queue_status = 'unreviewed' THEN 1 ELSE 0 END) AS unreviewed
      FROM intel_label_item
      GROUP BY COALESCE(language, 'unset')
      ORDER BY key
    `).all() as Row[]
    const total = Number(totals.total ?? 0)
    const humanConfirmed = Number(totals.human_confirmed ?? 0)
    const missingNotes: string[] = []
    if (total === 0) missingNotes.push("label_set_empty")
    if (humanConfirmed === 0) missingNotes.push("no_human_confirmed_labels")
    if (total > 0 && total < 200) missingNotes.push(`below_r3_2_target_200_have_${total}`)
    const catKeys = new Set(byCat.map(r => String(r.key)))
    for (const need of ["policy", "weather", "port", "lastmile"] as const) {
      if (!catKeys.has(need) || Number(byCat.find(r => String(r.key) === need)?.total ?? 0) === 0) {
        missingNotes.push(`missing_category_${need}`)
      }
    }
    const langKeys = new Set(byLang.map(r => String(r.key)))
    for (const need of ["zh", "en", "vi", "th", "id"] as const) {
      if (!langKeys.has(need)) missingNotes.push(`missing_language_${need}`)
    }
    const bucket = (rows: Row[]) => rows.map(r => ({
      key: String(r.key),
      total: Number(r.total ?? 0),
      humanConfirmed: Number(r.human_confirmed ?? 0),
      aiPrelabeled: Number(r.ai_prelabeled ?? 0),
      unreviewed: Number(r.unreviewed ?? 0),
    }))
    return {
      total,
      humanConfirmed,
      aiPrelabeled: Number(totals.ai_prelabeled ?? 0),
      unreviewed: Number(totals.unreviewed ?? 0),
      byCategory: bucket(byCat),
      byLanguage: bucket(byLang),
      missingNotes,
    }
  }

  async neighbors(id: string, filter: {
    queueStatus?: LabelQueueStatus | "all"
    category?: LabelCategory | "all"
    language?: string | "all"
  }): Promise<{ prevId: string | null, nextId: string | null }> {
    const items = await this.listItems({ limit: 5000, offset: 0, ...filter })
    const idx = items.findIndex(i => i.id === id)
    if (idx < 0) return { prevId: null, nextId: null }
    return {
      prevId: idx > 0 ? items[idx - 1]!.id : null,
      nextId: idx < items.length - 1 ? items[idx + 1]!.id : null,
    }
  }

  async latestDecision(labelItemId: string, opts?: { humanOnly?: boolean }): Promise<LabelDecisionView | null> {
    const sql = opts?.humanOnly
      ? `SELECT * FROM intel_label_decision WHERE label_item_id = ? AND is_human = 1 ORDER BY created_at DESC, rowid DESC LIMIT 1`
      : `SELECT * FROM intel_label_decision WHERE label_item_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1`
    const row = await this.db.prepare(sql).get(labelItemId) as Row | undefined
    return row ? mapDecision(row) : null
  }

  async latestAiPrelabel(labelItemId: string): Promise<LabelDecisionView | null> {
    const row = await this.db.prepare(`
      SELECT * FROM intel_label_decision
      WHERE label_item_id = ? AND kind = 'ai_prelabel'
      ORDER BY created_at DESC, rowid DESC LIMIT 1
    `).get(labelItemId) as Row | undefined
    return row ? mapDecision(row) : null
  }

  async listHumanDecisions(): Promise<LabelDecisionView[]> {
    const rows = await this.db.prepare(`
      SELECT d.* FROM intel_label_decision d
      INNER JOIN (
        SELECT label_item_id, MAX(created_at) AS max_at
        FROM intel_label_decision
        WHERE is_human = 1
        GROUP BY label_item_id
      ) latest ON latest.label_item_id = d.label_item_id AND latest.max_at = d.created_at
      WHERE d.is_human = 1
      ORDER BY d.created_at ASC
    `).all() as Row[]
    return rows.map(mapDecision)
  }

  /**
   * Enroll an existing approved version. Does not call models.
   * Idempotent on (item_id, version_id). Version/content_hash mismatch on re-enroll updates binding and clears human status.
   */
  async enroll(input: EnrollLabelInput, now = new Date().toISOString()): Promise<LabelItemView> {
    if (!input.itemId || !input.versionId || !input.contentHash || !input.sourceUrl) {
      throw new LabelInputError("invalid_enroll_identity")
    }
    const existing = await this.getByItemVersion(input.itemId, input.versionId)
    const category = input.category ? asCategory(input.category) : "unknown"
    const language = input.language == null || input.language === "" ? null : String(input.language).slice(0, 16)
    const excerpt = input.excerpt == null ? null : String(input.excerpt).slice(0, 2000)
    const title = input.title == null ? null : String(input.title).slice(0, 500)
    if (existing) {
      const hashChanged = existing.contentHash !== input.contentHash
      const preserveHuman = existing.queueStatus === "human_confirmed" && !hashChanged
      await this.db.prepare(`
        UPDATE intel_label_item SET
          content_hash = ?, source_url = ?, excerpt = ?, category = ?, language = ?, title = ?,
          queue_status = CASE
            WHEN ? = 1 THEN 'unreviewed'
            WHEN queue_status = 'human_confirmed' THEN queue_status
            ELSE queue_status
          END,
          updated_at = ?
        WHERE id = ?
      `).run(
        input.contentHash,
        input.sourceUrl,
        excerpt,
        category,
        language,
        title,
        hashChanged ? 1 : 0,
        now,
        existing.id,
      )
      // Refresh AI prelabel on hash change, or when first/updated analysis arrives
      // after enroll-before-analyze. Never demote a preserved human_confirmed queue.
      if (input.aiPrelabel) {
        await this.insertDecision({
          labelItemId: existing.id,
          itemId: input.itemId,
          versionId: input.versionId,
          contentHash: input.contentHash,
          kind: "ai_prelabel",
          operator: input.aiPrelabel.operator ?? "system:ai",
          isHuman: false,
          decision: normalizeDecision(input.aiPrelabel.decision),
          analysisIds: input.aiPrelabel.analysisIds ?? [],
          promptHash: input.aiPrelabel.promptHash ?? null,
          modelId: input.aiPrelabel.modelId ?? null,
          modelName: input.aiPrelabel.modelName ?? null,
          createdAt: now,
        })
        if (!preserveHuman) {
          await this.db.prepare(`
            UPDATE intel_label_item SET queue_status = 'ai_prelabeled', updated_at = ? WHERE id = ?
          `).run(now, existing.id)
        }
      }
      return (await this.getItem(existing.id))!
    }

    const id = `lbl_${randomUUID().replace(/-/g, "").slice(0, 24)}`
    const queueStatus: LabelQueueStatus = input.aiPrelabel ? "ai_prelabeled" : "unreviewed"
    await this.db.prepare(`
      INSERT INTO intel_label_item (
        id, item_id, version_id, content_hash, source_url, excerpt, category, language,
        queue_status, title, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      input.itemId,
      input.versionId,
      input.contentHash,
      input.sourceUrl,
      excerpt,
      category,
      language,
      queueStatus,
      title,
      now,
      now,
    )
    if (input.aiPrelabel) {
      await this.insertDecision({
        labelItemId: id,
        itemId: input.itemId,
        versionId: input.versionId,
        contentHash: input.contentHash,
        kind: "ai_prelabel",
        operator: input.aiPrelabel.operator ?? "system:ai",
        isHuman: false,
        decision: normalizeDecision(input.aiPrelabel.decision),
        analysisIds: input.aiPrelabel.analysisIds ?? [],
        promptHash: input.aiPrelabel.promptHash ?? null,
        modelId: input.aiPrelabel.modelId ?? null,
        modelName: input.aiPrelabel.modelName ?? null,
        createdAt: now,
      })
    }
    return (await this.getItem(id))!
  }

  async saveHumanDecision(input: SaveHumanDecisionInput, now = new Date().toISOString()): Promise<LabelDecisionView> {
    const item = await this.getItem(input.labelItemId)
    if (!item) throw new LabelInputError("label_item_not_found")
    if (item.contentHash !== input.expectedContentHash) {
      throw new LabelInputError("content_hash_mismatch")
    }
    if (input.kind !== "human_confirm" && input.kind !== "human_correct") {
      throw new LabelInputError("invalid_decision_kind")
    }
    const operator = typeof input.operator === "string" && input.operator.trim() ? input.operator.trim().slice(0, 120) : ""
    if (!operator || operator.startsWith("system:")) {
      throw new LabelInputError("operator_must_be_human")
    }
    const decision = normalizeDecision(input.decision)
    const requestId = typeof input.clientRequestId === "string" && input.clientRequestId.trim()
      ? input.clientRequestId.trim().slice(0, 160)
      : null

    // Real request-ID idempotency: same ID returns the original row only when
    // kind/hash/decision match; conflicting reuse is rejected. Different IDs
    // always insert (A→B→A yields three audit rows; latest wins).
    if (requestId) {
      const existing = await this.db.prepare(`
        SELECT * FROM intel_label_decision
        WHERE label_item_id = ? AND client_request_id = ?
        LIMIT 1
      `).get(input.labelItemId, requestId) as Row | undefined
      if (existing) {
        const mapped = mapDecision(existing)
        const sameKind = mapped.kind === input.kind
        const sameHash = mapped.contentHash === item.contentHash
        const sameDecision = JSON.stringify(mapped.decision) === JSON.stringify(decision)
        if (!sameKind || !sameHash || !sameDecision) {
          throw new LabelInputError("client_request_id_conflict")
        }
        return mapped
      }
    }

    const inserted = await this.insertDecision({
      labelItemId: item.id,
      itemId: item.itemId,
      versionId: item.versionId,
      contentHash: item.contentHash,
      kind: input.kind,
      operator,
      isHuman: true,
      decision,
      analysisIds: [],
      promptHash: null,
      modelId: null,
      modelName: null,
      clientRequestId: requestId,
      createdAt: now,
    })
    await this.db.prepare(`
      UPDATE intel_label_item SET queue_status = 'human_confirmed', updated_at = ? WHERE id = ?
    `).run(now, item.id)
    return inserted
  }

  private async insertDecision(input: {
    labelItemId: string
    itemId: string
    versionId: string
    contentHash: string
    kind: LabelDecisionKind
    operator: string
    isHuman: boolean
    decision: LabelDecisionFields
    analysisIds: string[]
    promptHash: string | null
    modelId: string | null
    modelName: string | null
    clientRequestId?: string | null
    createdAt: string
  }): Promise<LabelDecisionView> {
    const id = `ldc_${randomUUID().replace(/-/g, "").slice(0, 24)}`
    await this.db.prepare(`
      INSERT INTO intel_label_decision (
        id, label_item_id, item_id, version_id, content_hash, kind, operator, is_human,
        decision_json, analysis_ids_json, prompt_hash, model_id, model_name, client_request_id, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      input.labelItemId,
      input.itemId,
      input.versionId,
      input.contentHash,
      input.kind,
      input.operator,
      input.isHuman ? 1 : 0,
      JSON.stringify(input.decision),
      JSON.stringify(input.analysisIds),
      input.promptHash,
      input.modelId,
      input.modelName,
      input.clientRequestId ?? null,
      input.createdAt,
    )
    const row = await this.db.prepare("SELECT * FROM intel_label_decision WHERE id = ?").get(id) as Row
    return mapDecision(row)
  }
}
