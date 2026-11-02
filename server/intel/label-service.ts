/**
 * §4.9 labeling service — enroll/browse/save only.
 * Never calls model providers. AI prelabel is projected from existing intel_analysis rows
 * using the real completed/reused pipeline shapes ({decision,content} / {extract,content}).
 */
import type { Database } from "db0"
import type { LabelCategory, LabelDecisionFields, LabelDetailResponse, LabelItemView, LabelListResponse } from "@shared/intel-label"
import { IntelAnalysisRepository } from "#/database/intel-analysis"
import { IntelRepository } from "#/database/intel"
import { IntelLabelRepository, LabelInputError } from "#/database/intel-label"
import { readIntelMaterial } from "#/intel/material-read"

// Mirror of content-license excerpt length — label set stores licensed excerpt only.
const EXCERPT_CHARS = 280

function categoryFromEventType(eventType: string | null | undefined): LabelCategory {
  if (!eventType) return "unknown"
  if (eventType === "customs_rule" || eventType === "trade_policy" || eventType === "platform_rule") return "policy"
  if (eventType === "weather_hazard" || eventType === "holiday_notice") return "weather"
  if (eventType === "port_closure" || eventType === "port_congestion") return "port"
  if (eventType === "lastmile_disruption" || eventType === "labor_strike") return "lastmile"
  return "other"
}

