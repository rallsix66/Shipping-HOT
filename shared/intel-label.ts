/**
 * R3 §4.9 labeling contracts — URL + licensed excerpt + labels only.
 * AI prelabel and human confirm are separate; only isHuman counts as labeled.
 */

export const LABEL_CATEGORIES = [
  "policy",
  "weather",
  "port",
  "lastmile",
  "other",
  "unknown",
] as const
export type LabelCategory = (typeof LABEL_CATEGORIES)[number]

export const LABEL_QUEUE_STATUSES = [
  "unreviewed",
  "ai_prelabeled",
  "human_confirmed",
] as const
export type LabelQueueStatus = (typeof LABEL_QUEUE_STATUSES)[number]

export const LABEL_DECISION_KINDS = [
  "ai_prelabel",
  "human_confirm",
  "human_correct",
] as const
export type LabelDecisionKind = (typeof LABEL_DECISION_KINDS)[number]

/** Fields compared by scripts/intel-eval.ts (R3-3 / R3-4 denominators). */
export interface LabelDecisionFields {
  prefilterKeep: boolean | null
  eventType: string | null
  countries: string[]
  ports: string[]
  effectiveFrom: string | null
  isOfficialStatement: boolean | null
  notes?: string
}

export interface LabelCoverageBucket {
  key: string
  total: number
  humanConfirmed: number
  aiPrelabeled: number
  unreviewed: number
}

export interface LabelCoverageSummary {
  total: number
  humanConfirmed: number
  aiPrelabeled: number
  unreviewed: number
  byCategory: LabelCoverageBucket[]
  byLanguage: LabelCoverageBucket[]
  /** Honest gaps — never invent sample counts. */
  missingNotes: string[]
}

export interface LabelItemView {
  id: string
  itemId: string
  versionId: string
  contentHash: string
  sourceUrl: string
  excerpt: string | null
  category: LabelCategory
  language: string | null
  queueStatus: LabelQueueStatus
  title: string | null
  createdAt: string
  updatedAt: string
}

export interface LabelDecisionView {
  id: string
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
  createdAt: string
}

export interface LabelDetailResponse {
  item: LabelItemView
  /** Licensed material only; never restricted full text. */
  material: {
    title: string
    sourceUrl: string
    excerpt: string | null
    contentScope: string
    bodyAvailable: boolean
  }
  aiPrelabel: LabelDecisionView | null
  humanDecision: LabelDecisionView | null
  analysisSummaries: Array<{
    id: string
    step: string
    status: string
    modelName: string | null
    promptHash: string | null
    provenance: string
    output: unknown
  }>
  neighbors: { prevId: string | null, nextId: string | null }
}

export interface LabelListResponse {
  items: LabelItemView[]
  limit: number
  offset: number
  hasMore: boolean
  coverage: LabelCoverageSummary
}
