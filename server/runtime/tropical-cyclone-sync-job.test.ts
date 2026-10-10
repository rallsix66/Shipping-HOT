import NativeDatabase from "better-sqlite3"
import { createDatabase } from "db0"
import { describe, expect, it } from "vitest"
import { portDirectoryBaseline } from "@shared/port-directory"
import { ShippingRepository, initShippingTables } from "#/database/shipping"
import { createTropicalCycloneSyncJob } from "#/runtime/tropical-cyclone-sync-job"
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

describe("tropical cyclone sync job", () => {
  it("runs job → repository → panel and retains path times on detail failure", async () => {
    const { database, native } = createNativeDatabase()
    await initShippingTables(database, "real")
    const repository = new ShippingRepository(database, "real")
    const list = JSON.stringify([{ tropicalCyclone: "TC2634" }])
    const forecast = JSON.stringify([
      { part: "title", issue: { UTC: "2026-08-15T01:10:00Z" }, typhoonNumber: "2629", name: { en: "Koguma" } },
      { part: { en: "Analysis" }, advancedHours: 0, validtime: { UTC: "2026-08-15T10:00:00.000Z" }, center: [22.52, 114.35] },
      { part: { en: "Forecast" }, advancedHours: 24, validtime: { UTC: "2026-08-16T10:00:00.000Z" }, center: [23.0, 114.0] },
    ])
    const now = () => new Date("2026-08-15T10:00:00.000Z")
    const job = createTropicalCycloneSyncJob({
      database,
      dataMode: "real",
      intervalMs: 60_000,
      useLiveJma: true,
      now,
      repository,
      fetcher: async (url) => {
        if (url.includes("targetTc")) return new Response(list, { status: 200 })
        if (url.includes("TC2634")) return new Response(forecast, { status: 200 })
        return new Response("{}", { status: 404 })
      },
    })
    await job.run()
    const afterOk = await getTropicalCyclonePanel(repository, { now: now() })
    expect(afterOk.activeCount + afterOk.historicalSummaryCount).toBeGreaterThan(0)
    const pathFetchedAt = afterOk.cyclones[0]?.pathFetchedAt
    expect(pathFetchedAt).toBe("2026-08-15T10:00:00.000Z")

    const failJob = createTropicalCycloneSyncJob({
      database,
      dataMode: "real",
      intervalMs: 60_000,
      useLiveJma: true,
      now: () => new Date("2026-08-15T11:00:00.000Z"),
      repository,
      fetcher: async () => new Response("", { status: 503 }),
    })
    const partialResult = await createTropicalCycloneSyncJob({
      database,
      dataMode: "real",
      intervalMs: 60_000,
      useLiveJma: true,
      now: () => new Date("2026-08-15T10:30:00.000Z"),
      repository,
      fetcher: async (url) => {
        if (url.includes("targetTc")) return new Response(list, { status: 200 })
        return new Response("", { status: 503 })
      },
    }).run()
    expect(partialResult.status).toBe("failed")
    expect(partialResult.errorCode).toBe("jma_detail_total_failure")

    await failJob.run()
    const afterFail = await getTropicalCyclonePanel(repository, { now: new Date("2026-08-15T11:30:00.000Z") })
    expect(afterFail.sync.outcome).toBe("failed")
    expect(afterFail.cyclones[0]?.pathFetchedAt).toBe(pathFetchedAt)
    expect(afterFail.sync.lastFullSuccessAt).toBe("2026-08-15T10:00:00.000Z")
    expect(afterFail.sync.lastCheckedAt).toBe("2026-08-15T11:00:00.000Z")
    void portDirectoryBaseline
    native.close()
  })
})
