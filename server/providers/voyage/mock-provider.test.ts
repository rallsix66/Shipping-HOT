import NativeDatabase from "better-sqlite3"
import { createDatabase } from "db0"
import { describe, expect, it } from "vitest"
import { initShippingTables } from "#/database/shipping"
import { PortDirectoryRepository } from "#/database/port-directory"
import { createMockVoyageProvider } from "#/providers/voyage/mock-provider"

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

describe("mock voyage provider", () => {
  it("maps vessel identity, port identity and ETA into VoyageRecord", async () => {
    const { database, native } = createNativeDatabase()
    await initShippingTables(database, "mock")
    const provider = createMockVoyageProvider({
      portDirectory: new PortDirectoryRepository(database, "mock"),
      now: () => new Date("2026-08-24T00:00:00.000Z"),
    })
    const [voyage] = await provider.getVoyages([{ vesselId: "vessel-1", imo: "9162423", mmsi: "413393620" }])
    expect(voyage).toMatchObject({
      vesselId: "vessel-1",
      imo: "9162423",
      originPortId: "CNSHK",
      destinationPortId: "PHMNL",
      eta: "2026-08-27T00:00:00.000Z",
      sourceType: "mock",
    })
    native.close()
  })

  it("resolves Shekou through the existing port directory identity", async () => {
    const { database, native } = createNativeDatabase()
    await initShippingTables(database, "mock")
    await expect(new PortDirectoryRepository(database, "mock").resolvePortIdentity("Shekou")).resolves.toBe("CNSHK")
    native.close()
  })
})
