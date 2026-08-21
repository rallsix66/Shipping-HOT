import NativeDatabase from "better-sqlite3"
import { createDatabase } from "db0"
import { describe, expect, it } from "vitest"
import { createMockSnapshot } from "@shared/shipping-fixtures"
import { ShippingRepository, initShippingTables } from "./shipping"
import { createMockCalendarEvents } from "#/providers/calendar"

function createNativeDatabase() {
  const native = new NativeDatabase(":memory:")
  const database = createDatabase({
    name: "sqlite",
    dialect: "sqlite",
    getInstance: () => native,
    exec: (sql: string) => native.exec(sql),
    prepare: (sql: string) => {
      const statement = native.prepare(sql)
      return {
        all: async (...params: (string | number | boolean | null | undefined)[]) => statement.all(...params),
        get: async (...params: (string | number | boolean | null | undefined)[]) => statement.get(...params),
        run: async (...params: (string | number | boolean | null | undefined)[]) => {
          const result = statement.run(...params)
          return { success: result.changes > 0, changes: result.changes, lastInsertRowid: result.lastInsertRowid }
        },
      }
    },
    dispose: () => native.close(),
  } as never)
  return { database, native }
}

async function preparedRepository() {
  const state = createNativeDatabase()
  await initShippingTables(state.database, "mock")
  return { ...state, repository: new ShippingRepository(state.database) }
}

async function preparedRealRepository() {
  const state = createNativeDatabase()
  await initShippingTables(state.database, "real")
  return { ...state, repository: new ShippingRepository(state.database, "real") }
}

