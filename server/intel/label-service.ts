/**
 * §4.9 labeling service — enroll/browse/save only.
 * Never calls model providers. AI prelabel is copied from existing intel_analysis rows.
 */
import type { Database } from "db0"
import type { LabelCategory, LabelDecisionFields, LabelDetailResponse, LabelListResponse } from "@shared/intel-label"
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

function decisionFromAnalysisOutputs(outputs: Array<{ step: string, output: unknown }>): LabelDecisionFields {
  const pre = outputs.find(o => o.step === "prefilter")?.output as Record<string, unknown> | undefined
  const extract = outputs.find(o => o.step === "extract")?.output as Record<string, unknown> | undefined
  const keep = typeof pre?.keep === "boolean" ? pre.keep : typeof pre?.shouldKeep === "boolean" ? pre.shouldKeep : null
  return {
    prefilterKeep: keep,
    eventType: typeof extract?.eventType === "string" ? extract.eventType : null,
    countries: Array.isArray(extract?.countries) ? extract!.countries.filter((x): x is string => typeof x === "string") : [],
    ports: Array.isArray(extract?.ports) ? extract!.ports.filter((x): x is string => typeof x === "string") : [],
    effectiveFrom: typeof extract?.effectiveFrom === "string"
      ? extract.effectiveFrom
      : typeof extract?.occurredAt === "string"
        ? extract.occurredAt
        : null,
    isOfficialStatement: typeof extract?.isOfficialStatement === "boolean"
      ? extract.isOfficialStatement
      : typeof extract?.official === "boolean"
        ? extract.official
        : null,
  }
}

function licensedExcerpt(blocks: Array<{ type: string, text: string }>, bodyText: string | null): string | null {
  const excerptBlock = blocks.find(b => b.type === "excerpt")
  if (excerptBlock?.text) return excerptBlock.text.slice(0, EXCERPT_CHARS)
  if (!bodyText) return null
  return bodyText.length <= EXCERPT_CHARS ? bodyText : `${bodyText.slice(0, EXCERPT_CHARS - 1).trimEnd()}…`
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
    const items = hasMore ? rows.slice(0, limit) : rows
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
    let material
    if (materialResult.ok) {
      material = {
        title: materialResult.material.title,
        sourceUrl: materialResult.material.canonicalUrl,
        excerpt: licensedExcerpt(materialResult.material.blocks, materialResult.material.bodyText),
        contentScope: materialResult.material.contentScope,
        bodyAvailable: Boolean(materialResult.material.bodyText),
      }
    } else {
      material = {
        title: item.title ?? "",
        sourceUrl: item.sourceUrl,
        excerpt: item.excerpt,
        contentScope: "metadata_only",
        bodyAvailable: false,
      }
    }
    return {
      item,
      material,
      aiPrelabel: await this.labels.latestAiPrelabel(item.id),
      humanDecision: await this.labels.latestDecision(item.id, { humanOnly: true }),
      analysisSummaries: matched.map(r => ({
        id: r.id,
        step: r.step,
        status: r.status,
        modelName: r.modelName,
        promptHash: r.promptHash,
        provenance: r.provenance,
        output: r.outputJson ? safeJson(r.outputJson) : null,
      })),
      neighbors,
    }
  }

  /**
   * Enroll from an existing approved item+version. Copies AI outputs if present.
   * Does not call providers and does not invent human labels.
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
    const matched = analysisRows.filter(r => r.contentHash === material.version.contentHash && (r.status === "completed" || r.status === "reused"))
    const decision = decisionFromAnalysisOutputs(
      matched.map(r => ({ step: r.step, output: r.outputJson ? safeJson(r.outputJson) : null })),
    )
    const category = input.category ?? categoryFromEventType(decision.eventType)
    const aiPrelabel = matched.length
      ? {
          decision,
          analysisIds: matched.map(r => r.id),
          promptHash: matched.find(r => r.promptHash)?.promptHash ?? null,
          modelId: matched.find(r => r.modelId)?.modelId ?? null,
          modelName: matched.find(r => r.modelName)?.modelName ?? null,
          operator: "system:ai",
        }
      : undefined
    return this.labels.enroll({
      itemId: input.itemId,
      versionId: input.versionId,
      contentHash: material.version.contentHash,
      sourceUrl: material.canonicalUrl,
      excerpt: licensedExcerpt(material.blocks, material.bodyText),
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

function safeJson(raw: string): unknown {
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}
