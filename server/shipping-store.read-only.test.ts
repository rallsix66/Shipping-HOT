import { afterEach, describe, expect, it, vi } from "vitest"
import { createMockSnapshot } from "@shared/shipping-fixtures"

describe("shipping snapshot read boundary", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.doUnmock("#/database/shipping")
    vi.doUnmock("#/providers/shipping")
    vi.resetModules()
  })

  it("reads Feed from SQLite without invoking any Provider", async () => {
    const snapshot = createMockSnapshot()
    const feedCalls = vi.fn()
    class FakeRepository {
      constructor(_database: unknown, _dataMode?: unknown) {}
      async isEmpty() {
        return false
      }

      async getSettings() {
        return structuredClone(snapshot.settings)
      }

      async listPorts() {
        return structuredClone(snapshot.ports)
      }

      async listFeedItems() {
        return structuredClone(snapshot.feedItems)
      }

      async listCalendarEvents() {
        return []
      }

      async listEvents() {
        return structuredClone(snapshot.events)
      }
    }
    vi.stubGlobal("useDatabase", () => ({}))
    vi.doMock("#/database/shipping", () => ({ ShippingRepository: FakeRepository, initShippingTables: async () => ({ schemaVersion: 14, bootstrapCompletedAt: "2026-08-29T00:00:00.000Z" }) }))
    vi.doMock("#/providers/shipping", async () => {
      const actual = await vi.importActual<typeof import("#/providers/shipping")>("#/providers/shipping")
      return { ...actual, providers: { ...actual.providers, feed: { getFeedItems: feedCalls } } }
    })

    const { getShippingSnapshot } = await import("./shipping-store")
    const result = await getShippingSnapshot()

    expect(result.feedItems).toEqual(snapshot.feedItems)
    expect(feedCalls).not.toHaveBeenCalled()
  })

  it("reads Feed history from SQLite without Provider calls", async () => {
    const snapshot = createMockSnapshot()
    const feedCalls = vi.fn()
    class FakeRepository {
      constructor(_database: unknown, _dataMode?: unknown) {}
      async isEmpty() {
        return false
      }

      async getSettings() {
        return structuredClone(snapshot.settings)
      }

      async listFeedHistory() {
        return [{
          id: "hist-1",
          feedItemId: snapshot.feedItems[0].id,
          observedAt: "2026-01-10T00:00:00.000Z",
          item: snapshot.feedItems[0],
        }]
      }
    }
    vi.stubGlobal("useDatabase", () => ({}))
    vi.doMock("#/database/shipping", () => ({ ShippingRepository: FakeRepository, initShippingTables: async () => ({ schemaVersion: 14, bootstrapCompletedAt: "2026-08-29T00:00:00.000Z" }) }))
    vi.doMock("#/providers/shipping", async () => {
      const actual = await vi.importActual<typeof import("#/providers/shipping")>("#/providers/shipping")
      return { ...actual, providers: { ...actual.providers, feed: { getFeedItems: feedCalls } } }
    })

    const { getFeedHistory } = await import("./shipping-store")
    const history = await getFeedHistory({ query: "notice", limit: 5 })
    expect(history).toHaveLength(1)
    expect(history[0].item.id).toBe(snapshot.feedItems[0].id)
    expect(feedCalls).not.toHaveBeenCalled()
  })

  it("does not expose retired vessel fields on the port-only snapshot", async () => {
    const snapshot = createMockSnapshot()
    class FakeRepository {
      constructor(_database: unknown, _dataMode?: unknown) {}
      async isEmpty() {
        return false
      }

      async getSettings() {
        return structuredClone(snapshot.settings)
      }

      async listPorts() {
        return structuredClone(snapshot.ports)
      }

      async listFeedItems() {
        return structuredClone(snapshot.feedItems)
      }

      async listCalendarEvents() {
        return []
      }

      async listEvents() {
        return structuredClone(snapshot.events)
      }
    }
    vi.stubGlobal("useDatabase", () => ({}))
    vi.doMock("#/database/shipping", () => ({ ShippingRepository: FakeRepository, initShippingTables: async () => ({ schemaVersion: 14, bootstrapCompletedAt: "2026-08-29T00:00:00.000Z" }) }))
    vi.doMock("#/providers/shipping", async () => vi.importActual("#/providers/shipping"))

    const { getShippingSnapshot } = await import("./shipping-store")
    const result = await getShippingSnapshot()
    expect(result).not.toHaveProperty("vessels")
    expect(result).not.toHaveProperty("voyages")
  })
})
