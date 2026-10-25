import type { Database } from "db0"

// Same transactional rebuild protocol as 026; the runner owns FK disable/check/restore.
export const intelJsonListMigration = {
  version: 27,
  name: "intel-json-list",
  rebuildWithForeignKeysDisabled: true,
  async up(db: Database) {
    const row = await db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'intel_source'").get() as { sql: string }
    const constraint = "CHECK (kind IN ('rss', 'atom', 'rdf', 'web_list'))"
    const expanded = "CHECK (kind IN ('rss', 'atom', 'rdf', 'web_list', 'json_list'))"
    if (row.sql.includes(expanded)) return
    if (!row.sql.includes(constraint)) throw new Error("Unexpected intel_source kind constraint")
    const objects = await db.prepare("SELECT sql FROM sqlite_master WHERE tbl_name = 'intel_source' AND type IN ('index', 'trigger') AND sql IS NOT NULL ORDER BY type, name").all() as { sql: string }[]
    const create = row.sql.replace(/^CREATE TABLE\s+(?:IF NOT EXISTS\s+)?["`[]?intel_source["`\]]?/i, "CREATE TABLE intel_source_json_list_027").replace(constraint, expanded)
    if (!create.startsWith("CREATE TABLE intel_source_json_list_027")) throw new Error("Unexpected intel_source table definition")
    await db.exec(create)
    await db.exec("INSERT INTO intel_source_json_list_027 SELECT * FROM intel_source")
    await db.exec("DROP TABLE intel_source")
    await db.exec("ALTER TABLE intel_source_json_list_027 RENAME TO intel_source")
    for (const object of objects) await db.exec(object.sql)
  },
} as const
