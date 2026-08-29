import type { Database } from "db0"

export interface ActualMockRows {
  vessels: number
  ports: number
  voyages: number
  feedItems: number
  events: number
  calendarEvents: number
  aisPositions: number
  aisLatestPositions: number
  total: number
}

interface LineageRow {
  source_type?: unknown
  data?: unknown
}

const tableLabels = [
  ["vessels", "vessels", true],
  ["ports", "ports", true],
  ["voyages", "voyages", true],
  ["feed_items", "feedItems", true],
  ["events", "events", true],
  ["calendar_events", "calendarEvents", true],
  ["ais_positions", "aisPositions", false],
  ["ais_latest_positions", "aisLatestPositions", false],
] as const

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
  return evidence.some(item => parsedRecord(item)?.provenance && parsedRecord(parsedRecord(item)?.provenance)?.sourceType === "mock")
}

export async function scanRealOperationalMockRows(db: Database): Promise<ActualMockRows> {
  const counts = {} as Record<ActualMockRowsKey, number>
  for (const [table, label, hasData] of tableLabels) {
    const rows = await db.prepare(`SELECT source_type${hasData ? ", data" : ""} FROM ${table}`).all() as LineageRow[]
    counts[label] = rows.filter(hasMockLineage).length
  }
  return {
    vessels: counts.vessels,
    ports: counts.ports,
    voyages: counts.voyages,
    feedItems: counts.feedItems,
    events: counts.events,
    calendarEvents: counts.calendarEvents,
    aisPositions: counts.aisPositions,
    aisLatestPositions: counts.aisLatestPositions,
    total: Object.values(counts).reduce((sum, count) => sum + count, 0),
  }
}

type ActualMockRowsKey = Exclude<keyof ActualMockRows, "total">

export function assertZeroRealOperationalMockRows(rows: ActualMockRows): void {
  if (rows.total > 0) throw new Error(`real_zero_mock_gate_failed: ${JSON.stringify(rows)}`)
}
