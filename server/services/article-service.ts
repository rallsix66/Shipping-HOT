import process from "node:process"
import type { Database } from "db0"
import type { ArticleBlock, ArticleCompletenessStatus, ArticleSourcePolicy, ArticleVersion, FeedArticleDetail } from "@shared/article"
import type { ShippingDataMode } from "#/database/runtime"
import { ArticleRepository } from "#/database/article"
import { ShippingRepository } from "#/database/shipping"
import { ARTICLE_EXTRACTOR_VERSION, extractArticle } from "#/providers/article-extractor"
import { computeArticleContentHash } from "#/services/article-content-hash"
import { type SecureFetchOptions, secureFetchArticle } from "#/services/article-fetch-security"
import { resolveArticleSourcePolicy } from "#/services/source-policy"

export interface ArticleServiceOptions {
  database: Database
  dataMode: ShippingDataMode
  now?: () => Date
  fetchOptions?: Pick<SecureFetchOptions, "lookup" | "transport" | "maxBytes" | "timeoutMs" | "maxRedirects">
  resolvePolicy?: (sourceId: string) => ArticleSourcePolicy
}

export interface ArticleProcessResult {
  feedItemId: string
  status: ArticleCompletenessStatus
  created?: boolean
  fetched: boolean
}

export const EXCERPT_MAX_CHARACTERS = 280

function excerpt(blocks: readonly ArticleBlock[]): ArticleBlock[] {
  const first = blocks.find(block => block.type === "paragraph") ?? blocks[0]
  if (!first) return []
  const text = first.text.length <= EXCERPT_MAX_CHARACTERS
    ? first.text
    : `${first.text.slice(0, EXCERPT_MAX_CHARACTERS - 1).trimEnd()}…`
  return [{ ...first, text }]
}

/**
 * The single orchestration for article full text:
 * FeedItem → policy resolver → secure fetch → extractor → canonical blocks →
 * SHA-256 → ArticleRepository. GET reads never call this; a fetch failure only
 * updates article state and never touches the FeedItem or the last current version.
 */
export class ArticleService {
  private readonly article: ArticleRepository
  private readonly shipping: ShippingRepository
  private readonly now: () => Date
  private readonly resolvePolicy: (sourceId: string) => ArticleSourcePolicy

  constructor(private readonly options: ArticleServiceOptions) {
    this.article = new ArticleRepository(options.database)
    this.shipping = new ShippingRepository(options.database, options.dataMode)
    this.now = options.now ?? (() => new Date())
    this.resolvePolicy = options.resolvePolicy ?? resolveArticleSourcePolicy
  }

  private async findFeedItem(feedItemId: string) {
    const items = await this.shipping.listFeedItems({ now: this.now(), view: "all" })
    return items.find(item => item.id === feedItemId)
  }

