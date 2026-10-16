import type { Database } from "db0"

/** The migration runner disables FK enforcement outside its transaction, then checks before commit. */
export const intelWebListMigration = {
  version: 26,
  name: "intel-web-list",
  rebuildWithForeignKeysDisabled: true,
  async up(db: Database) {
    const row = await db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'intel_source'").get() as { sql: string }
    if (!row.sql.includes("'web_list'")) {
      const constraint = "CHECK (kind IN ('rss', 'atom', 'rdf'))"
      if (!row.sql.includes(constraint)) throw new Error("Unexpected intel_source kind constraint")
      const objects = await db.prepare("SELECT sql FROM sqlite_master WHERE tbl_name = 'intel_source' AND type IN ('index', 'trigger') AND sql IS NOT NULL ORDER BY type, name").all() as { sql: string }[]
      const create = row.sql.replace(/^CREATE TABLE\s+(?:IF NOT EXISTS\s+)?["`[]?intel_source["`\]]?/i, "CREATE TABLE intel_source_web_list_026")
        .replace(constraint, "CHECK (kind IN ('rss', 'atom', 'rdf', 'web_list'))")
      if (create === row.sql || !create.startsWith("CREATE TABLE intel_source_web_list_026")) throw new Error("Unexpected intel_source table definition")
      await db.exec(create)
      await db.exec("INSERT INTO intel_source_web_list_026 SELECT * FROM intel_source")
      await db.exec("DROP TABLE intel_source")
      await db.exec("ALTER TABLE intel_source_web_list_026 RENAME TO intel_source")
      for (const object of objects) await db.exec(object.sql)
    }
    const columns = await db.prepare("PRAGMA table_info(intel_item_version)").all() as { name: string }[]
    if (!columns.some(column => column.name === "date_evidence")) {
      await db.exec("ALTER TABLE intel_item_version ADD COLUMN date_evidence TEXT NULL")
    }
  },
} as const
