import type { Database } from "db0"
import { knownMockProvenanceFor, normalizeLegacyEventTrust, normalizeLegacyTrust } from "@shared/shipping"
import type { DataProvenance, FeedItem, Freshness, Port, ProvenanceAware, ShippingEvent, ShippingSettings, Vessel, Voyage } from "@shared/shipping"
import type { CalendarEvent } from "@shared/calendar"

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

function rows<T>(value: unknown): T[] {
  if (Array.isArray(value)) return value as T[]
  if (value && typeof value === "object" && Array.isArray((value as { results?: unknown[] }).results)) return (value as { results: T[] }).results
  return []
}

function parse<T>(value: unknown): T {
  return JSON.parse(String(value)) as T
}

export async function initShippingTables(db: Database) {
  await db.prepare(`CREATE TABLE IF NOT EXISTS feed_items (
    id TEXT PRIMARY KEY, source_id TEXT NOT NULL, category TEXT NOT NULL, type TEXT NOT NULL,
    title TEXT NOT NULL, summary TEXT NOT NULL, source_url TEXT NOT NULL, published_at TEXT NOT NULL,
    fetched_at TEXT NOT NULL, severity TEXT NOT NULL, related_port_ids TEXT NOT NULL,
    related_vessel_ids TEXT NOT NULL, related_voyage_ids TEXT NOT NULL, data TEXT NOT NULL
  )`).run()
  await db.prepare(`CREATE TABLE IF NOT EXISTS vessels (
    id TEXT PRIMARY KEY, data TEXT NOT NULL, is_watched INTEGER NOT NULL DEFAULT 0,
    navigation_status TEXT NOT NULL, status_changed_at TEXT NOT NULL, last_updated_at TEXT
  )`).run()
  await db.prepare(`CREATE TABLE IF NOT EXISTS ports (
    id TEXT PRIMARY KEY, data TEXT NOT NULL, is_watched INTEGER NOT NULL DEFAULT 0,
    congestion_level TEXT NOT NULL, last_updated_at TEXT
  )`).run()
  await db.prepare(`CREATE TABLE IF NOT EXISTS voyages (
    id TEXT PRIMARY KEY, data TEXT NOT NULL, vessel_id TEXT NOT NULL,
    baseline_etd TEXT, baseline_eta TEXT, latest_etd TEXT, latest_eta TEXT, delay_minutes INTEGER
  )`).run()
  await db.prepare(`CREATE TABLE IF NOT EXISTS events (
    id TEXT PRIMARY KEY, data TEXT NOT NULL, type TEXT NOT NULL, severity TEXT NOT NULL,
    status TEXT NOT NULL, dedupe_key TEXT NOT NULL UNIQUE, first_detected_at TEXT NOT NULL,
    last_detected_at TEXT NOT NULL, resolved_at TEXT
  )`).run()
  await db.prepare(`CREATE TABLE IF NOT EXISTS settings (
    id TEXT PRIMARY KEY, data TEXT NOT NULL, updated_at TEXT NOT NULL
  )`).run()
  await db.prepare(`CREATE TABLE IF NOT EXISTS calendar_events (
    id TEXT PRIMARY KEY, country_code TEXT NOT NULL, subdivision_code TEXT, date TEXT NOT NULL,
    end_date TEXT, type TEXT NOT NULL, is_public_holiday INTEGER NOT NULL,
    business_impact TEXT NOT NULL, source_id TEXT NOT NULL, source_url TEXT,
    verified INTEGER NOT NULL, last_checked_at TEXT NOT NULL, updated_at TEXT,
    stale INTEGER NOT NULL, data TEXT NOT NULL
  )`).run()
}

export class ShippingRepository {
  constructor(private readonly db: Database) {}

  async isEmpty(): Promise<boolean> {
    const row = await this.db.prepare("SELECT COUNT(*) AS count FROM vessels").get() as Row | undefined
    return Number(row?.count ?? 0) === 0
  }

  async seed(vessels: Vessel[], ports: Port[], voyages: Voyage[], feedItems: FeedItem[], events: ShippingEvent[], settings: ShippingSettings, calendarEvents: CalendarEvent[] = []) {
    for (const vessel of vessels) await this.upsertVessel(vessel)
    for (const port of ports) await this.upsertPort(port)
    for (const voyage of voyages) await this.upsertVoyage(voyage)
    for (const feedItem of feedItems) await this.upsertFeedItem(feedItem)
    for (const event of events) await this.upsertEvent(event)
    for (const event of calendarEvents) await this.upsertCalendarEvent(event)
    await this.saveSettings(settings)
  }

  async listVessels(defaults: LegacyTrustDefaults = {}) {
    return rows<Row>(await this.db.prepare("SELECT data FROM vessels ORDER BY id").all()).map(row => normalizeLegacyTrust(parse<Vessel>(row.data), defaults.vessel))
  }

  async listPorts(defaults: LegacyTrustDefaults = {}) {
    return rows<Row>(await this.db.prepare("SELECT data FROM ports ORDER BY id").all()).map(row => normalizeLegacyTrust(parse<Port>(row.data), defaults.port))
  }

  async listVoyages(defaults: LegacyTrustDefaults = {}) {
    return rows<Row>(await this.db.prepare("SELECT data FROM voyages ORDER BY id").all()).map(row => normalizeLegacyTrust(parse<Voyage>(row.data), defaults.voyage))
  }

  async listFeedItems() {
    return rows<Row>(await this.db.prepare("SELECT data FROM feed_items ORDER BY published_at DESC").all()).map((row) => {
      const item = parse<FeedItem>(row.data)
      return normalizeLegacyTrust(item, knownMockProvenanceFor(item.sourceId))
    })
  }

