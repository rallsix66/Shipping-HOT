import type { Database } from "db0"

async function hasColumn(db: Database, table: string, column: string): Promise<boolean> {
  const rows = await db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name?: string }>
  return rows.some(row => row.name === column)
}

export const translationRuntimeWorkStateMigration = {
  version: 12,
  name: "translation-runtime-work-state",
  async up(db: Database) {
    if (!(await hasColumn(db, "translation_cache", "retry_count"))) {
      await db.exec("ALTER TABLE translation_cache ADD COLUMN retry_count INTEGER NOT NULL DEFAULT 0")
    }
    if (!(await hasColumn(db, "translation_cache", "next_retry_at"))) {
      await db.exec("ALTER TABLE translation_cache ADD COLUMN next_retry_at TEXT NULL")
    }
    if (!(await hasColumn(db, "translation_cache", "retryable"))) {
      await db.exec("ALTER TABLE translation_cache ADD COLUMN retryable INTEGER NOT NULL DEFAULT 0")
    }
    if (!(await hasColumn(db, "translation_cache", "lease_until"))) {
      await db.exec("ALTER TABLE translation_cache ADD COLUMN lease_until TEXT NULL")
    }
    if (!(await hasColumn(db, "translation_cache", "last_error_code"))) {
      await db.exec("ALTER TABLE translation_cache ADD COLUMN last_error_code TEXT NULL")
    }
    await db.exec(`
      CREATE INDEX IF NOT EXISTS idx_translation_cache_work_state
      ON translation_cache(provider, model, target_language, status, retryable, next_retry_at, lease_until, updated_at)
    `)
  },
} as const
