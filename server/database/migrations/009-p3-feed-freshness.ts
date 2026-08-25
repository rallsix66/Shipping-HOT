import type { Database } from "db0"

async function hasColumn(db: Database, column: string): Promise<boolean> {
  const rows = await db.prepare("PRAGMA table_info(feed_items)").all() as Array<{ name?: string }>
  return rows.some(row => row.name === column)
}

export const p3FeedFreshnessMigration = {
  version: 9,
  name: "p3-feed-freshness",
  async up(db: Database) {
    for (const column of ["effective_at", "expires_at", "current_until"]) {
      if (!(await hasColumn(db, column))) await db.exec(`ALTER TABLE feed_items ADD COLUMN ${column} TEXT`)
    }
    if (!(await hasColumn(db, "visibility"))) await db.exec("ALTER TABLE feed_items ADD COLUMN visibility TEXT NOT NULL DEFAULT 'history'")

    await db.exec(`
      CREATE TABLE IF NOT EXISTS feed_item_history (
        id TEXT PRIMARY KEY,
        feed_item_id TEXT NOT NULL,
        source_id TEXT NOT NULL,
        observed_at TEXT NOT NULL,
        effective_at TEXT,
        expires_at TEXT,
        current_until TEXT,
        visibility TEXT NOT NULL CHECK (visibility IN ('current', 'history', 'quarantine')),
        source_type TEXT NOT NULL CHECK (source_type IN ('real', 'mock', 'imported', 'derived')),
        data TEXT NOT NULL
      );

      CREATE UNIQUE INDEX IF NOT EXISTS idx_feed_item_history_item_observed
        ON feed_item_history(feed_item_id, observed_at);
      CREATE INDEX IF NOT EXISTS idx_feed_item_history_source_observed
        ON feed_item_history(source_id, observed_at DESC);
      CREATE INDEX IF NOT EXISTS idx_feed_items_current_until
        ON feed_items(visibility, current_until);
    `)

    await db.prepare("UPDATE feed_items SET visibility = 'history' WHERE visibility IS NULL OR visibility = ''").run()
    await db.exec(`
      INSERT OR IGNORE INTO feed_item_history (
        id, feed_item_id, source_id, observed_at, effective_at, expires_at,
        current_until, visibility, source_type, data
      )
      SELECT
        'feed-history:' || id || ':' || fetched_at,
        id,
        source_id,
        fetched_at,
        effective_at,
        expires_at,
        current_until,
        visibility,
        source_type,
        data
      FROM feed_items
    `)
  },
} as const
