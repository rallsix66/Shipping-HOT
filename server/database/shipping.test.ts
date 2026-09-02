import NativeDatabase from "better-sqlite3"
import { createDatabase } from "db0"
import { describe, expect, it } from "vitest"
import { createMockSnapshot } from "@shared/shipping-fixtures"
import type { VoyageRecord } from "@shared/voyage"
import { ShippingRepository, initShippingTables } from "./shipping"
import { VoyageRepository } from "./voyages"
import { p3FeedFreshnessMigration } from "./migrations/009-p3-feed-freshness"
import { p3FeedFreshnessReclassificationMigration } from "./migrations/010-p3-feed-freshness-reclassification"
import { createMockCalendarEvents } from "#/providers/calendar"
import { readLatestVoyage } from "#/services/voyage-read"

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
    expect(migration).toEqual({ version: 12, name: "translation-runtime-work-state" })
    expect(metadata).toMatchObject({ schema_version: 12, data_mode: "real" })
    expect(metadata.bootstrap_completed_at).toEqual(expect.any(String))
    expect(directory).toMatchObject({ port_directory_status: "ready", port_directory_version: "p1a-unlocode-baseline-v1", port_directory_imported_at: expect.any(String) })
    for (const table of ["translation_cache", "provider_usage", "provider_runtime", "sync_runs", "vessel_watchlist", "port_watchlist", "port_directory", "vessel_metadata", "vessel_search_cache", "ais_positions", "ais_latest_positions", "voyage_eta_history", "feed_item_history"]) {
      expect(native.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table)).toEqual({ 1: 1 })
    }
    for (const table of ["vessels", "ports", "voyages", "feed_items", "events", "calendar_events", "ais_port_metrics"]) {
      expect(native.prepare(`SELECT name FROM pragma_table_info('${table}') WHERE name = 'source_type'`).get()).toEqual({ name: "source_type" })
    }
    expect(native.prepare("SELECT COUNT(*) AS count FROM port_directory WHERE is_active = 1 AND source <> 'mock'").get()).toEqual({ count: 8 })
    expect(native.prepare("SELECT name FROM pragma_table_info('provider_runtime') WHERE name = 'provider_id'").get()).toEqual({ name: "provider_id" })
    expect(native.prepare("SELECT name FROM pragma_table_info('provider_runtime') WHERE name = 'capability'").get()).toEqual({ name: "capability" })
    expect(native.prepare("SELECT name FROM pragma_table_info('provider_usage') WHERE name = 'records_count'").get()).toEqual({ name: "records_count" })
    expect(native.prepare("SELECT COUNT(*) AS count FROM pragma_index_list('provider_runtime') WHERE origin = 'pk'").get()).toEqual({ count: 1 })
    expect(native.prepare("SELECT name FROM pragma_table_info('vessels') WHERE name = 'is_watched'").get()).toBeUndefined()
    expect(native.prepare("SELECT name FROM pragma_table_info('ports') WHERE name = 'is_watched'").get()).toBeUndefined()
    expect(native.prepare("SELECT name FROM pragma_table_info('voyages') WHERE name = 'origin_port_id'").get()).toEqual({ name: "origin_port_id" })
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

  it("keeps the legacy Snapshot Voyage aligned with the P3B latest Voyage API", async () => {
    const { database, native } = createNativeDatabase()
    await initShippingTables(database, "mock")
    const voyageRepository = new VoyageRepository(database, "mock")
    const shippingRepository = new ShippingRepository(database, "mock")
    const first: VoyageRecord = {
      id: "voyage-consistency-1",
      vesselId: "vessel-consistency-1",
      imo: "9162423",
      mmsi: "413393620",
      originPortId: "CNSHK",
      destinationPortId: "PHMNL",
      voyageNumber: "CONSISTENCY-001",
      status: "in_transit",
      eta: "2026-09-01T00:00:00.000Z",
      etd: "2026-08-24T00:00:00.000Z",
      source: "mock-voyage",
      sourceType: "mock",
      timestamp: "2026-08-24T00:00:00.000Z",
      lastUpdatedAt: "2026-08-24T00:00:00.000Z",
    }
    await voyageRepository.saveVoyages([first])
    await voyageRepository.saveVoyages([{ ...first, eta: "2026-09-03T00:00:00.000Z", lastUpdatedAt: "2026-08-25T00:00:00.000Z", timestamp: "2026-08-25T00:00:00.000Z" }])

    const snapshotVoyage = (await shippingRepository.listVoyages()).find(item => item.vesselId === first.vesselId)
    const latestVoyage = await readLatestVoyage(database, "mock", first.vesselId)
    expect(snapshotVoyage).toMatchObject({
      baselineEta: "2026-09-01T00:00:00.000Z",
      latestEta: "2026-09-03T00:00:00.000Z",
      delayMinutes: 2880,
    })
    expect(latestVoyage).toMatchObject({ eta: "2026-09-03T00:00:00.000Z" })
    expect(snapshotVoyage?.latestEta).toBe(latestVoyage?.eta)
    expect(snapshotVoyage?.baselineEta).not.toBe(snapshotVoyage?.latestEta)
    native.close()
  })

  it("keeps historical VesselAPI episodes visible with persisted episode state", async () => {
    const { database, native } = createNativeDatabase()
    await initShippingTables(database, "real")
    const voyageRepository = new VoyageRepository(database, "real")
    const makeVoyage = (destination: "PHMNL" | "SGSIN", timestamp: string, eta: string): VoyageRecord => ({
      id: `vesselapi:vessel-history:destination:${destination}:episode:${new Date(timestamp).toISOString().replace(/[.:-]/g, "")}`,
      vesselId: "vessel-history",
      imo: "9155391",
      mmsi: "538090733",
      destinationPortId: destination === "PHMNL" ? destination : undefined,
      status: "unknown",
      eta,
      source: "vesselapi",
      sourceType: "real",
      timestamp,
      lastUpdatedAt: timestamp,
    })
    const first = makeVoyage("PHMNL", "2026-09-01T10:00:00.000Z", "2026-09-03T00:00:00.000Z")
    const second = makeVoyage("SGSIN", "2026-09-02T10:00:00.000Z", "2026-09-08T00:00:00.000Z")
    const current = makeVoyage("PHMNL", "2026-10-18T10:00:00.000Z", "2026-10-20T00:00:00.000Z")
    await voyageRepository.saveVoyages([first, second, current])
    const voyages = await new ShippingRepository(database, "real").listVoyages()
    expect(voyages).toHaveLength(3)
    expect(voyages.find(item => item.id === first.id)).toMatchObject({ episodeState: "superseded", status: "unknown" })
    expect(voyages.find(item => item.id === second.id)).toMatchObject({ episodeState: "superseded", status: "unknown" })
    expect(voyages.find(item => item.id === current.id)).toMatchObject({ episodeState: "current", status: "unknown" })
    native.close()
  })

  it("backfills legacy Feed rows into append-only history during v9", async () => {
    const { database, native } = createNativeDatabase()
    native.exec(`
      CREATE TABLE feed_items (
        id TEXT PRIMARY KEY,
        source_id TEXT NOT NULL,
        category TEXT NOT NULL,
        type TEXT NOT NULL,
        title TEXT NOT NULL,
        summary TEXT NOT NULL,
        source_url TEXT NOT NULL,
        published_at TEXT NOT NULL,
        fetched_at TEXT NOT NULL,
        severity TEXT NOT NULL,
        related_port_ids TEXT NOT NULL,
        related_vessel_ids TEXT NOT NULL,
        related_voyage_ids TEXT NOT NULL,
        source_type TEXT NOT NULL,
        data TEXT NOT NULL
      )
    `)
    native.prepare(`
      INSERT INTO feed_items (
        id, source_id, category, type, title, summary, source_url,
        published_at, fetched_at, severity, related_port_ids,
        related_vessel_ids, related_voyage_ids, source_type, data
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      "legacy-feed",
      "mock-port-notice",
      "port_notice",
      "shipping_news",
      "Legacy notice",
      "Preserved during migration",
      "https://example.test/legacy-feed",
      "2026-08-20T00:00:00.000Z",
      "2026-08-20T00:01:00.000Z",
      "info",
      "[]",
      "[]",
      "[]",
      "mock",
      JSON.stringify({ id: "legacy-feed", sourceId: "mock-port-notice", title: "Legacy notice" }),
    )

    await p3FeedFreshnessMigration.up(database)
    expect(native.prepare("SELECT visibility FROM feed_items WHERE id = ?").get("legacy-feed")).toEqual({ visibility: "history" })
    expect(native.prepare("SELECT feed_item_id, observed_at, source_type FROM feed_item_history WHERE feed_item_id = ?").get("legacy-feed")).toEqual({
      feed_item_id: "legacy-feed",
      observed_at: "2026-08-20T00:01:00.000Z",
      source_type: "mock",
    })
    await p3FeedFreshnessMigration.up(database)
    expect(native.prepare("SELECT COUNT(*) AS count FROM feed_item_history WHERE feed_item_id = ?").get("legacy-feed")).toEqual({ count: 1 })
    native.close()
  })

  it("reclassifies v9 Feed rows and syncs current/history/quarantine state in v10", async () => {
    const { database, native } = createNativeDatabase()
    native.exec(`
      CREATE TABLE feed_items (
        id TEXT PRIMARY KEY,
        source_id TEXT NOT NULL,
        category TEXT NOT NULL,
        type TEXT NOT NULL,
        title TEXT NOT NULL,
        summary TEXT NOT NULL,
        source_url TEXT NOT NULL,
        published_at TEXT NOT NULL,
        fetched_at TEXT NOT NULL,
        severity TEXT NOT NULL,
        related_port_ids TEXT NOT NULL,
        related_vessel_ids TEXT NOT NULL,
        related_voyage_ids TEXT NOT NULL,
        source_type TEXT NOT NULL,
        data TEXT NOT NULL
      )
    `)
    await p3FeedFreshnessMigration.up(database)
    const insert = native.prepare(`
      INSERT INTO feed_items (
        id, source_id, category, type, title, summary, source_url,
        published_at, fetched_at, severity, related_port_ids,
        related_vessel_ids, related_voyage_ids, source_type, data
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    const add = (id: string, sourceType: string, publishedAt: string, data: Record<string, unknown>) => insert.run(
      id,
      `source-${id}`,
      "shipping_news",
      "shipping_news",
      id,
      id,
      `https://example.test/${id}`,
      publishedAt,
      "2026-08-20T00:01:00.000Z",
      "warning",
      "[]",
      "[]",
      "[]",
      sourceType,
      JSON.stringify({
        id,
        sourceId: `source-${id}`,
        category: "shipping_news",
        type: "shipping_news",
        title: id,
        summary: id,
        sourceUrl: `https://example.test/${id}`,
        publishedAt,
        fetchedAt: "2026-08-20T00:01:00.000Z",
        severity: "warning",
        relatedPortIds: [],
        relatedVesselIds: [],
        relatedVoyageIds: [],
        sourceStatus: "healthy",
        stale: false,
        eventEligibility: true,
        provenance: { sourceType: sourceType === "mock" ? "mock" : "third_party", dataNature: "reported", sourceId: `source-${id}` },
        ...data,
      }),
    )
    add("feed-v10-current", "real", "2026-08-20T00:00:00.000Z", {})
    add("feed-v10-expired", "imported", "2026-08-01T00:00:00.000Z", {})
    add("feed-v10-mock-valid", "mock", "2026-08-20T00:00:00.000Z", {})
    add("feed-v10-invalid", "mock", "2026-08-20T00:00:00.000Z", { effectiveAt: "not-a-date" })

    const now = new Date("2026-08-25T00:00:00.000Z")
    await p3FeedFreshnessReclassificationMigration.up(database, now)
    const states = native.prepare("SELECT id, visibility, current_until, source_type FROM feed_items ORDER BY id").all()
    expect(states).toEqual([
      { id: "feed-v10-current", visibility: "current", current_until: "2026-09-03T00:00:00.000Z", source_type: "real" },
      { id: "feed-v10-expired", visibility: "history", current_until: "2026-08-15T00:00:00.000Z", source_type: "imported" },
      { id: "feed-v10-invalid", visibility: "quarantine", current_until: null, source_type: "mock" },
      { id: "feed-v10-mock-valid", visibility: "current", current_until: "2026-09-03T00:00:00.000Z", source_type: "mock" },
    ])
    const invalidData = JSON.parse(String((native.prepare("SELECT data FROM feed_items WHERE id = ?").get("feed-v10-invalid") as { data: string }).data)) as Record<string, unknown>
    expect(invalidData).toMatchObject({ visibility: "quarantine", eventEligibility: false, source_type: "mock", effectiveAt: "not-a-date" })
    expect(native.prepare("SELECT COUNT(*) AS count FROM feed_item_history").get()).toEqual({ count: 4 })
    expect(native.prepare("SELECT visibility, source_type FROM feed_item_history WHERE feed_item_id = ?").get("feed-v10-invalid")).toEqual({ visibility: "quarantine", source_type: "mock" })
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
    expect(await repository.listFeedItems()).toEqual([])
    expect((await repository.listFeedItems({ view: "history" })).map(item => item.id)).toEqual([unknown.id])
    native.close()
  })

  it("persists current Feed rows separately from append-only history and archives source disappearance", async () => {
    const { repository, native } = await preparedRepository()
    const snapshot = createMockSnapshot()
    const now = new Date("2026-01-11T00:00:00.000Z")
    const current = { ...snapshot.feedItems[0], id: "feed-current", publishedAt: "2026-01-10T00:00:00.000Z", fetchedAt: "2026-01-10T00:01:00.000Z" }
    const unknown = { ...snapshot.feedItems[0], id: "feed-quarantine", publishedAt: "", publicationTimeKnown: false, fetchedAt: "2026-01-10T00:02:00.000Z" }
    await repository.upsertFeedItem(current)
    await repository.upsertFeedItem({ ...current, fetchedAt: "2026-01-10T00:03:00.000Z", summary: "updated observation" })
    await repository.upsertFeedItem(unknown)

    expect((await repository.listFeedItems({ now })).map(item => item.id)).toEqual([current.id])
    expect((await repository.listFeedItems({ view: "history", now })).map(item => item.id)).toEqual([unknown.id])
    expect(await repository.listFeedHistory({ sourceId: current.sourceId, limit: 10 })).toEqual(expect.arrayContaining([
      expect.objectContaining({ feedItemId: current.id, item: expect.objectContaining({ summary: current.summary }) }),
      expect.objectContaining({ feedItemId: current.id, item: expect.objectContaining({ summary: "updated observation" }) }),
    ]))

    expect(await repository.archiveFeedItemsNotIn([current.sourceId], new Set(), now)).toBe(1)
    expect(await repository.listFeedItems({ now })).toEqual([])
    expect((await repository.listFeedHistory({ query: "updated observation", limit: 10 })).map(record => record.item.id)).toContain(current.id)
    native.close()
  })

  it("filters Feed history query and source before applying the limit", async () => {
    const { repository, native } = await preparedRepository()
    const snapshot = createMockSnapshot()
    const base = snapshot.feedItems[0]
    const targetSource = base.sourceId
    const add = (id: string, fetchedAt: string, title: string, sourceId = targetSource) => repository.upsertFeedItem({
      ...base,
      id,
      sourceId,
      title,
      summary: title,
      fetchedAt,
      publishedAt: "2026-01-10T00:00:00.000Z",
    })
    await add("feed-history-newest-unmatched", "2026-01-10T00:04:00.000Z", "newest unrelated")
    await add("feed-history-second-unmatched", "2026-01-10T00:03:00.000Z", "second unrelated")
    await add("feed-history-older-match", "2026-01-10T00:01:00.000Z", "older needle match")
    await add("feed-history-other-source-match", "2026-01-10T00:05:00.000Z", "needle from another source", "other-source")

    const result = await repository.listFeedHistory({ query: "needle", sourceId: targetSource, limit: 1 })
    expect(result.map(record => record.item.id)).toEqual(["feed-history-older-match"])
    expect(await repository.listFeedHistory({ query: "needle", sourceId: targetSource, limit: 500 })).toHaveLength(1)
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
