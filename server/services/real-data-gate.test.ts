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
  it("discovers current lineage tables and excludes metadata tables", async () => {
    const { database, native } = createNativeDatabase()
    await initShippingTables(database, "real")
    const rows = await scanRealOperationalMockRows(database)
    expect(rows.tables).toMatchObject({
      calendar_events: 0,
      events: 0,
      feed_item_history: 0,
      feed_items: 0,
      ports: 0,
    })
    expect(rows.total).toBe(0)
    expect(rows.tables).not.toHaveProperty("app_metadata")
    expect(rows.tables).not.toHaveProperty("schema_migrations")
    expect(() => assertZeroRealOperationalMockRows(rows)).not.toThrow()
    native.close()
  })

  it("fails when a normalized column is real but JSON provenance is Mock", async () => {
    const { database, native } = createNativeDatabase()
    await initShippingTables(database, "real")
    await database.prepare(`INSERT INTO ports (id, data, source_type, congestion_level, last_updated_at) VALUES (?, ?, ?, ?, ?)`).run(
      "mock-gate-port",
      JSON.stringify({ id: "mock-gate-port", provenance: { sourceType: "mock" } }),
      "real",
      null,
      null,
    )
    const rows = await scanRealOperationalMockRows(database)
    expect(rows).toMatchObject({ tables: { ports: 1 }, total: 1 })
    expect(() => assertZeroRealOperationalMockRows(rows)).toThrow("real_zero_mock_gate_failed")
    native.close()
  })

  it.each([
    ["feed_item_history", "INSERT INTO feed_item_history (id, feed_item_id, source_id, observed_at, effective_at, expires_at, current_until, visibility, source_type, data) VALUES ('gate-feed-history', 'gate-feed', 'mock-port-notice', '2026-08-29T00:00:00.000Z', NULL, NULL, NULL, 'history', 'mock', '{}')"],
  ])("fails when %s contains source_type=mock", async (table, insertSql) => {
    const { database, native } = createNativeDatabase()
    await initShippingTables(database, "real")
    await database.exec(insertSql)
    const rows = await scanRealOperationalMockRows(database)
    expect(rows.tables[table]).toBe(1)
    expect(() => assertZeroRealOperationalMockRows(rows)).toThrow("real_zero_mock_gate_failed")
    native.close()
  })

  it("discovers a future source_type table and fails on its Mock row", async () => {
    const { database, native } = createNativeDatabase()
    await initShippingTables(database, "real")
    await database.exec("CREATE TABLE test_future_lineage (id TEXT PRIMARY KEY, source_type TEXT NOT NULL)")
    await database.prepare("INSERT INTO test_future_lineage (id, source_type) VALUES ('future-mock', 'mock')").run()
    const rows = await scanRealOperationalMockRows(database)
    expect(rows.tables.test_future_lineage).toBe(1)
    expect(() => assertZeroRealOperationalMockRows(rows)).toThrow("real_zero_mock_gate_failed")
    native.close()
  })
})
