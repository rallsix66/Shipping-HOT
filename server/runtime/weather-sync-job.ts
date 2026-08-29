import type { Database } from "db0"
import type { ShippingDataMode } from "#/database/runtime"
import type { WeatherProvider } from "#/providers/shipping"
import { ShippingRepository } from "#/database/shipping"
import type { RuntimeJob } from "#/runtime/background-runtime"

export const WEATHER_SYNC_CAPABILITY = "weather_sync" as const

export interface WeatherSyncJobOptions {
  database: Database
  dataMode: ShippingDataMode
  provider: WeatherProvider
  intervalMs: number
  enabled?: boolean
  now?: () => Date
}

export function createWeatherSyncJob(options: WeatherSyncJobOptions): RuntimeJob {
  const repository = new ShippingRepository(options.database, options.dataMode)
  const now = options.now ?? (() => new Date())
  return {
    id: "weather-sync",
    providerId: "open-meteo-marine",
    capability: WEATHER_SYNC_CAPABILITY,
    intervalMs: options.intervalMs,
    enabled: options.enabled ?? true,
    run: async () => {
      const fetchedAt = now()
      const ports = await repository.listPorts()
      const previous = (await repository.listFeedItems({ now: fetchedAt, view: "all" })).filter(item => item.sourceId === "open-meteo-marine")
      const received = await options.provider.getFeedItems(ports, previous)
      const retainedIds = new Set(received.map(item => item.id))
      const archived = await repository.archiveFeedItemsNotIn(["open-meteo-marine"], retainedIds, fetchedAt)
      for (const item of received) await repository.upsertFeedItem(item)
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
        errorCode: failed?.error,
        errorMessage: failed?.error,
      }
    },
  }
}
