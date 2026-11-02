import type { Database } from "db0"

/**
 * R3 §4.9 labeling set: enroll approved intel item+version samples and record
 * AI prelabels vs human confirm/correct decisions. Additive only.
 *
 * Stores URL + license-safe excerpt + labels — never restricted full text.
 * Browse/save paths must not call model providers (see IntelLabelRepository).
 */
export const intelLabelMigration = {
  version: 34,
  name: "intel-label",
  async up(db: Database) {
    await db.exec(`
      CREATE TABLE IF NOT EXISTS intel_label_item (
        id TEXT PRIMARY KEY,
        item_id TEXT NOT NULL,
        version_id TEXT NOT NULL,
        content_hash TEXT NOT NULL,
        source_url TEXT NOT NULL,
        excerpt TEXT NULL,
        category TEXT NOT NULL DEFAULT 'unknown'
          CHECK (category IN (
            'policy', 'weather', 'port', 'lastmile', 'other', 'unknown'
          )),
        language TEXT NULL,
        queue_status TEXT NOT NULL DEFAULT 'unreviewed'
          CHECK (queue_status IN (
            'unreviewed', 'ai_prelabeled', 'human_confirmed'
          )),
        title TEXT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(item_id, version_id)
      )
    `)
    await db.exec(`
      CREATE TABLE IF NOT EXISTS intel_label_decision (
        id TEXT PRIMARY KEY,
        label_item_id TEXT NOT NULL,
        item_id TEXT NOT NULL,
        version_id TEXT NOT NULL,
        content_hash TEXT NOT NULL,
        kind TEXT NOT NULL CHECK (kind IN (
          'ai_prelabel', 'human_confirm', 'human_correct'
        )),
        operator TEXT NOT NULL,
        is_human INTEGER NOT NULL CHECK (is_human IN (0, 1)),
        decision_json TEXT NOT NULL,
        analysis_ids_json TEXT NULL,
        prompt_hash TEXT NULL,
        model_id TEXT NULL,
        model_name TEXT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (label_item_id) REFERENCES intel_label_item(id)
      )
    `)
    await db.exec("CREATE INDEX IF NOT EXISTS idx_intel_label_item_queue ON intel_label_item(queue_status, updated_at)")
    await db.exec("CREATE INDEX IF NOT EXISTS idx_intel_label_item_cat_lang ON intel_label_item(category, language)")
    await db.exec("CREATE INDEX IF NOT EXISTS idx_intel_label_decision_item ON intel_label_decision(label_item_id, created_at)")
  },
} as const
