import type { Database } from "db0"
import { manualCatalog } from "#/intel/manual-catalog"
import { intelSourceSeeds } from "#/intel/sources.ts"

/** Approved R2-7 addition. Old rows and their provenance remain untouched. */
export const intelManualMigration = {
  version: 28,
  name: "intel-manual",
  rebuildWithForeignKeysDisabled: true,
  async up(db: Database) {
    const row = await db.prepare("SELECT sql FROM sqlite_master WHERE name = 'intel_source'").get() as { sql: string }
    const constraint = "CHECK (kind IN ('rss', 'atom', 'rdf', 'web_list', 'json_list'))"
    if (!row.sql.includes(constraint)) throw new Error("Unexpected intel_source constraint")
    const objects = await db.prepare("SELECT sql FROM sqlite_master WHERE tbl_name = 'intel_source' AND type IN ('index', 'trigger') AND sql IS NOT NULL").all() as { sql: string }[]
    await db.exec(row.sql.replace(/^CREATE TABLE\s+(?:IF NOT EXISTS\s+)?["`[]?intel_source["`\]]?/i, "CREATE TABLE intel_source_manual_028").replace(constraint, "CHECK (kind IN ('rss', 'atom', 'rdf', 'web_list', 'json_list', 'manual'))"))
    await db.exec("INSERT INTO intel_source_manual_028 SELECT * FROM intel_source")
    await db.exec("DROP TABLE intel_source")
    await db.exec("ALTER TABLE intel_source_manual_028 RENAME TO intel_source")
    for (const object of objects) await db.exec(object.sql)
    await db.exec(`CREATE TABLE intel_manual_action (
      request_id TEXT PRIMARY KEY, payload_hash TEXT NOT NULL, source_id TEXT NOT NULL,
      action TEXT NOT NULL CHECK(action IN ('submit', 'checked_empty')),
      operator TEXT NOT NULL, entered_at TEXT NOT NULL, item_id TEXT NULL, version_id TEXT NULL,
      outcome TEXT NOT NULL
    )`)
    await db.exec("CREATE INDEX idx_intel_manual_action_source ON intel_manual_action(source_id, entered_at)")
    for (const source of manualCatalog) {
      await db.prepare("INSERT INTO intel_source (id, catalog_id, name, kind, url, persistence, enabled, updated_at) VALUES (?, ?, ?, 'manual', ?, 'disallowed', 0, ?)").run(source.id, source.catalogId, source.name, source.urls[0] ?? "", "2026-10-14T04:15:00.000Z")
    }
    // Reuse already-approved licensed sources for optional manual supplements;
    // never activate collection or overwrite an existing source's policy/health.
    for (const source of intelSourceSeeds) {
      await db.prepare("INSERT INTO intel_source (id, catalog_id, name, kind, url, persistence, enabled, updated_at) VALUES (?, ?, ?, ?, ?, ?, 0, ?) ON CONFLICT(id) DO NOTHING").run(source.id, source.catalogId, source.name, source.kind, source.url, source.persistence, "2026-10-14T04:15:00.000Z")
    }
  },
} as const
