import type { Database } from "db0"
import type { ArticleBlock, ArticleCompletenessStatus, ArticleDetail, ArticleState, ArticleVersion } from "@shared/article"

function row<T>(value: unknown): T | undefined {
  return value && typeof value === "object" ? value as T : undefined
}

function rows<T>(value: unknown): T[] {
  return Array.isArray(value) ? value as T[] : []
}

function parseMetadata(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== "string" || !value) return undefined
  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : undefined
  } catch {
    return undefined
  }
}

interface VersionRow {
  id: string
  feed_item_id: string
  content_hash: string
  language?: string | null
  source_published_at?: string | null
  source_updated_at?: string | null
  fetched_at: string
  extractor_version: string
  completeness_status: string
  access_policy?: string | null
  redistribution_policy?: string | null
  created_at: string
}

interface BlockRow {
  id: string
  version_id: string
  block_key: string
  block_order: number
  block_type: string
  text: string
  metadata?: string | null
}

interface StateRow {
  feed_item_id: string
  source_id: string
  original_url: string
  canonical_url?: string | null
  content_type?: string | null
  completeness_status: string
  current_version_id?: string | null
  last_attempt_at?: string | null
  last_success_at?: string | null
  error_code?: string | null
  error_message?: string | null
  updated_at: string
}

function mapState(value: StateRow): ArticleState {
  return {
    feedItemId: value.feed_item_id,
    sourceId: value.source_id,
    originalUrl: value.original_url,
    canonicalUrl: value.canonical_url ?? null,
    contentType: value.content_type ?? null,
    completenessStatus: value.completeness_status as ArticleCompletenessStatus,
    currentVersionId: value.current_version_id ?? null,
    lastAttemptAt: value.last_attempt_at ?? null,
    lastSuccessAt: value.last_success_at ?? null,
    errorCode: value.error_code ?? null,
    errorMessage: value.error_message ?? null,
    updatedAt: value.updated_at,
  }
}

function mapVersion(value: VersionRow): ArticleVersion {
  return {
    id: value.id,
    feedItemId: value.feed_item_id,
    contentHash: value.content_hash,
    language: value.language ?? null,
    sourcePublishedAt: value.source_published_at ?? null,
    sourceUpdatedAt: value.source_updated_at ?? null,
    fetchedAt: value.fetched_at,
    extractorVersion: value.extractor_version,
    completenessStatus: value.completeness_status as ArticleCompletenessStatus,
    accessPolicy: value.access_policy ?? null,
    redistributionPolicy: value.redistribution_policy ?? null,
    createdAt: value.created_at,
  }
}

function mapBlock(value: BlockRow): ArticleBlock {
  return {
    id: value.id,
    blockKey: value.block_key,
    order: Number(value.block_order),
    type: value.block_type as ArticleBlock["type"],
    text: value.text,
    metadata: parseMetadata(value.metadata),
  }
}

/** SQLite boundary for article fetch state, immutable versions and ordered blocks. */
export class ArticleRepository {
  constructor(private readonly db: Database) {}

  async saveFetchState(state: ArticleState): Promise<void> {
    await this.db.prepare(`
      INSERT INTO feed_articles (
        feed_item_id, source_id, original_url, canonical_url, content_type, completeness_status,
        current_version_id, last_attempt_at, last_success_at, error_code, error_message, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(feed_item_id) DO UPDATE SET
        source_id = excluded.source_id,
        original_url = excluded.original_url,
        canonical_url = excluded.canonical_url,
        content_type = excluded.content_type,
        completeness_status = excluded.completeness_status,
        current_version_id = COALESCE(excluded.current_version_id, feed_articles.current_version_id),
        last_attempt_at = COALESCE(excluded.last_attempt_at, feed_articles.last_attempt_at),
        last_success_at = COALESCE(excluded.last_success_at, feed_articles.last_success_at),
        error_code = excluded.error_code,
        error_message = excluded.error_message,
        updated_at = excluded.updated_at
    `).run(
      state.feedItemId,
      state.sourceId,
      state.originalUrl,
      state.canonicalUrl ?? null,
      state.contentType ?? null,
      state.completenessStatus,
      state.currentVersionId ?? null,
      state.lastAttemptAt ?? null,
      state.lastSuccessAt ?? null,
      state.errorCode ?? null,
      state.errorMessage ?? null,
      state.updatedAt,
    )
  }

