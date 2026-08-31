import process from "node:process"
import type { Database } from "db0"
import type { ShippingDataMode } from "#/database/runtime"
import type { AisTrackingProvider } from "#/providers/ais/contracts"
import { createAisAreaProviderForDatabase, createAisTrackingProviderForDatabase, getConfiguredAisStreamTiming } from "#/providers/ais"
import { createAisTrackingJob } from "#/runtime/ais-tracking-job"
import type { VoyageProvider } from "#/providers/voyage/contracts"
import { createVoyageProviderForDatabase } from "#/providers/voyage"
import { createVoyageSyncJob } from "#/runtime/voyage-sync-job"
import type { AisAreaProvider } from "#/providers/aisstream-area"
import { createAisAreaSyncJob } from "#/runtime/ais-area-sync-job"
import { MockFeedProvider, activeShippingFeedSourceIds, createPublicFeedProvider, shippingFeedSources } from "#/providers/feed"
import { createFeedSyncJob } from "#/runtime/feed-sync-job"
import { createCalendarSyncJob } from "#/runtime/calendar-sync-job"
import { createPortSyncJob } from "#/runtime/port-sync-job"
import { createWeatherSyncJob } from "#/runtime/weather-sync-job"
import { createOpenMeteoWeatherProvider, providerModes, providers } from "#/providers/shipping"
import { PortDirectoryRepository } from "#/database/port-directory"
import type { RuntimeJob } from "#/runtime/background-runtime"
import { isAisStreamingEnabled } from "#/runtime/ais-streaming-config"

export interface RuntimeRegistryOptions {
  database: Database
  dataMode: ShippingDataMode
  aisProvider?: AisTrackingProvider
  aisAreaProvider?: AisAreaProvider
  voyageProvider?: VoyageProvider
  now?: () => Date
}

function intervalMs(): number {
  const minutes = Number(process.env.SHIPPING_AIS_INTERVAL_MINUTES ?? 15)
  return Math.max(1, Number.isFinite(minutes) ? minutes : 15) * 60 * 1000
}

function voyageIntervalMs(): number {
  const minutes = Number(process.env.SHIPPING_VOYAGE_INTERVAL_MINUTES ?? 60)
  return Math.max(1, Number.isFinite(minutes) ? minutes : 60) * 60 * 1000
}

function aisAreaIntervalMs(): number {
  const minutes = Number(process.env.SHIPPING_AIS_AREA_INTERVAL_MINUTES ?? 1)
  return Math.max(1, Number.isFinite(minutes) && minutes > 0 ? minutes : 1) * 60 * 1000
}

function feedIntervalMs(): number {
  const minutes = Number(process.env.SHIPPING_FEED_INTERVAL_MINUTES ?? 30)
  return Math.max(1, Number.isFinite(minutes) ? minutes : 30) * 60 * 1000
}

function calendarIntervalMs(): number {
  const hours = Number(process.env.SHIPPING_CALENDAR_INTERVAL_HOURS ?? 24)
  return Math.max(1, Number.isFinite(hours) ? hours : 24) * 60 * 60 * 1000
}

function portIntervalMs(): number {
  const minutes = Number(process.env.SHIPPING_PORT_INTERVAL_MINUTES ?? 60)
  return Math.max(1, Number.isFinite(minutes) ? minutes : 60) * 60 * 1000
}

function weatherIntervalMs(): number {
  const minutes = Number(process.env.SHIPPING_WEATHER_INTERVAL_MINUTES ?? 60)
  return Math.max(1, Number.isFinite(minutes) ? minutes : 60) * 60 * 1000
}

export function getConfiguredAisProviderId(): string {
  return process.env.SHIPPING_AIS_PROVIDER?.trim().toLowerCase()
    || process.env.SHIPPING_VESSEL_PROVIDER?.trim().toLowerCase()
    || "mock"
}

