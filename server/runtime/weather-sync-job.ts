import type { Database } from "db0"
import { portDirectoryBaseline } from "@shared/port-directory"
import type { ShippingDataMode } from "#/database/runtime"
import type { WeatherProvider } from "#/providers/shipping"
import { ShippingRepository } from "#/database/shipping"
import type { RuntimeJob } from "#/runtime/background-runtime"
import { computePortWeatherImpacts, forecastRowsToOpenMeteoPoints } from "#/services/open-meteo-port-forecast"
import { resolveTyphoonInputForImpactInterval } from "#/services/typhoon-wr-s03-resolve"

export const WEATHER_SYNC_CAPABILITY = "weather_sync" as const

export interface WeatherSyncJobOptions {
  database: Database
  dataMode: ShippingDataMode
  provider: WeatherProvider
  intervalMs: number
  enabled?: boolean
  now?: () => Date
  /** Test-only override */
  repository?: ShippingRepository
}

export function createWeatherSyncJob(options: WeatherSyncJobOptions): RuntimeJob {
  const repository = options.repository ?? new ShippingRepository(options.database, options.dataMode)
  const now = options.now ?? (() => new Date())
  const providerId = options.provider.providerId
  return {
    id: "weather-sync",
    providerId,
    capability: WEATHER_SYNC_CAPABILITY,
    intervalMs: options.intervalMs,
    enabled: options.enabled ?? true,
    run: async () => {
      const fetchedAt = now()
      const ports = await repository.listPorts()
      const previous = (await repository.listFeedItems({ now: fetchedAt, view: "all" })).filter(item => item.sourceId === providerId)
      const received = await options.provider.getFeedItems(ports, previous)
      const retainedIds = new Set(received.map(item => item.id))
      const archived = await repository.archiveFeedItemsNotIn([providerId], retainedIds, fetchedAt)
      for (const item of received) await repository.upsertFeedItem(item)
      const forecastBatch = options.provider.drainForecastPersistence?.()
      if (forecastBatch) {
        const portIds = new Set([
          ...forecastBatch.forecastsByPortId.keys(),
          ...forecastBatch.impactsByPortId.keys(),
        ])
        const runNow = now()
        const nowMs = runNow.getTime()
        const syncMeta = await repository.getTropicalCycloneSyncMeta({ nowMs })
        const cyclones = await repository.listNormalizedTropicalCyclones()
        const portCoords = portDirectoryBaseline.map(row => ({
          portId: row.shippingPortId,
          unlocode: row.unlocode,
          latitude: row.latitude,
          longitude: row.longitude,
        }))
        for (const portId of portIds) {
          const forecasts = forecastBatch.forecastsByPortId.get(portId) ?? []
          let impacts = forecastBatch.impactsByPortId.get(portId) ?? []
          if (forecasts.length) {
            const coord = portCoords.find(item => item.portId === portId)
            const resolveTyphoon = (validFrom: string, validUntil: string) => {
              if (!coord) return { status: "unavailable" as const }
              return resolveTyphoonInputForImpactInterval(syncMeta, cyclones, coord, validFrom, validUntil, nowMs)
            }
            const computedAt = impacts[0]?.computedAt ?? forecasts[0]?.fetchedAt ?? fetchedAt.toISOString()
            impacts = computePortWeatherImpacts(
              portId,
              forecastRowsToOpenMeteoPoints(forecasts),
              computedAt,
              undefined,
              resolveTyphoon,
            )
          }
          await repository.replaceWeatherPortBatch(portId, forecasts, impacts)
        }
        for (const attempt of forecastBatch.marineReferenceAttempts ?? []) await repository.recordMarineReferenceAttempt(attempt)
        options.provider.ackForecastPersistence?.()
      }
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
