import NativeDatabase from "better-sqlite3"
import { createDatabase } from "db0"
import { describe, expect, it, vi } from "vitest"
import { initShippingTables } from "./shipping"
import { VesselMetadataRepository } from "./vessel-search"
import { VesselSearchService } from "#/search/vessel"

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

const result = {
  id: "imo:9876543",
  name: "EVER GLORY",
  imo: "9876543",
  mmsi: "477123400",
  callsign: "9V1234",
  type: "Container ship",
  flag: "SG",
  source: "vesselapi",
  fetchedAt: "2026-08-21T00:00:00.000Z",
  source_type: "real" as const,
  providerRecordId: "vessel-1",
}

describe("vessel metadata persistence and search cache", () => {
  it("persists metadata and serves the same normalized search from SQLite cache", async () => {
    const { database, native } = createNativeDatabase()
    await initShippingTables(database, "real")
    const provider = { providerId: "vesselapi", search: vi.fn(async () => [result]) }
    const service = new VesselSearchService(new VesselMetadataRepository(database, "real"), provider, { now: () => new Date("2026-08-21T00:00:00.000Z") })

    await expect(service.search({ query: " EVER   GLORY " })).resolves.toMatchObject({ cacheHit: false, results: [expect.objectContaining({ imo: "9876543", callsign: "9V1234" })] })
    await expect(service.search({ query: "ever glory", field: "name" })).resolves.toMatchObject({ cacheHit: true, providerId: "vesselapi" })
    expect(provider.search).toHaveBeenCalledTimes(1)
    expect(native.prepare("SELECT name, imo, mmsi, callsign, type, flag, source, fetched_at FROM vessel_metadata WHERE id = ?").get(result.id)).toMatchObject({ name: "EVER GLORY", imo: "9876543", mmsi: "477123400", callsign: "9V1234", source: "vesselapi" })
    expect(native.prepare("SELECT search_key, result_ids FROM vessel_search_cache").get()).toEqual({ search_key: "name:ever glory", result_ids: JSON.stringify([result.id]) })
    native.close()
  })

  it("expires a cache entry and queries the provider again", async () => {
    const { database, native } = createNativeDatabase()
    await initShippingTables(database, "real")
    let now = new Date("2026-08-21T00:00:00.000Z")
    const provider = { providerId: "vesselapi", search: vi.fn(async () => [result]) }
    const service = new VesselSearchService(new VesselMetadataRepository(database, "real"), provider, { now: () => now, cacheTtlMs: 60 * 1000 })
    await service.search({ query: "9876543" })
    now = new Date("2026-08-21T00:02:00.000Z")
    await expect(service.search({ query: "9876543" })).resolves.toMatchObject({ cacheHit: false })
    expect(provider.search).toHaveBeenCalledTimes(2)
    native.close()
  })

  it("rejects mock search results in Real Mode", async () => {
    const { database, native } = createNativeDatabase()
    await initShippingTables(database, "real")
    const provider = { providerId: "mock-vessel-search", search: vi.fn(async () => [{ ...result, source: "mock-vessel-search", source_type: "mock" as const }]) }
    const service = new VesselSearchService(new VesselMetadataRepository(database, "real"), provider)
    await expect(service.search({ query: "EVER GLORY" })).rejects.toThrow("mock_search_not_allowed_in_real_mode")
    expect(native.prepare("SELECT COUNT(*) AS count FROM vessel_metadata").get()).toEqual({ count: 0 })
    native.close()
  })

  it("keeps the provider canonical id while promoting IMO and updating MMSI", async () => {
    const { database, native } = createNativeDatabase()
    await initShippingTables(database, "real")
    const repository = new VesselMetadataRepository(database, "real")
    const incomplete: VesselSearchResult = {
      ...result,
      id: "vesselapi:vessel-123",
      name: "IDENTITY PROMOTION TEST",
      imo: undefined,
      mmsi: "111111111",
      providerRecordId: "vessel-123",
    }
    const first = (await repository.saveSearch({ query: incomplete.name }, [incomplete], "vesselapi", "real", new Date(result.fetchedAt)))[0]
    expect(first.id).toBe("vesselapi:vessel-123")

    const promoted = (await repository.saveSearch({ query: "9876543", field: "imo" }, [{
      ...incomplete,
      id: "imo:9876543",
      imo: "9876543",
    }], "vesselapi", "real", new Date(result.fetchedAt)))[0]
    expect(promoted.id).toBe("vesselapi:vessel-123")

    const changedMmsi = (await repository.saveSearch({ query: "9876543", field: "imo" }, [{
      ...promoted,
      id: "imo:9876543",
      mmsi: "222222222",
    }], "vesselapi", "real", new Date(result.fetchedAt)))[0]
    expect(changedMmsi.id).toBe("vesselapi:vessel-123")
    expect(native.prepare("SELECT COUNT(*) AS count FROM vessel_metadata").get()).toEqual({ count: 1 })
    expect(native.prepare("SELECT id, imo, mmsi, provider_record_id FROM vessel_metadata").get()).toEqual({ id: "vesselapi:vessel-123", imo: "9876543", mmsi: "222222222", provider_record_id: "vessel-123" })
    await expect(repository.getCachedSearch({ query: "9876543", field: "imo" })).resolves.toMatchObject({ results: [expect.objectContaining({ id: "vesselapi:vessel-123", imo: "9876543", mmsi: "222222222" })] })
    native.close()
  })

  it("rejects identity attributes that point to different canonical entities", async () => {
    const { database, native } = createNativeDatabase()
    await initShippingTables(database, "real")
    const repository = new VesselMetadataRepository(database, "real")
    await repository.saveSearch({ query: "VESSEL A" }, [{ ...result, id: "imo:1000001", name: "VESSEL A", imo: "1000001", mmsi: "111111111", providerRecordId: "a" }], "vesselapi", "real", new Date(result.fetchedAt))
    await repository.saveSearch({ query: "VESSEL B" }, [{ ...result, id: "imo:1000002", name: "VESSEL B", imo: "1000002", mmsi: "222222222", providerRecordId: "b" }], "vesselapi", "real", new Date(result.fetchedAt))

    await expect(repository.saveSearch({ query: "CONFLICT" }, [{
      ...result,
      id: "imo:1000001",
      name: "CONFLICT",
      imo: "1000001",
      mmsi: "222222222",
      providerRecordId: "a",
    }], "vesselapi", "real", new Date(result.fetchedAt))).rejects.toThrow("identity_conflict")
    expect(native.prepare("SELECT COUNT(*) AS count FROM vessel_metadata").get()).toEqual({ count: 2 })
    native.close()
  })
})
