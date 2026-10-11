import NativeDatabase from "better-sqlite3"
import { createDatabase } from "db0"
import { describe, expect, it } from "vitest"
import { initShippingTables } from "#/database/shipping"
import { readDatabaseMetadata } from "#/database/runtime"

const V15_TABLES = [
  "weather_forecast",
  "weather_impact",
  "tropical_cyclone",
  "ops_calendar_event",
  "policy_record",
  "policy_version",
] as const

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

function tableNames(native: NativeDatabase): Set<string> {
  const rows = native.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{ name: string }>
  return new Set(rows.map(r => r.name))
}

describe("migration 015 ops-weather-calendar-policy", () => {
  it("applies on fresh database to schema v15 with six new tables (idempotent)", async () => {
    const { database, native } = createNativeDatabase()
    await initShippingTables(database, "mock")
    expect((await readDatabaseMetadata(database)).schemaVersion).toBe(16)
    const names = tableNames(native)
    expect(V15_TABLES.every(t => names.has(t))).toBe(true)

    await initShippingTables(database, "mock")
    const applied = native.prepare("SELECT COUNT(*) AS c FROM schema_migrations WHERE version = 15").get() as { c: number }
    expect(applied.c).toBe(1)
    native.close()
  })

  it("upgrades v14-equivalent state without losing existing port rows", async () => {
    const { database, native } = createNativeDatabase()
    await initShippingTables(database, "mock")
    native.prepare("INSERT OR REPLACE INTO ports (id, data, last_updated_at) VALUES ('p-test', '{}', '2026-01-01T00:00:00.000Z')").run()

    for (const table of V15_TABLES) native.exec(`DROP TABLE IF EXISTS ${table}`)
    native.prepare("DELETE FROM schema_migrations WHERE version = 15").run()
    native.prepare("UPDATE app_metadata SET schema_version = 14").run()

    await initShippingTables(database, "mock")
    expect((await readDatabaseMetadata(database)).schemaVersion).toBe(16)
    expect(V15_TABLES.every(t => tableNames(native).has(t))).toBe(true)
    const port = native.prepare("SELECT id FROM ports WHERE id = 'p-test'").get()
    expect(port).toEqual({ id: "p-test" })
    native.close()
  })
})
