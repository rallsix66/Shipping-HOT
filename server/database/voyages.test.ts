import { mkdtempSync, rmSync } from "node:fs"
import { join } from "node:path"
import NativeDatabase from "better-sqlite3"
import { createDatabase } from "db0"
import { describe, expect, it } from "vitest"
import type { VoyageRecord } from "@shared/voyage"
import { initShippingTables } from "#/database/shipping"
import { VoyageRepository } from "#/database/voyages"

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

function voyage(overrides: Partial<VoyageRecord> = {}): VoyageRecord {
  return {
    id: "voyage-vessel-1-001",
    vesselId: "vessel-1",
    imo: "9162423",
    mmsi: "413393620",
    originPortId: "CNSHK",
    destinationPortId: "PHMNL",
    voyageNumber: "V001",
    status: "in_transit",
    eta: "2026-09-01T00:00:00.000Z",
    etd: "2026-08-24T00:00:00.000Z",
    source: "mock-voyage",
    sourceType: "mock",
    timestamp: "2026-08-24T00:00:00.000Z",
    lastUpdatedAt: "2026-08-24T00:00:00.000Z",
    ...overrides,
  }
}

describe("voyage repository", () => {
  it("preserves ETA history and returns the latest voyage", async () => {
    const { database, native } = createNativeDatabase()
    await initShippingTables(database, "mock")
    const repository = new VoyageRepository(database, "mock")
    await repository.saveVoyages([voyage()])
    await repository.saveVoyages([voyage({
      eta: "2026-09-03T00:00:00.000Z",
      timestamp: "2026-08-25T00:00:00.000Z",
      lastUpdatedAt: "2026-08-25T00:00:00.000Z",
    })])
    expect(native.prepare("SELECT baseline_eta, latest_eta, delay_minutes FROM voyages WHERE id = ?").get("voyage-vessel-1-001")).toEqual({
      baseline_eta: "2026-09-01T00:00:00.000Z",
      latest_eta: "2026-09-03T00:00:00.000Z",
      delay_minutes: 2880,
    })
    const stored = JSON.parse(String((native.prepare("SELECT data FROM voyages WHERE id = ?").get("voyage-vessel-1-001") as { data: string }).data)) as Record<string, unknown>
    expect(stored).toMatchObject({
      baselineEta: "2026-09-01T00:00:00.000Z",
      latestEta: "2026-09-03T00:00:00.000Z",
      delayMinutes: 2880,
    })
    expect(await repository.getLatestVoyage("vessel-1")).toMatchObject({ eta: "2026-09-03T00:00:00.000Z" })
    expect(await repository.listEtaHistory("voyage-vessel-1-001")).toMatchObject([
      { eta: "2026-09-01T00:00:00.000Z" },
      { eta: "2026-09-03T00:00:00.000Z" },
    ])
    expect(native.prepare("SELECT COUNT(*) AS count FROM voyage_eta_history").get()).toEqual({ count: 2 })
    native.close()
  })

  it("rejects records whose vesselId was not requested", async () => {
    const { database, native } = createNativeDatabase()
    await initShippingTables(database, "mock")
    const repository = new VoyageRepository(database, "mock")
    const result = await repository.saveVoyages([
      voyage(),
      voyage({ id: "voyage-vessel-9-001", vesselId: "vessel-9", mmsi: "999999999" }),
    ], "2026-08-24T00:00:00.000Z", { requestedVesselIds: ["vessel-1"] })
    expect(result).toMatchObject({ written: 1, rejectedVesselIds: 1, historyWritten: 1 })
    expect(await repository.getLatestVoyage("vessel-9")).toBeUndefined()
    expect(native.prepare("SELECT COUNT(*) AS count FROM voyages").get()).toEqual({ count: 1 })
    expect(await repository.getLatestVoyage("vessel-1")).toMatchObject({ vesselId: "vessel-1" })
    native.close()
  })

  it("does not let an older timestamp overwrite the latest voyage", async () => {
    const { database, native } = createNativeDatabase()
    await initShippingTables(database, "mock")
    const repository = new VoyageRepository(database, "mock")
    await repository.saveVoyages([voyage({
      eta: "2026-09-03T00:00:00.000Z",
      status: "departed",
      lastUpdatedAt: "2026-08-25T12:00:00.000Z",
      timestamp: "2026-08-25T12:00:00.000Z",
    })])
    const result = await repository.saveVoyages([voyage()], "2026-08-26T00:00:00.000Z")
    expect(result).toMatchObject({ written: 0, staleSkipped: 1, historyWritten: 0 })
    expect(await repository.getLatestVoyage("vessel-1")).toMatchObject({
      eta: "2026-09-03T00:00:00.000Z",
      status: "departed",
      lastUpdatedAt: "2026-08-25T12:00:00.000Z",
    })
    expect(native.prepare("SELECT COUNT(*) AS count FROM voyage_eta_history").get()).toEqual({ count: 1 })
    expect(await repository.listEtaHistory("voyage-vessel-1-001")).toMatchObject([
      { eta: "2026-09-03T00:00:00.000Z" },
    ])
    native.close()
  })

  it("persists voyage and ETA history across a native restart", async () => {
    const root = mkdtempSync("shipping-hot-voyage-")
    const path = join(root, "voyage.sqlite3")
    try {
      const first = createNativeDatabase(path)
      await initShippingTables(first.database, "mock")
      await new VoyageRepository(first.database, "mock").saveVoyages([voyage()])
      first.native.close()

      const second = createNativeDatabase(path)
      await initShippingTables(second.database, "mock")
      expect(await new VoyageRepository(second.database, "mock").getLatestVoyage("vessel-1")).toMatchObject({
        id: "voyage-vessel-1-001",
        eta: "2026-09-01T00:00:00.000Z",
      })
      expect(await new VoyageRepository(second.database, "mock").listEtaHistory("voyage-vessel-1-001")).toHaveLength(1)
      second.native.close()
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it("round-trips a real ETA observation without fabricating origin or voyage number", async () => {
    const { database, native } = createNativeDatabase()
    await initShippingTables(database, "real")
    const repository = new VoyageRepository(database, "real")
    const observation = voyage({
      id: "vesselapi:vessel-1:eta:2026-09-01T08:00:00.000Z",
      originPortId: undefined,
      destinationPortId: "PHMNL",
      voyageNumber: undefined,
      status: "unknown",
      etd: undefined,
      source: "vesselapi",
      sourceType: "real",
      timestamp: "2026-09-01T08:00:00.000Z",
      lastUpdatedAt: "2026-09-01T08:00:00.000Z",
    })
    await expect(repository.saveVoyages([observation])).resolves.toMatchObject({ written: 1, historyWritten: 1 })
    await expect(repository.getLatestVoyage("vessel-1")).resolves.toMatchObject({
      id: "vesselapi:vessel-1:destination:PHMNL:episode:20260901T080000000Z",
      destinationPortId: "PHMNL",
      originPortId: undefined,
      voyageNumber: undefined,
      status: "unknown",
      sourceType: "real",
    })
    const persistedId = "vesselapi:vessel-1:destination:PHMNL:episode:20260901T080000000Z"
    await expect(repository.getLatestVerifiedRealVoyage("vesselapi")).resolves.toMatchObject({ id: persistedId, destinationPortId: "PHMNL" })
    expect(await repository.listEtaHistory(persistedId)).toHaveLength(1)
    native.close()
  })

  it("keeps one stable ETA episode, freezes baseline, and appends ETA history", async () => {
    const { database, native } = createNativeDatabase()
    await initShippingTables(database, "real")
    const repository = new VoyageRepository(database, "real")
    const id = "vesselapi:vessel-1:destination:PHMNL:episode:20260901T100000000Z"
    const first = voyage({
      id,
      originPortId: undefined,
      destinationPortId: "PHMNL",
      voyageNumber: undefined,
      status: "unknown",
      etd: undefined,
      eta: "2026-09-03T00:00:00.000Z",
      source: "vesselapi",
      sourceType: "real",
      timestamp: "2026-09-01T10:00:00.000Z",
      lastUpdatedAt: "2026-09-01T10:00:00.000Z",
    })
    const second = { ...first, id: "vesselapi:vessel-1:destination:PHMNL:episode:20260901T110000000Z", eta: "2026-09-04T00:00:00.000Z", timestamp: "2026-09-01T11:00:00.000Z", lastUpdatedAt: "2026-09-01T11:00:00.000Z" }
    await repository.saveVoyages([first])
    await repository.saveVoyages([second])
    expect(native.prepare("SELECT COUNT(*) AS count, baseline_eta, latest_eta, delay_minutes FROM voyages WHERE id = ?").get(id)).toEqual({
      count: 1,
      baseline_eta: "2026-09-03T00:00:00.000Z",
      latest_eta: "2026-09-04T00:00:00.000Z",
      delay_minutes: 1440,
    })
    expect(await repository.listEtaHistory(id)).toHaveLength(2)
    expect(await repository.getLatestVoyage("vessel-1")).toMatchObject({ id, eta: "2026-09-04T00:00:00.000Z" })
    native.close()
  })

  it("creates a fresh episode when a vessel returns to an earlier destination", async () => {
    const { database, native } = createNativeDatabase()
    await initShippingTables(database, "real")
    const repository = new VoyageRepository(database, "real")
    const base = voyage({ source: "vesselapi", sourceType: "real", status: "unknown", voyageNumber: undefined, etd: undefined, originPortId: undefined })
    const episode = (destination: "PHMNL" | "SGSIN", timestamp: string, eta: string): VoyageRecord => ({
      ...base,
      id: `vesselapi:vessel-1:destination:${destination}:episode:${new Date(timestamp).toISOString().replace(/[.:-]/g, "")}`,
      destinationPortId: destination === "PHMNL" ? destination : undefined,
      timestamp,
      lastUpdatedAt: timestamp,
      eta,
    })
    const first = episode("PHMNL", "2026-09-01T10:00:00.000Z", "2026-09-03T00:00:00.000Z")
    const firstUpdate = episode("PHMNL", "2026-09-01T11:00:00.000Z", "2026-09-04T00:00:00.000Z")
    const second = episode("SGSIN", "2026-09-02T10:00:00.000Z", "2026-09-08T00:00:00.000Z")
    const returnObservation = episode("PHMNL", "2026-10-18T10:00:00.000Z", "2026-10-20T00:00:00.000Z")
    const returnUpdate = episode("PHMNL", "2026-10-18T11:00:00.000Z", "2026-10-21T00:00:00.000Z")

    await expect(repository.saveVoyages([first])).resolves.toMatchObject({ newEpisodes: 1, acceptedIds: [first.id] })
    await expect(repository.saveVoyages([firstUpdate])).resolves.toMatchObject({ reusedEpisodes: 1, acceptedIds: [first.id] })
    await expect(repository.saveVoyages([second])).resolves.toMatchObject({ newEpisodes: 1, supersededEpisodes: 1 })
    await expect(repository.saveVoyages([returnObservation])).resolves.toMatchObject({ newEpisodes: 1, supersededEpisodes: 1 })
    const returnResult = await repository.saveVoyages([returnUpdate])

    const rows = native.prepare("SELECT id, baseline_eta, latest_eta, delay_minutes FROM voyages ORDER BY last_updated_at, id").all() as { id: string, baseline_eta: string, latest_eta: string, delay_minutes: number }[]
    expect(rows).toHaveLength(3)
    expect(rows.map(row => row.id)).toEqual([first.id, second.id, returnObservation.id])
    expect(returnObservation.id).not.toBe(first.id)
    expect(rows[0]).toMatchObject({ baseline_eta: "2026-09-03T00:00:00.000Z", latest_eta: "2026-09-04T00:00:00.000Z", delay_minutes: 1440 })
    expect(rows[2]).toMatchObject({ baseline_eta: "2026-10-20T00:00:00.000Z", latest_eta: "2026-10-21T00:00:00.000Z", delay_minutes: 1440 })
    expect(returnResult).toMatchObject({ reusedEpisodes: 1, acceptedIds: [returnObservation.id] })
    expect(await repository.listEtaHistory(first.id)).toHaveLength(2)
    expect(await repository.listEtaHistory(second.id)).toHaveLength(1)
    expect(await repository.listEtaHistory(returnObservation.id)).toHaveLength(2)
    expect(await repository.getLatestVoyage("vessel-1")).toMatchObject({ id: returnObservation.id, eta: "2026-10-21T00:00:00.000Z", episodeState: "current" })
    const stateRows = native.prepare("SELECT id, data FROM voyages ORDER BY created_at, id").all() as { id: string, data: string }[]
    expect(stateRows.map(row => JSON.parse(row.data))).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: first.id, episodeState: "superseded", supersededAt: second.lastUpdatedAt }),
      expect.objectContaining({ id: second.id, episodeState: "superseded", supersededAt: returnObservation.lastUpdatedAt }),
      expect.objectContaining({ id: returnObservation.id, episodeState: "current" }),
    ]))
    native.close()
  })

  it("rejects stale and equal-timestamp cross-destination transitions without switching current episode", async () => {
    const { database, native } = createNativeDatabase()
    await initShippingTables(database, "real")
    const repository = new VoyageRepository(database, "real")
    const base = voyage({ source: "vesselapi", sourceType: "real", status: "unknown", voyageNumber: undefined, etd: undefined, originPortId: undefined })
    const observation = (destination: "PHMNL" | "SGSIN", timestamp: string): VoyageRecord => ({
      ...base,
      id: `vesselapi:vessel-1:destination:${destination}:episode:${new Date(timestamp).toISOString().replace(/[.:-]/g, "")}`,
      destinationPortId: destination === "PHMNL" ? destination : undefined,
      timestamp,
      lastUpdatedAt: timestamp,
    })
    const singapore = observation("SGSIN", "2026-09-01T12:00:00.000Z")
    await repository.saveVoyages([singapore])
    await expect(repository.saveVoyages([observation("PHMNL", "2026-09-01T11:00:00.000Z")])).resolves.toMatchObject({ episodeStaleSkipped: 1, acceptedIds: [], historyWritten: 0 })
    await expect(repository.saveVoyages([observation("PHMNL", singapore.lastUpdatedAt)])).resolves.toMatchObject({ episodeTransitionConflicts: 1, acceptedIds: [], historyWritten: 0 })
    expect(native.prepare("SELECT COUNT(*) AS count FROM voyages").get()).toEqual({ count: 1 })
    expect(await repository.getLatestVoyage("vessel-1")).toMatchObject({ id: singapore.id, episodeState: "current" })
    native.close()
  })

  it("preserves the transition boundary across a native SQLite restart", async () => {
    const root = mkdtempSync("shipping-hot-voyage-episode-")
    const path = join(root, "voyage.sqlite3")
    const episode = (destination: "PHMNL" | "SGSIN", timestamp: string, eta: string): VoyageRecord => voyage({
      id: `vesselapi:vessel-1:destination:${destination}:episode:${new Date(timestamp).toISOString().replace(/[.:-]/g, "")}`,
      source: "vesselapi",
      sourceType: "real",
      status: "unknown",
      voyageNumber: undefined,
      originPortId: undefined,
      destinationPortId: destination === "PHMNL" ? destination : undefined,
      timestamp,
      lastUpdatedAt: timestamp,
      eta,
      etd: undefined,
    })
    const first = episode("PHMNL", "2026-09-01T10:00:00.000Z", "2026-09-03T00:00:00.000Z")
    const second = episode("SGSIN", "2026-09-02T10:00:00.000Z", "2026-09-08T00:00:00.000Z")
    const returned = episode("PHMNL", "2026-10-18T10:00:00.000Z", "2026-10-20T00:00:00.000Z")
    let initial: ReturnType<typeof createNativeDatabase> | undefined
    let reopened: ReturnType<typeof createNativeDatabase> | undefined
    try {
      initial = createNativeDatabase(path)
      await initShippingTables(initial.database, "real")
      await new VoyageRepository(initial.database, "real").saveVoyages([first, second])
      initial.native.close()
      initial = undefined

      reopened = createNativeDatabase(path)
      await initShippingTables(reopened.database, "real")
      await new VoyageRepository(reopened.database, "real").saveVoyages([returned])
      expect(reopened.native.prepare("SELECT id FROM voyages ORDER BY last_updated_at, id").all()).toHaveLength(3)
      expect(await new VoyageRepository(reopened.database, "real").getLatestVoyage("vessel-1")).toMatchObject({ id: returned.id, episodeState: "current" })
    } finally {
      initial?.native.close()
      reopened?.native.close()
      rmSync(root, { recursive: true, force: true })
    }
  })

  it("uses existing staleSkipped for an older observation on the same destination episode", async () => {
    const { database, native } = createNativeDatabase()
    await initShippingTables(database, "real")
    const repository = new VoyageRepository(database, "real")
    const id = "vesselapi:vessel-1:destination:PHMNL:episode:20260901T120000000Z"
    const latest = voyage({ id, source: "vesselapi", sourceType: "real", status: "unknown", voyageNumber: undefined, etd: undefined, originPortId: undefined, destinationPortId: "PHMNL", timestamp: "2026-09-01T12:00:00.000Z", lastUpdatedAt: "2026-09-01T12:00:00.000Z" })
    const older = { ...latest, id: "vesselapi:vessel-1:destination:PHMNL:episode:20260901T110000000Z", timestamp: "2026-09-01T11:00:00.000Z", lastUpdatedAt: "2026-09-01T11:00:00.000Z" }
    await repository.saveVoyages([latest])
    await expect(repository.saveVoyages([older])).resolves.toMatchObject({ staleSkipped: 1, episodeStaleSkipped: 0, historyWritten: 0 })
    expect(await repository.listEtaHistory(id)).toHaveLength(1)
    native.close()
  })

  it("separates ETA episodes when the official destination changes", async () => {
    const { database, native } = createNativeDatabase()
    await initShippingTables(database, "real")
    const repository = new VoyageRepository(database, "real")
    const base = voyage({ source: "vesselapi", sourceType: "real", status: "unknown", voyageNumber: undefined, etd: undefined, originPortId: undefined })
    await repository.saveVoyages([
      { ...base, id: "vesselapi:vessel-1:destination:PHMNL:episode:20260901T100000000Z", destinationPortId: "PHMNL", timestamp: "2026-09-01T10:00:00.000Z", lastUpdatedAt: "2026-09-01T10:00:00.000Z" },
      { ...base, id: "vesselapi:vessel-1:destination:SGSIN:episode:20260901T110000000Z", destinationPortId: undefined, timestamp: "2026-09-01T11:00:00.000Z", lastUpdatedAt: "2026-09-01T11:00:00.000Z" },
    ])
    expect(native.prepare("SELECT COUNT(*) AS count FROM voyages").get()).toEqual({ count: 2 })
    expect(await repository.listEtaHistory("vesselapi:vessel-1:destination:PHMNL:episode:20260901T100000000Z")).toHaveLength(1)
    expect(await repository.listEtaHistory("vesselapi:vessel-1:destination:SGSIN:episode:20260901T110000000Z")).toHaveLength(1)
    native.close()
  })

  it("retains trusted origin and canonical destination through temporary enrichment loss", async () => {
    const { database, native } = createNativeDatabase()
    await initShippingTables(database, "real")
    const repository = new VoyageRepository(database, "real")
    const id = "vesselapi:vessel-1:destination:PHMNL:episode:20260901T100000000Z"
    const first = voyage({ id, source: "vesselapi", sourceType: "real", status: "unknown", voyageNumber: undefined, etd: undefined, timestamp: "2026-09-01T10:00:00.000Z", lastUpdatedAt: "2026-09-01T10:00:00.000Z" })
    const second = { ...first, originPortId: undefined, destinationPortId: undefined, eta: "2026-09-02T00:00:00.000Z", timestamp: "2026-09-01T11:00:00.000Z", lastUpdatedAt: "2026-09-01T11:00:00.000Z" }
    await repository.saveVoyages([first])
    await repository.saveVoyages([second])
    expect(await repository.getLatestVoyage("vessel-1")).toMatchObject({ id, originPortId: "CNSHK", destinationPortId: "PHMNL" })
    const stored = JSON.parse(String((native.prepare("SELECT data FROM voyages WHERE id = ?").get(id) as { data: string }).data)) as Record<string, unknown>
    expect(stored).toMatchObject({ originPortId: "CNSHK", destinationPortId: "PHMNL" })
    native.close()
  })

  it("stale-skips an older observation on the stable episode ID", async () => {
    const { database, native } = createNativeDatabase()
    await initShippingTables(database, "real")
    const repository = new VoyageRepository(database, "real")
    const id = "vesselapi:vessel-1:destination:PHMNL:episode:20260901T120000000Z"
    const latest = voyage({ id, source: "vesselapi", sourceType: "real", status: "unknown", voyageNumber: undefined, etd: undefined, timestamp: "2026-09-01T12:00:00.000Z", lastUpdatedAt: "2026-09-01T12:00:00.000Z" })
    const older = { ...latest, eta: "2026-09-01T00:00:00.000Z", timestamp: "2026-09-01T11:00:00.000Z", lastUpdatedAt: "2026-09-01T11:00:00.000Z" }
    await repository.saveVoyages([latest])
    await expect(repository.saveVoyages([older])).resolves.toMatchObject({ staleSkipped: 1, historyWritten: 0 })
    expect(await repository.getLatestVoyage("vessel-1")).toMatchObject({ eta: latest.eta, lastUpdatedAt: latest.lastUpdatedAt })
    expect(await repository.listEtaHistory(id)).toHaveLength(1)
    native.close()
  })

  it("retains the Real Mode Mock rejection guard", async () => {
    const { database, native } = createNativeDatabase()
    await initShippingTables(database, "real")
    await expect(new VoyageRepository(database, "real").saveVoyages([voyage()])).rejects.toThrow("mock_voyage_not_allowed_in_real_mode")
    native.close()
  })
})
