import { describe, expect, it } from "vitest"
import type { Database } from "db0"
import { createMockSnapshot } from "@shared/shipping-fixtures"
import { ShippingRepository, initShippingTables } from "./shipping"
import { createMockCalendarEvents } from "#/providers/calendar"

type StoredRow = Record<string, unknown>

class FakeStatement {
  constructor(private readonly database: FakeDatabase, private readonly sql: string) {}

  async run(...args: unknown[]) {
    if (/INSERT INTO vessels_new/i.test(this.sql)) {
      this.database.copyVesselsToMigrationTable()
      return { success: true }
    }
    if (/DROP TABLE vessels\b/i.test(this.sql)) {
      this.database.dropVesselsForMigration()
      return { success: true }
    }
    if (/ALTER TABLE vessels_new RENAME TO vessels/i.test(this.sql)) {
      this.database.renameMigratedVessels()
      return { success: true }
    }
    if (/COMMIT/i.test(this.sql)) {
      this.database.vesselStatusChangedAtNotNull = false
      return { success: true }
    }
    const insert = this.sql.match(/INSERT OR REPLACE INTO (\w+)/i)
    if (insert) this.database.insert(insert[1], args)
    const update = this.sql.match(/UPDATE (\w+) SET data = \?, is_watched = \? WHERE id = \?/i)
    if (update) this.database.updateWatch(update[1], args)
    const deleteMatch = this.sql.match(/DELETE FROM (\w+)/i)
    if (deleteMatch) this.database.delete(deleteMatch[1], args)
    return { success: true }
  }

  async get(...args: unknown[]) {
    if (/SELECT COUNT\(\*\) AS count FROM vessels/i.test(this.sql)) return { count: this.database.table("vessels").size }
    const settings = this.sql.match(/SELECT data FROM settings WHERE id = 'default'/i)
    if (settings) return this.database.table("settings").get("default")
    const row = this.sql.match(/SELECT data FROM (\w+) WHERE id = \?/i)
    if (row) return this.database.table(row[1]).get(String(args[0]))
    return undefined
  }

  async all() {
    if (/PRAGMA table_info\(vessels\)/i.test(this.sql)) return this.database.vesselTableInfo()
    const table = this.sql.match(/SELECT data FROM (\w+)/i)?.[1]
    return table ? [...this.database.table(table).values()] : []
  }
}

class FakeDatabase {
  private tables = new Map<string, Map<string, StoredRow>>()
  vesselStatusChangedAtNotNull = false
  private migrationVessels = new Map<string, StoredRow>()
  lastArgs: unknown[] = []

  prepare(sql: string) {
    return new FakeStatement(this, sql)
  }

  table(name: string) {
    let table = this.tables.get(name)
    if (!table) {
      table = new Map()
      this.tables.set(name, table)
    }
    return table
  }

  vesselTableInfo() {
    return this.vesselStatusChangedAtNotNull
      ? [{ name: "id", notnull: 0 }, { name: "data", notnull: 1 }, { name: "is_watched", notnull: 1 }, { name: "navigation_status", notnull: 1 }, { name: "status_changed_at", notnull: 1 }, { name: "last_updated_at", notnull: 0 }]
      : []
  }

  copyVesselsToMigrationTable() {
    this.migrationVessels = new Map(this.table("vessels"))
  }

  dropVesselsForMigration() {
    this.tables.delete("vessels")
  }

  renameMigratedVessels() {
    this.tables.set("vessels", this.migrationVessels)
  }

  insert(tableName: string, args: unknown[]) {
    const table = this.table(tableName)
    const id = tableName === "settings" ? "default" : String(args[0])
    if (tableName === "settings") table.set(id, { data: args[0], id })
    else if (tableName === "vessels") table.set(id, { id, data: args[1], is_watched: args[2], status_changed_at: args[4] })
    else if (tableName === "ports") table.set(id, { id, data: args[1], is_watched: args[2] })
    else if (tableName === "voyages") table.set(id, { id, data: args[1], baseline_eta: args[4], latest_eta: args[6] })
    else if (tableName === "feed_items") table.set(id, { id, data: args[13], published_at: args[7], fetched_at: args[8] })
    else if (tableName === "events") table.set(id, { id, data: args[1], status: args[4], dedupe_key: args[5], last_detected_at: args[7] })
    else if (tableName === "calendar_events") table.set(id, { id, data: args[14], date: args[3], country_code: args[1] })
    else if (tableName === "ais_port_metrics") table.set(id, { id, data: args[1], updated_at: args[2] })
  }

