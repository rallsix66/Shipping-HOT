import NativeDatabase from "better-sqlite3"
import { createDatabase } from "db0"
import { describe, expect, it } from "vitest"
import { createMockSnapshot } from "@shared/shipping-fixtures"
import { ShippingRepository, initShippingTables } from "./shipping"

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

describe("shipping repository", () => {
  it("seeds and reads ports, feed items, events and settings", async () => {
    const { database, native } = createNativeDatabase()
    await initShippingTables(database, "mock")
    const repository = new ShippingRepository(database, "mock")
    const snapshot = createMockSnapshot()
    await repository.seed(snapshot.ports, snapshot.feedItems, snapshot.events, snapshot.settings)
    expect(await repository.listPorts()).toHaveLength(snapshot.ports.length)
    expect(await repository.listFeedItems({ now: new Date() })).toHaveLength(snapshot.feedItems.length)
    expect(await repository.listEvents()).toHaveLength(snapshot.events.length)
    expect(await repository.getSettings()).toMatchObject({ refreshInterval: snapshot.settings.refreshInterval })
    native.close()
  })

  it("persists port follow state independently from provider rows", async () => {
    const { database, native } = createNativeDatabase()
    await initShippingTables(database, "mock")
    const repository = new ShippingRepository(database, "mock")
    const snapshot = createMockSnapshot()
    await repository.seed(snapshot.ports, [], [], snapshot.settings)
    const port = snapshot.ports[0]
    expect((await repository.listPorts()).find(item => item.id === port.id)?.isWatched).toBe(false)
    await repository.setPortFollow(port.id, true)
    expect((await repository.listPorts()).find(item => item.id === port.id)?.isWatched).toBe(true)
    await repository.setPortFollow(port.id, false)
    expect((await repository.listPorts()).find(item => item.id === port.id)?.isWatched).toBe(false)
    native.close()
  })
})
