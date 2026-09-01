import type { Database } from "db0"
import type { FeedItem } from "@shared/shipping"
import type { ShippingDataMode } from "#/database/runtime"
import { ShippingRepository } from "#/database/shipping"
import type { WeatherAlertProvider } from "#/providers/weather-alerts"
import type { RuntimeJob, SyncResult } from "#/runtime/background-runtime"

export const WEATHER_ALERT_SYNC_CAPABILITY = "weather_alerts" as const

export interface WeatherAlertSyncJobOptions {
  database: Database
  dataMode: ShippingDataMode
  sourceId: string
  provider: WeatherAlertProvider & { readonly providerId: string }
  intervalMs: number
  enabled?: boolean
  now?: () => Date
}

function latestSourceUpdatedAt(items: FeedItem[]): string | undefined {
  return items
    .map(item => item.sourceUpdatedAt)
    .filter((value): value is string => typeof value === "string" && Number.isFinite(Date.parse(value)))
    .sort((left, right) => Date.parse(right) - Date.parse(left))[0]
}

export function createWeatherAlertSyncJob(options: WeatherAlertSyncJobOptions): RuntimeJob {
  const repository = new ShippingRepository(options.database, options.dataMode)
  const now = options.now ?? (() => new Date())
  const providerId = options.provider.providerId
  if (providerId !== options.sourceId) throw new Error("weather_alert_source_provider_mismatch")

  return {
    id: `weather-alert-sync:${options.sourceId}`,
    providerId,
    capability: WEATHER_ALERT_SYNC_CAPABILITY,
    intervalMs: options.intervalMs,
    enabled: options.enabled ?? true,
    async run(): Promise<SyncResult> {
      const fetchedAt = now()
      const previous = (await repository.listFeedItems({ now: fetchedAt, view: "all" }))
        .filter(item => item.sourceId === options.sourceId)
      const ports = await repository.listPorts()
      const received = await options.provider.getFeedItems(previous, ports)
      const failed = received.find(item => item.sourceStatus === "failed")

      for (const item of received) await repository.upsertFeedItem(item)

      if (failed) {
        return {
          status: "failed",
          recordsRead: received.length,
          recordsWritten: received.length,
          errorCode: failed.errorCode ?? "provider_unavailable",
          errorMessage: failed.error ?? "official weather alert source failed",
        }
      }

      const retainedIds = new Set(received.map(item => item.id))
      const archived = await repository.archiveFeedItemsNotIn([options.sourceId], retainedIds, fetchedAt)
      return {
        status: "success",
        recordsRead: received.length,
        recordsWritten: received.length + archived,
        sourceUpdatedAt: latestSourceUpdatedAt(received),
      }
    },
  }
}
