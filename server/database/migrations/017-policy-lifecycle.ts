import type { Database } from "db0"

/**
 * R1.5-7 policy lifecycle on the existing policy_record / policy_version tables (015 is executed; not edited).
 * Adds source type, full text / excerpt / basis, fixture flag, explicit supersede/repeal relations,
 * a per-version full snapshot (old basis is never erased) and an append-only change log.
 */
const recordColumns: [string, string][] = [
  ["source_type", "TEXT NOT NULL DEFAULT 'unspecified'"],
  ["body_excerpt", "TEXT NULL"],
  ["full_text", "TEXT NULL"],
  ["basis_text", "TEXT NULL"],
  ["stage", "TEXT NULL"],
  ["is_fixture", "INTEGER NOT NULL DEFAULT 0"],
  ["supersedes_policy_id", "TEXT NULL"],
  ["superseded_by_policy_id", "TEXT NULL"],
  ["relation_kind", "TEXT NULL"],
]
const versionColumns: [string, string][] = [
  ["snapshot_json", "TEXT NULL"],
  ["entered_by", "TEXT NULL"],
]

async function addColumns(db: Database, table: string, columns: [string, string][]) {
  const existing = new Set(((await db.prepare(`PRAGMA table_info(${table})`).all()) as { name: string }[]).map(c => c.name))
  for (const [name, type] of columns) {
    if (!existing.has(name)) await db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${type}`)
  }
}

export const policyLifecycleMigration = {
  version: 17,
  name: "policy-lifecycle",
  async up(db: Database) {
    await addColumns(db, "policy_record", recordColumns)
    await addColumns(db, "policy_version", versionColumns)
    await db.exec(`
      CREATE TABLE IF NOT EXISTS policy_change_log (
        id TEXT PRIMARY KEY,
        policy_id TEXT NOT NULL,
        version_id TEXT NULL,
        action TEXT NOT NULL,
        actor TEXT NOT NULL,
        summary TEXT NOT NULL,
        created_at TEXT NOT NULL
      )
    `)
    await db.exec("CREATE INDEX IF NOT EXISTS idx_policy_change_log_policy ON policy_change_log(policy_id, created_at)")
    await db.exec("CREATE INDEX IF NOT EXISTS idx_policy_record_effective ON policy_record(effective_at)")
  },
}
