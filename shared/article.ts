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

/**
 * Only these metadata fields may influence the content hash, per block type.
 * They must describe body semantics (structure, safe canonical links). Debug,
 * fetch-run, policy or request/response metadata must never be added here.
 */
export const SEMANTIC_BLOCK_METADATA_KEYS: Readonly<Record<ArticleBlockType, readonly string[]>> = {
  heading: ["level"],
  paragraph: ["href"],
  list: ["ordered"],
  table: ["header", "columns"],
  caption: ["href"],
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null"
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`
  const record = value as Record<string, unknown>
  return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(",")}}`
}

/** Projection of block metadata down to the hash-relevant semantic allowlist. */
export function semanticBlockMetadata(block: ArticleBlock): string | null {
  const allowed = SEMANTIC_BLOCK_METADATA_KEYS[block.type] ?? []
  const source = block.metadata
  if (!source || allowed.length === 0) return null
  const picked: Record<string, unknown> = {}
  for (const key of allowed) {
    if (Object.prototype.hasOwnProperty.call(source, key) && source[key] !== undefined) picked[key] = source[key]
  }
  return Object.keys(picked).length > 0 ? stableJson(picked) : null
}

/**
 * Canonical, deterministic serialization of extracted blocks used as the
 * SHA-256 input. Contains block type, order, whitespace-normalized text and the
 * semantic metadata allowlist only — never `fetchedAt`, policy, run/debug ids or
 * raw HTML. The server computes the actual SHA-256 from this string.
 */
export function canonicalArticleBlocks(blocks: readonly ArticleBlock[]): string {
  const canonical = [...blocks]
    .sort((a, b) => a.order - b.order)
    .map(block => ({
      type: block.type,
      order: block.order,
      text: normalizeArticleBlockText(block.text),
      metadata: semanticBlockMetadata(block),
    }))
  return JSON.stringify(canonical)
}

const TRACKING_PARAM_PATTERN = /^(?:utm_.+|fbclid|gclid|dclid|msclkid|igshid|mc_cid|mc_eid|yclid|_hsenc|_hsmi|spm|scm|ref_src)$/i

/**
 * Canonicalizes a candidate link before it may enter block metadata: resolves
 * against a base, drops the fragment and tracking query parameters (utm_*,
 * fbclid, gclid, ...), lowercases the host and sorts query params. Returns a
 * safe absolute http/https URL, or null for credentials/non-web/relative-unsafe
 * input. Keeping this stable prevents tracking-only changes from creating a new
 * article version.
 */
export function canonicalizeArticleUrl(raw: string, base?: string): string | null {
  let url: URL
  try {
    url = base ? new URL(raw, base) : new URL(raw)
  } catch {
    return null
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null
  if (url.username || url.password) return null
  if (!url.hostname) return null
  url.hash = ""
  url.hostname = url.hostname.toLowerCase()
  const kept = [...url.searchParams.entries()]
    .filter(([key]) => !TRACKING_PARAM_PATTERN.test(key))
    .sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0)
  url.search = ""
  for (const [key, value] of kept) url.searchParams.append(key, value)
  return url.toString()
}
