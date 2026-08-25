import process from "node:process"
import type { Database } from "db0"
import { hasMockEvidence, knownMockProvenanceFor, normalizeLegacyEventTrust, normalizeLegacyTrust, recordAllowedForDataMode } from "@shared/shipping"
import type { AisDerivedPortMetric } from "@shared/ais-area"
import type { DataEvidence, DataProvenance, FeedItem, Freshness, Port, ProvenanceAware, ShippingEvent, ShippingSettings, SourceLineage, Vessel, Voyage } from "@shared/shipping"
import type { CalendarEvent } from "@shared/calendar"
import { applyFeedFreshnessPolicy } from "@shared/shipping-rules"
import { type DatabaseMetadata, type ShippingDataMode, initializeShippingDatabase } from "#/database/runtime"

type Row = Record<string, unknown>

interface LegacyTrustDefaults {
  vessel?: DataProvenance
  port?: DataProvenance
  voyage?: DataProvenance
}

interface LegacyEventSources {
  vessels?: Vessel[]
  ports?: Port[]
  voyages?: Voyage[]
  feedItems?: FeedItem[]
}

export interface FeedHistoryQuery {
  query?: string
  sourceId?: string
  limit?: number
  now?: Date
}

export interface FeedHistoryRecord {
  id: string
  feedItemId: string
  observedAt: string
  item: FeedItem
}

function rows<T>(value: unknown): T[] {
  if (Array.isArray(value)) return value as T[]
  if (value && typeof value === "object" && Array.isArray((value as { results?: unknown[] }).results)) return (value as { results: T[] }).results
  return []
}

function parse<T>(value: unknown): T {
  return JSON.parse(String(value)) as T
}

async function transaction<T>(db: Database, work: () => Promise<T>): Promise<T> {
  await db.prepare("BEGIN").run()
  try {
    const result = await work()
    await db.prepare("COMMIT").run()
    return result
  } catch (error) {
    try {
      await db.prepare("ROLLBACK").run()
    } catch {
      // Preserve the original persistence error.
    }
    throw error
  }
}

export async function initShippingTables(db: Database, dataMode: ShippingDataMode = process.env.SHIPPING_DATA_MODE === "real" ? "real" : "mock"): Promise<DatabaseMetadata> {
  return initializeShippingDatabase(db, dataMode)
}

export class ShippingRepository {
  constructor(private readonly db: Database, private readonly dataMode: ShippingDataMode = process.env.SHIPPING_DATA_MODE === "real" ? "real" : "mock") {}

  private sourceWhere() {
    return this.dataMode === "real" ? " WHERE source_type IN ('real', 'imported', 'derived')" : ""
  }

  private lineage<T extends ProvenanceAware & { evidence?: DataEvidence[] }>(record: T, fallback: SourceLineage): SourceLineage {
    if (record.source_type) return record.source_type
    return hasMockEvidence(record) ? "mock" : fallback
  }

  private prepareRecord<T extends ProvenanceAware & { evidence?: DataEvidence[] }>(record: T, fallback: SourceLineage): T & { source_type: SourceLineage } {
    const source_type = this.lineage(record, fallback)
    if (this.dataMode === "real" && !recordAllowedForDataMode({ ...record, source_type }, this.dataMode)) {
      throw new Error("mock_record_not_allowed_in_real_mode")
    }
    return { ...record, source_type }
  }

  private async listWatchIds(kind: "vessel" | "port") {
    const table = kind === "vessel" ? "vessel_watchlist" : "port_watchlist"
    const key = kind === "vessel" ? "vessel_id" : "port_id"
    const values = rows<Row>(await this.db.prepare(`SELECT ${key} FROM ${table}`).all())
    return new Set(values.map(row => String(row[key])))
  }

