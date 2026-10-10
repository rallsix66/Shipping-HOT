import type { Database } from "db0"
import { portDirectoryBaseline } from "@shared/port-directory"
import type { ShippingDataMode } from "#/database/runtime"
import type { WeatherProvider } from "#/providers/shipping"
import { ShippingRepository } from "#/database/shipping"
import type { RuntimeJob } from "#/runtime/background-runtime"
import { computePortWeatherImpacts, forecastRowsToOpenMeteoPoints } from "#/services/open-meteo-port-forecast"
import { TYPHOON_NO_STORM_DISTANCE_KM } from "#/services/weather-rule-coverage"
import { minTyphoonDistanceKmForPort } from "#/services/tropical-cyclone-display"

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
        const syncMeta = await repository.getTropicalCycloneSyncMeta()
        const cyclones = await repository.listNormalizedTropicalCyclones()
        const portCoords = portDirectoryBaseline.map(row => ({
          portId: row.shippingPortId,
          unlocode: row.unlocode,
          latitude: row.latitude,
          longitude: row.longitude,
        }))
        const typhoonChecked = syncMeta.outcome === "ok" || syncMeta.outcome === "ok_empty"
        for (const portId of portIds) {
          const forecasts = forecastBatch.forecastsByPortId.get(portId) ?? []
          let impacts = forecastBatch.impactsByPortId.get(portId) ?? []
          if (typhoonChecked && forecasts.length) {
            const coord = portCoords.find(item => item.portId === portId)
            const typhoonKm = coord
              ? (minTyphoonDistanceKmForPort(cyclones, coord, true) ?? TYPHOON_NO_STORM_DISTANCE_KM)
              : TYPHOON_NO_STORM_DISTANCE_KM
            const computedAt = impacts[0]?.computedAt ?? forecasts[0]?.fetchedAt ?? fetchedAt.toISOString()
            impacts = computePortWeatherImpacts(
              portId,
              forecastRowsToOpenMeteoPoints(forecasts),
              computedAt,
              typhoonKm,
            )
          }
          await repository.replaceWeatherPortBatch(portId, forecasts, impacts)
        }
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
