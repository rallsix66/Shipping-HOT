import type { Database } from "db0"

export interface ActualMockRows {
  tables: Record<string, number>
  total: number
}

interface SchemaTable {
  name: string
  columns: Set<string>
}

interface LineageRow {
  source_type?: unknown
  data?: unknown
}

const excludedTables = new Set([
  "schema_migrations",
  "app_metadata",
  "port_directory_status",
  "settings",
  "user",
  "vessel_watchlist",
  "port_watchlist",
  "translation_cache",
  "provider_usage",
  "provider_runtime",
  "sync_runs",
])

function validIdentifier(value: string): boolean {
  return /^[a-z_]\w*$/i.test(value)
}

function quoteIdentifier(value: string): string {
  if (!validIdentifier(value)) throw new Error("real_zero_mock_gate_invalid_identifier")
  return `"${value.replaceAll("\"", "\"\"")}"`
}

function parsedRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== "string") return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined
  try {
    const parsed = JSON.parse(value) as unknown
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : undefined
  } catch {
    return undefined
  }
}

function hasMockLineage(row: LineageRow): boolean {
  if (row.source_type === "mock") return true
  const record = parsedRecord(row.data)
  if (!record) return false
  if (record.source_type === "mock" || record.sourceType === "mock") return true
  const provenance = parsedRecord(record.provenance)
  if (provenance?.sourceType === "mock") return true
  const evidence = Array.isArray(record.evidence) ? record.evidence : []
  return evidence.some(item => parsedRecord(parsedRecord(item)?.provenance)?.sourceType === "mock")
}

async function discoverLineageTables(db: Database): Promise<SchemaTable[]> {
  const tableRows = await db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as Array<{ name?: unknown }>
  const tables: SchemaTable[] = []
  for (const tableRow of tableRows) {
    const name = typeof tableRow.name === "string" ? tableRow.name : undefined
    if (!name || excludedTables.has(name) || name.startsWith("sqlite_") || !validIdentifier(name)) continue
    const columnRows = await db.prepare(`PRAGMA table_info(${quoteIdentifier(name)})`).all() as Array<{ name?: unknown }>
    const columns = new Set(columnRows.flatMap(column => typeof column.name === "string" ? [column.name] : []))
    if (columns.has("source_type")) tables.push({ name, columns })
  }
  return tables
}

export async function scanRealOperationalMockRows(db: Database): Promise<ActualMockRows> {
  const tables: Record<string, number> = {}
  for (const table of await discoverLineageTables(db)) {
    const dataColumn = table.columns.has("data")
    const rows = await db.prepare(`SELECT ${quoteIdentifier("source_type")} AS source_type${dataColumn ? `, ${quoteIdentifier("data")} AS data` : ""} FROM ${quoteIdentifier(table.name)}`).all() as LineageRow[]
    tables[table.name] = rows.filter(hasMockLineage).length
  }
  return { tables, total: Object.values(tables).reduce((sum, count) => sum + count, 0) }
}

export function assertZeroRealOperationalMockRows(rows: ActualMockRows): void {
  if (rows.total > 0) throw new Error(`real_zero_mock_gate_failed: ${JSON.stringify(rows)}`)
}
