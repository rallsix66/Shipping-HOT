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
  modelId?: string | null
  modelName?: string | null
  promptHash?: string | null
  receiptId?: string | null
  output?: unknown
  outputJson?: string | null
}

/**
 * Pick one coherent analyze run (not a cross-run mix of oldest prefilter + newest extract).
 * Prefer the latest completed/reused extract, then the latest prefilter at-or-before it,
 * plus severity rows in that window. Prefilter-only (BLOCK) uses the latest prefilter.
 */
export function selectConsistentAnalysisRun<T extends AnalysisIdentityRow>(rows: T[]): T[] {
  const usable = rows.filter(r => !r.status || r.status === "completed" || r.status === "reused")
  if (!usable.length) return []
  const byNewest = (a: T, b: T) => {
    const t = b.createdAt.localeCompare(a.createdAt)
    if (t !== 0) return t
    return (b.attemptIndex ?? 0) - (a.attemptIndex ?? 0)
  }
  const extracts = usable.filter(r => r.step === "extract").sort(byNewest)
  const prefilters = usable.filter(r => r.step === "prefilter").sort(byNewest)
  const picked: T[] = []
  if (extracts.length) {
    const extract = extracts[0]!
    const pre = prefilters.find(p => p.createdAt <= extract.createdAt) ?? null
    const start = pre?.createdAt ?? extract.createdAt
    if (pre) picked.push(pre)
    for (const r of usable) {
      if ((r.step === "severity" || r.step === "severity_tiebreak")
        && r.createdAt >= start
        && r.createdAt <= extract.createdAt) {
        picked.push(r)
      }
    }
    picked.push(extract)
  } else if (prefilters.length) {
    picked.push(prefilters[0]!)
  } else {
    return []
  }
  const seen = new Set<string>()
  const deduped: T[] = []
  for (const r of picked.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || (a.attemptIndex ?? 0) - (b.attemptIndex ?? 0))) {
    if (seen.has(r.id)) continue
    seen.add(r.id)
    deduped.push(r)
  }
  return deduped
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
    const matched = analysisRows.filter(r =>
      r.contentHash === material.version.contentHash
      && (r.status === "completed" || r.status === "reused"),
    )
    const selected = selectConsistentAnalysisRun(matched.map(r => ({
      id: r.id,
      step: r.step,
      status: r.status,
      createdAt: r.createdAt,
      attemptIndex: r.attemptIndex,
      modelId: r.modelId,
      modelName: r.modelName,
      promptHash: r.promptHash,
      receiptId: r.receiptId,
      outputJson: r.outputJson,
    })))
    const { decision, projected } = decisionFromAnalysisOutputs(
      selected.map(r => ({
        step: r.step,
        status: r.status,
        output: r.outputJson ? safeJson(r.outputJson) : null,
      })),
    )
    const category = input.category ?? categoryFromEventType(decision.eventType)
    const extractRow = selected.find(r => r.step === "extract")
    const preRow = selected.find(r => r.step === "prefilter")
    // Primary display identity prefers extract; run fingerprint keeps prefilter in prompt/model fields
    // when both steps exist so mixed prefilter configs cannot silently collapse into extract-only.
    const runPromptHash = selected.length === 0
      ? null
      : selected.map(r => `${r.step}:${r.promptHash ?? ""}`).join("|")
    const runModelId = selected.length === 0
      ? null
      : selected.map(r => `${r.step}:${r.modelId ?? ""}`).join("|")
    const runModelName = selected.length === 0
      ? null
      : selected.map(r => `${r.step}:${r.modelName ?? ""}`).join("|")
    const aiPrelabel = projected && selected.length
      ? {
          decision,
          analysisIds: selected.map(r => r.id),
          promptHash: runPromptHash ?? extractRow?.promptHash ?? preRow?.promptHash ?? null,
          modelId: runModelId ?? extractRow?.modelId ?? preRow?.modelId ?? null,
          modelName: runModelName ?? extractRow?.modelName ?? preRow?.modelName ?? null,
          operator: "system:ai",
        }
      : undefined
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
