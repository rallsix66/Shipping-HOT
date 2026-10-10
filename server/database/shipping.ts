import process from "node:process"
import type { Database } from "db0"
import { hasMockEvidence, knownMockProvenanceFor, normalizeLegacyEventTrust, normalizeLegacyTrust, recordAllowedForDataMode } from "@shared/shipping"
import type { DataEvidence, DataProvenance, FeedItem, FeedVisibility, Freshness, MarineReferenceAttempt, MarineReferenceSyncMeta, Port, PortWeatherForecastRow, PortWeatherImpactRow, ProvenanceAware, ShippingEvent, ShippingSettings, SourceLineage, TropicalCycloneSyncMeta } from "@shared/shipping"
import type { CalendarEvent } from "@shared/calendar"
import { applyFeedFreshnessPolicy } from "@shared/shipping-rules"
import { JMA_TYPHOON_SOURCE_ID, type JmaTropicalCycloneSyncFailure, type JmaTropicalCycloneSyncResult } from "#/providers/jma-tropical-cyclone"
import { type NormalizedTropicalCyclone, normalizeStoredTropicalCyclonePayload } from "#/services/jma-typhoon-parse"
import { enrichTropicalCycloneSyncMeta, jmaDataValidUntil } from "#/services/tropical-cyclone-freshness"
import { marineReferenceSyncMetaId } from "#/config/port-marine-reference"

import type { PortCoordinate } from "#/services/tropical-cyclone-display"
import { minTyphoonDistanceKmForPort } from "#/services/tropical-cyclone-display"
import { type DatabaseMetadata, type ShippingDataMode, initializeShippingDatabase } from "#/database/runtime"

type Row = Record<string, unknown>

interface FeedStorageRow extends Row {
  data: string
  visibility?: unknown
  current_until?: unknown
  source_type?: unknown
}

const portFollowTable = `port_${"watch"}list` as const

const feedVisibilities = new Set<FeedVisibility>(["current", "history", "quarantine"])
const sourceLineages = new Set<SourceLineage>(["real", "mock", "imported", "derived"])

function persistedFeedVisibility(value: unknown): FeedVisibility {
  return typeof value === "string" && feedVisibilities.has(value as FeedVisibility)
    ? value as FeedVisibility
    : "history"
}

function persistedSourceLineage(value: unknown): SourceLineage {
  return typeof value === "string" && sourceLineages.has(value as SourceLineage)
    ? value as SourceLineage
    : "mock"
}