function safeJson(raw: string): unknown {
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

/**
 * Project LabelDecisionFields from real analyze-pipeline completed/reused outputs:
 * - prefilter: { decision: "PASS"|"BLOCK"|"UNKNOWN", content }
 * - extract: { extract: ExtractedIntel, content }
 * Legacy flat keep/shouldKeep / top-level extract keys are ignored (they never matched storage).
 */

export interface AnalysisIdentityRow {
  id: string
  step: string
  status?: string
  createdAt: string
  attemptIndex?: number
  runId?: string | null
  modelId?: string | null
  modelName?: string | null
  promptHash?: string | null
  receiptId?: string | null
  output?: unknown
  outputJson?: string | null
}

/**
 * Pick one coherent analyze run by persistent run_id (not latest-success extract / time-neighbor stitch).
 * Includes failed/denied/charged steps of that run so receipts are not silently dropped.
 * Legacy rows without run_id cannot be reliably grouped → complete=false (unselectable / incomplete).
 */
export interface AnalysisRunSelection<T extends AnalysisIdentityRow> {
  rows: T[]
  runId: string | null
  complete: boolean
  reason?: string
}

export function selectConsistentAnalysisRun<T extends AnalysisIdentityRow>(rows: T[]): AnalysisRunSelection<T> {
  if (!rows.length) {
    return { rows: [], runId: null, complete: true }
  }
  const withRun = rows.filter(r => typeof r.runId === "string" && r.runId.length > 0)
  if (!withRun.length) {
    return {
      rows: [],
      runId: null,
      complete: false,
      reason: "legacy_ungroupable_missing_run_id",
    }
  }
  const byRun = new Map<string, T[]>()
  for (const r of withRun) {
    const id = r.runId as string
    const list = byRun.get(id) ?? []
    list.push(r)
    byRun.set(id, list)
  }
  let bestId: string | null = null
  let bestTs = ""
  for (const [id, list] of byRun) {
    const maxTs = list.reduce((m, r) => (r.createdAt > m ? r.createdAt : m), "")
    if (!bestId || maxTs > bestTs || (maxTs === bestTs && id > bestId)) {
      bestId = id
      bestTs = maxTs
    }
  }
  const selected = (byRun.get(bestId!) ?? []).slice().sort(
    (a, b) => a.createdAt.localeCompare(b.createdAt) || (a.attemptIndex ?? 0) - (b.attemptIndex ?? 0),
  )
  return { rows: selected, runId: bestId, complete: true }
}

/** Per-step config fingerprint: step:value|… — eval compares overlapping steps only. */
export function buildStepConfigFingerprint(
  rows: Array<{ step: string, status?: string, promptHash?: string | null, modelId?: string | null, modelName?: string | null }>,
  field: "promptHash" | "modelId" | "modelName",
): string | null {
  const byStep = new Map<string, string>()
  for (const r of rows) {
    const raw = r[field]
    if (raw == null || raw === "") continue
    if (!byStep.has(r.step)) byStep.set(r.step, String(raw))
  }
  if (!byStep.size) return null
  return [...byStep.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([step, value]) => `${step}:${value}`)
    .join("|")
}

export function parseStepConfigFingerprint(fp: string | null | undefined): Map<string, string> {
  const out = new Map<string, string>()
  if (!fp) return out
  // Plain (non step:value) fingerprints still compare as a single synthetic step.
  if (!fp.includes(":")) {
    out.set("__run__", fp)
    return out
  }
  for (const part of fp.split("|")) {
    const idx = part.indexOf(":")
    if (idx <= 0) continue
    out.set(part.slice(0, idx), part.slice(idx + 1))
  }
  return out
}

/** True when overlapping steps disagree on modelId or promptHash (unexecuted step ≠ conflict). */
export function stepConfigsConflict(
  a: { modelId?: string | null, promptHash?: string | null, modelName?: string | null },
  b: { modelId?: string | null, promptHash?: string | null, modelName?: string | null },
): boolean {
  const aModel = parseStepConfigFingerprint(a.modelId)
  const bModel = parseStepConfigFingerprint(b.modelId)
  const aPrompt = parseStepConfigFingerprint(a.promptHash)
  const bPrompt = parseStepConfigFingerprint(b.promptHash)
  const aName = parseStepConfigFingerprint(a.modelName)
  const bName = parseStepConfigFingerprint(b.modelName)
  const steps = new Set<string>([
    ...aModel.keys(),
    ...bModel.keys(),
    ...aPrompt.keys(),
    ...bPrompt.keys(),
    ...aName.keys(),
    ...bName.keys(),
  ])
  for (const step of steps) {
    const overlaps
      = (aModel.has(step) && bModel.has(step))
        || (aPrompt.has(step) && bPrompt.has(step))
        || (aName.has(step) && bName.has(step))
    if (!overlaps) continue
    if (aModel.has(step) && bModel.has(step) && aModel.get(step) !== bModel.get(step)) return true
    if (aPrompt.has(step) && bPrompt.has(step) && aPrompt.get(step) !== bPrompt.get(step)) return true
    if (aName.has(step) && bName.has(step) && aName.get(step) !== bName.get(step)) return true
  }
  return false
}

export function decisionFromAnalysisOutputs(
  outputs: Array<{ step: string, status?: string, output: unknown }>,
): { decision: LabelDecisionFields, projected: boolean } {
  const usable = outputs.filter(o => !o.status || o.status === "completed" || o.status === "reused")
  const pre = usable.find(o => o.step === "prefilter")?.output
  const extractOut = usable.find(o => o.step === "extract")?.output
  let prefilterKeep: boolean | null = null
  let projected = false
  if (pre && typeof pre === "object" && !Array.isArray(pre)) {
    const decision = (pre as Record<string, unknown>).decision
    if (decision === "PASS") {
      prefilterKeep = true
      projected = true
    } else if (decision === "BLOCK") {
      prefilterKeep = false
      projected = true
    } else if (decision === "UNKNOWN") {
      prefilterKeep = null
      projected = true
    }
  }
  let eventType: string | null = null
  let countries: string[] = []
  let ports: string[] = []
  let effectiveFrom: string | null = null
  let isOfficialStatement: boolean | null = null
  if (extractOut && typeof extractOut === "object" && !Array.isArray(extractOut)) {
    const nested = (extractOut as Record<string, unknown>).extract
    if (nested && typeof nested === "object" && !Array.isArray(nested)) {
      const extract = nested as Record<string, unknown>
      projected = true
      eventType = typeof extract.eventType === "string" ? extract.eventType : null
      countries = Array.isArray(extract.countries) ? extract.countries.filter((x): x is string => typeof x === "string") : []
      ports = Array.isArray(extract.ports) ? extract.ports.filter((x): x is string => typeof x === "string") : []
      effectiveFrom = typeof extract.effectiveFrom === "string"
        ? extract.effectiveFrom
        : typeof extract.occurredAt === "string"
          ? extract.occurredAt
          : null
      isOfficialStatement = typeof extract.isOfficialStatement === "boolean" ? extract.isOfficialStatement : null
    }
  }
  return {
    projected,
    decision: {
      prefilterKeep,
      eventType,
      countries,
      ports,
      effectiveFrom,
      isOfficialStatement,
    },
  }
}

function licensedExcerpt(blocks: Array<{ type: string, text: string }>, bodyText: string | null, contentScope: string): string | null {
  if (contentScope === "metadata_only") return null
  const excerptBlock = blocks.find(b => b.type === "excerpt")
  if (excerptBlock?.text) return excerptBlock.text.slice(0, EXCERPT_CHARS)
  if (!bodyText) return null
  return bodyText.length <= EXCERPT_CHARS ? bodyText : `${bodyText.slice(0, EXCERPT_CHARS - 1).trimEnd()}…`
}

/** Strip any cached excerpt from list views — live rights applied only on detail. */
function redactListItem(item: LabelItemView): LabelItemView {
  return { ...item, excerpt: null }
}

export class LabelService {
  readonly labels: IntelLabelRepository
  readonly intel: IntelRepository
  readonly analysis: IntelAnalysisRepository

  constructor(db: Database) {
    this.labels = new IntelLabelRepository(db)
    this.intel = new IntelRepository(db)
    this.analysis = new IntelAnalysisRepository(db)
  }

  async list(query: {
    limit?: number
    offset?: number
    queueStatus?: string
    category?: string
    language?: string
  }): Promise<LabelListResponse> {
    const limit = Math.min(Math.max(Number(query.limit) || 20, 1), 50)
    const offset = Math.min(Math.max(Number(query.offset) || 0, 0), 10000)
    const rows = await this.labels.listItems({
      limit,
      offset,
      queueStatus: (query.queueStatus as never) || "all",
      category: (query.category as never) || "all",
      language: query.language || "all",
    })
    const hasMore = rows.length > limit
    const items = (hasMore ? rows.slice(0, limit) : rows).map(redactListItem)
    return { items, limit, offset, hasMore, coverage: await this.labels.coverage() }
  }

  async detail(labelItemId: string, filter: {
    queueStatus?: string
    category?: string
    language?: string
  } = {}): Promise<LabelDetailResponse> {
    const item = await this.labels.getItem(labelItemId)
    if (!item) throw new LabelInputError("label_item_not_found")
    const materialResult = await readIntelMaterial(this.intel, item.itemId, item.versionId)
    const analysisRows = await this.analysis.listForVersion(item.itemId, item.versionId)
    // Only same content_hash analysis — version change must not reuse old labels/outputs.
    const matched = analysisRows.filter(r => r.contentHash === item.contentHash)
    const neighbors = await this.labels.neighbors(item.id, {
      queueStatus: (filter.queueStatus as never) || "all",
      category: (filter.category as never) || "all",
      language: filter.language || "all",
    })

    // Live rights only. Read failure must NOT fall back to cached item.excerpt.
    let material: LabelDetailResponse["material"]
    let liveExcerpt: string | null = null
    if (materialResult.ok) {
      liveExcerpt = licensedExcerpt(
        materialResult.material.blocks,
        materialResult.material.bodyText,
        materialResult.material.contentScope,
      )
      material = {
        title: materialResult.material.title,
        sourceUrl: materialResult.material.canonicalUrl,
        excerpt: liveExcerpt,
        contentScope: materialResult.material.contentScope,
        bodyAvailable: Boolean(materialResult.material.bodyText) && materialResult.material.contentScope !== "metadata_only",
        materialReadFailed: false,
        materialReadCode: null,
      }
    } else {
      material = {
        title: item.title ?? "",
        sourceUrl: item.sourceUrl,
        excerpt: null,
        contentScope: "metadata_only",
        bodyAvailable: false,
        materialReadFailed: true,
        materialReadCode: materialResult.code,
      }
    }

    // Never leak cached excerpt on the item payload either.
    const safeItem: LabelItemView = { ...item, excerpt: liveExcerpt }

    return {
      item: safeItem,
      material,
      aiPrelabel: await this.labels.latestAiPrelabel(item.id),
      humanDecision: await this.labels.latestDecision(item.id, { humanOnly: true }),
      analysisSummaries: matched.map(r => ({
        id: r.id,
        step: r.step,
        status: r.status,
        modelName: r.modelName,
        modelId: r.modelId,
        promptHash: r.promptHash,
        provenance: r.provenance,
        receiptId: r.receiptId,
        output: r.outputJson ? safeJson(r.outputJson) : null,
      })),
      neighbors,
    }
  }

  /**
   * Enroll from an existing approved item+version. Copies AI outputs if present.
   * Does not call providers and does not invent human labels.
   * Re-enroll after analyze fills AI prelabel even when content hash is unchanged;
   * never demotes human_confirmed.
   */
  async enrollFromExisting(input: {
    itemId: string
    versionId: string
    category?: LabelCategory
    language?: string | null
  }) {
    const materialResult = await readIntelMaterial(this.intel, input.itemId, input.versionId)
    if (!materialResult.ok) throw new LabelInputError(`material_${materialResult.code}`)
    const material = materialResult.material
    const analysisRows = await this.analysis.listForVersion(input.itemId, input.versionId)
    const matched = analysisRows.filter(r => r.contentHash === material.version.contentHash)
    const selection = selectConsistentAnalysisRun(matched.map(r => ({
      id: r.id,
      step: r.step,
      status: r.status,
      createdAt: r.createdAt,
      attemptIndex: r.attemptIndex,
      runId: r.runId,
      modelId: r.modelId,
      modelName: r.modelName,
      promptHash: r.promptHash,
      receiptId: r.receiptId,
      outputJson: r.outputJson,
    })))
    const selected = selection.rows
    const { decision, projected } = decisionFromAnalysisOutputs(
      selected.map(r => ({
        step: r.step,
        status: r.status,
        output: r.outputJson ? safeJson(r.outputJson) : null,
      })),
    )
    const category = input.category ?? categoryFromEventType(decision.eventType)
    const runPromptHash = buildStepConfigFingerprint(selected, "promptHash")
    const runModelId = buildStepConfigFingerprint(selected, "modelId")
    const runModelName = buildStepConfigFingerprint(selected, "modelName")
    // Always bind the selected run's analysisIds (incl. failed-but-charged) when grouping is complete.
    // Incomplete legacy rows stay without AI prelabel (do not invent a time-stitch).
    const aiPrelabel = selection.complete && selected.length
      ? {
          decision,
          analysisIds: selected.map(r => r.id),
          promptHash: runPromptHash,
          modelId: runModelId,
          modelName: runModelName,
          operator: "system:ai",
        }
      : undefined
    void projected
    const excerpt = licensedExcerpt(material.blocks, material.bodyText, material.contentScope)
    return this.labels.enroll({
      itemId: input.itemId,
      versionId: input.versionId,
      contentHash: material.version.contentHash,
      sourceUrl: material.canonicalUrl,
      excerpt,
      title: material.title,
      category,
      language: input.language ?? null,
      aiPrelabel,
    })
  }

  async saveHuman(input: {
    labelItemId: string
    expectedContentHash: string
    kind: "human_confirm" | "human_correct"
    operator: string
    decision: LabelDecisionFields
    clientRequestId?: string
  }) {
    return this.labels.saveHumanDecision(input)
  }
}
