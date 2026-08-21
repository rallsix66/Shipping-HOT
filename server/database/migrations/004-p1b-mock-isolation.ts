import type { Database } from "db0"
import type { SourceLineage } from "../../../shared/shipping"

const lineages = new Set<SourceLineage>(["real", "mock", "imported", "derived"])

interface StoredRecord {
  source_type?: unknown
  sourceId?: unknown
  source_id?: unknown
  provenance?: { sourceType?: unknown }
  evidence?: Array<{ provenance?: { sourceType?: unknown } }>
}

interface StoredRow {
  id?: unknown
  port_id?: unknown
  data: unknown
}

interface TableDefinition {
  name: "vessels" | "ports" | "voyages" | "feed_items" | "events" | "calendar_events" | "ais_port_metrics"
  key: "id" | "port_id"
  derived: boolean
}

const tables: TableDefinition[] = [
  { name: "vessels", key: "id", derived: false },
  { name: "ports", key: "id", derived: false },
  { name: "voyages", key: "id", derived: false },
  { name: "feed_items", key: "id", derived: false },
  { name: "events", key: "id", derived: true },
  { name: "calendar_events", key: "id", derived: false },
  { name: "ais_port_metrics", key: "port_id", derived: true },
]

interface TableInfoRow {
  name?: string
}

async function hasColumn(db: Database, table: string, column: string) {
  const rows = await db.prepare(`PRAGMA table_info(${table})`).all() as TableInfoRow[]
  return rows.some(row => row.name === column)
}

function lineageForRecord(value: unknown, derived: boolean): SourceLineage {
  const parsed = (() => {
    if (typeof value !== "string") return value
    try {
      return JSON.parse(value) as unknown
    } catch {
      return undefined
    }
  })()
  const record = parsed && typeof parsed === "object" ? parsed as StoredRecord : {}
  if (typeof record.source_type === "string" && lineages.has(record.source_type as SourceLineage)) return record.source_type as SourceLineage
  const sourceId = typeof record.sourceId === "string" ? record.sourceId : typeof record.source_id === "string" ? record.source_id : ""
  const provenanceIsMock = record.provenance?.sourceType === "mock"
  const evidenceIsMock = record.evidence?.some(item => item.provenance?.sourceType === "mock") ?? false
  if (provenanceIsMock || evidenceIsMock || sourceId.startsWith("mock-")) return "mock"
  if (derived && (record.provenance || record.evidence)) return "derived"
  if (!derived && record.provenance) return "real"
  return "mock"
}

export const p1bMockIsolationMigration = {
  version: 4,
  name: "p1b-mock-isolation-lineage",
  async up(db: Database) {
    for (const table of tables) {
      if (!(await hasColumn(db, table.name, "source_type"))) {
        await db.exec(`ALTER TABLE ${table.name} ADD COLUMN source_type TEXT NOT NULL DEFAULT 'mock'`)
      }

      const rows = await db.prepare(`SELECT ${table.key}, data FROM ${table.name}`).all() as StoredRow[]
      for (const row of rows) {
        const key = row[table.key]
        if (key === undefined || key === null) continue
        const source_type = lineageForRecord(row.data, table.derived)
        const parsed = (() => {
          if (typeof row.data !== "string") return row.data
          try {
            return JSON.parse(row.data) as unknown
          } catch {
            return undefined
          }
        })()
        const record = parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : {}
        await db.prepare(`UPDATE ${table.name} SET source_type = ?, data = ? WHERE ${table.key} = ?`)
          .run(source_type, JSON.stringify({ ...record, source_type }), String(key))
      }
    }
  },
} as const
