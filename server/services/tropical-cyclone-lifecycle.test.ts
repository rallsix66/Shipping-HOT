import NativeDatabase from "better-sqlite3"
import { createDatabase } from "db0"
import { describe, expect, it } from "vitest"
import { portDirectoryBaseline } from "@shared/port-directory"
import { ShippingRepository, initShippingTables } from "#/database/shipping"
import { getTropicalCyclonePanel } from "#/services/tropical-cyclone-panel"
import { filterActiveCyclonesForRules } from "#/services/tropical-cyclone-display"

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

const ports = portDirectoryBaseline.map(row => ({
  portId: row.shippingPortId,
  unlocode: row.unlocode,
  latitude: row.latitude,
  longitude: row.longitude,
}))

const nearPoint = {
  current: { lat: 22.52, lon: 114.35, at: "2026-08-15T10:00:00.000Z" },
  trackHistory: [{ lat: 22.0, lon: 118.0 }],
  forecast: [{ lat: 23.0, lon: 114.0, at: "2026-08-16T00:00:00.000Z" }],
}

describe("tropical cyclone lifecycle", () => {
  it("keeps 48h summary when TC drops from list without dissipated evidence", async () => {
    const { database, native } = createNativeDatabase()
    await initShippingTables(database, "mock")
    const repository = new ShippingRepository(database, "mock")
    await repository.applyJmaTropicalCycloneSync({
      cyclones: [{
        id: "tc-jma-TC1",
        basin: "NW_PACIFIC",
        jmaId: "TC1",
        nameEn: "Alpha",
        ...nearPoint,
        lifecycleStatus: "active",
        pathFetchedAt: "2026-08-15T10:00:00.000Z",
        rawForecastJson: [],
      }],
      outcome: "ok",
      fetchedAt: "2026-08-15T10:00:00.000Z",
      listConfirmedEmpty: false,
      failedTcIds: [],
      parseErrorCount: 0,
    }, ports)
    await repository.applyJmaTropicalCycloneSync({
      cyclones: [],
      outcome: "ok_empty",
      fetchedAt: "2026-08-15T11:00:00.000Z",
      listConfirmedEmpty: true,
      failedTcIds: [],
      parseErrorCount: 0,
    }, ports)
    const panel = await getTropicalCyclonePanel(repository, { now: new Date("2026-08-15T12:00:00.000Z") })
    expect(panel.sync.outcome).toBe("ok_empty")
    expect(panel.activeCount).toBe(0)
    expect(panel.historicalSummaryCount).toBe(1)
    expect(panel.cyclones[0]?.lifecycleStatus).toBe("missing_from_list")
    expect(filterActiveCyclonesForRules(await repository.listNormalizedTropicalCyclones())).toHaveLength(0)
    native.close()
  })

  it("preserves first missingFromListAt across repeat ok_empty sync", async () => {
    const { database, native } = createNativeDatabase()
    await initShippingTables(database, "mock")
    const repository = new ShippingRepository(database, "mock")
    const seed = {
      id: "tc-jma-TC1",
      basin: "NW_PACIFIC",
      jmaId: "TC1",
      nameEn: "Alpha",
      ...nearPoint,
      lifecycleStatus: "active" as const,
      pathFetchedAt: "2026-08-15T10:00:00.000Z",
      rawForecastJson: [],
    }
    await repository.applyJmaTropicalCycloneSync({
      cyclones: [seed],
      outcome: "ok",
      fetchedAt: "2026-08-15T10:00:00.000Z",
      listConfirmedEmpty: false,
      failedTcIds: [],
      parseErrorCount: 0,
    }, ports)
    for (const at of ["2026-08-15T11:00:00.000Z", "2026-08-15T12:00:00.000Z"]) {
      await repository.applyJmaTropicalCycloneSync({
        cyclones: [],
        outcome: "ok_empty",
        fetchedAt: at,
        listConfirmedEmpty: true,
        failedTcIds: [],
        parseErrorCount: 0,
      }, ports)
    }
    const row = (await repository.listNormalizedTropicalCyclones())[0]
    expect(row?.missingFromListAt).toBe("2026-08-15T11:00:00.000Z")
    native.close()
  })

  it("hides historical summary after 48h", async () => {
    const { database, native } = createNativeDatabase()
    await initShippingTables(database, "mock")
    const repository = new ShippingRepository(database, "mock")
    await repository.applyJmaTropicalCycloneSync({
      cyclones: [{
        id: "tc-jma-TC1",
        basin: "NW_PACIFIC",
        jmaId: "TC1",
        nameEn: "Alpha",
        ...nearPoint,
        lifecycleStatus: "active",
        pathFetchedAt: "2026-08-15T10:00:00.000Z",
        rawForecastJson: [],
      }],
      outcome: "ok",
      fetchedAt: "2026-08-15T10:00:00.000Z",
      listConfirmedEmpty: false,
      failedTcIds: [],
      parseErrorCount: 0,
    }, ports)
    await repository.applyJmaTropicalCycloneSync({
      cyclones: [],
      outcome: "ok_empty",
      fetchedAt: "2026-08-15T11:00:00.000Z",
      listConfirmedEmpty: true,
      failedTcIds: [],
      parseErrorCount: 0,
    }, ports)
    const panel = await getTropicalCyclonePanel(repository, { now: new Date("2026-08-17T12:00:00.000Z") })
    expect(panel.historicalSummaryCount).toBe(0)
    native.close()
  })

  it("keeps B active when A disappears from list", async () => {
    const { database, native } = createNativeDatabase()
    await initShippingTables(database, "mock")
    const repository = new ShippingRepository(database, "mock")
    const mk = (id: string, jmaId: string, name: string) => ({
      id,
      basin: "NW_PACIFIC",
      jmaId,
      nameEn: name,
      ...nearPoint,
      lifecycleStatus: "active" as const,
      pathFetchedAt: "2026-08-15T10:00:00.000Z",
      rawForecastJson: [],
    })
    await repository.applyJmaTropicalCycloneSync({
      cyclones: [mk("tc-a", "TCA", "A"), mk("tc-b", "TCB", "B")],
      outcome: "ok",
      fetchedAt: "2026-08-15T10:00:00.000Z",
      listConfirmedEmpty: false,
      failedTcIds: [],
      parseErrorCount: 0,
    }, ports)
    await repository.applyJmaTropicalCycloneSync({
      cyclones: [mk("tc-b", "TCB", "B")],
      outcome: "ok",
      fetchedAt: "2026-08-15T11:00:00.000Z",
      listConfirmedEmpty: false,
      failedTcIds: [],
      parseErrorCount: 0,
    }, ports)
    const panel = await getTropicalCyclonePanel(repository, { now: new Date("2026-08-15T11:30:00.000Z") })
    expect(panel.activeCount).toBe(1)
    expect(panel.historicalSummaryCount).toBe(1)
    native.close()
  })

  it("reactivates when TC reappears on list", async () => {
    const { database, native } = createNativeDatabase()
    await initShippingTables(database, "mock")
    const repository = new ShippingRepository(database, "mock")
    const cyclone = {
      id: "tc-jma-TC1",
      basin: "NW_PACIFIC",
      jmaId: "TC1",
      nameEn: "Alpha",
      ...nearPoint,
      lifecycleStatus: "active" as const,
      pathFetchedAt: "2026-08-15T10:00:00.000Z",
      rawForecastJson: [],
    }
    await repository.applyJmaTropicalCycloneSync({
      cyclones: [cyclone],
      outcome: "ok",
      fetchedAt: "2026-08-15T10:00:00.000Z",
      listConfirmedEmpty: false,
      failedTcIds: [],
      parseErrorCount: 0,
    }, ports)
    await repository.applyJmaTropicalCycloneSync({
      cyclones: [],
      outcome: "ok_empty",
      fetchedAt: "2026-08-15T11:00:00.000Z",
      listConfirmedEmpty: true,
      failedTcIds: [],
      parseErrorCount: 0,
    }, ports)
    await repository.applyJmaTropicalCycloneSync({
      cyclones: [{ ...cyclone, lifecycleStatus: "active", pathFetchedAt: "2026-08-15T12:00:00.000Z" }],
      outcome: "ok",
      fetchedAt: "2026-08-15T12:00:00.000Z",
      listConfirmedEmpty: false,
      failedTcIds: [],
      parseErrorCount: 0,
    }, ports)
    const panel = await getTropicalCyclonePanel(repository, { now: new Date("2026-08-15T12:30:00.000Z") })
    expect(panel.activeCount).toBe(1)
    expect(panel.historicalSummaryCount).toBe(0)
    native.close()
  })
})
