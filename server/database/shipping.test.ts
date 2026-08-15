import { describe, expect, it } from "vitest"
import type { Database } from "db0"
import { createMockSnapshot } from "@shared/shipping-fixtures"
import { ShippingRepository, initShippingTables } from "./shipping"
import { createMockCalendarEvents } from "#/providers/calendar"

type StoredRow = Record<string, unknown>

class FakeStatement {
  constructor(private readonly database: FakeDatabase, private readonly sql: string) {}

  async run(...args: unknown[]) {
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
    const table = this.sql.match(/SELECT data FROM (\w+)/i)?.[1]
    return table ? [...this.database.table(table).values()] : []
  }
}

class FakeDatabase {
  private tables = new Map<string, Map<string, StoredRow>>()
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
    const database = new FakeDatabase()
    await initShippingTables(database as unknown as Database)
    const repository = new ShippingRepository(database as unknown as Database)
    await repository.seed(snapshot.vessels, snapshot.ports, snapshot.voyages, snapshot.feedItems, [], snapshot.settings, calendarEvents)
    const stored = await repository.listCalendarEvents()
    expect(stored).toHaveLength(10)
    expect(stored[0]).toMatchObject({ countryCode: "TH", sourceId: "mock-calendar", stale: false })
  })
})