describe("shippingRepository", () => {
  it("runs the P0 migration runner and records foundation metadata", async () => {
    const { database, native } = createNativeDatabase()
    await initShippingTables(database, "real")
    await initShippingTables(database, "real")
    const migration = native.prepare("SELECT version, name FROM schema_migrations ORDER BY version DESC LIMIT 1").get() as { version: number, name: string }
    const metadata = native.prepare("SELECT schema_version, bootstrap_completed_at, data_mode FROM app_metadata WHERE id = 'default'").get() as { schema_version: number, bootstrap_completed_at?: string, data_mode: string }
    const directory = native.prepare("SELECT port_directory_status, port_directory_version, port_directory_imported_at FROM port_directory_status WHERE id = 'default'").get() as { port_directory_status: string, port_directory_version?: string, port_directory_imported_at?: string }
    expect(migration).toEqual({ version: 5, name: "p2a-search-foundation" })
    expect(metadata).toMatchObject({ schema_version: 5, data_mode: "real" })
    expect(metadata.bootstrap_completed_at).toEqual(expect.any(String))
    expect(directory).toMatchObject({ port_directory_status: "ready", port_directory_version: "p1a-unlocode-baseline-v1", port_directory_imported_at: expect.any(String) })
    for (const table of ["translation_cache", "provider_usage", "provider_runtime", "sync_runs", "vessel_watchlist", "port_watchlist", "port_directory", "vessel_metadata", "vessel_search_cache"]) {
      expect(native.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table)).toEqual({ 1: 1 })
    }
    for (const table of ["vessels", "ports", "voyages", "feed_items", "events", "calendar_events", "ais_port_metrics"]) {
      expect(native.prepare(`SELECT name FROM pragma_table_info('${table}') WHERE name = 'source_type'`).get()).toEqual({ name: "source_type" })
    }
    expect(native.prepare("SELECT COUNT(*) AS count FROM port_directory WHERE is_active = 1 AND source <> 'mock'").get()).toEqual({ count: 8 })
    expect(native.prepare("SELECT name FROM pragma_table_info('vessels') WHERE name = 'is_watched'").get()).toBeUndefined()
    expect(native.prepare("SELECT name FROM pragma_table_info('ports') WHERE name = 'is_watched'").get()).toBeUndefined()
    native.close()
  })

  it("seeds and reads all provider facts and settings", async () => {
    const { repository, native } = await preparedRepository()
    const snapshot = createMockSnapshot()
    await repository.seed(snapshot.vessels, snapshot.ports, snapshot.voyages, snapshot.feedItems, snapshot.events, snapshot.settings)
    expect(await repository.listVessels()).toHaveLength(snapshot.vessels.length)
    expect((await repository.listVessels())[0].provenance).toMatchObject({ sourceType: "mock", sourceId: "mock-vessel" })
    expect(await repository.listPorts()).toHaveLength(snapshot.ports.length)
    expect(await repository.listVoyages()).toHaveLength(snapshot.voyages.length)
    expect(await repository.listFeedItems()).toHaveLength(snapshot.feedItems.length)
    expect(await repository.listEvents()).toHaveLength(snapshot.events.length)
    expect((await repository.listEvents()).every(event => (event.evidence?.length ?? 0) > 0)).toBe(true)
    expect(await repository.getSettings()).toMatchObject({ refreshInterval: 15, retentionDays: 30, eventThresholds: { anchoredHours: 24, delayMinutes: 120 } })
    native.close()
  })

  it("keeps Mock rows out of every Real Mode Repository query", async () => {
    const { repository, native } = await preparedRealRepository()
    const snapshot = createMockSnapshot()
    await repository.seed(snapshot.vessels, snapshot.ports, snapshot.voyages, snapshot.feedItems, snapshot.events, snapshot.settings, createMockCalendarEvents(2026))
    expect(await repository.listVessels()).toEqual([])
    expect(await repository.listPorts()).toEqual([])
    expect(await repository.listVoyages()).toEqual([])
    expect(await repository.listFeedItems()).toEqual([])
    expect(await repository.listEvents()).toEqual([])
    expect(await repository.listCalendarEvents()).toEqual([])

    const realVessel = { ...snapshot.vessels[0], source_type: "real" as const, provenance: { sourceType: "third_party" as const, dataNature: "observed" as const, sourceId: "aisstream" } }
    await repository.upsertVessel(realVessel)
    expect(await repository.listVessels()).toEqual([expect.objectContaining({ id: realVessel.id, source_type: "real" })])

    const mixedEvidenceEvent = { ...snapshot.events[0], source_type: "derived" as const, provenance: { sourceType: "third_party" as const, dataNature: "derived" as const, sourceId: "aisstream" }, evidence: [{ provenance: { sourceType: "mock" as const, dataNature: "observed" as const, sourceId: "mock-vessel" } }] }
    await expect(repository.upsertEvent(mixedEvidenceEvent)).rejects.toThrow("mock_record_not_allowed_in_real_mode")
    native.close()
  })

  it("keeps user watch state in its own table when Provider rows are upserted", async () => {
    const { repository, native } = await preparedRepository()
    const snapshot = createMockSnapshot()
    const vessel = snapshot.vessels[0]
    await repository.upsertVessel(vessel)
    expect(await repository.updateWatch("vessel", vessel.id, true)).toBe(true)
    await repository.upsertVessel({ ...vessel, isWatched: false, navigationStatus: "anchored" })
    expect((await repository.listVessels()).find(item => item.id === vessel.id)?.isWatched).toBe(true)
    const stored = native.prepare("SELECT data FROM vessels WHERE id = ?").get(vessel.id) as { data: string }
    expect(JSON.parse(stored.data).isWatched).toBe(false)
    expect(native.prepare("SELECT vessel_id FROM vessel_watchlist WHERE vessel_id = ?").get(vessel.id)).toEqual({ vessel_id: vessel.id })
    await repository.updateWatch("vessel", vessel.id, false)
    expect((await repository.listVessels()).find(item => item.id === vessel.id)?.isWatched).toBe(false)
    const settings = { ...snapshot.settings, refreshInterval: 30 }
    await repository.saveSettings(settings)
    expect((await repository.getSettings())?.refreshInterval).toBe(30)
    native.close()
  })

  it("prunes old resolved events and feed items", async () => {
    const { repository, native } = await preparedRepository()
    const snapshot = createMockSnapshot()
    await repository.seed(snapshot.vessels, snapshot.ports, snapshot.voyages, snapshot.feedItems, snapshot.events, snapshot.settings)
    await repository.pruneExpired(1, new Date("2099-01-03T00:00:00.000Z"))
    expect(await repository.listEvents()).toHaveLength(snapshot.events.filter(event => event.status === "active").length)
    expect(await repository.listFeedItems()).toHaveLength(0)
    native.close()
  })

  it("roundtrips an identity-only AIS Vessel with a nullable statusChangedAt", async () => {
    const { repository, native } = await preparedRepository()
    const snapshot = createMockSnapshot()
    const identityOnly = {
      ...snapshot.vessels[0],
      navigationStatus: "unknown" as const,
      statusChangedAt: undefined,
      stale: true,
      sourceStatus: "degraded" as const,
      provenance: { sourceType: "third_party" as const, dataNature: "observed" as const, sourceId: "aisstream" },
    }
    await repository.upsertVessel(identityOnly)
    expect(native.prepare("SELECT status_changed_at FROM vessels WHERE id = ?").get(identityOnly.id)).toEqual({ status_changed_at: null })
    expect((await repository.listVessels())[0]).toMatchObject({ id: identityOnly.id, navigationStatus: "unknown", sourceStatus: "degraded" })
    expect((await repository.listVessels())[0].statusChangedAt).toBeUndefined()
    native.close()
  })

  it("keeps same-condition Mock and AIS Events as separate history rows", async () => {
    const { repository, native } = await preparedRepository()
    const snapshot = createMockSnapshot()
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
    expect((await repository.listEvents()).find(event => event.dedupeKey === aisEvent.dedupeKey)?.lastDetectedAt).toBe("2026-08-17T01:00:00.000Z")
    native.close()
  })

  it("persists fetchedAt separately and retains unknown-publication items by fetch time", async () => {
    const { repository, native } = await preparedRepository()
    const snapshot = createMockSnapshot()
    const unknown = { ...snapshot.feedItems[0], id: "feed-unknown-published", publishedAt: "", publicationTimeKnown: false, updatedAt: "2099-01-01T00:00:00.000Z", fetchedAt: "2026-08-15T10:00:00.000Z" }
    const expiredUnknown = { ...unknown, id: "feed-unknown-expired", fetchedAt: "2026-08-13T10:00:00.000Z" }
    const normalOld = { ...snapshot.feedItems[1], id: "feed-published-expired", publishedAt: "2026-08-13T10:00:00.000Z", updatedAt: "2099-01-01T00:00:00.000Z", fetchedAt: "2026-08-15T10:00:00.000Z" }
    await repository.upsertFeedItem(unknown)
    await repository.upsertFeedItem(expiredUnknown)
    await repository.upsertFeedItem(normalOld)
    expect(native.prepare("SELECT published_at, fetched_at FROM feed_items WHERE id = ?").get(unknown.id)).toEqual({ published_at: "", fetched_at: unknown.fetchedAt })
    await repository.pruneExpired(1, new Date("2026-08-15T12:00:00.000Z"))
    expect((await repository.listFeedItems()).map(item => item.id)).toEqual([unknown.id])
    native.close()
  })

  it("initializes calendar and bounded AIS aggregate persistence", async () => {
    const { repository, native } = await preparedRepository()
    const snapshot = createMockSnapshot()
    const calendarEvents = createMockCalendarEvents(2026, "2026-08-15T00:00:00.000Z")
    await repository.seed(snapshot.vessels, snapshot.ports, snapshot.voyages, snapshot.feedItems, [], snapshot.settings, calendarEvents)
    expect(await repository.listCalendarEvents()).toHaveLength(calendarEvents.length)
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
    expect(await repository.listAisPortMetrics()).toEqual([{ ...metric, source_type: "derived" }])
    native.close()
  })
})
