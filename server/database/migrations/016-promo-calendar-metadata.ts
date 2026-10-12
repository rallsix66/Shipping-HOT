import type { Database } from "db0"

/**
 * R1.5-5: promo calendar metadata on the existing ops_calendar_event table (migration 015 is executed; not edited).
 * Legacy rows get platform 'unspecified' (shown 未指定) and entry_kind 'legacy'.
 */
const columns: [string, string][] = [
  ["platform", "TEXT NOT NULL DEFAULT 'unspecified'"],
  ["entry_kind", "TEXT NOT NULL DEFAULT 'legacy'"],
  ["window_status", "TEXT NOT NULL DEFAULT 'determined'"],
  ["generation_basis", "TEXT NULL"],
  ["rule_year", "INTEGER NULL"],
  ["occurrence", "TEXT NULL"],
  ["confirmation_source_id", "TEXT NULL"],
  ["confirmation_evidence_ref", "TEXT NULL"],
  ["confirmation_note", "TEXT NULL"],
  ["confirmed_at", "TEXT NULL"],
  ["manual_edited_at", "TEXT NULL"],
]

export const promoCalendarMetadataMigration = {
  version: 16,
  name: "promo-calendar-metadata",
  async up(db: Database) {
    const existing = new Set(((await db.prepare("PRAGMA table_info(ops_calendar_event)").all()) as { name: string }[]).map(c => c.name))
    for (const [name, type] of columns) {
      if (!existing.has(name)) await db.exec(`ALTER TABLE ops_calendar_event ADD COLUMN ${name} ${type}`)
    }
    await db.exec("CREATE INDEX IF NOT EXISTS idx_ops_calendar_range ON ops_calendar_event(starts_at, ends_at)")
  },
}
