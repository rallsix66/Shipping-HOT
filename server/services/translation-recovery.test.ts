import NativeDatabase from "better-sqlite3"
import { createDatabase } from "db0"
import { describe, expect, it } from "vitest"
import { clearBlockedTranslationCircuit, clearBlockedTranslationCircuitBestEffort } from "./translation-recovery"
import { RuntimeRepository, isProviderCircuitBlocked } from "#/database/runtime-jobs"
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

describe("translation circuit recovery", () => {
  it("clears a contract-blocked translation circuit so a deliberate retry can run", async () => {
    const { database, native } = createNativeDatabase()
    await initShippingTables(database, "real")
    const runtime = new RuntimeRepository(database)
    await runtime.blockProviderCircuit({ providerId: "deepseek", capability: "translation", errorCode: "provider_contract_changed", errorMessage: "unknown finish_reason", updatedAt: "2026-09-14T00:00:00.000Z" })
    await expect(runtime.getProviderRuntime("deepseek", "translation")).resolves.toMatchObject({ status: "failed", errorCode: "provider_contract_changed" })
    expect(isProviderCircuitBlocked(await runtime.getProviderRuntime("deepseek", "translation"))).toBe(true)

    await expect(clearBlockedTranslationCircuit(database, "translation_secret_updated")).resolves.toBe(true)
    const cleared = await runtime.getProviderRuntime("deepseek", "translation")
    expect(isProviderCircuitBlocked(cleared)).toBe(false)
    expect(cleared?.consecutiveFailures ?? 0).toBe(0)
    expect(cleared?.errorCode ?? null).toBeNull()
    native.close()
  })

  it("is a no-op when no translation circuit is blocked", async () => {
    const { database, native } = createNativeDatabase()
    await initShippingTables(database, "real")
    await expect(clearBlockedTranslationCircuit(database, "translation_settings_updated")).resolves.toBe(false)
    const runtime = new RuntimeRepository(database)
    await runtime.updateProviderRuntime({ providerId: "deepseek", capability: "translation", status: "degraded", updatedAt: "2026-09-14T00:00:00.000Z" })
    await expect(clearBlockedTranslationCircuit(database, "translation_settings_updated")).resolves.toBe(false)
    await expect(runtime.getProviderRuntime("deepseek", "translation")).resolves.toMatchObject({ status: "degraded" })
    native.close()
  })

  it("never turns a successful configuration write into a failure when recovery itself fails", async () => {
    const { database, native } = createNativeDatabase()
    await initShippingTables(database, "real")
    const broken = {
      prepare: () => {
        throw new Error("runtime table unavailable")
      },
    } as never
    // The strict helper still fails loudly for tests/diagnostics...
    await expect(clearBlockedTranslationCircuit(broken, "translation_settings_updated")).rejects.toThrow("runtime table unavailable")
    // ...while the route-safe wrapper absorbs the failure: the operator's saved
    // settings/secret stay saved and the circuit simply remains blocked.
    await expect(clearBlockedTranslationCircuitBestEffort(broken, "translation_settings_updated")).resolves.toBe(false)
    await expect(clearBlockedTranslationCircuitBestEffort(database, "translation_settings_updated")).resolves.toBe(false)
    native.close()
  })
})