  private async insertVessel(vessel: Vessel, conflict: "update" | "ignore") {
    const record = this.prepareRecord(vessel, "real")
    const data = JSON.stringify({ ...record, isWatched: false })
    const conflictClause = conflict === "ignore"
      ? "ON CONFLICT(id) DO NOTHING"
      : `ON CONFLICT(id) DO UPDATE SET
          data = excluded.data,
          source_type = excluded.source_type,
          navigation_status = excluded.navigation_status,
          status_changed_at = excluded.status_changed_at,
          last_updated_at = excluded.last_updated_at`
    await this.db.prepare(`
      INSERT INTO vessels (id, data, source_type, navigation_status, status_changed_at, last_updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ${conflictClause}
    `).run(vessel.id, data, record.source_type, vessel.navigationStatus, vessel.statusChangedAt ?? null, vessel.updatedAt ?? null)
  }

  private async insertPort(port: Port, conflict: "update" | "ignore") {
    const record = this.prepareRecord(port, "real")
    const data = JSON.stringify({ ...record, isWatched: false })
    const conflictClause = conflict === "ignore"
      ? "ON CONFLICT(id) DO NOTHING"
      : `ON CONFLICT(id) DO UPDATE SET
          data = excluded.data,
          source_type = excluded.source_type,
          congestion_level = excluded.congestion_level,
          last_updated_at = excluded.last_updated_at`
    await this.db.prepare(`
      INSERT INTO ports (id, data, source_type, congestion_level, last_updated_at)
      VALUES (?, ?, ?, ?, ?)
      ${conflictClause}
    `).run(port.id, data, record.source_type, port.congestionLevel ?? null, port.updatedAt ?? null)
  }

  private async insertVoyage(voyage: Voyage, conflict: "update" | "ignore") {
    const record = this.prepareRecord(voyage, "real")
    const conflictClause = conflict === "ignore"
      ? "ON CONFLICT(id) DO NOTHING"
      : `ON CONFLICT(id) DO UPDATE SET
          data = excluded.data,
          source_type = excluded.source_type,
          vessel_id = excluded.vessel_id,
          baseline_etd = excluded.baseline_etd,
          baseline_eta = excluded.baseline_eta,
          latest_etd = excluded.latest_etd,
          latest_eta = excluded.latest_eta,
          delay_minutes = excluded.delay_minutes`
    await this.db.prepare(`
      INSERT INTO voyages (id, data, source_type, vessel_id, baseline_etd, baseline_eta, latest_etd, latest_eta, delay_minutes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ${conflictClause}
    `).run(voyage.id, JSON.stringify(record), record.source_type, voyage.vesselId, voyage.baselineEtd ?? null, voyage.baselineEta ?? null, voyage.latestEtd ?? null, voyage.latestEta ?? null, voyage.delayMinutes ?? null)
  }

