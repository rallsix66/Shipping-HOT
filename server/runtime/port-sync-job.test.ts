import NativeDatabase from "better-sqlite3"
import { createDatabase } from "db0"
import { describe, expect, it } from "vitest"
import { createMockSnapshot } from "@shared/shipping-fixtures"
import type { Port } from "@shared/shipping"
import { createPortSyncJob } from "./port-sync-job"
import { ShippingRepository, initShippingTables } from "#/database/shipping"
import { MockPortProvider } from "#/providers/shipping"

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

async function seedPorts(database: Parameters<typeof initShippingTables>[0]) {
  const snapshot = createMockSnapshot()
  await new ShippingRepository(database, "mock").seed([], snapshot.ports, [], [], [], snapshot.settings)
}

describe("port sync job", () => {
  it("uses the Port provider identity and reports successful writes", async () => {
    const { database, native } = createNativeDatabase()
    await initShippingTables(database, "mock")
    const sourceUpdatedAt = "2026-08-29T00:00:00.000Z"
    const provider = {
      providerId: "mock-port",
      getPorts: async () => [{ ...createMockSnapshot().ports[0], sourceUpdatedAt, updatedAt: sourceUpdatedAt }],
    }
    const job = createPortSyncJob({ database, dataMode: "mock", provider, intervalMs: 60_000 })
    const result = await job.run()
    expect(job.providerId).toBe("mock-port")
    expect(result).toMatchObject({ status: "success", recordsRead: 1, recordsWritten: 1, sourceUpdatedAt })
    expect((await new ShippingRepository(database, "mock").listPorts())).toEqual([expect.objectContaining({ sourceUpdatedAt })])
    native.close()
  })

  it("keeps provider failure identity and last-known port data", async () => {
    const { database, native } = createNativeDatabase()
    await initShippingTables(database, "mock")
    await seedPorts(database)
    const provider = {
      providerId: "portcast-public",
      getPorts: async (lastKnown: Port[] = []) => lastKnown.map(port => ({ ...port, sourceStatus: "failed" as const, stale: true, error: "Portcast rate limited", errorCode: "rate_limited" })),
    }
    const job = createPortSyncJob({ database, dataMode: "mock", provider, intervalMs: 60_000 })
    const result = await job.run()
    expect(job.providerId).toBe("portcast-public")
    expect(result).toMatchObject({ status: "failed", recordsRead: 8, recordsWritten: 8, errorCode: "rate_limited" })
    native.close()
  })

  it("exposes the built-in Mock Port identity", () => {
    expect(MockPortProvider.providerId).toBe("mock-port")
  })
})
