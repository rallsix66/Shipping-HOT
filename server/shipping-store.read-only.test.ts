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

      async listVessels() {
        return structuredClone(snapshot.vessels)
      }

      async listPorts() {
        return structuredClone(snapshot.ports)
      }

      async listVoyages() {
        return structuredClone(snapshot.voyages)
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

      async listAisPortMetrics() {
        return []
      }
    }
    vi.stubGlobal("useDatabase", () => ({}))
    vi.doMock("#/database/shipping", () => ({ ShippingRepository: FakeRepository, initShippingTables: async () => ({ schemaVersion: 11, bootstrapCompletedAt: "2026-08-29T00:00:00.000Z" }) }))
    vi.doMock("#/providers/shipping", async () => {
      const actual = await vi.importActual<typeof import("#/providers/shipping")>("#/providers/shipping")
      return { ...actual, providers: { ...actual.providers, feed: { getFeedItems: feedCalls } } }
    })

    const { getShippingSnapshot } = await import("./shipping-store")
    const result = await getShippingSnapshot()

    expect(result.feedItems).toEqual(snapshot.feedItems)
    expect(feedCalls).not.toHaveBeenCalled()
  })
})
