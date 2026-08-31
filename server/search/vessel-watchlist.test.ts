import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import NativeDatabase from "better-sqlite3"
import { createDatabase } from "db0"
import { describe, expect, it } from "vitest"
import type { VesselSearchResult } from "@shared/vessel-search"
import { VesselWatchlistService } from "./vessel-watchlist"
import { initShippingTables } from "#/database/shipping"
import { VesselMetadataRepository } from "#/database/vessel-search"

function createNativeDatabase(path = ":memory:") {
  const native = new NativeDatabase(path)
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

const fetchedAt = "2026-08-21T00:00:00.000Z"

function searchResult(overrides: Partial<VesselSearchResult>): VesselSearchResult {
  return {
    id: "vesselapi:dong-fang-fu",
    name: "DONG FANG FU",
    imo: "9162423",
    mmsi: "413393620",
    callsign: "BPCL3",
    type: "Container Ship",
    flag: "China",
    source: "vesselapi",
    fetchedAt,
    source_type: "real",
    providerRecordId: "dong-fang-fu",
    ...overrides,
  }
}

async function persistSearch(repository: VesselMetadataRepository, result: VesselSearchResult, query: string, providerId = "vesselapi") {
  return (await repository.saveSearch({ query, field: "name" }, [result], providerId, "real", new Date(fetchedAt)))[0]
}

describe("vessel search watchlist", () => {
  it("deduplicates name, IMO and MMSI results and preserves metadata", async () => {
    const { database, native } = createNativeDatabase()
    await initShippingTables(database, "real")
    const metadata = new VesselMetadataRepository(database, "real")
    const watchlist = new VesselWatchlistService(database, "real")
    const nameResult = await persistSearch(metadata, searchResult({ imo: undefined }), "DONG FANG FU")
    const imoResult = await persistSearch(metadata, searchResult({ id: "imo:9162423" }), "9162423")
    const mmsiResult = await persistSearch(metadata, searchResult({ id: "mmsi:413393620", imo: undefined }), "413393620")

    await expect(watchlist.add(nameResult.id)).resolves.toMatchObject({ id: "vesselapi:dong-fang-fu", aisTrackingAvailable: true })
    await expect(watchlist.add(imoResult.id)).resolves.toMatchObject({ id: "vesselapi:dong-fang-fu", imo: "9162423" })
    await expect(watchlist.add(mmsiResult.id)).resolves.toMatchObject({ id: "vesselapi:dong-fang-fu", mmsi: "413393620" })
    expect(await watchlist.list()).toEqual([expect.objectContaining({ id: "vesselapi:dong-fang-fu", name: "DONG FANG FU", callsign: "BPCL3", source: "vesselapi", aisTrackingAvailable: true })])
    expect(native.prepare("SELECT COUNT(*) AS count FROM vessel_watchlist").get()).toEqual({ count: 1 })

    await expect(watchlist.remove(mmsiResult.id)).resolves.toBe(true)
    expect(await watchlist.list()).toEqual([])

    const noMmsiResult = searchResult({ id: "vesselapi:name:no-mmsi", imo: undefined, mmsi: undefined, callsign: "NOMMSI", providerRecordId: undefined, name: "NO MMSI VESSEL" })
    const persistedNoMmsi = await persistSearch(metadata, noMmsiResult, "NO MMSI VESSEL")
    await expect(watchlist.add(persistedNoMmsi.id)).resolves.toMatchObject({ id: "vesselapi:name:no mmsi vessel", aisEnabled: false, aisTrackingAvailable: false })
    expect((await watchlist.list())[0].mmsi).toBeUndefined()
    native.close()
  })

  it("persists a DONG FANG FU watch across a database restart", async () => {
    const directory = await mkdtemp(join(tmpdir(), "shipping-hot-p2b-watchlist-"))
    const path = join(directory, "shipping-hot.sqlite3")
    try {
      const first = createNativeDatabase(path)
      await initShippingTables(first.database, "real")
      const result = await persistSearch(new VesselMetadataRepository(first.database, "real"), searchResult({ id: "imo:9162423" }), "DONG FANG FU")
      await expect(new VesselWatchlistService(first.database, "real").add(result.id)).resolves.toMatchObject({ name: "DONG FANG FU", imo: "9162423", mmsi: "413393620" })
      first.native.close()

      const second = createNativeDatabase(path)
      await initShippingTables(second.database, "real")
      await expect(new VesselWatchlistService(second.database, "real").list()).resolves.toEqual([expect.objectContaining({ id: "imo:9162423", name: "DONG FANG FU", imo: "9162423", mmsi: "413393620" })])
      second.native.close()
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it("promotes incomplete provider identities without duplicating the watch", async () => {
    const { database, native } = createNativeDatabase()
    await initShippingTables(database, "real")
    const metadata = new VesselMetadataRepository(database, "real")
    const watchlist = new VesselWatchlistService(database, "real")

    const incomplete = await persistSearch(metadata, searchResult({
      id: "vesselapi:vessel-123",
      name: "PROVIDER IDENTITY TEST",
      imo: undefined,
      mmsi: "111111111",
      providerRecordId: "vessel-123",
    }), "PROVIDER IDENTITY TEST")
    await expect(watchlist.add(incomplete.id)).resolves.toMatchObject({ id: "vesselapi:vessel-123", mmsi: "111111111" })

    const promoted = await persistSearch(metadata, searchResult({
      id: "imo:9876543",
      name: "PROVIDER IDENTITY TEST",
      imo: "9876543",
      mmsi: "111111111",
      providerRecordId: "vessel-123",
    }), "9876543")
    expect(promoted.id).toBe("vesselapi:vessel-123")
    await expect(watchlist.add(promoted.id)).resolves.toMatchObject({ id: "vesselapi:vessel-123", imo: "9876543", mmsi: "111111111" })

    const changedMmsi = await persistSearch(metadata, searchResult({
      id: "imo:9876543",
      name: "PROVIDER IDENTITY TEST",
      imo: "9876543",
      mmsi: "222222222",
      providerRecordId: "vessel-123",
    }), "9876543")
    expect(changedMmsi.id).toBe("vesselapi:vessel-123")
    await expect(watchlist.add(changedMmsi.id)).resolves.toMatchObject({ id: "vesselapi:vessel-123", mmsi: "222222222" })
    expect(await watchlist.list()).toEqual([expect.objectContaining({ id: "vesselapi:vessel-123", imo: "9876543", mmsi: "222222222" })])
    expect(native.prepare("SELECT COUNT(*) AS count FROM vessel_metadata").get()).toEqual({ count: 1 })
    expect(native.prepare("SELECT COUNT(*) AS count FROM vessel_watchlist").get()).toEqual({ count: 1 })
    native.close()
  })

  it("promotes a name-and-provider watch when IMO and MMSI arrive later", async () => {
    const { database, native } = createNativeDatabase()
    await initShippingTables(database, "real")
    const metadata = new VesselMetadataRepository(database, "real")
    const watchlist = new VesselWatchlistService(database, "real")

    const incomplete = await persistSearch(metadata, searchResult({
      id: "vesselapi:vessel-456",
      name: "NAME PROVIDER TEST",
      imo: undefined,
      mmsi: undefined,
      providerRecordId: "vessel-456",
    }), "NAME PROVIDER TEST")
    await watchlist.add(incomplete.id)

    const complete = await persistSearch(metadata, searchResult({
      id: "imo:9162423",
      name: "NAME PROVIDER TEST",
      imo: "9162423",
      mmsi: "413393620",
      providerRecordId: "vessel-456",
    }), "9162423")
    expect(complete.id).toBe("vesselapi:vessel-456")
    await watchlist.add(complete.id)
    expect(await watchlist.list()).toEqual([expect.objectContaining({ id: "vesselapi:vessel-456", imo: "9162423", mmsi: "413393620" })])
    expect(native.prepare("SELECT COUNT(*) AS count FROM vessel_watchlist").get()).toEqual({ count: 1 })
    native.close()
  })

  it("keeps same-name strong identities in separate watches", async () => {
    const { database, native } = createNativeDatabase()
    await initShippingTables(database, "real")
    const metadata = new VesselMetadataRepository(database, "real")
    const watchlist = new VesselWatchlistService(database, "real")

    const first = await persistSearch(metadata, searchResult({
      id: "vesselapi:A",
      name: "SAME NAME",
      imo: undefined,
      mmsi: "111111111",
      providerRecordId: "A",
    }), "SAME NAME")
    const second = await persistSearch(metadata, searchResult({
      id: "vesselapi:B",
      name: "SAME NAME",
      imo: undefined,
      mmsi: "222222222",
      providerRecordId: "B",
    }), "SAME NAME")
    await watchlist.add(first.id)
    await watchlist.add(second.id)
    expect(await watchlist.list()).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "vesselapi:A", mmsi: "111111111", providerRecordId: "A" }),
      expect.objectContaining({ id: "vesselapi:B", mmsi: "222222222", providerRecordId: "B" }),
    ]))
    expect((await watchlist.list())).toHaveLength(2)

    await expect(watchlist.remove(second.id)).resolves.toBe(true)
    expect(await watchlist.list()).toEqual([expect.objectContaining({ id: "vesselapi:A", mmsi: "111111111", providerRecordId: "A" })])
    native.close()
  })

  it("promotes a truly provisional name watch without duplicating it", async () => {
    const { database, native } = createNativeDatabase()
    await initShippingTables(database, "real")
    const metadata = new VesselMetadataRepository(database, "real")
    const watchlist = new VesselWatchlistService(database, "real")

    const provisional = await persistSearch(metadata, searchResult({
      id: "vesselapi:name:same name",
      name: "SAME NAME",
      imo: undefined,
      mmsi: undefined,
      providerRecordId: undefined,
    }), "SAME NAME")
    await watchlist.add(provisional.id)

    const complete = await persistSearch(metadata, searchResult({
      id: "imo:9876543",
      name: "SAME NAME",
      imo: "9876543",
      mmsi: "222222222",
      providerRecordId: "A",
    }), "9876543")
    expect(complete.id).toBe(provisional.id)
    await watchlist.add(complete.id)
    expect(await watchlist.list()).toEqual([expect.objectContaining({ id: provisional.id, imo: "9876543", mmsi: "222222222", providerRecordId: "A" })])
    expect(native.prepare("SELECT COUNT(*) AS count FROM vessel_metadata").get()).toEqual({ count: 1 })
    expect(native.prepare("SELECT COUNT(*) AS count FROM vessel_watchlist").get()).toEqual({ count: 1 })
    native.close()
  })

  it("uses the current GFW MMSI for Watchlist/AIS eligibility while retaining historical MMSIs", async () => {
    const { database, native } = createNativeDatabase()
    await initShippingTables(database, "real")
    const metadata = new VesselMetadataRepository(database, "real")
    const watchlist = new VesselWatchlistService(database, "real")
    const hansa = await persistSearch(metadata, searchResult({
      id: "imo:9155391",
      name: "HANSA BREITENBURG",
      imo: "9155391",
      mmsi: "538090733",
      callsign: "V7B3029",
      flag: "MHL",
      source: "gfw",
      providerRecordId: "c208e013b-bd7e-8fd3-126e-8c91e6958831",
      identityHistory: [
        { providerRecordId: "97db6280-e316-f58c-043d-1740bbb210f9", name: "HANSA BREITENBURG", imo: "9155391", mmsi: "636090756", callsign: "A8ET3", flag: "LBR", source: "gfw", transmissionDateFrom: "2012-01-01T01:26:05Z", transmissionDateTo: "2026-06-08T00:50:04Z" },
        { providerRecordId: "6561869d3-3c29-f6bb-24ab-ff765f60e1a2", name: "HANSA BREITENB5RG", imo: "9155391", mmsi: "770308484", callsign: "A8ET3", flag: "URY", source: "gfw", transmissionDateFrom: "2024-12-04T07:46:34Z", transmissionDateTo: "2024-12-04T10:28:07Z" },
        { providerRecordId: "c208e013b-bd7e-8fd3-126e-8c91e6958831", name: "HANSA BREITENBURG", imo: "9155391", mmsi: "538090733", callsign: "V7B3029", flag: "MHL", source: "gfw", transmissionDateFrom: "2026-06-08T00:49:32Z", transmissionDateTo: "2026-08-28T23:59:58Z" },
      ],
    }), "HANSA BREITENBURG", "gfw")
    const watched = await watchlist.add(hansa.id)
    expect(watched).toMatchObject({ id: "imo:9155391", mmsi: "538090733", aisEnabled: true, aisTrackingAvailable: true })
    expect(watched.identityHistory?.map(identity => identity.mmsi)).toEqual(["636090756", "770308484", "538090733"])
    expect(native.prepare("SELECT vessel_id, ais_enabled FROM vessel_watchlist").get()).toEqual({ vessel_id: "imo:9155391", ais_enabled: 1 })
    native.close()
  })
})
