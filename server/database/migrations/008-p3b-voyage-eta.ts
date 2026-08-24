import type { Database } from "db0"

interface Row {
  id: string
  data?: string
  source_type?: string
}

interface StoredVoyage {
  imo?: string
  mmsi?: string
  originPortId?: string
  destinationPortId?: string
  voyageNumber?: string
  status?: string
  eta?: string
  etd?: string
  latestEta?: string
  latestEtd?: string
  source?: string
  updatedAt?: string
  lastUpdatedAt?: string
  createdAt?: string
}

async function hasColumn(db: Database, column: string): Promise<boolean> {
  const rows = await db.prepare("PRAGMA table_info(voyages)").all() as Array<{ name?: string }>
  return rows.some(row => row.name === column)
}

function parse(value: unknown): StoredVoyage {
  if (typeof value !== "string") return {}
  try {
    const parsed = JSON.parse(value) as unknown
    return parsed && typeof parsed === "object" ? parsed as StoredVoyage : {}
  } catch {
    return {}
  }
}

export const p3bVoyageEtaMigration = {
  version: 8,
  name: "p3b-voyage-eta-foundation",
  async up(db: Database) {
    for (const column of [
      "imo",
      "mmsi",
      "origin_port_id",
      "destination_port_id",
      "voyage_number",
      "status",
      "eta",
      "etd",
      "source",
      "last_updated_at",
      "created_at",
    ]) {
      if (!(await hasColumn(db, column))) await db.exec(`ALTER TABLE voyages ADD COLUMN ${column} TEXT`)
    }

    await db.exec(`
      CREATE INDEX IF NOT EXISTS idx_voyages_vessel_updated
        ON voyages(vessel_id, last_updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_voyages_status_updated
        ON voyages(status, last_updated_at DESC);

      CREATE TABLE IF NOT EXISTS voyage_eta_history (
        id TEXT PRIMARY KEY,
        voyage_id TEXT NOT NULL,
        vessel_id TEXT NOT NULL,
        eta TEXT,
        etd TEXT,
        source TEXT NOT NULL,
        source_type TEXT NOT NULL CHECK (source_type IN ('real', 'mock', 'imported', 'derived')),
        observed_at TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_voyage_eta_history_voyage_observed
        ON voyage_eta_history(voyage_id, observed_at DESC);
      CREATE INDEX IF NOT EXISTS idx_voyage_eta_history_vessel_observed
        ON voyage_eta_history(vessel_id, observed_at DESC);
    `)

    const rows = await db.prepare("SELECT id, data, source_type FROM voyages").all() as Row[]
    for (const row of rows) {
      const record = parse(row.data)
      await db.prepare(`
        UPDATE voyages SET
          imo = COALESCE(imo, ?),
          mmsi = COALESCE(mmsi, ?),
          origin_port_id = COALESCE(origin_port_id, ?),
          destination_port_id = COALESCE(destination_port_id, ?),
          voyage_number = COALESCE(voyage_number, ?),
          status = COALESCE(status, ?),
          eta = COALESCE(eta, ?),
          etd = COALESCE(etd, ?),
          source = COALESCE(source, ?),
          last_updated_at = COALESCE(last_updated_at, ?),
          created_at = COALESCE(created_at, ?)
        WHERE id = ?
      `).run(
        record.imo ?? null,
        record.mmsi ?? null,
        record.originPortId ?? null,
        record.destinationPortId ?? null,
        record.voyageNumber ?? null,
        record.status ?? null,
        record.eta ?? record.latestEta ?? null,
        record.etd ?? record.latestEtd ?? null,
        record.source ?? (row.source_type === "mock" ? "mock-schedule" : "legacy-voyage"),
        record.lastUpdatedAt ?? record.updatedAt ?? null,
        record.createdAt ?? record.updatedAt ?? null,
        row.id,
      )
    }
  },
} as const