function timestampMs(value: unknown): number | undefined {
  if (typeof value !== "string" || value.trim() === "") return undefined
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

/** Hydrates a FeedItem from SQLite's canonical lifecycle projection without re-running incoming freshness policy. */
function hydratePersistedFeedItem(row: FeedStorageRow, now: Date): FeedItem {
  const stored = parse<FeedItem>(row.data)
  const visibility = persistedFeedVisibility(row.visibility)
  const currentUntil = typeof row.current_until === "string" && row.current_until.trim() !== ""
    ? row.current_until
    : undefined
  const source_type = persistedSourceLineage(row.source_type)
  const hydrated = { ...stored, visibility, currentUntil, source_type }

  if (visibility !== "current") return hydrated

  // A persisted current row is only effective while its canonical window is valid and in the future.
  // Missing/invalid timestamps fail closed as effective history; this is a read-time projection only.
  const currentUntilMs = timestampMs(currentUntil)
  if (currentUntilMs === undefined || currentUntilMs <= now.getTime()) {
    return {
      ...hydrated,
      visibility: "history",
      eventEligibility: false,
      stale: true,
      error: hydrated.error ?? "expired",
    }
  }
  return hydrated
}

interface LegacyTrustDefaults {
  port?: DataProvenance
}

interface LegacyEventSources {
  ports?: Port[]
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

  async isEmpty(): Promise<boolean> {
    const row = await this.db.prepare(`
      SELECT
        (SELECT COUNT(*) FROM ports)
        + (SELECT COUNT(*) FROM feed_items)
        + (SELECT COUNT(*) FROM events)
        + (SELECT COUNT(*) FROM calendar_events) AS total
    `).get() as { total?: number } | undefined
    return Number(row?.total ?? 0) === 0
  }

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
          data = excluded.data`
    await this.db.prepare(`
      INSERT INTO feed_items (id, source_id, category, type, title, summary, source_url, published_at, fetched_at, effective_at, expires_at, current_until, visibility, severity, related_port_ids, related_vessel_ids, source_type, data)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ${conflictClause}
    `).run(normalized.id, normalized.sourceId, normalized.category, normalized.type, normalized.title, normalized.summary, normalized.sourceUrl, normalized.publishedAt, fetchedAt, normalized.effectiveAt ?? null, normalized.expiresAt ?? null, normalized.currentUntil ?? null, normalized.visibility ?? "history", normalized.severity, JSON.stringify(normalized.relatedPortIds), JSON.stringify(normalized.relatedVesselIds), record.source_type, JSON.stringify({ ...record, fetchedAt }))
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

  async seed(ports: Port[], feedItems: FeedItem[], events: ShippingEvent[], settings: ShippingSettings, calendarEvents: CalendarEvent[] = []) {
    const allow = <T extends ProvenanceAware & { evidence?: DataEvidence[] }>(items: T[]) => items.filter(item => recordAllowedForDataMode(item, this.dataMode))
    await transaction(this.db, async () => {
      for (const port of allow(ports)) await this.insertPort(port, "ignore")
      for (const feedItem of allow(feedItems)) await this.insertFeedItem(feedItem, "ignore")
      for (const event of allow(events)) await this.insertEvent(event, "ignore")
      for (const event of allow(calendarEvents)) await this.insertCalendarEvent(event, "ignore")
      await this.insertSettingsIfMissing(settings)
    })
  }

  private async followedPortIds(): Promise<Set<string>> {
    const values = rows<Row>(await this.db.prepare(`SELECT port_id FROM ${portFollowTable}`).all())
    return new Set(values.map(row => String(row.port_id)))
  }

  async listPorts(defaults: LegacyTrustDefaults = {}) {
    const followed = await this.followedPortIds()
    return rows<Row>(await this.db.prepare(`SELECT data FROM ports${this.sourceWhere()} ORDER BY id`).all()).map((row) => {
      const port = parse<Port>(row.data)
      return normalizeLegacyTrust({ ...port, isWatched: followed.has(port.id) }, defaults.port)
    }).filter(port => recordAllowedForDataMode(port, this.dataMode))
  }

  async setPortFollow(portId: string, isWatched: boolean): Promise<boolean> {
    const row = await this.db.prepare("SELECT id FROM ports WHERE id = ?").get(portId)
    if (!row) return false
    await transaction(this.db, async () => {
      if (isWatched) {
        await this.db.prepare(`
          INSERT INTO ${portFollowTable} (port_id, watched_at)
          VALUES (?, ?)
          ON CONFLICT(port_id) DO UPDATE SET watched_at = excluded.watched_at
        `).run(portId, new Date().toISOString())
      } else {
        await this.db.prepare(`DELETE FROM ${portFollowTable} WHERE port_id = ?`).run(portId)
      }
    })
    return true
  }

  async listFeedItems(options: { now?: Date, view?: "current" | "history" | "all" } = {}) {
    const now = options.now ?? new Date()
    const view = options.view ?? "current"
    const clauses = [this.dataMode === "real" ? "source_type IN ('real', 'imported', 'derived')" : "1 = 1"]
    const params: (string | number)[] = []
    if (view === "current") {
      clauses.push("visibility = 'current'", "julianday(current_until) > julianday(?)")
      params.push(now.toISOString())
    } else if (view === "history") {
      clauses.push(`(
        visibility <> 'current'
        OR (
          visibility = 'current'
          AND (
            current_until IS NULL
            OR julianday(current_until) IS NULL
            OR julianday(current_until) <= julianday(?)
          )
        )
      )`)
      params.push(now.toISOString())
    }
    const records = rows<FeedStorageRow>(await this.db.prepare(`
      SELECT data, visibility, current_until, source_type
      FROM feed_items
      WHERE ${clauses.join(" AND ")}
      ORDER BY published_at DESC
    `).all(...params))
      .map(row => hydratePersistedFeedItem(row, now))
      .filter(item => view !== "current" || item.visibility === "current")
      .filter(item => view !== "history" || item.visibility !== "current")
      .map(item => normalizeLegacyTrust(item, knownMockProvenanceFor(item.sourceId)))
      .filter(item => recordAllowedForDataMode(item, this.dataMode))
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
      if (event.portId) return sources.ports?.find(item => item.id === event.portId)
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

  async upsertPort(port: Port) {
    await this.insertPort(port, "update")
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

  async pruneExpired(retentionDays: number, now = new Date()) {
    const cutoff = new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1000).toISOString()
    await transaction(this.db, async () => {
      await this.db.prepare("DELETE FROM events WHERE last_detected_at < ? AND status = 'resolved'").run(cutoff)
      await this.db.prepare("DELETE FROM feed_items WHERE (published_at <> '' AND published_at < ?) OR (published_at = '' AND fetched_at < ?)").run(cutoff, cutoff)
      await this.db.prepare("DELETE FROM feed_item_history WHERE observed_at < ?").run(cutoff)
    })
  }

  /**
   * ADR-009 reference sync meta (last attempt + last success kept separately). Stored as a dedicated row in the
   * key/value `settings` table (id `marine-ref-sync:<refKey>`); the user settings row ('default') is untouched.
   */
  async recordMarineReferenceAttempt(attempt: MarineReferenceAttempt) {
    const previous = await this.getMarineReferenceSyncMeta(attempt.refKey)
    const next: MarineReferenceSyncMeta = attempt.outcome === "success"
      ? { refKey: attempt.refKey, lastAttemptAt: attempt.attemptedAt, lastAttemptOutcome: "success", lastSuccessAt: attempt.attemptedAt, grid: attempt.grid }
      : { refKey: attempt.refKey, lastAttemptAt: attempt.attemptedAt, lastAttemptOutcome: "failed", lastAttemptError: attempt.error, lastSuccessAt: previous?.lastSuccessAt, grid: previous?.grid }
    await this.db.prepare(`
      INSERT INTO settings (id, data, updated_at) VALUES (?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at
    `).run(marineReferenceSyncMetaId(attempt.refKey), JSON.stringify(next), attempt.attemptedAt)
  }

  async getMarineReferenceSyncMeta(refKey: string): Promise<MarineReferenceSyncMeta | undefined> {
    const row = await this.db.prepare("SELECT data FROM settings WHERE id = ?").get(marineReferenceSyncMetaId(refKey)) as Row | undefined
    return row ? parse<MarineReferenceSyncMeta>(row.data) ?? undefined : undefined
  }

  async replaceWeatherPortBatch(portId: string, forecasts: PortWeatherForecastRow[], impacts: PortWeatherImpactRow[]) {
    await transaction(this.db, async () => {
      await this.db.prepare("DELETE FROM weather_forecast WHERE port_id = ?").run(portId)
      await this.db.prepare("DELETE FROM weather_impact WHERE port_id = ?").run(portId)
      for (const row of forecasts) {
        await this.db.prepare(`
          INSERT INTO weather_forecast (
            id, port_id, unlocode, forecast_at, horizon,
            wave_height_m, swell_wave_height_m, wind_speed_kmh, wind_gust_kmh,
            precipitation_mm, visibility_m, source_id, fetched_at, payload_json
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
        `).run(
          row.id,
          row.portId,
          row.unlocode ?? null,
          row.forecastAt,
          row.horizon,
          row.waveHeightM ?? null,
          row.swellWaveHeightM ?? null,
          row.windSpeedKmh ?? null,
          row.windGustKmh ?? null,
          row.precipitationMm ?? null,
          row.visibilityM ?? null,
          row.sourceId,
          row.fetchedAt,
        )
      }
      for (const row of impacts) {
        await this.db.prepare(`
          INSERT INTO weather_impact (
            id, port_id, valid_from, valid_until, impact_object, severity, status,
            rule_id, input_values_json, provenance, summary_zh, computed_at
          ) VALUES (?, ?, ?, ?, 'shipping_port', ?, ?, ?, ?, ?, ?, ?)
        `).run(
          row.id,
          row.portId,
          row.validFrom,
          row.validUntil,
          row.severity,
          row.status,
          row.ruleId,
          JSON.stringify(row.inputValues),
          row.provenance,
          row.summaryZh,
          row.computedAt,
        )
      }
    })
  }

  /** Diagnostics/tests only: every stored row for a port, oldest first (no truncation unless `limit` is given). */
  async listWeatherForecastsForPort(portId: string, limit?: number): Promise<PortWeatherForecastRow[]> {
    const result = await this.db.prepare(`
      SELECT id, port_id, unlocode, forecast_at, horizon,
        wave_height_m, swell_wave_height_m, wind_speed_kmh, wind_gust_kmh,
        precipitation_mm, visibility_m, source_id, fetched_at
      FROM weather_forecast
      WHERE port_id = ?
      ORDER BY forecast_at ASC
      LIMIT ?
    `).all(portId, limit ?? -1)
    return this.mapWeatherForecastRows(result)
  }

  /**
   * Rows with forecast_at in [fromIso, toIso] (ISO-8601 UTC strings as written by the normalizer).
   * The cap keeps the LATEST rows so future hours at the window end are never squeezed out by old ones.
   */
  async listWeatherForecastsForPortInRange(portId: string, fromIso: string, toIso: string, limit: number): Promise<PortWeatherForecastRow[]> {
    const result = await this.db.prepare(`
      SELECT id, port_id, unlocode, forecast_at, horizon,
        wave_height_m, swell_wave_height_m, wind_speed_kmh, wind_gust_kmh,
        precipitation_mm, visibility_m, source_id, fetched_at
      FROM weather_forecast
      WHERE port_id = ? AND forecast_at >= ? AND forecast_at <= ?
      ORDER BY forecast_at DESC
      LIMIT ?
    `).all(portId, fromIso, toIso, limit)
    return this.mapWeatherForecastRows(result).reverse()
  }

  /** Most recent `limit` rows (any age), oldest first; used only for the stale/historical fallback display. */
  async listLatestWeatherForecastsForPort(portId: string, limit: number): Promise<PortWeatherForecastRow[]> {
    const result = await this.db.prepare(`
      SELECT id, port_id, unlocode, forecast_at, horizon,
        wave_height_m, swell_wave_height_m, wind_speed_kmh, wind_gust_kmh,
        precipitation_mm, visibility_m, source_id, fetched_at
      FROM weather_forecast
      WHERE port_id = ?
      ORDER BY forecast_at DESC
      LIMIT ?
    `).all(portId, limit)
    return this.mapWeatherForecastRows(result).reverse()
  }

  private mapWeatherForecastRows(result: unknown): PortWeatherForecastRow[] {
    return rows<Row>(result as never).map(row => ({
      id: String(row.id),
      portId: String(row.port_id),
      unlocode: row.unlocode ? String(row.unlocode) : undefined,
      forecastAt: String(row.forecast_at),
      horizon: (row.horizon === "current" ? "current" : "hourly") as PortWeatherForecastRow["horizon"],
      waveHeightM: typeof row.wave_height_m === "number" ? row.wave_height_m : undefined,
      swellWaveHeightM: typeof row.swell_wave_height_m === "number" ? row.swell_wave_height_m : undefined,
      windSpeedKmh: typeof row.wind_speed_kmh === "number" ? row.wind_speed_kmh : undefined,
      windGustKmh: typeof row.wind_gust_kmh === "number" ? row.wind_gust_kmh : undefined,
      precipitationMm: typeof row.precipitation_mm === "number" ? row.precipitation_mm : undefined,
      visibilityM: typeof row.visibility_m === "number" ? row.visibility_m : undefined,
      sourceId: String(row.source_id),
      fetchedAt: String(row.fetched_at),
    }))
  }

  async countWeatherImpactsActiveInHorizon(portId: string, asOfIso: string, horizonEndIso: string): Promise<number> {
    const result = await this.db.prepare(`
      SELECT COUNT(*) AS count
      FROM weather_impact
      WHERE port_id = ?
        AND julianday(valid_until) >= julianday(?)
        AND julianday(valid_from) <= julianday(?)
    `).get(portId, asOfIso, horizonEndIso) as Row | undefined
    return Number(result?.count ?? 0)
  }

  async listWeatherImpactsForPortRanked(
    portId: string,
    asOfIso: string,
    horizonEndIso: string,
    limit = 48,
  ): Promise<PortWeatherImpactRow[]> {
    const result = await this.db.prepare(`
      SELECT id, port_id, valid_from, valid_until, rule_id, severity, status,
        input_values_json, provenance, summary_zh, computed_at
      FROM weather_impact
      WHERE port_id = ?
        AND julianday(valid_until) >= julianday(?)
        AND julianday(valid_from) <= julianday(?)
      ORDER BY
        CASE severity
          WHEN 'critical' THEN 4
          WHEN 'warning' THEN 3
          WHEN 'watch' THEN 2
          ELSE 1
        END DESC,
        ABS(julianday(valid_from) - julianday(?)) ASC,
        valid_from ASC
      LIMIT ?
    `).all(portId, asOfIso, horizonEndIso, asOfIso, limit)
    return rows<Row>(result).map((row) => {
      const inputValues = parse<Record<string, number>>(row.input_values_json)
      return {
        id: String(row.id),
        portId: String(row.port_id),
        validFrom: String(row.valid_from),
        validUntil: String(row.valid_until),
        ruleId: String(row.rule_id),
        severity: String(row.severity) as PortWeatherImpactRow["severity"],
        status: "potential" as const,
        provenance: "system" as const,
        summaryZh: String(row.summary_zh),
        inputValues,
        computedAt: String(row.computed_at),
      }
    })
  }

  private static readonly TROPICAL_CYCLONE_SYNC_ROW_ID = "_jma_sync_meta"

  async saveTropicalCycloneSyncMeta(meta: TropicalCycloneSyncMeta) {
    await this.db.prepare(`
      INSERT INTO tropical_cyclone (id, basin, name, jma_id, track_json, forecast_json, source_id, fetched_at, dissipated_at)
      VALUES (?, 'META', NULL, NULL, ?, NULL, ?, ?, NULL)
      ON CONFLICT(id) DO UPDATE SET
        track_json = excluded.track_json,
        source_id = excluded.source_id,
        fetched_at = excluded.fetched_at
    `).run(
      ShippingRepository.TROPICAL_CYCLONE_SYNC_ROW_ID,
      JSON.stringify(meta),
      meta.sourceId,
      meta.lastCheckedAt ?? new Date().toISOString(),
    )
  }

  async getTropicalCycloneSyncMeta(options: { nowMs?: number } = {}): Promise<TropicalCycloneSyncMeta> {
    const row = await this.db.prepare(`
      SELECT track_json, source_id, fetched_at
      FROM tropical_cyclone
      WHERE id = ?
    `).get(ShippingRepository.TROPICAL_CYCLONE_SYNC_ROW_ID) as Row | undefined
    if (!row) {
      return { sourceId: "jma-typhoon", outcome: "not_run" }
    }
    try {
      const parsed = parse<TropicalCycloneSyncMeta>(row.track_json)
      const base = parsed ?? { sourceId: String(row.source_id) as TropicalCycloneSyncMeta["sourceId"], outcome: "not_run" as const }
      const nowMs = options.nowMs ?? Date.now()
      return enrichTropicalCycloneSyncMeta({
        ...base,
        dataValidUntil: base.dataValidUntil ?? jmaDataValidUntil(base.lastSuccessAt ?? base.lastCheckedAt),
      }, nowMs)
    } catch {
      return { sourceId: "jma-typhoon", outcome: "not_run" }
    }
  }

  private static cyclonePayload(cyclone: NormalizedTropicalCyclone) {
    return {
      current: cyclone.current,
      trackHistory: cyclone.trackHistory,
      forecast: cyclone.forecast,
      typhoonNumber: cyclone.typhoonNumber,
      nameEn: cyclone.nameEn,
      nameJp: cyclone.nameJp,
      category: cyclone.category,
      issuedAt: cyclone.issuedAt,
      lifecycleStatus: cyclone.lifecycleStatus,
      missingFromListAt: cyclone.missingFromListAt,
      dissipatedReason: cyclone.dissipatedReason,
      summaryZhPersisted: cyclone.summaryZhPersisted,
      pathFetchedAt: cyclone.pathFetchedAt,
    }
  }

  private async upsertTropicalCycloneRow(cyclone: NormalizedTropicalCyclone, sourceId: string, rowFetchedAt: string) {
    const pathFetchedAt = cyclone.pathFetchedAt ?? rowFetchedAt
    cyclone.pathFetchedAt = pathFetchedAt
    await this.db.prepare(`
      INSERT INTO tropical_cyclone (id, basin, name, jma_id, track_json, forecast_json, source_id, fetched_at, dissipated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        basin = excluded.basin,
        name = excluded.name,
        jma_id = excluded.jma_id,
        track_json = excluded.track_json,
        forecast_json = excluded.forecast_json,
        source_id = excluded.source_id,
        fetched_at = excluded.fetched_at,
        dissipated_at = excluded.dissipated_at
    `).run(
      cyclone.id,
      cyclone.basin,
      cyclone.nameEn ?? cyclone.nameJp ?? null,
      cyclone.jmaId,
      JSON.stringify(ShippingRepository.cyclonePayload(cyclone)),
      JSON.stringify(cyclone.rawForecastJson),
      sourceId,
      pathFetchedAt,
      cyclone.dissipatedAt ?? null,
    )
  }

  async applyJmaTropicalCycloneSync(
    result: JmaTropicalCycloneSyncResult | JmaTropicalCycloneSyncFailure,
    ports: readonly PortCoordinate[],
  ) {
    void ports
    const previous = await this.listNormalizedTropicalCyclones()
    const prevMeta = await this.getTropicalCycloneSyncMeta({ nowMs: Date.parse(result.fetchedAt) })

    if (result.outcome === "failed") {
      await this.saveTropicalCycloneSyncMeta({
        sourceId: JMA_TYPHOON_SOURCE_ID,
        lastCheckedAt: result.fetchedAt,
        lastFullSuccessAt: prevMeta.lastFullSuccessAt ?? prevMeta.lastSuccessAt,
        lastPathFetchAt: prevMeta.lastPathFetchAt,
        lastSuccessAt: prevMeta.lastFullSuccessAt ?? prevMeta.lastSuccessAt,
        dataValidUntil: jmaDataValidUntil(prevMeta.lastFullSuccessAt ?? prevMeta.lastSuccessAt),
        outcome: "failed",
        errorCode: result.errorCode,
        errorMessage: result.errorMessage,
        failedTcIds: prevMeta.failedTcIds,
        listInvalidCount: prevMeta.listInvalidCount,
      })
      return
    }

    const pathFetchedThisRun = result.cyclones.length > 0
    const fullListSuccess = result.outcome === "ok" || result.outcome === "ok_empty"
    const lastFullSuccessAt = fullListSuccess
      ? result.fetchedAt
      : (prevMeta.lastFullSuccessAt ?? prevMeta.lastSuccessAt)
    const lastPathFetchAt = pathFetchedThisRun
      ? result.fetchedAt
      : prevMeta.lastPathFetchAt
    const syncMetaBase: TropicalCycloneSyncMeta = {
      sourceId: JMA_TYPHOON_SOURCE_ID,
      lastCheckedAt: result.fetchedAt,
      lastFullSuccessAt,
      lastPathFetchAt,
      lastSuccessAt: lastFullSuccessAt,
      dataValidUntil: jmaDataValidUntil(lastFullSuccessAt),
      outcome: result.outcome,
      failedTcIds: result.failedTcIds.length ? result.failedTcIds : undefined,
      listInvalidCount: result.listInvalidCount,
    }

    await transaction(this.db, async () => {
      const syncedIds = new Set(result.cyclones.map(c => c.id))

      if (result.outcome === "ok_empty" && result.listConfirmedEmpty) {
        for (const cyclone of previous) {
          if (cyclone.lifecycleStatus === "dissipated" && cyclone.dissipatedAt) continue
          await this.upsertTropicalCycloneRow({
            ...cyclone,
            lifecycleStatus: "missing_from_list",
            missingFromListAt: cyclone.missingFromListAt ?? result.fetchedAt,
            pathFetchedAt: cyclone.pathFetchedAt,
            summaryZhPersisted: cyclone.summaryZhPersisted
              ?? `${cyclone.nameEn ?? cyclone.nameJp ?? cyclone.jmaId} 自最新 JMA 列表消失 · 不等于已登陆/减弱 · 48h 内保留路径摘要`,
          }, JMA_TYPHOON_SOURCE_ID, cyclone.pathFetchedAt ?? cyclone.issuedAt ?? result.fetchedAt)
        }
      } else {
        for (const cyclone of result.cyclones) {
          await this.upsertTropicalCycloneRow({
            ...cyclone,
            lifecycleStatus: cyclone.dissipatedAt ? "dissipated" : "active",
            pathFetchedAt: cyclone.pathFetchedAt ?? result.fetchedAt,
          }, JMA_TYPHOON_SOURCE_ID, cyclone.pathFetchedAt ?? result.fetchedAt)
        }
        if (result.outcome === "ok") {
          for (const cyclone of previous) {
            if (syncedIds.has(cyclone.id)) continue
            if (cyclone.lifecycleStatus === "dissipated") {
              await this.upsertTropicalCycloneRow(cyclone, JMA_TYPHOON_SOURCE_ID, cyclone.pathFetchedAt ?? cyclone.dissipatedAt ?? result.fetchedAt)
              continue
            }
            await this.upsertTropicalCycloneRow({
              ...cyclone,
              lifecycleStatus: "missing_from_list",
              missingFromListAt: cyclone.missingFromListAt ?? result.fetchedAt,
              pathFetchedAt: cyclone.pathFetchedAt,
              summaryZhPersisted: cyclone.summaryZhPersisted
                ?? `${cyclone.nameEn ?? cyclone.nameJp ?? cyclone.jmaId} 自最新 JMA 列表消失 · 不等于已登陆/减弱 · 48h 内保留路径摘要`,
            }, JMA_TYPHOON_SOURCE_ID, cyclone.pathFetchedAt ?? result.fetchedAt)
          }
        }
      }

      await this.saveTropicalCycloneSyncMeta(syncMetaBase)
    })
  }

  /** @deprecated Use applyJmaTropicalCycloneSync — retained for tests/fixtures. */
  async replaceTropicalCyclones(
    cyclones: readonly NormalizedTropicalCyclone[],
    sync: Pick<TropicalCycloneSyncMeta, "sourceId" | "lastCheckedAt" | "outcome">,
    ports: readonly PortCoordinate[],
  ) {
    void ports
    const outcome = sync.outcome === "ok_empty"
      ? "ok_empty"
      : sync.outcome === "partial"
        ? "partial"
        : "ok"
    await this.applyJmaTropicalCycloneSync({
      cyclones: [...cyclones],
      outcome,
      fetchedAt: sync.lastCheckedAt ?? new Date().toISOString(),
      listConfirmedEmpty: sync.outcome === "ok_empty",
      failedTcIds: [],
      parseErrorCount: 0,
    }, ports)
  }

  async listNormalizedTropicalCyclones(): Promise<NormalizedTropicalCyclone[]> {
    const result = await this.db.prepare(`
      SELECT id, basin, name, jma_id, track_json, forecast_json, source_id, fetched_at, dissipated_at
      FROM tropical_cyclone
      WHERE id <> ?
      ORDER BY fetched_at DESC
    `).all(ShippingRepository.TROPICAL_CYCLONE_SYNC_ROW_ID)
    return rows<Row>(result).map((row) => {
      const payload = parse<Parameters<typeof normalizeStoredTropicalCyclonePayload>[0]>(row.track_json)
      const normalized = normalizeStoredTropicalCyclonePayload(payload)
      return {
        id: String(row.id),
        basin: String(row.basin),
        jmaId: String(row.jma_id ?? ""),
        typhoonNumber: normalized.typhoonNumber,
        nameEn: normalized.nameEn ?? (row.name ? String(row.name) : undefined),
        nameJp: normalized.nameJp,
        category: normalized.category,
        issuedAt: normalized.issuedAt,
        current: normalized.current,
        trackHistory: normalized.trackHistory,
        forecast: normalized.forecast,
        dissipatedAt: row.dissipated_at ? String(row.dissipated_at) : undefined,
        dissipatedReason: normalized.dissipatedReason,
        lifecycleStatus: normalized.lifecycleStatus,
        missingFromListAt: normalized.missingFromListAt,
        summaryZhPersisted: normalized.summaryZhPersisted,
        pathFetchedAt: normalized.pathFetchedAt ?? String(row.fetched_at ?? ""),
        rawForecastJson: parse<unknown>(row.forecast_json),
      }
    })
  }

  async minTyphoonDistanceKmForPortId(portId: string, ports: readonly PortCoordinate[]): Promise<number | undefined> {
    const port = ports.find(item => item.portId === portId)
    if (!port) return undefined
    const cyclones = await this.listNormalizedTropicalCyclones()
    return minTyphoonDistanceKmForPort(cyclones, port, true)
  }
}
