import NativeDatabase from "better-sqlite3"
import { createDatabase } from "db0"
import { afterEach, describe, expect, it } from "vitest"
import { initShippingTables } from "#/database/shipping"
import { bootstrapBackgroundRuntime, shutdownBackgroundRuntime } from "#/runtime/bootstrap"

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

const environmentNames = ["SHIPPING_DATA_MODE", "SHIPPING_RUNTIME_ENABLED"]
const previousEnvironment = new Map(environmentNames.map(name => [name, process.env[name]]))

afterEach(async () => {
  await shutdownBackgroundRuntime()
  for (const name of environmentNames) {
    const value = previousEnvironment.get(name)
    if (value === undefined) delete process.env[name]
    else process.env[name] = value
  }
})

describe("background runtime bootstrap (R1 port-only registry)", () => {
  it("reuses the same runtime instance across repeated bootstrap calls", async () => {
    const { database, native } = createNativeDatabase()
    await initShippingTables(database, "mock")
    process.env.SHIPPING_RUNTIME_ENABLED = "false"
    const first = await bootstrapBackgroundRuntime({ database, enabled: false })
    const second = await bootstrapBackgroundRuntime({ database, enabled: false })
    expect(second).toBe(first)
    await shutdownBackgroundRuntime()
    native.close()
  })
})