function feedJobs(options: RuntimeRegistryOptions): RuntimeJob[] {
  const requestedProvider = process.env.SHIPPING_FEED_PROVIDER?.trim().toLowerCase()
  if (options.dataMode === "real" && requestedProvider !== "public") return []
  if (options.dataMode !== "real" && requestedProvider !== "public") {
    return [createFeedSyncJob({
      database: options.database,
      dataMode: options.dataMode,
      provider: MockFeedProvider,
      source: { id: "mock-port-notice", name: "Mock Feed" },
      intervalMs: feedIntervalMs(),
      enabled: true,
      now: options.now,
    })]
  }
  return shippingFeedSources
    .filter(source => activeShippingFeedSourceIds([source]).has(source.id))
    .map(source => createFeedSyncJob({
      database: options.database,
      dataMode: options.dataMode,
      provider: createPublicFeedProvider({ sources: [source], throwOnSourceFailureWithoutLastKnown: true }),
      source,
      intervalMs: feedIntervalMs(),
      enabled: true,
      now: options.now,
    }))
}

function calendarJobs(options: RuntimeRegistryOptions): RuntimeJob[] {
  return [createCalendarSyncJob({
    database: options.database,
    dataMode: options.dataMode,
    provider: providers.calendar,
    intervalMs: calendarIntervalMs(),
    enabled: true,
    now: options.now,
  })]
}

function portJobs(options: RuntimeRegistryOptions): RuntimeJob[] {
  return [createPortSyncJob({
    database: options.database,
    dataMode: options.dataMode,
    provider: providers.port,
    intervalMs: portIntervalMs(),
    enabled: true,
    now: options.now,
  })]
}

function weatherJobs(options: RuntimeRegistryOptions): RuntimeJob[] {
  const weatherProvider = providerModes.weather === "open-meteo"
    ? createOpenMeteoWeatherProvider({ portDirectory: new PortDirectoryRepository(options.database, options.dataMode), now: options.now })
    : providers.weather
  return [createWeatherSyncJob({
    database: options.database,
    dataMode: options.dataMode,
    provider: weatherProvider,
    intervalMs: weatherIntervalMs(),
    enabled: true,
    now: options.now,
  })]
}

export function getDefaultRuntimeJobs(options: RuntimeRegistryOptions): RuntimeJob[] {
  const providerId = getConfiguredAisProviderId()
  const streamingEnabled = isAisStreamingEnabled(options.dataMode)
  const aisTiming = getConfiguredAisStreamTiming()
  const provider = streamingEnabled
    ? undefined
    : options.aisProvider ?? createAisTrackingProviderForDatabase(options.database, {
      providerId,
      dataMode: options.dataMode,
      connectionTimeoutMs: aisTiming.connectionTimeoutMs,
      observationWindowMs: aisTiming.observationWindowMs,
      now: options.now,
    })
  const voyageProviderId = process.env.SHIPPING_VOYAGE_PROVIDER?.trim().toLowerCase() || "mock"
  const voyageProvider = options.voyageProvider ?? createVoyageProviderForDatabase(options.database, {
    providerId: voyageProviderId,
    dataMode: options.dataMode,
    now: options.now,
  })
  const areaEnabled = options.dataMode === "real" && process.env.SHIPPING_AIS_AREA_PROVIDER?.trim().toLowerCase() === "aisstream"
  const aisAreaProvider = areaEnabled
    ? options.aisAreaProvider ?? createAisAreaProviderForDatabase(options.database, { dataMode: options.dataMode, now: options.now })
    : undefined
  const jobs: RuntimeJob[] = []
  if (provider) {
    jobs.push(createAisTrackingJob({
      database: options.database,
      dataMode: options.dataMode,
      provider,
      intervalMs: intervalMs(),
      enabled: !(options.dataMode === "real" && provider.providerId === "mock"),
      now: options.now,
    }))
  }
  if (aisAreaProvider) {
    jobs.push(createAisAreaSyncJob({
      database: options.database,
      dataMode: options.dataMode,
      provider: aisAreaProvider,
      intervalMs: aisAreaIntervalMs(),
      enabled: true,
    }))
  }
  return [...jobs, createVoyageSyncJob({
    database: options.database,
    dataMode: options.dataMode,
    provider: voyageProvider,
    intervalMs: voyageIntervalMs(),
    enabled: !(options.dataMode === "real" && voyageProvider.providerId === "mock"),
    now: options.now,
  }), ...feedJobs(options), ...calendarJobs(options), ...portJobs(options), ...weatherJobs(options)]
}
