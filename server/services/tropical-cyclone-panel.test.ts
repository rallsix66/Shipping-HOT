import NativeDatabase from "better-sqlite3"
import { createDatabase } from "db0"
import { describe, expect, it } from "vitest"
import { ShippingRepository, initShippingTables } from "#/database/shipping"
import { getTropicalCyclonePanel } from "#/services/tropical-cyclone-panel"

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

describe("tropical cyclone panel", () => {
  it("distinguishes ok_empty sync from not_run", async () => {
    const { database, native } = createNativeDatabase()
    await initShippingTables(database, "mock")
    const repository = new ShippingRepository(database, "mock")
    await repository.saveTropicalCycloneSyncMeta({
      sourceId: "jma-typhoon",
      outcome: "ok_empty",
      lastCheckedAt: "2026-08-15T12:00:00.000Z",
    })
    const panel = await getTropicalCyclonePanel(repository, { now: new Date("2026-08-15T12:00:00.000Z") })
    expect(panel.sync.outcome).toBe("ok_empty")
    expect(panel.messageZh).toContain("目前没有影响本区域的活跃台风")
    expect(panel.cyclones).toHaveLength(0)
    native.close()
  })
})
