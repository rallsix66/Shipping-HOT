import NativeDatabase from "better-sqlite3"
import { createDatabase } from "db0"
import { describe, expect, it } from "vitest"
import { RuntimeRepository } from "#/database/runtime-jobs"
import { ShippingRepository, initShippingTables } from "#/database/shipping"
import { BackgroundRuntime } from "#/runtime/background-runtime"
import { TROPICAL_CYCLONE_SYNC_CAPABILITY, createTropicalCycloneSyncJob } from "#/runtime/tropical-cyclone-sync-job"
import { getTropicalCyclonePanel } from "#/services/tropical-cyclone-panel"

const TEST_NOW = new Date("2026-08-15T11:00:00.000Z")
const TEST_PREVIOUS_SUCCESS = "2026-08-15T10:00:00.000Z"
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

describe("tropical cyclone background runtime partial mapping", () => {
  it("targetTc ok + all detail 503 → failed runtime, preserved path, no success refresh", async () => {
    const { database, native } = createNativeDatabase()
    await initShippingTables(database, "real")
    const shippingRepository = new ShippingRepository(database, "real")
    const runtimeRepository = new RuntimeRepository(database)
    const list = JSON.stringify([{ tropicalCyclone: "TC2634" }])
    const forecast = JSON.stringify([
      { part: "title", issue: { UTC: "2026-08-15T01:10:00Z" }, name: { en: "Koguma" } },
      { part: { en: "Analysis" }, advancedHours: 0, validtime: { UTC: "2026-08-15T10:00:00.000Z" }, center: [22.52, 114.35] },
    ])
    const seedJob = createTropicalCycloneSyncJob({
      database,
      dataMode: "real",
      intervalMs: 60_000,
      useLiveJma: true,
      now: () => new Date(TEST_PREVIOUS_SUCCESS),
      repository: shippingRepository,
      fetcher: async (url) => {
        if (url.includes("targetTc")) return new Response(list, { status: 200 })
        if (url.includes("TC2634")) return new Response(forecast, { status: 200 })
        return new Response("{}", { status: 404 })
      },
    })
    await seedJob.run()
    const panelBefore = await getTropicalCyclonePanel(shippingRepository, { now: TEST_NOW })
    expect(panelBefore.cyclones.length).toBeGreaterThan(0)
    const pathFetchedAt = panelBefore.cyclones[0]?.pathFetchedAt

    await runtimeRepository.updateProviderRuntime({
      providerId: "jma-typhoon",
      capability: TROPICAL_CYCLONE_SYNC_CAPABILITY,
      status: "healthy",
      lastRequestAt: TEST_PREVIOUS_SUCCESS,
      lastSuccessAt: TEST_PREVIOUS_SUCCESS,
      consecutiveFailures: 0,
      updatedAt: TEST_PREVIOUS_SUCCESS,
    })

    const runtime = new BackgroundRuntime(runtimeRepository, { now: () => TEST_NOW })
    runtime.register(createTropicalCycloneSyncJob({
      database,
      dataMode: "real",
      intervalMs: 60_000,
      useLiveJma: true,
      now: () => TEST_NOW,
      repository: shippingRepository,
      fetcher: async (url) => {
        if (url.includes("targetTc")) return new Response(list, { status: 200 })
        return new Response("", { status: 503 })
      },
    }))
    await runtime.start()
    const result = await runtime.runNow("tropical-cyclone-sync")
    expect(result.status).toBe("failed")
    expect(result.errorCode).toBe("jma_detail_total_failure")

    const runtimeRow = await runtimeRepository.getProviderRuntime("jma-typhoon", TROPICAL_CYCLONE_SYNC_CAPABILITY)
    expect(runtimeRow?.consecutiveFailures).toBe(1)
    expect(runtimeRow?.status).toBe("degraded")
    expect(runtimeRow?.lastSuccessAt).toBe(TEST_PREVIOUS_SUCCESS)

    const meta = await shippingRepository.getTropicalCycloneSyncMeta({ nowMs: TEST_NOW.getTime() })
    expect(meta.lastFullSuccessAt).toBe(TEST_PREVIOUS_SUCCESS)
    expect(meta.lastCheckedAt).toBe(TEST_NOW.toISOString())
    expect(Date.parse(meta.lastCheckedAt!) <= TEST_NOW.getTime()).toBe(true)

    const panelAfter = await getTropicalCyclonePanel(shippingRepository, { now: TEST_NOW })
    expect(panelAfter.cyclones[0]?.pathFetchedAt).toBe(pathFetchedAt)
    native.close()
  })
})
