import NativeDatabase from "better-sqlite3"
import { createDatabase } from "db0"
import { describe, expect, it } from "vitest"
import { assertZeroRealOperationalMockRows, scanRealOperationalMockRows } from "./real-data-gate"
import { initShippingTables } from "#/database/shipping"

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

describe("real operational zero-Mock gate", () => {
  it("passes only when every operational table has no Mock lineage", async () => {
    const { database, native } = createNativeDatabase()
    await initShippingTables(database, "real")
    const rows = await scanRealOperationalMockRows(database)
    expect(rows).toEqual({ vessels: 0, ports: 0, voyages: 0, feedItems: 0, events: 0, calendarEvents: 0, aisPositions: 0, aisLatestPositions: 0, total: 0 })
    expect(() => assertZeroRealOperationalMockRows(rows)).not.toThrow()
    native.close()
  })

  it("fails Real Mode when a Mock row is injected into the operational database", async () => {
    const { database, native } = createNativeDatabase()
    await initShippingTables(database, "real")
    await database.prepare(`INSERT INTO vessels (id, data, source_type, navigation_status, status_changed_at, last_updated_at) VALUES (?, ?, ?, ?, ?, ?)`).run(
      "mock-gate-vessel",
      JSON.stringify({ id: "mock-gate-vessel", provenance: { sourceType: "mock" } }),
      "real",
      "unknown",
      null,
      null,
    )
    const rows = await scanRealOperationalMockRows(database)
    expect(rows).toMatchObject({ vessels: 1, total: 1 })
    expect(() => assertZeroRealOperationalMockRows(rows)).toThrow("real_zero_mock_gate_failed")
    native.close()
  })
})
