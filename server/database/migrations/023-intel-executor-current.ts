import type { Database } from "db0"

async function hasColumn(db: Database, table: string, column: string): Promise<boolean> {
  const rows = await db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name?: string }>
  return rows.some(row => row.name === column)
}

// R2 first-slice review repairs (additive):
// - intel_executor + intel_fetch_run.executor_id: recovery only closes runs whose executor is confirmed ended,
//   or runs swept by the explicit exclusive startup step; never inferred from instance construction time.
// - intel_item_current_change: every move of intel_item.current_version_id (new version or rollback to an
//   existing immutable version) is recorded.
export const intelExecutorCurrentMigration = {
  version: 23,
  name: "intel-executor-current",
  async up(db: Database) {
    await db.exec(`
      CREATE TABLE IF NOT EXISTS intel_executor (
        id TEXT PRIMARY KEY,
        started_at TEXT NOT NULL,
        ended_at TEXT NULL
      )
    `)
    if (!(await hasColumn(db, "intel_fetch_run", "executor_id"))) await db.exec("ALTER TABLE intel_fetch_run ADD COLUMN executor_id TEXT NULL")
    await db.exec("CREATE INDEX IF NOT EXISTS idx_intel_fetch_run_executor ON intel_fetch_run(executor_id, status)")
    await db.exec(`
      CREATE TABLE IF NOT EXISTS intel_item_current_change (
        id TEXT PRIMARY KEY,
        item_id TEXT NOT NULL,
        from_version_id TEXT NULL,
        to_version_id TEXT NOT NULL,
        reason TEXT NOT NULL CHECK (reason IN ('new_version', 'restored_version')),
        changed_at TEXT NOT NULL
      )
    `)
    await db.exec("CREATE INDEX IF NOT EXISTS idx_intel_item_current_change_item ON intel_item_current_change(item_id, changed_at)")
  },
} as const
