import type { Database } from "db0"
import { applyFeedFreshnessPolicy } from "../../../shared/shipping-rules"
import type { FeedItem, SourceLineage } from "../../../shared/shipping"

const lineages = new Set<SourceLineage>(["real", "mock", "imported", "derived"])

interface FeedRow {
  id: string
  source_id: string
  category: string
  type: string
  title: string
  summary: string
  source_url: string
  published_at: string
  fetched_at: string
  severity: string
  related_port_ids: string
  related_vessel_ids: string
  related_voyage_ids: string
  source_type: string
  data: string
}

function parseObject(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value) as unknown
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {}
  } catch {
    return {}
  }
}

function parseIds(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : []
  } catch {
    return []
  }
}

function sourceLineage(value: string): SourceLineage {
  return lineages.has(value as SourceLineage) ? value as SourceLineage : "mock"
}

function feedItemFromRow(row: FeedRow, sourceType: SourceLineage): FeedItem {
  return {
    ...parseObject(row.data),
    id: row.id,
    sourceId: row.source_id,
    category: row.category as FeedItem["category"],
    type: row.type,
    title: row.title,
    summary: row.summary,
    sourceUrl: row.source_url,
    publishedAt: row.published_at,
    fetchedAt: row.fetched_at,
    severity: row.severity as FeedItem["severity"],
    relatedPortIds: parseIds(row.related_port_ids),
    relatedVesselIds: parseIds(row.related_vessel_ids),
    relatedVoyageIds: parseIds(row.related_voyage_ids),
    source_type: sourceType,
  } as FeedItem
}

export const p3FeedFreshnessReclassificationMigration = {
  version: 10,
  name: "p3-feed-freshness-reclassification",
  async up(db: Database, now = new Date()) {
    const rows = await db.prepare(`
      SELECT id, source_id, category, type, title, summary, source_url,
        published_at, fetched_at, severity, related_port_ids,
        related_vessel_ids, related_voyage_ids, source_type, data
      FROM feed_items
    `).all() as FeedRow[]

    for (const row of rows) {
      const sourceType = sourceLineage(row.source_type)
      const normalized = applyFeedFreshnessPolicy(feedItemFromRow(row, sourceType), now)
      const persisted = { ...normalized, source_type: sourceType }
      const data = JSON.stringify(persisted)
      const currentUntil = normalized.currentUntil ?? null
      const expiresAt = normalized.expiresAt ?? null
      const effectiveAt = normalized.effectiveAt ?? null
      const observedAt = row.fetched_at
      const historyId = `feed-history:${row.id}:${observedAt}`

      await db.prepare(`
        UPDATE feed_items SET
          effective_at = ?,
          expires_at = ?,
          current_until = ?,
          visibility = ?,
          source_type = ?,
          data = ?
        WHERE id = ?
      `).run(effectiveAt, expiresAt, currentUntil, normalized.visibility ?? "history", sourceType, data, row.id)

      await db.prepare(`
        INSERT INTO feed_item_history (
          id, feed_item_id, source_id, observed_at, effective_at, expires_at,
          current_until, visibility, source_type, data
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(feed_item_id, observed_at) DO UPDATE SET
          source_id = excluded.source_id,
          effective_at = excluded.effective_at,
          expires_at = excluded.expires_at,
          current_until = excluded.current_until,
          visibility = excluded.visibility,
          source_type = excluded.source_type,
          data = excluded.data
      `).run(historyId, row.id, row.source_id, observedAt, effectiveAt, expiresAt, currentUntil, normalized.visibility ?? "history", sourceType, data)
    }
  },
} as const
