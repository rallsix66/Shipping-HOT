import type { Database } from "db0"

async function hasColumn(db: Database, table: string, column: string): Promise<boolean> {
  const rows = await db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name?: string }>
  return rows.some(row => row.name === column)
}

export const providerUsageRecordsMigration = {
  version: 11,
  name: "provider-usage-records",
  async up(db: Database) {
    if (!(await hasColumn(db, "provider_usage", "records_count"))) {
      await db.exec("ALTER TABLE provider_usage ADD COLUMN records_count INTEGER NOT NULL DEFAULT 0")
    }
  },
} as const