  private async insertFeedHistory(item: FeedItem, sourceType: SourceLineage, observedAt: string) {
    const historyId = `feed-history:${item.id}:${observedAt}`
    await this.db.prepare(`
      INSERT OR IGNORE INTO feed_item_history (id, feed_item_id, source_id, observed_at, effective_at, expires_at, current_until, visibility, source_type, data)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(historyId, item.id, item.sourceId, observedAt, item.effectiveAt ?? null, item.expiresAt ?? null, item.currentUntil ?? null, item.visibility ?? "history", sourceType, JSON.stringify(item))
  }

  private async insertFeedItem(item: FeedItem, conflict: "update" | "ignore", normalizedOverride?: FeedItem) {
    const fetchedAt = item.fetchedAt || item.updatedAt || item.publishedAt || new Date().toISOString()
    const normalized = normalizedOverride ?? applyFeedFreshnessPolicy({ ...item, fetchedAt }, new Date(fetchedAt))
    const record = this.prepareRecord(normalized, "real")
    const conflictClause = conflict === "ignore"
      ? "ON CONFLICT(id) DO NOTHING"
      : `ON CONFLICT(id) DO UPDATE SET
          source_id = excluded.source_id,
          source_type = excluded.source_type,
          category = excluded.category,
          type = excluded.type,
          title = excluded.title,
          summary = excluded.summary,
          source_url = excluded.source_url,
          published_at = excluded.published_at,
          fetched_at = excluded.fetched_at,
          effective_at = excluded.effective_at,
          expires_at = excluded.expires_at,
          current_until = excluded.current_until,
          visibility = excluded.visibility,
          severity = excluded.severity,
          related_port_ids = excluded.related_port_ids,
          related_vessel_ids = excluded.related_vessel_ids,
          related_voyage_ids = excluded.related_voyage_ids,
          data = excluded.data`
    await this.db.prepare(`
      INSERT INTO feed_items (id, source_id, category, type, title, summary, source_url, published_at, fetched_at, effective_at, expires_at, current_until, visibility, severity, related_port_ids, related_vessel_ids, related_voyage_ids, source_type, data)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ${conflictClause}
    `).run(normalized.id, normalized.sourceId, normalized.category, normalized.type, normalized.title, normalized.summary, normalized.sourceUrl, normalized.publishedAt, fetchedAt, normalized.effectiveAt ?? null, normalized.expiresAt ?? null, normalized.currentUntil ?? null, normalized.visibility ?? "history", normalized.severity, JSON.stringify(normalized.relatedPortIds), JSON.stringify(normalized.relatedVesselIds), JSON.stringify(normalized.relatedVoyageIds), record.source_type, JSON.stringify({ ...record, fetchedAt }))
    await this.insertFeedHistory({ ...normalized, ...record, fetchedAt }, record.source_type, fetchedAt)
  }

  private async insertEvent(event: ShippingEvent, conflict: "update" | "ignore") {
    const record = this.prepareRecord(event, "derived")
    const conflictClause = conflict === "ignore"
      ? "ON CONFLICT(id) DO NOTHING"
      : `ON CONFLICT(id) DO UPDATE SET
          data = excluded.data,
          source_type = excluded.source_type,
          type = excluded.type,
          severity = excluded.severity,
          status = excluded.status,
          dedupe_key = excluded.dedupe_key,
          first_detected_at = excluded.first_detected_at,
          last_detected_at = excluded.last_detected_at,
          resolved_at = excluded.resolved_at`
    await this.db.prepare(`
      INSERT INTO events (id, data, source_type, type, severity, status, dedupe_key, first_detected_at, last_detected_at, resolved_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ${conflictClause}
    `).run(event.id, JSON.stringify(record), record.source_type, event.type, event.severity, event.status, event.dedupeKey, event.firstDetectedAt, event.lastDetectedAt, event.resolvedAt ?? null)
  }

  private async insertCalendarEvent(event: CalendarEvent, conflict: "update" | "ignore") {
    const record = this.prepareRecord(event, "real")
    const conflictClause = conflict === "ignore"
      ? "ON CONFLICT(id) DO NOTHING"
      : `ON CONFLICT(id) DO UPDATE SET
          country_code = excluded.country_code,
          source_type = excluded.source_type,
          subdivision_code = excluded.subdivision_code,
          date = excluded.date,
          end_date = excluded.end_date,
          type = excluded.type,
          is_public_holiday = excluded.is_public_holiday,
          business_impact = excluded.business_impact,
          source_id = excluded.source_id,
          source_url = excluded.source_url,
          verified = excluded.verified,
          last_checked_at = excluded.last_checked_at,
          updated_at = excluded.updated_at,
          stale = excluded.stale,
          data = excluded.data`
    await this.db.prepare(`
      INSERT INTO calendar_events (id, country_code, subdivision_code, date, end_date, type, is_public_holiday, business_impact, source_id, source_url, verified, last_checked_at, updated_at, stale, source_type, data)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ${conflictClause}
    `).run(event.id, event.countryCode, event.subdivisionCode ?? null, event.date, event.endDate ?? null, event.type, event.isPublicHoliday ? 1 : 0, event.businessImpact, event.sourceId, event.sourceUrl ?? null, event.verified ? 1 : 0, event.lastCheckedAt, event.updatedAt ?? null, event.stale ? 1 : 0, record.source_type, JSON.stringify(record))
  }

  async seed(vessels: Vessel[], ports: Port[], voyages: Voyage[], feedItems: FeedItem[], events: ShippingEvent[], settings: ShippingSettings, calendarEvents: CalendarEvent[] = [], aisPortMetrics: AisDerivedPortMetric[] = []) {
    const allow = <T extends ProvenanceAware & { evidence?: DataEvidence[] }>(items: T[]) => items.filter(item => recordAllowedForDataMode(item, this.dataMode))
    await transaction(this.db, async () => {
      for (const vessel of allow(vessels)) await this.insertVessel(vessel, "ignore")
      for (const port of allow(ports)) await this.insertPort(port, "ignore")
      for (const voyage of allow(voyages)) await this.insertVoyage(voyage, "ignore")
      for (const feedItem of allow(feedItems)) await this.insertFeedItem(feedItem, "ignore")
      for (const event of allow(events)) await this.insertEvent(event, "ignore")
      for (const event of allow(calendarEvents)) await this.insertCalendarEvent(event, "ignore")
      for (const metric of allow(aisPortMetrics)) await this.insertAisPortMetric(metric, "ignore")
      await this.insertSettingsIfMissing(settings)
    })
  }

  async listVessels(defaults: LegacyTrustDefaults = {}) {
    const watched = await this.listWatchIds("vessel")
    return rows<Row>(await this.db.prepare(`SELECT data FROM vessels${this.sourceWhere()} ORDER BY id`).all()).map((row) => {
      const vessel = parse<Vessel>(row.data)
      return normalizeLegacyTrust({ ...vessel, isWatched: watched.has(vessel.id) }, defaults.vessel)
    }).filter(vessel => recordAllowedForDataMode(vessel, this.dataMode))
  }

  async listPorts(defaults: LegacyTrustDefaults = {}) {
    const watched = await this.listWatchIds("port")
    return rows<Row>(await this.db.prepare(`SELECT data FROM ports${this.sourceWhere()} ORDER BY id`).all()).map((row) => {
      const port = parse<Port>(row.data)
      return normalizeLegacyTrust({ ...port, isWatched: watched.has(port.id) }, defaults.port)
    }).filter(port => recordAllowedForDataMode(port, this.dataMode))
  }

  async listVoyages(defaults: LegacyTrustDefaults = {}) {
    return rows<Row>(await this.db.prepare(`SELECT data FROM voyages${this.sourceWhere()} ORDER BY id`).all()).map(row => normalizeLegacyTrust(parse<Voyage>(row.data), defaults.voyage)).filter(voyage => recordAllowedForDataMode(voyage, this.dataMode))
  }

  async listFeedItems(options: { now?: Date, view?: "current" | "history" } = {}) {
    const now = options.now ?? new Date()
    const view = options.view ?? "current"
    const clauses = [this.dataMode === "real" ? "source_type IN ('real', 'imported', 'derived')" : "1 = 1"]
    const params: (string | number)[] = []
    if (view === "current") {
      clauses.push("visibility = 'current'", "current_until > ?")
      params.push(now.toISOString())
    } else {
      clauses.push("visibility <> 'current'")
    }
    const records = rows<Row>(await this.db.prepare(`SELECT data FROM feed_items WHERE ${clauses.join(" AND ")} ORDER BY published_at DESC`).all(...params)).map((row) => {
      const item = parse<FeedItem>(row.data)
      return normalizeLegacyTrust(applyFeedFreshnessPolicy(item, now), knownMockProvenanceFor(item.sourceId))
    }).filter(item => recordAllowedForDataMode(item, this.dataMode))
    return records
  }

  async listFeedHistory(options: FeedHistoryQuery = {}): Promise<FeedHistoryRecord[]> {
    const limit = Math.max(1, Math.min(Math.floor(options.limit ?? 100), 500))
    const clauses = [this.dataMode === "real" ? "source_type IN ('real', 'imported', 'derived')" : "1 = 1"]
    const params: (string | number)[] = []
    const query = options.query?.trim().toLocaleLowerCase()
    if (options.sourceId) {
      clauses.push("source_id = ?")
      params.push(options.sourceId)
    }
    const rowsValue = rows<Row>(await this.db.prepare(`SELECT id, feed_item_id, observed_at, data FROM feed_item_history WHERE ${clauses.join(" AND ")} ORDER BY observed_at DESC`).all(...params))
    return rowsValue.map((row) => {
      const item = parse<FeedItem>(row.data)
      return {
        id: String(row.id),
        feedItemId: String(row.feed_item_id),
        observedAt: String(row.observed_at),
        item: normalizeLegacyTrust(item, knownMockProvenanceFor(item.sourceId)),
      }
    }).filter(record => !query || [record.item.title, record.item.summary, record.item.sourceUrl, record.item.sourceId].some(value => value.toLocaleLowerCase().includes(query))).slice(0, limit)
  }

  async listEvents(sources: LegacyEventSources = {}) {
    const findSource = (event: ShippingEvent): (Freshness & ProvenanceAware) | undefined => {
      if (event.feedItemId) return sources.feedItems?.find(item => item.id === event.feedItemId)
      if (event.vesselId) return sources.vessels?.find(item => item.id === event.vesselId)
      if (event.portId) return sources.ports?.find(item => item.id === event.portId)
      if (event.voyageId) return sources.voyages?.find(item => item.id === event.voyageId)
      return undefined
    }
    return rows<Row>(await this.db.prepare(`SELECT data FROM events${this.sourceWhere()} ORDER BY last_detected_at DESC`).all()).map((row) => {
      const event = parse<ShippingEvent>(row.data)
      return normalizeLegacyEventTrust(event, findSource(event))
    }).filter(event => recordAllowedForDataMode(event, this.dataMode))
  }

  async listCalendarEvents() {
    return rows<Row>(await this.db.prepare(`SELECT data FROM calendar_events${this.sourceWhere()} ORDER BY date, country_code, id`).all()).map(row => parse<CalendarEvent>(row.data)).filter(event => recordAllowedForDataMode(event, this.dataMode))
  }

  async getSettings(): Promise<ShippingSettings | undefined> {
    const row = await this.db.prepare("SELECT data FROM settings WHERE id = 'default'").get() as Row | undefined
    return row ? parse<ShippingSettings>(row.data) : undefined
  }

  async upsertVessel(vessel: Vessel) {
    await this.insertVessel(vessel, "update")
  }

  async listAisPortMetrics() {
    return rows<Row>(await this.db.prepare(`SELECT data FROM ais_port_metrics${this.sourceWhere()} ORDER BY port_id`).all()).map(row => parse<AisDerivedPortMetric>(row.data)).filter(metric => recordAllowedForDataMode(metric, this.dataMode))
  }

  async upsertPort(port: Port) {
    await this.insertPort(port, "update")
  }

  async upsertVoyage(voyage: Voyage) {
    await this.insertVoyage(voyage, "update")
  }

  async upsertFeedItem(item: FeedItem) {
    await this.insertFeedItem(item, "update")
  }

  async archiveFeedItemsNotIn(sourceIds: readonly string[], retainedIds: ReadonlySet<string>, now = new Date(), reason = "source_item_not_in_current_index") {
    if (!sourceIds.length) return 0
    const placeholders = sourceIds.map(() => "?").join(",")
    const clauses = [`source_id IN (${placeholders})`, "visibility = 'current'"]
    const params: (string | number)[] = [...sourceIds]
    if (this.dataMode === "real") clauses.push("source_type IN ('real', 'imported', 'derived')")
    const candidates = rows<Row>(await this.db.prepare(`SELECT data FROM feed_items WHERE ${clauses.join(" AND ")}`).all(...params))
    let archived = 0
    for (const row of candidates) {
      const item = parse<FeedItem>(row.data)
      if (retainedIds.has(item.id)) continue
      const next = {
        ...applyFeedFreshnessPolicy({ ...item, fetchedAt: now.toISOString() }, now),
        visibility: "history" as const,
        eventEligibility: false,
        stale: true,
        error: item.error ?? reason,
      }
      await this.insertFeedItem(next, "update", next)
      archived += 1
    }
    return archived
  }

  async upsertEvent(event: ShippingEvent) {
    await this.insertEvent(event, "update")
  }

  async upsertCalendarEvent(event: CalendarEvent) {
    await this.insertCalendarEvent(event, "update")
  }

  async deleteCalendarEvents(ids: string[]) {
    if (!ids.length) return
    const placeholders = ids.map(() => "?").join(",")
    await this.db.prepare(`DELETE FROM calendar_events WHERE id IN (${placeholders})`).run(...ids)
  }

  private async saveSettingsUnlocked(settings: ShippingSettings) {
    await this.db.prepare(`
      INSERT INTO settings (id, data, updated_at) VALUES ('default', ?, ?)
      ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at
    `).run(JSON.stringify(settings), new Date().toISOString())
  }

  private async insertSettingsIfMissing(settings: ShippingSettings) {
    await this.db.prepare(`
      INSERT INTO settings (id, data, updated_at) VALUES ('default', ?, ?)
      ON CONFLICT(id) DO NOTHING
    `).run(JSON.stringify(settings), new Date().toISOString())
  }

  async saveSettings(settings: ShippingSettings) {
    await transaction(this.db, () => this.saveSettingsUnlocked(settings))
  }

  async updateWatch(kind: "vessel" | "port", id: string, isWatched: boolean) {
    const entityTable = kind === "vessel" ? "vessels" : "ports"
    const watchTable = kind === "vessel" ? "vessel_watchlist" : "port_watchlist"
    const watchColumn = kind === "vessel" ? "vessel_id" : "port_id"
    const row = await this.db.prepare(`SELECT id FROM ${entityTable} WHERE id = ?`).get(id)
    if (!row) return false
    await transaction(this.db, async () => {
      if (isWatched) {
        await this.db.prepare(`
          INSERT INTO ${watchTable} (${watchColumn}, watched_at${kind === "vessel" ? ", ais_enabled" : ""})
          VALUES (?, ?${kind === "vessel" ? ", 1" : ""})
          ON CONFLICT(${watchColumn}) DO UPDATE SET watched_at = excluded.watched_at
        `).run(id, new Date().toISOString())
      } else {
        await this.db.prepare(`DELETE FROM ${watchTable} WHERE ${watchColumn} = ?`).run(id)
      }
    })
    return true
  }

  async pruneExpired(retentionDays: number, now = new Date()) {
    const cutoff = new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1000).toISOString()
    await transaction(this.db, async () => {
      await this.db.prepare("DELETE FROM events WHERE last_detected_at < ? AND status = 'resolved'").run(cutoff)
      await this.db.prepare("DELETE FROM feed_items WHERE (published_at <> '' AND published_at < ?) OR (published_at = '' AND fetched_at < ?)").run(cutoff, cutoff)
      await this.db.prepare("DELETE FROM feed_item_history WHERE observed_at < ?").run(cutoff)
    })
  }

  private async insertAisPortMetric(metric: AisDerivedPortMetric, conflict: "update" | "ignore") {
    const record = this.prepareRecord(metric, "derived")
    const conflictClause = conflict === "ignore"
      ? "ON CONFLICT(port_id) DO NOTHING"
      : "ON CONFLICT(port_id) DO UPDATE SET data = excluded.data, source_type = excluded.source_type, updated_at = excluded.updated_at"
    await this.db.prepare(`
      INSERT INTO ais_port_metrics (port_id, data, source_type, updated_at) VALUES (?, ?, ?, ?)
      ${conflictClause}
    `).run(metric.portId, JSON.stringify(record), record.source_type, metric.updatedAt ?? metric.fetchedAt ?? null)
  }

  async upsertAisPortMetric(metric: AisDerivedPortMetric) {
    await this.insertAisPortMetric(metric, "update")
  }
}