  async listEvents(sources: LegacyEventSources = {}) {
    const findSource = (event: ShippingEvent): (Freshness & ProvenanceAware) | undefined => {
      if (event.feedItemId) return sources.feedItems?.find(item => item.id === event.feedItemId)
      if (event.vesselId) return sources.vessels?.find(item => item.id === event.vesselId)
      if (event.portId) return sources.ports?.find(item => item.id === event.portId)
      if (event.voyageId) return sources.voyages?.find(item => item.id === event.voyageId)
      return undefined
    }
    return rows<Row>(await this.db.prepare("SELECT data FROM events ORDER BY last_detected_at DESC").all()).map((row) => {
      const event = parse<ShippingEvent>(row.data)
      return normalizeLegacyEventTrust(event, findSource(event))
    })
  }

  async listCalendarEvents() {
    return rows<Row>(await this.db.prepare("SELECT data FROM calendar_events ORDER BY date, country_code, id").all()).map(row => parse<CalendarEvent>(row.data))
  }

  async getSettings(): Promise<ShippingSettings | undefined> {
    const row = await this.db.prepare("SELECT data FROM settings WHERE id = 'default'").get() as Row | undefined
    return row ? parse<ShippingSettings>(row.data) : undefined
  }

  async upsertVessel(vessel: Vessel) {
    await this.db.prepare(`INSERT OR REPLACE INTO vessels (id, data, is_watched, navigation_status, status_changed_at, last_updated_at) VALUES (?, ?, ?, ?, ?, ?)`)
      .run(vessel.id, JSON.stringify(vessel), vessel.isWatched ? 1 : 0, vessel.navigationStatus, vessel.statusChangedAt, vessel.updatedAt ?? null)
  }

  async upsertPort(port: Port) {
    await this.db.prepare(`INSERT OR REPLACE INTO ports (id, data, is_watched, congestion_level, last_updated_at) VALUES (?, ?, ?, ?, ?)`)
      .run(port.id, JSON.stringify(port), port.isWatched ? 1 : 0, port.congestionLevel, port.updatedAt ?? null)
  }

  async upsertVoyage(voyage: Voyage) {
    await this.db.prepare(`INSERT OR REPLACE INTO voyages (id, data, vessel_id, baseline_etd, baseline_eta, latest_etd, latest_eta, delay_minutes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(voyage.id, JSON.stringify(voyage), voyage.vesselId, voyage.baselineEtd ?? null, voyage.baselineEta ?? null, voyage.latestEtd ?? null, voyage.latestEta ?? null, voyage.delayMinutes ?? null)
  }

  async upsertFeedItem(item: FeedItem) {
    await this.db.prepare(`INSERT OR REPLACE INTO feed_items (id, source_id, category, type, title, summary, source_url, published_at, fetched_at, severity, related_port_ids, related_vessel_ids, related_voyage_ids, data) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(item.id, item.sourceId, item.category, item.type, item.title, item.summary, item.sourceUrl, item.publishedAt, item.updatedAt ?? item.publishedAt, item.severity, JSON.stringify(item.relatedPortIds), JSON.stringify(item.relatedVesselIds), JSON.stringify(item.relatedVoyageIds), JSON.stringify(item))
  }

  async upsertEvent(event: ShippingEvent) {
    await this.db.prepare(`INSERT OR REPLACE INTO events (id, data, type, severity, status, dedupe_key, first_detected_at, last_detected_at, resolved_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(event.id, JSON.stringify(event), event.type, event.severity, event.status, event.dedupeKey, event.firstDetectedAt, event.lastDetectedAt, event.resolvedAt ?? null)
  }

  async upsertCalendarEvent(event: CalendarEvent) {
    await this.db.prepare(`INSERT OR REPLACE INTO calendar_events (id, country_code, subdivision_code, date, end_date, type, is_public_holiday, business_impact, source_id, source_url, verified, last_checked_at, updated_at, stale, data) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(event.id, event.countryCode, event.subdivisionCode ?? null, event.date, event.endDate ?? null, event.type, event.isPublicHoliday ? 1 : 0, event.businessImpact, event.sourceId, event.sourceUrl ?? null, event.verified ? 1 : 0, event.lastCheckedAt, event.updatedAt ?? null, event.stale ? 1 : 0, JSON.stringify(event))
  }

  async deleteCalendarEvents(ids: string[]) {
    if (!ids.length) return
    const placeholders = ids.map(() => "?").join(",")
    await this.db.prepare(`DELETE FROM calendar_events WHERE id IN (${placeholders})`).run(...ids)
  }

  async saveSettings(settings: ShippingSettings) {
    await this.db.prepare("INSERT OR REPLACE INTO settings (id, data, updated_at) VALUES ('default', ?, ?)").run(JSON.stringify(settings), new Date().toISOString())
  }

  async updateWatch(kind: "vessel" | "port", id: string, isWatched: boolean) {
    const table = kind === "vessel" ? "vessels" : "ports"
    const row = await this.db.prepare(`SELECT data FROM ${table} WHERE id = ?`).get(id) as Row | undefined
    if (!row) return false
    const item = parse<Vessel | Port>(row.data)
    item.isWatched = isWatched
    await this.db.prepare(`UPDATE ${table} SET data = ?, is_watched = ? WHERE id = ?`).run(JSON.stringify(item), isWatched ? 1 : 0, id)
    return true
  }

  async pruneExpired(retentionDays: number, now = new Date()) {
    const cutoff = new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1000).toISOString()
    await this.db.prepare("DELETE FROM events WHERE last_detected_at < ? AND status = 'resolved'").run(cutoff)
    await this.db.prepare("DELETE FROM feed_items WHERE published_at < ?").run(cutoff)
  }
}
