import type { Database } from "db0"

export async function initShippingTables(db: Database) {
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS feed_items (
      id TEXT PRIMARY KEY, source_id TEXT NOT NULL, category TEXT NOT NULL,
      type TEXT NOT NULL, title TEXT NOT NULL, summary TEXT NOT NULL,
      source_url TEXT NOT NULL, published_at TEXT NOT NULL, fetched_at TEXT NOT NULL,
      severity TEXT NOT NULL, related_port_ids TEXT NOT NULL, related_vessel_ids TEXT NOT NULL,
      related_voyage_ids TEXT NOT NULL, data TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS vessels (
      id TEXT PRIMARY KEY, data TEXT NOT NULL, is_watched INTEGER NOT NULL DEFAULT 0,
      navigation_status TEXT NOT NULL, status_changed_at TEXT NOT NULL, last_updated_at TEXT
    );
    CREATE TABLE IF NOT EXISTS ports (
      id TEXT PRIMARY KEY, data TEXT NOT NULL, is_watched INTEGER NOT NULL DEFAULT 0,
      congestion_level TEXT NOT NULL, last_updated_at TEXT
    );
    CREATE TABLE IF NOT EXISTS voyages (
      id TEXT PRIMARY KEY, data TEXT NOT NULL, vessel_id TEXT NOT NULL,
      baseline_etd TEXT, baseline_eta TEXT, latest_etd TEXT, latest_eta TEXT, delay_minutes INTEGER
    );
    CREATE TABLE IF NOT EXISTS events (
      id TEXT PRIMARY KEY, data TEXT NOT NULL, type TEXT NOT NULL, severity TEXT NOT NULL,
      status TEXT NOT NULL, dedupe_key TEXT NOT NULL UNIQUE, first_detected_at TEXT NOT NULL,
      last_detected_at TEXT NOT NULL, resolved_at TEXT
    );
    CREATE TABLE IF NOT EXISTS settings (
      id TEXT PRIMARY KEY, data TEXT NOT NULL, updated_at TEXT NOT NULL
    );
  `).run()
}
