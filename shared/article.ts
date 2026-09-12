// Article full-text DTOs. Source identity is inherited from the existing FeedItem
// and shippingFeedSources registry; nothing here is a second Feed/source system.
export type ArticleCompletenessStatus =
  | "complete"
  | "summary_only"
  | "incomplete"
  | "authorization_required"
  | "policy_disallowed"
  | "unsupported"
  | "source_unavailable"

export type ArticleBlockType = "heading" | "paragraph" | "list" | "table" | "caption"

export interface ArticleBlock {
  id: string
  /** Stable within a version (e.g. structural path); never order-derived. */
  blockKey: string
  order: number
  type: ArticleBlockType
  text: string
  metadata?: Record<string, unknown>
}

export interface ArticleVersion {
  id: string
  feedItemId: string
  contentHash: string
  language?: string | null
  sourcePublishedAt?: string | null
  sourceUpdatedAt?: string | null
  fetchedAt: string
  extractorVersion: string
  completenessStatus: ArticleCompletenessStatus
  accessPolicy?: string | null
  redistributionPolicy?: string | null
  createdAt: string
}

export interface ArticleState {
  feedItemId: string
  sourceId: string
  originalUrl: string
  canonicalUrl?: string | null
  contentType?: string | null
  completenessStatus: ArticleCompletenessStatus
  currentVersionId?: string | null
  lastAttemptAt?: string | null
  lastSuccessAt?: string | null
  errorCode?: string | null
  errorMessage?: string | null
  updatedAt: string
}

export interface ArticleDetail {
  state: ArticleState
  currentVersion?: ArticleVersion
  blocks: ArticleBlock[]
}

/** Whitespace-normalized block text used for content hashing. */
export function normalizeArticleBlockText(text: string): string {
  return text.replace(/\s+/g, " ").trim()
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null"
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`
  const record = value as Record<string, unknown>
  return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(",")}}`
}

function fnv1a(input: string, seed: number): number {
  let hash = seed >>> 0
  for (let index = 0; index < input.length; index++) {
    hash ^= input.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash
}

/**
 * Canonical content hash of cleaned/extracted blocks. Inputs are block type,
 * order, whitespace-normalized text and semantic metadata only — never
 * `fetchedAt`, policy or random ids. Identical extracted content hashes the
 * same (no false version); a real text/structure change hashes differently.
 */
export function computeArticleContentHash(blocks: readonly ArticleBlock[]): string {
  const canonical = [...blocks]
    .sort((a, b) => a.order - b.order)
    .map(block => ({
      type: block.type,
      order: block.order,
      text: normalizeArticleBlockText(block.text),
      metadata: block.metadata ? stableJson(block.metadata) : null,
    }))
  const serialized = JSON.stringify(canonical)
  const low = fnv1a(serialized, 0x811C9DC5)
  const high = fnv1a(serialized, 0x9E3779B9)
  return `${low.toString(16).padStart(8, "0")}${high.toString(16).padStart(8, "0")}`
}