  async process(feedItemId: string): Promise<ArticleProcessResult> {
    const item = await this.findFeedItem(feedItemId)
    if (!item) return { feedItemId, status: "unsupported", fetched: false }
    const policy = this.resolvePolicy(item.sourceId)
    const nowIso = this.now().toISOString()
    // originalUrl is the FeedItem's own source; fetchUrl is what we actually
    // request (canonical when present). They are never conflated in storage.
    const originalUrl = item.sourceUrl
    const fetchUrl = item.canonicalUrl ?? item.sourceUrl

    if (!policy.fetchAllowed || policy.persistence === "disallowed") {
      const status: ArticleCompletenessStatus = policy.persistence === "disallowed" ? "policy_disallowed" : "authorization_required"
      await this.article.saveFetchState({
        feedItemId,
        sourceId: item.sourceId,
        originalUrl,
        completenessStatus: status,
        lastAttemptAt: nowIso,
        updatedAt: nowIso,
        errorCode: policy.status === "unconfigured" ? "policy_unconfigured" : "policy_disallowed",
      })
      return { feedItemId, status, fetched: false }
    }

    const result = await secureFetchArticle(fetchUrl, { policy, ...this.options.fetchOptions })
    if (!result.ok) {
      const failureStatus: ArticleCompletenessStatus
        = result.code === "content_type_unsupported" || result.code === "content_type_missing" ? "unsupported" : "source_unavailable"
      await this.article.saveFetchState({
        feedItemId,
        sourceId: item.sourceId,
        originalUrl,
        completenessStatus: failureStatus,
        lastAttemptAt: nowIso,
        updatedAt: nowIso,
        errorCode: result.code,
        errorMessage: result.message.slice(0, 200),
      })
      return { feedItemId, status: failureStatus, fetched: true }
    }

    const extracted = extractArticle(result.body, result.finalUrl, policy)
    if (extracted.blocks.length === 0 && extracted.status === "source_unavailable") {
      await this.article.saveFetchState({
        feedItemId,
        sourceId: item.sourceId,
        originalUrl,
        canonicalUrl: result.finalUrl,
        contentType: result.contentType ?? null,
        completenessStatus: "source_unavailable",
        lastAttemptAt: nowIso,
        updatedAt: nowIso,
        errorCode: "extraction_structure_failed",
        errorMessage: "No article content extracted for the configured source structure.",
      })
      return { feedItemId, status: "source_unavailable", fetched: true }
    }
    const limited = policy.persistence === "excerpt_only"
    const blocks = limited ? excerpt(extracted.blocks) : extracted.blocks
    const status: ArticleCompletenessStatus = limited ? "summary_only" : extracted.status
    const contentHash = computeArticleContentHash(blocks)
    const version: ArticleVersion = {
      id: `article-version:${feedItemId}:${contentHash.slice(0, 16)}`,
      feedItemId,
      contentHash,
      language: null,
      sourcePublishedAt: item.publishedAt || null,
      sourceUpdatedAt: item.sourceUpdatedAt ?? null,
      fetchedAt: nowIso,
      extractorVersion: ARTICLE_EXTRACTOR_VERSION,
      completenessStatus: status,
      accessPolicy: policy.status,
      redistributionPolicy: policy.persistence,
      createdAt: nowIso,
    }
    await this.article.saveFetchState({
      feedItemId,
      sourceId: item.sourceId,
      originalUrl,
      canonicalUrl: result.finalUrl,
      contentType: result.contentType ?? null,
      completenessStatus: status,
      lastAttemptAt: nowIso,
      lastSuccessAt: nowIso,
      updatedAt: nowIso,
    })
    const saved = await this.article.saveVersionWithBlocks(version, blocks)
    return { feedItemId, status, created: saved.created, fetched: true }
  }

  async getDetail(feedItemId: string, versionId?: string): Promise<FeedArticleDetail | undefined> {
    const detail = await this.article.getArticle(feedItemId)
    if (!detail) return undefined
    const versions = await this.article.listVersions(feedItemId)
    let currentVersion = detail.currentVersion
    let blocks = detail.blocks
    if (versionId && versionId !== detail.currentVersion?.id) {
      const selected = versions.find(version => version.id === versionId)
      if (selected) {
        currentVersion = selected
        blocks = await this.article.listVersionBlocks(selected.id)
      }
    }
    return {
      feedItemId,
      state: detail.state,
      currentVersion,
      blocks,
      versions: versions.map(version => ({
        id: version.id,
        contentHash: version.contentHash,
        fetchedAt: version.fetchedAt,
        createdAt: version.createdAt,
        extractorVersion: version.extractorVersion,
        completenessStatus: version.completenessStatus,
      })),
    }
  }
}

export function createArticleService(dataMode?: ShippingDataMode, database?: Database): ArticleService | undefined {
  if (!database) return undefined
  return new ArticleService({ database, dataMode: dataMode ?? (process.env.SHIPPING_DATA_MODE === "real" ? "real" : "mock") })
}
