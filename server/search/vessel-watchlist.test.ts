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
    id: "imo:9321483",
    name: "DONG FANG FU",
    imo: "9321483",
    mmsi: "477045900",
    callsign: "H3RC",
    type: "Container Ship",
    flag: "Panama",
    source: "vesselapi",
    fetchedAt,
    source_type: "real",
    ...overrides,
  }
}

async function persistSearch(repository: VesselMetadataRepository, result: VesselSearchResult, query: string) {
  await repository.saveSearch({ query, field: "name" }, [result], "vesselapi", "real", new Date(fetchedAt))
}

describe("vessel search watchlist", () => {
  it("deduplicates name, IMO and MMSI results and preserves metadata", async () => {
    const { database, native } = createNativeDatabase()
    await initShippingTables(database, "real")
    const metadata = new VesselMetadataRepository(database, "real")
    const watchlist = new VesselWatchlistService(database, "real")
    const nameResult = searchResult({ id: "mmsi:477045900", imo: undefined })
    const imoResult = searchResult({ id: "imo:9321483" })
    const mmsiResult = searchResult({ id: "mmsi:477045900", imo: undefined })
    await persistSearch(metadata, nameResult, "DONG FANG FU")
    await persistSearch(metadata, imoResult, "9321483")
    await persistSearch(metadata, mmsiResult, "477045900")

    await expect(watchlist.add(nameResult.id)).resolves.toMatchObject({ id: "mmsi:477045900", aisTrackingAvailable: true })
    await expect(watchlist.add(imoResult.id)).resolves.toMatchObject({ id: "imo:9321483", imo: "9321483" })
    await expect(watchlist.add(mmsiResult.id)).resolves.toMatchObject({ id: "imo:9321483", mmsi: "477045900" })
    expect(await watchlist.list()).toEqual([expect.objectContaining({ id: "imo:9321483", name: "DONG FANG FU", callsign: "H3RC", source: "vesselapi", aisTrackingAvailable: true })])
    expect(native.prepare("SELECT COUNT(*) AS count FROM vessel_watchlist").get()).toEqual({ count: 1 })

    await expect(watchlist.remove(mmsiResult.id)).resolves.toBe(true)
    expect(await watchlist.list()).toEqual([])

    const noMmsiResult = searchResult({ id: "vesselapi:name:no-mmsi", imo: undefined, mmsi: undefined, callsign: "NOMMSI" })
    await persistSearch(metadata, noMmsiResult, "NO MMSI VESSEL")
    await expect(watchlist.add(noMmsiResult.id)).resolves.toMatchObject({ id: "vesselapi:name:no-mmsi", aisEnabled: false, aisTrackingAvailable: false })
    expect((await watchlist.list())[0].mmsi).toBeUndefined()
    native.close()
  })

  it("persists a DONG FANG FU watch across a database restart", async () => {
    const directory = await mkdtemp(join(tmpdir(), "shipping-hot-p2b-watchlist-"))
    const path = join(directory, "shipping-hot.sqlite3")
    try {
      const first = createNativeDatabase(path)
      await initShippingTables(first.database, "real")
      const result = searchResult({ id: "imo:9321483" })
      await persistSearch(new VesselMetadataRepository(first.database, "real"), result, "DONG FANG FU")
      await expect(new VesselWatchlistService(first.database, "real").add(result.id)).resolves.toMatchObject({ name: "DONG FANG FU", imo: "9321483", mmsi: "477045900" })
      first.native.close()

      const second = createNativeDatabase(path)
      await initShippingTables(second.database, "real")
      await expect(new VesselWatchlistService(second.database, "real").list()).resolves.toEqual([expect.objectContaining({ id: "imo:9321483", name: "DONG FANG FU", imo: "9321483", mmsi: "477045900" })])
      second.native.close()
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
})
