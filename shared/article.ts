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
