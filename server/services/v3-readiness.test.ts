import NativeDatabase from "better-sqlite3"
import { createDatabase } from "db0"
import { describe, expect, it } from "vitest"
import { initShippingTables } from "#/database/shipping"
import { readV3Readiness } from "#/services/v3-readiness"

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

describe("v3 readiness", () => {
  it("passes the local Mock-only V3 foundation gate without network calls", async () => {
    const { database, native } = createNativeDatabase()
    await initShippingTables(database, "mock")
    const report = await readV3Readiness(database, {
      dataMode: "mock",
      runtimeJobs: [
        { id: "ais-tracking", providerId: "mock", capability: "ais_tracking", enabled: true },
        { id: "voyage-sync", providerId: "mock", capability: "voyage_sync", enabled: true },
      ],
    })
    expect(report.ready).toBe(true)
    expect(report.checks.find(check => check.id === "port-directory")).toMatchObject({ status: "pass" })
    expect(report.checks.find(check => check.id === "network-probes")).toMatchObject({ status: "skipped" })
    native.close()
  })

  it("rejects a runtime Job outside the approved V3 foundation scope", async () => {
    const { database, native } = createNativeDatabase()
    await initShippingTables(database, "mock")
    const report = await readV3Readiness(database, {
      dataMode: "mock",
      runtimeJobs: [{ id: "translation-sync", providerId: "mock", capability: "translation", enabled: true }],
    })
    expect(report.ready).toBe(false)
    expect(report.checks.find(check => check.id === "runtime-scope")).toMatchObject({ status: "fail" })
    native.close()
  })
})
