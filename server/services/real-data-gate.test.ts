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
  it("discovers every current lineage table and excludes metadata tables", async () => {
    const { database, native } = createNativeDatabase()
    await initShippingTables(database, "real")
    const rows = await scanRealOperationalMockRows(database)
    expect(rows).toEqual({
      tables: {
        ais_latest_positions: 0,
        ais_port_metrics: 0,
        ais_positions: 0,
        calendar_events: 0,
        events: 0,
        feed_item_history: 0,
        feed_items: 0,
        ports: 0,
        vessel_metadata: 0,
        vessel_search_cache: 0,
        vessels: 0,
        voyage_eta_history: 0,
        voyages: 0,
      },
      total: 0,
    })
    expect(rows.tables).not.toHaveProperty("app_metadata")
    expect(rows.tables).not.toHaveProperty("schema_migrations")
    expect(() => assertZeroRealOperationalMockRows(rows)).not.toThrow()
    native.close()
  })

  it("fails when a normalized column is real but JSON provenance is Mock", async () => {
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
    expect(rows).toMatchObject({ tables: { vessels: 1 }, total: 1 })
    expect(() => assertZeroRealOperationalMockRows(rows)).toThrow("real_zero_mock_gate_failed")
    native.close()
  })

  it.each([
    ["ais_port_metrics", "INSERT INTO ais_port_metrics (port_id, data, source_type, updated_at) VALUES ('gate-port', '{}', 'mock', '2026-08-29T00:00:00.000Z')"],
    ["voyage_eta_history", "INSERT INTO voyage_eta_history (id, voyage_id, vessel_id, eta, etd, source, source_type, observed_at, created_at) VALUES ('gate-history', 'gate-voyage', 'gate-vessel', NULL, NULL, 'mock-voyage', 'mock', '2026-08-29T00:00:00.000Z', '2026-08-29T00:00:00.000Z')"],
    ["feed_item_history", "INSERT INTO feed_item_history (id, feed_item_id, source_id, observed_at, effective_at, expires_at, current_until, visibility, source_type, data) VALUES ('gate-feed-history', 'gate-feed', 'mock-port-notice', '2026-08-29T00:00:00.000Z', NULL, NULL, NULL, 'history', 'mock', '{}')"],
    ["vessel_metadata", "INSERT INTO vessel_metadata (id, name, source, fetched_at, source_type, data) VALUES ('gate-metadata', 'Mock Vessel', 'mock-vessel-search', '2026-08-29T00:00:00.000Z', 'mock', '{}')"],
    ["vessel_search_cache", "INSERT INTO vessel_search_cache (search_key, query, field, result_ids, provider_id, source_type, fetched_at, expires_at) VALUES ('gate-cache', 'mock', 'name', '[]', 'mock-vessel-search', 'mock', '2026-08-29T00:00:00.000Z', '2026-08-30T00:00:00.000Z')"],
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
