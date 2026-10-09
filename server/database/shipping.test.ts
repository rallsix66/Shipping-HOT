import NativeDatabase from "better-sqlite3"
import { createDatabase } from "db0"
import { describe, expect, it } from "vitest"
import { createMockSnapshot } from "@shared/shipping-fixtures"
import { ShippingRepository, initShippingTables } from "./shipping"

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

async function preparedRepository() {
  const state = createNativeDatabase()
  await initShippingTables(state.database, "mock")
  return { ...state, repository: new ShippingRepository(state.database) }
}

describe("shipping repository", () => {
  it("seeds and reads ports, feed items, events and settings", async () => {
    const { database, native } = createNativeDatabase()
    await initShippingTables(database, "mock")
    const repository = new ShippingRepository(database, "mock")
    const snapshot = createMockSnapshot()
    await repository.seed(snapshot.ports, snapshot.feedItems, snapshot.events, snapshot.settings)
    expect(await repository.listPorts()).toHaveLength(snapshot.ports.length)
    expect(await repository.listFeedItems({ now: new Date() })).toHaveLength(snapshot.feedItems.length)
    expect(await repository.listEvents()).toHaveLength(snapshot.events.length)
    expect(await repository.getSettings()).toMatchObject({ refreshInterval: snapshot.settings.refreshInterval })
    native.close()
  })

  it("persists port follow state independently from provider rows", async () => {
    const { database, native } = createNativeDatabase()
    await initShippingTables(database, "mock")
    const repository = new ShippingRepository(database, "mock")
    const snapshot = createMockSnapshot()
    await repository.seed(snapshot.ports, [], [], snapshot.settings)
    const port = snapshot.ports[0]
    expect((await repository.listPorts()).find(item => item.id === port.id)?.isWatched).toBe(false)
    await repository.setPortFollow(port.id, true)
    expect((await repository.listPorts()).find(item => item.id === port.id)?.isWatched).toBe(true)
    await repository.setPortFollow(port.id, false)
    expect((await repository.listPorts()).find(item => item.id === port.id)?.isWatched).toBe(false)
    native.close()
  })

  it("hydrates Feed lifecycle from canonical columns and projects natural expiry without writes", async () => {
    const { repository, native } = await preparedRepository()
    const snapshot = createMockSnapshot()
    const now = new Date("2026-09-04T12:00:00.000Z")
    const future = "2026-09-05T00:00:00.000Z"
    const alternateFuture = "2026-09-06T00:00:00.000Z"
    const expired = "2026-09-04T11:00:00.000Z"
    const add = async (id: string) => repository.upsertFeedItem({
      ...snapshot.feedItems[0],
      id,
      publishedAt: "2026-09-04T00:00:00.000Z",
      fetchedAt: "2026-09-04T00:01:00.000Z",
    })
    const persist = (id: string, visibility: string, currentUntil: string | null, jsonPatch: Record<string, unknown> = {}, sourceType = "mock") => {
      const row = native.prepare("SELECT data FROM feed_items WHERE id = ?").get(id) as { data: string }
      const data = { ...JSON.parse(row.data) as Record<string, unknown>, ...jsonPatch }
      native.prepare("UPDATE feed_items SET visibility = ?, current_until = ?, source_type = ?, data = ? WHERE id = ?")
        .run(visibility, currentUntil, sourceType, JSON.stringify(data), id)
    }

    await add("feed-lifecycle-current")
    await add("feed-lifecycle-history")
    await add("feed-lifecycle-quarantine")
    await add("feed-lifecycle-expired")
    await add("feed-lifecycle-equal")
    await add("feed-lifecycle-null")
    await add("feed-lifecycle-invalid")
    await add("feed-lifecycle-column-current")
    await add("feed-lifecycle-canonical-until")
    await add("feed-lifecycle-unknown-visibility")

    persist("feed-lifecycle-current", "current", future)
    persist("feed-lifecycle-history", "history", future, { visibility: "current", eventEligibility: true, stale: false })
    persist("feed-lifecycle-quarantine", "quarantine", future, { visibility: "current", eventEligibility: true, stale: false })
    persist("feed-lifecycle-expired", "current", expired, { visibility: "current", eventEligibility: true, stale: false })
    persist("feed-lifecycle-equal", "current", now.toISOString(), { visibility: "current", eventEligibility: true, stale: false })
    persist("feed-lifecycle-null", "current", null, { visibility: "current", eventEligibility: true, stale: false })
    persist("feed-lifecycle-invalid", "current", "not-a-date", { visibility: "current", eventEligibility: true, stale: false })
    persist("feed-lifecycle-column-current", "current", future, { visibility: "history", currentUntil: expired }, "imported")
    persist("feed-lifecycle-canonical-until", "current", alternateFuture, { visibility: "current", currentUntil: expired })
    persist("feed-lifecycle-unknown-visibility", "unsupported", future, { visibility: "current" })

    const beforeExpired = native.prepare("SELECT visibility, current_until, data FROM feed_items WHERE id = ?").get("feed-lifecycle-expired")
    const current = await repository.listFeedItems({ view: "current", now })
    expect(current.map(item => item.id)).toEqual(expect.arrayContaining([
      "feed-lifecycle-current",
      "feed-lifecycle-column-current",
      "feed-lifecycle-canonical-until",
    ]))
    expect(current).toHaveLength(3)

    const history = await repository.listFeedItems({ view: "history", now })
    expect(history.map(item => item.id)).toEqual(expect.arrayContaining([
      "feed-lifecycle-history",
      "feed-lifecycle-quarantine",
      "feed-lifecycle-expired",
      "feed-lifecycle-equal",
      "feed-lifecycle-null",
      "feed-lifecycle-invalid",
      "feed-lifecycle-unknown-visibility",
    ]))
    expect(history.find(item => item.id === "feed-lifecycle-expired")).toMatchObject({ visibility: "history", currentUntil: expired, eventEligibility: false, stale: true })
    expect(native.prepare("SELECT visibility, current_until, data FROM feed_items WHERE id = ?").get("feed-lifecycle-expired")).toEqual(beforeExpired)
    native.close()
  })

  it("filters Feed history query and source before applying the limit", async () => {
    const { repository, native } = await preparedRepository()
    const snapshot = createMockSnapshot()
    const base = snapshot.feedItems[0]
    const targetSource = base.sourceId
    const add = (id: string, fetchedAt: string, title: string, sourceId = targetSource) => repository.upsertFeedItem({
      ...base,
      id,
      sourceId,
      title,
      summary: title,
      fetchedAt,
      publishedAt: "2026-01-10T00:00:00.000Z",
    })
    await add("feed-history-newest-unmatched", "2026-01-10T00:04:00.000Z", "newest unrelated")
    await add("feed-history-second-unmatched", "2026-01-10T00:03:00.000Z", "second unrelated")
    await add("feed-history-older-match", "2026-01-10T00:01:00.000Z", "older needle match")
    await add("feed-history-other-source-match", "2026-01-10T00:05:00.000Z", "needle from another source", "other-source")

    const result = await repository.listFeedHistory({ query: "needle", sourceId: targetSource, limit: 1 })
    expect(result.map(record => record.item.id)).toEqual(["feed-history-older-match"])
    expect(await repository.listFeedHistory({ query: "needle", sourceId: targetSource, limit: 500 })).toHaveLength(1)
    native.close()
  })
})