  updateWatch(tableName: string, args: unknown[]) {
    const row = this.table(tableName).get(String(args[2]))
    if (row) {
      row.data = args[0]
      row.is_watched = args[1]
    }
  }

  delete(tableName: string, args: unknown[]) {
    const table = this.table(tableName)
    if (tableName === "events") {
      for (const [id, row] of table) {
        if (row.status === "resolved" && String(row.last_detected_at) < String(args[0])) table.delete(id)
      }
    }
    if (tableName === "feed_items") {
      for (const [id, row] of table) {
        const publishedAt = String(row.published_at)
        const retentionAt = publishedAt === "" ? String(row.fetched_at) : publishedAt
        if (retentionAt < String(args[0])) table.delete(id)
      }
    }
  }
}

describe("shippingRepository", () => {
  it("seeds and reads all entities and settings", async () => {
    const snapshot = createMockSnapshot()
    const database = new FakeDatabase()
    await initShippingTables(database as unknown as Database)
    const repository = new ShippingRepository(database as unknown as Database)
    await repository.seed(snapshot.vessels, snapshot.ports, snapshot.voyages, snapshot.feedItems, snapshot.events.map(event => ({ ...event, status: "resolved" as const, resolvedAt: "2026-01-02T00:00:00.000Z", lastDetectedAt: "2026-01-02T00:00:00.000Z" })), snapshot.settings)
    expect(await repository.listVessels()).toHaveLength(snapshot.vessels.length)
    expect((await repository.listVessels())[0].provenance).toMatchObject({ sourceType: "mock", sourceId: "mock-vessel" })
    expect(await repository.listPorts()).toHaveLength(snapshot.ports.length)
    expect(await repository.listVoyages()).toHaveLength(snapshot.voyages.length)
    expect(await repository.listFeedItems()).toHaveLength(snapshot.feedItems.length)
    expect(await repository.listEvents()).toHaveLength(snapshot.events.length)
    expect((await repository.listEvents()).every(event => (event.evidence?.length ?? 0) > 0)).toBe(true)
    expect(await repository.getSettings()).toEqual(snapshot.settings)
  })

  it("persists watch, settings, voyage baseline and resolved Event updates", async () => {
    const snapshot = createMockSnapshot()
    const database = new FakeDatabase()
    const repository = new ShippingRepository(database as unknown as Database)
    await repository.seed(snapshot.vessels, snapshot.ports, snapshot.voyages, snapshot.feedItems, snapshot.events, snapshot.settings)
    await repository.updateWatch("vessel", snapshot.vessels[0].id, false)
    expect((await repository.listVessels()).find(item => item.id === snapshot.vessels[0].id)?.isWatched).toBe(false)
    const settings = { ...snapshot.settings, refreshInterval: 30 }
    await repository.saveSettings(settings)
    expect((await repository.getSettings())?.refreshInterval).toBe(30)
    const voyage = { ...snapshot.voyages[0], baselineEta: "2026-01-01T00:00:00.000Z" }
    await repository.upsertVoyage(voyage)
    expect((await repository.listVoyages()).find(item => item.id === voyage.id)?.baselineEta).toBe(voyage.baselineEta)
    const event = { ...snapshot.events[0], status: "resolved" as const, resolvedAt: "2026-01-01T00:00:00.000Z" }
    await repository.upsertEvent(event)
    expect((await repository.listEvents()).find(item => item.id === event.id)?.status).toBe("resolved")
  })

  it("prunes old resolved events and feed items", async () => {
    const snapshot = createMockSnapshot()
    const database = new FakeDatabase()
    const repository = new ShippingRepository(database as unknown as Database)
    await repository.seed(snapshot.vessels, snapshot.ports, snapshot.voyages, snapshot.feedItems, snapshot.events, snapshot.settings)
    await repository.pruneExpired(1, new Date("2099-01-03T00:00:00.000Z"))
    expect(await repository.listEvents()).toHaveLength(snapshot.events.filter(event => event.status === "active").length)
    expect(await repository.listFeedItems()).toHaveLength(0)
  })

  it("roundtrips an identity-only AIS Vessel with a nullable statusChangedAt", async () => {
    const snapshot = createMockSnapshot()
    const database = new FakeDatabase()
    const repository = new ShippingRepository(database as unknown as Database)
    const identityOnly = {
      ...snapshot.vessels[0],
      navigationStatus: "unknown" as const,
      statusChangedAt: undefined,
      stale: true,
      sourceStatus: "degraded" as const,
      provenance: { sourceType: "third_party" as const, dataNature: "observed" as const, sourceId: "aisstream" },
    }
    await repository.upsertVessel(identityOnly)
    expect(database.table("vessels").get(identityOnly.id)?.status_changed_at).toBeNull()
    expect((await repository.listVessels())[0]).toMatchObject({ id: identityOnly.id, navigationStatus: "unknown", sourceStatus: "degraded" })
    expect((await repository.listVessels())[0].statusChangedAt).toBeUndefined()
    const normal = { ...identityOnly, navigationStatus: "anchored" as const, statusChangedAt: "2026-08-17T00:00:00.000Z", stale: false, sourceStatus: "healthy" as const }
    await repository.upsertVessel(normal)
    expect((await repository.listVessels())[0].statusChangedAt).toBe(normal.statusChangedAt)
  })

  it("rebuilds an old NOT NULL vessel schema without dropping rows or watch state", async () => {
    const snapshot = createMockSnapshot()
    const database = new FakeDatabase()
    database.vesselStatusChangedAtNotNull = true
    const vessel = { ...snapshot.vessels[0], isWatched: false }
    database.table("vessels").set(vessel.id, { id: vessel.id, data: JSON.stringify(vessel), is_watched: 0, status_changed_at: vessel.statusChangedAt })
    await initShippingTables(database as unknown as Database)
    expect(database.vesselStatusChangedAtNotNull).toBe(false)
    expect(database.table("vessels").get(vessel.id)).toMatchObject({ id: vessel.id, is_watched: 0, status_changed_at: vessel.statusChangedAt })
    expect((await new ShippingRepository(database as unknown as Database).listVessels())[0].isWatched).toBe(vessel.isWatched)
    await initShippingTables(database as unknown as Database)
    expect(database.vesselStatusChangedAtNotNull).toBe(false)
  })

  it("keeps same-condition Mock and AIS Events as separate history rows", async () => {
    const snapshot = createMockSnapshot()
    const database = new FakeDatabase()
    const repository = new ShippingRepository(database as unknown as Database)
    const mockEvent = { ...snapshot.events[0] }
    const aisEvent = {
      ...mockEvent,
      id: "event-vessel_anchored:vessel-ever-glory:aisstream",
      dedupeKey: "vessel_anchored:vessel-ever-glory:aisstream",
      provenance: { sourceType: "third_party" as const, dataNature: "derived" as const, sourceId: "aisstream" },
      evidence: [{ provenance: { sourceType: "third_party" as const, dataNature: "observed" as const, sourceId: "aisstream" }, sourceUpdatedAt: "2026-08-17T00:00:00.000Z" }],
    }
    await repository.upsertEvent(mockEvent)
    await repository.upsertEvent(aisEvent)
    expect(await repository.listEvents()).toHaveLength(2)
    await repository.upsertEvent({ ...aisEvent, lastDetectedAt: "2026-08-17T01:00:00.000Z" })
    expect(await repository.listEvents()).toHaveLength(2)
    expect((await repository.listEvents()).find(event => event.dedupeKey === mockEvent.dedupeKey)?.id).toBe(mockEvent.id)
    expect((await repository.listEvents()).find(event => event.dedupeKey === aisEvent.dedupeKey)?.lastDetectedAt).toBe("2026-08-17T01:00:00.000Z")
  })

  it("persists fetchedAt separately and retains unknown-publication items by fetch time", async () => {
    const snapshot = createMockSnapshot()
    const database = new FakeDatabase()
    const repository = new ShippingRepository(database as unknown as Database)
    const unknown = { ...snapshot.feedItems[0], id: "feed-unknown-published", publishedAt: "", publicationTimeKnown: false, eventEligibility: false, updatedAt: "2099-01-01T00:00:00.000Z", fetchedAt: "2026-08-15T10:00:00.000Z" }
    const expiredUnknown = { ...unknown, id: "feed-unknown-expired", fetchedAt: "2026-08-13T10:00:00.000Z" }
    const normalOld = { ...snapshot.feedItems[1], id: "feed-published-expired", publishedAt: "2026-08-13T10:00:00.000Z", updatedAt: "2099-01-01T00:00:00.000Z", fetchedAt: "2026-08-15T10:00:00.000Z" }
    await repository.upsertFeedItem(unknown)
    await repository.upsertFeedItem(expiredUnknown)
    await repository.upsertFeedItem(normalOld)

    expect(database.table("feed_items").get(unknown.id)).toMatchObject({ published_at: "", fetched_at: unknown.fetchedAt })
    await repository.pruneExpired(1, new Date("2026-08-15T12:00:00.000Z"))

    const remaining = await repository.listFeedItems()
    expect(remaining.map(item => item.id)).toEqual([unknown.id])
  })

  it("backfills only deterministically known legacy provenance", async () => {
    const snapshot = createMockSnapshot()
    const database = new FakeDatabase()
    const legacyVessel = { ...snapshot.vessels[0], provenance: undefined }
    const legacyPort = { ...snapshot.ports[0], provenance: undefined }
    const legacyEvent = { ...snapshot.events[2], provenance: undefined, evidence: undefined }
    const unknownFeed = { ...snapshot.feedItems[0], sourceId: "legacy-news", provenance: undefined }
    database.table("vessels").set(legacyVessel.id, { id: legacyVessel.id, data: JSON.stringify(legacyVessel) })
    database.table("ports").set(legacyPort.id, { id: legacyPort.id, data: JSON.stringify(legacyPort) })
    database.table("events").set(legacyEvent.id, { id: legacyEvent.id, data: JSON.stringify(legacyEvent) })
    database.table("feed_items").set(unknownFeed.id, { id: unknownFeed.id, data: JSON.stringify(unknownFeed) })
    const repository = new ShippingRepository(database as unknown as Database)

    expect((await repository.listVessels())[0].provenance).toBeUndefined()
    expect((await repository.listVessels({ vessel: { sourceType: "mock", dataNature: "observed", sourceId: "mock-vessel" } }))[0].provenance).toMatchObject({ sourceId: "mock-vessel" })
    const ports = await repository.listPorts({ port: { sourceType: "mock", dataNature: "derived", sourceId: "mock-port" } })
    expect(ports[0].provenance).toMatchObject({ sourceId: "mock-port" })
    expect((await repository.listEvents({ ports }))[0]).toMatchObject({ provenance: { sourceId: "mock-port", dataNature: "derived" }, evidence: [{ provenance: { sourceId: "mock-port", dataNature: "derived" } }] })
    expect((await repository.listFeedItems())[0].provenance).toBeUndefined()
  })

  it("initializes and persists the minimal calendar_events table", async () => {
    const snapshot = createMockSnapshot()
    const calendarEvents = createMockCalendarEvents(2026, "2026-08-15T00:00:00.000Z")
    calendarEvents[0] = { ...calendarEvents[0], scope: "subdivision", subdivisionCode: "my-05", subdivisionCodes: ["my-05"], scopeLabel: "Negeri Sembilan" }
    const database = new FakeDatabase()
    await initShippingTables(database as unknown as Database)
    const repository = new ShippingRepository(database as unknown as Database)
    await repository.seed(snapshot.vessels, snapshot.ports, snapshot.voyages, snapshot.feedItems, [], snapshot.settings, calendarEvents)
    const stored = await repository.listCalendarEvents()
    expect(stored).toHaveLength(10)
    expect(stored[0]).toMatchObject({ countryCode: "TH", sourceId: "mock-calendar", stale: false })
    expect(stored.find(event => event.id === calendarEvents[0].id)).toMatchObject({ scope: "subdivision", subdivisionCode: "my-05", subdivisionCodes: ["my-05"], scopeLabel: "Negeri Sembilan" })
  })

  it("roundtrips only the bounded AIS area aggregate metric", async () => {
    const database = new FakeDatabase()
    const repository = new ShippingRepository(database as unknown as Database)
    const metric = {
      portId: "port-shekou",
      sampleSize: 5,
      activeVesselCount: 5,
      anchoredCount: 4,
      mooredCount: 0,
      lowSpeedCount: 4,
      stationaryRatio: 0.8,
      ambiguousSampleCount: 1,
      trend: "rising" as const,
      consecutiveRisingWindows: 3,
      bucketStartedAt: "2026-08-19T00:00:00.000Z",
      bucketEndedAt: "2026-08-19T00:05:00.000Z",
      bbox: { south: 22, west: 113, north: 23, east: 114 },
      boundarySource: "configured_heuristic" as const,
      coverage: "usable" as const,
      lowSpeedThresholdKnots: 1,
      minimumSampleSize: 5,
      stale: false,
      sourceStatus: "healthy" as const,
      fetchedAt: "2026-08-19T00:00:00.000Z",
      provenance: { sourceType: "third_party" as const, dataNature: "derived" as const, sourceId: "aisstream-area" },
    }
    await repository.upsertAisPortMetric(metric)
    expect(await repository.listAisPortMetrics()).toEqual([metric])
    expect(database.table("ais_port_metrics").get("port-shekou")).toBeDefined()
  })
})
