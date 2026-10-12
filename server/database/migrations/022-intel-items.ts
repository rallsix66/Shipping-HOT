import type { Database } from "db0"

// R2 first slice: deduplicated intel items with immutable, license-scoped body versions.
// Mirrors 013 (article_versions / article_blocks): each version keeps readable content blocks
// within the source's persistence policy, not only a hash.
export const intelItemsMigration = {
  version: 22,
  name: "intel-items",
  async up(db: Database) {
    await db.exec(`
      CREATE TABLE IF NOT EXISTS intel_item (
        id TEXT PRIMARY KEY,
        source_id TEXT NOT NULL,
        canonical_url TEXT NOT NULL,
        title TEXT NOT NULL,
        published_at TEXT NULL,
        first_seen_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL,
        current_version_id TEXT NULL,
        UNIQUE (source_id, canonical_url)
      )
    `)
    await db.exec(`
      CREATE TABLE IF NOT EXISTS intel_item_version (
        id TEXT PRIMARY KEY,
        item_id TEXT NOT NULL,
        content_hash TEXT NOT NULL,
        fetched_at TEXT NOT NULL,
        extractor_version TEXT NOT NULL,
        content_scope TEXT NOT NULL CHECK (content_scope IN ('full_text', 'excerpt', 'metadata_only')),
        source_published_at TEXT NULL,
        source_updated_at TEXT NULL,
        created_at TEXT NOT NULL,
        UNIQUE (item_id, content_hash)
      )
    `)
    await db.exec("CREATE INDEX IF NOT EXISTS idx_intel_item_version_item ON intel_item_version(item_id, created_at)")
    await db.exec(`
      CREATE TABLE IF NOT EXISTS intel_item_block (
        id TEXT PRIMARY KEY,
        version_id TEXT NOT NULL,
        block_key TEXT NOT NULL,
        block_order INTEGER NOT NULL,
        block_type TEXT NOT NULL CHECK (block_type IN ('title', 'paragraph', 'excerpt')),
        text TEXT NOT NULL,
        UNIQUE (version_id, block_order),
        UNIQUE (version_id, block_key)
      )
    `)
    await db.exec("CREATE INDEX IF NOT EXISTS idx_intel_item_block_version ON intel_item_block(version_id, block_order)")
  },
} as const