  /**
   * Persists an immutable version and its blocks atomically. Re-processing the
   * same (feed_item_id, content_hash) returns the existing version without adding
   * duplicate versions or blocks.
   */
  async saveVersionWithBlocks(version: ArticleVersion, blocks: readonly ArticleBlock[]): Promise<{ created: boolean, versionId: string }> {
    // Fail closed when there is no article state row: never write an orphan version.
    const state = row<StateRow>(await this.db.prepare(
      "SELECT * FROM feed_articles WHERE feed_item_id = ?",
    ).get(version.feedItemId) as never)
    if (!state) throw new Error("article_state_missing")

    const existing = row<{ id: string }>(await this.db.prepare(
      "SELECT id FROM article_versions WHERE feed_item_id = ? AND content_hash = ?",
    ).get(version.feedItemId, version.contentHash) as never)
    if (existing?.id) {
      // Same content re-observed: no new version, but re-point current_version_id
      // (handles A → B → A), refresh success time and clear the previous error.
      // `article_versions` stays an immutable snapshot; the mutable completeness
      // reflects this latest successful observation.
      const result = await this.db.prepare(`
        UPDATE feed_articles
        SET current_version_id = ?, completeness_status = ?, last_success_at = ?, error_code = NULL, error_message = NULL, updated_at = ?
        WHERE feed_item_id = ?
      `).run(existing.id, version.completenessStatus, version.fetchedAt, version.createdAt, version.feedItemId) as { changes?: number }
      if (result?.changes !== 1) throw new Error("article_state_update_failed")
      return { created: false, versionId: existing.id }
    }

    await this.db.prepare("BEGIN").run()
    try {
      await this.db.prepare(`
        INSERT INTO article_versions (
          id, feed_item_id, content_hash, language, source_published_at, source_updated_at,
          fetched_at, extractor_version, completeness_status, access_policy, redistribution_policy, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        version.id,
        version.feedItemId,
        version.contentHash,
        version.language ?? null,
        version.sourcePublishedAt ?? null,
        version.sourceUpdatedAt ?? null,
        version.fetchedAt,
        version.extractorVersion,
        version.completenessStatus,
        version.accessPolicy ?? null,
        version.redistributionPolicy ?? null,
        version.createdAt,
      )
      for (const block of blocks) {
        // Stored block id is version-scoped so the same stable block key can
        // repeat across versions without PK collisions.
        await this.db.prepare(`
          INSERT INTO article_blocks (id, version_id, block_key, block_order, block_type, text, metadata)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(
          `${version.id}:${block.blockKey}`,
          version.id,
          block.blockKey,
          block.order,
          block.type,
          block.text,
          block.metadata ? JSON.stringify(block.metadata) : null,
        )
      }
      const updated = await this.db.prepare(`
        UPDATE feed_articles
        SET current_version_id = ?, completeness_status = ?, last_success_at = ?, error_code = NULL, error_message = NULL, updated_at = ?
        WHERE feed_item_id = ?
      `).run(version.id, version.completenessStatus, version.fetchedAt, version.createdAt, version.feedItemId) as { changes?: number }
      if (updated?.changes !== 1) throw new Error("article_state_update_failed")
      await this.db.prepare("COMMIT").run()
    } catch (error) {
      await this.db.prepare("ROLLBACK").run()
      throw error
    }
    return { created: true, versionId: version.id }
  }

  async getArticle(feedItemId: string): Promise<ArticleDetail | undefined> {
    const stateRow = row<StateRow>(await this.db.prepare(
      "SELECT * FROM feed_articles WHERE feed_item_id = ?",
    ).get(feedItemId) as never)
    if (!stateRow) return undefined
    const state = mapState(stateRow)

    const currentVersionId = state.currentVersionId
    let currentVersion: ArticleVersion | undefined
    if (currentVersionId) {
      const versionRow = row<VersionRow>(await this.db.prepare("SELECT * FROM article_versions WHERE id = ?").get(currentVersionId) as never)
      currentVersion = versionRow ? mapVersion(versionRow) : undefined
    }
    return {
      state,
      currentVersion,
      blocks: currentVersion ? await this.listVersionBlocks(currentVersion.id) : [],
    }
  }

  async getState(feedItemId: string): Promise<ArticleState | undefined> {
    const stateRow = row<StateRow>(await this.db.prepare(
      "SELECT * FROM feed_articles WHERE feed_item_id = ?",
    ).get(feedItemId) as never)
    return stateRow ? mapState(stateRow) : undefined
  }

  async listVersionBlocks(versionId: string): Promise<ArticleBlock[]> {
    const values = rows<BlockRow>(await this.db.prepare(
      "SELECT * FROM article_blocks WHERE version_id = ? ORDER BY block_order",
    ).all(versionId) as never)
    return values.map(mapBlock)
  }

  async listVersions(feedItemId: string): Promise<ArticleVersion[]> {
    const values = rows<VersionRow>(await this.db.prepare(
      "SELECT * FROM article_versions WHERE feed_item_id = ? ORDER BY created_at, id",
    ).all(feedItemId) as never)
    return values.map(mapVersion)
  }
}
