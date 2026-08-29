import type { Database } from "db0"
import { detectShippingEvents } from "@shared/shipping-engine"
import { type OperationalSourceContext, type ShippingSettings, filterEventsForOperationalContext } from "@shared/shipping"
import type { ShippingDataMode } from "#/database/runtime"
import { ShippingRepository } from "#/database/shipping"
import type { FeedProvider, ShippingFeedSource } from "#/providers/feed"
import type { RuntimeJob } from "#/runtime/background-runtime"
import { createOperationalSourceContext, providerModes } from "#/providers/shipping"

export const FEED_SYNC_CAPABILITY = "feed_sync" as const

export interface FeedSyncJobOptions {
  database: Database
  dataMode: ShippingDataMode
  provider: FeedProvider
  source: Pick<ShippingFeedSource, "id" | "name">
  intervalMs: number
  enabled?: boolean
  now?: () => Date
}

export async function refreshFeedEvents(repository: ShippingRepository, settings: ShippingSettings, now: Date, context: OperationalSourceContext): Promise<void> {
  const vessels = await repository.listVessels()
  const ports = await repository.listPorts()
  const voyages = await repository.listVoyages()
  const feedItems = await repository.listFeedItems({ now })
  const aisPortMetrics = await repository.listAisPortMetrics()
  const storedEvents = await repository.listEvents({ vessels, ports, voyages, feedItems })
  const events = detectShippingEvents(
    vessels,
    ports,
    voyages,
    feedItems,
    settings,
    filterEventsForOperationalContext(storedEvents, context),
    now.toISOString(),
    await repository.listCalendarEvents(),
    aisPortMetrics,
  )
  for (const event of events) await repository.upsertEvent(event)
}

/**
 * A Feed Job owns one source only. This keeps source cadence, last-known data,
 * failure state and archive decisions independent in the Runtime repository.
 */
export function createFeedSyncJob(options: FeedSyncJobOptions): RuntimeJob {
  const repository = new ShippingRepository(options.database, options.dataMode)
  const now = options.now ?? (() => new Date())
  const sourceId = options.source.id
  const providerId = options.provider.providerId
  const context = createOperationalSourceContext({ ...providerModes, dataMode: options.dataMode })
  return {
    id: `feed-sync:${sourceId}`,
    providerId,
    capability: FEED_SYNC_CAPABILITY,
    intervalMs: options.intervalMs,
    enabled: options.enabled ?? true,
    run: async () => {
      const fetchedAt = now()
      const previous = (await repository.listFeedItems({ now: fetchedAt, view: "all" }))
        .filter(item => item.sourceId === sourceId)
      const ports = await repository.listPorts()
      const received = (await options.provider.getFeedItems(previous, ports))
        .filter(item => item.sourceId === sourceId)
      const retainedIds = new Set(received.map(item => item.id))
      const archived = await repository.archiveFeedItemsNotIn([sourceId], retainedIds, fetchedAt)
      for (const item of received) await repository.upsertFeedItem(item)
      const settings = await repository.getSettings()
      if (settings) await refreshFeedEvents(repository, settings, fetchedAt, context)
      const failed = received.find(item => item.sourceStatus === "failed")
      const sourceUpdatedAt = received
        .map(item => Date.parse(item.sourceUpdatedAt ?? item.updatedAt ?? item.publishedAt))
        .filter(timestamp => Number.isFinite(timestamp))
        .sort((a, b) => b - a)[0]
      return {
        status: failed ? "failed" : "success",
        recordsRead: received.length,
        recordsWritten: received.length + archived,
        sourceUpdatedAt: sourceUpdatedAt === undefined ? undefined : new Date(sourceUpdatedAt).toISOString(),
        errorCode: failed?.errorCode,
        errorMessage: failed?.error,
      }
    },
  }
}
