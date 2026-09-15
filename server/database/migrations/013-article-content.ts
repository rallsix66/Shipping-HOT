import type { Database } from "db0"

// Article full-text capability: current fetch state per FeedItem, immutable
// original-article versions, and stable content blocks. Source identity is
// inherited from the existing FeedItem / shippingFeedSources registry; this
// migration does not add a second source registry or a source_type lineage
// column (lineage is resolved through feed_items.source_type).
export const articleContentMigration = {
  version: 13,
  name: "article-content",
  async up(db: Database) {
    await db.exec(`
      CREATE TABLE IF NOT EXISTS feed_articles (
        feed_item_id TEXT PRIMARY KEY,
        source_id TEXT NOT NULL,
        original_url TEXT NOT NULL,
        canonical_url TEXT NULL,
        content_type TEXT NULL,
        completeness_status TEXT NOT NULL,
        current_version_id TEXT NULL,
        last_attempt_at TEXT NULL,
        last_success_at TEXT NULL,
        error_code TEXT NULL,
        error_message TEXT NULL,
        updated_at TEXT NOT NULL
      )
    `)
    await db.exec("CREATE INDEX IF NOT EXISTS idx_feed_articles_source ON feed_articles(source_id)")
    await db.exec("CREATE INDEX IF NOT EXISTS idx_feed_articles_status ON feed_articles(completeness_status)")

    await db.exec(`
      CREATE TABLE IF NOT EXISTS article_versions (
        id TEXT PRIMARY KEY,
        feed_item_id TEXT NOT NULL,
        content_hash TEXT NOT NULL,
        language TEXT NULL,
        source_published_at TEXT NULL,
        source_updated_at TEXT NULL,
        fetched_at TEXT NOT NULL,
        extractor_version TEXT NOT NULL,
        completeness_status TEXT NOT NULL,
        access_policy TEXT NULL,
        redistribution_policy TEXT NULL,
        created_at TEXT NOT NULL,
        UNIQUE (feed_item_id, content_hash)
      )
    `)
    await db.exec("CREATE INDEX IF NOT EXISTS idx_article_versions_feed_item ON article_versions(feed_item_id, created_at)")

    await db.exec(`
      CREATE TABLE IF NOT EXISTS article_blocks (
        id TEXT PRIMARY KEY,
        version_id TEXT NOT NULL,
        block_key TEXT NOT NULL,
        block_order INTEGER NOT NULL,
        block_type TEXT NOT NULL,
        text TEXT NOT NULL,
        metadata TEXT NULL,
        UNIQUE (version_id, block_order),
        UNIQUE (version_id, block_key)
      )
    `)
    await db.exec("CREATE INDEX IF NOT EXISTS idx_article_blocks_version ON article_blocks(version_id, block_order)")
  },
} as const
