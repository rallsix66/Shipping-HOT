import process from "node:process"
import type { Database } from "db0"
import type { ShippingDataMode } from "#/database/runtime"
import { MockFeedProvider, activeShippingFeedSourceIds, createPublicFeedProvider, shippingFeedSources } from "#/providers/feed"
import { createFeedSyncJob } from "#/runtime/feed-sync-job"
import { articleFetchEnabled, articleFetchIntervalMs, createArticleFetchJob } from "#/runtime/article-fetch-job"
import { createCalendarSyncJob } from "#/runtime/calendar-sync-job"
import type { CalendarProvider } from "#/providers/calendar"
import { createPortSyncJob } from "#/runtime/port-sync-job"
import { createWeatherSyncJob } from "#/runtime/weather-sync-job"
import { createWeatherAlertSyncJob } from "#/runtime/weather-alert-sync-job"
import { createOpenMeteoWeatherProvider, providerModes, providers } from "#/providers/shipping"
import { activeOfficialWeatherAlertSourceIds, createOfficialWeatherAlertProvider, officialWeatherAlertSources } from "#/providers/weather-alerts"
import type { WeatherAlertProvider } from "#/providers/weather-alerts"
import { PortDirectoryRepository } from "#/database/port-directory"
import type { RuntimeJob } from "#/runtime/background-runtime"
import { TRANSLATION_PROVIDER_TIMEOUT_MS, createTranslationSyncJob } from "#/runtime/translation-sync-job"
import type { SecretStore, TranslationProvider } from "#/providers/contracts"
import { createDeepSeekTranslationProvider } from "#/providers/translation/deepseek-provider"
import { TRANSLATION_PROVIDER_ID } from "#/services/translation-settings"
import { FileSecretStore } from "#/secrets/file-secret-store"

export interface RuntimeRegistryOptions {
  database: Database
  dataMode: ShippingDataMode
  calendarProvider?: CalendarProvider
  translationProvider?: TranslationProvider
  translationSecretStore?: SecretStore
  now?: () => Date
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

function weatherAlertIntervalMs(): number {
  const minutes = Number(process.env.SHIPPING_WEATHER_ALERT_INTERVAL_MINUTES ?? 15)
  return (Number.isFinite(minutes) && minutes > 0 ? minutes : 15) * 60 * 1000
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

function articleJobs(options: RuntimeRegistryOptions): RuntimeJob[] {
  if (!articleFetchEnabled()) return []
  return [createArticleFetchJob({
    database: options.database,
    dataMode: options.dataMode,
    intervalMs: articleFetchIntervalMs(),
    enabled: true,
    now: options.now,
  })]
}

function calendarJobs(options: RuntimeRegistryOptions): RuntimeJob[] {
  const provider = options.calendarProvider ?? providers.calendar
  return [createCalendarSyncJob({
    database: options.database,
    dataMode: options.dataMode,
    provider,
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

function weatherAlertJobs(options: RuntimeRegistryOptions): RuntimeJob[] {
  if (options.dataMode !== "real") return []
  const mode = process.env.SHIPPING_WEATHER_ALERT_PROVIDER?.trim().toLowerCase()
  if (mode !== "public" && mode !== "experimental") return []
  const activeSourceIds = activeOfficialWeatherAlertSourceIds({ allowPending: mode === "experimental" })
  return officialWeatherAlertSources
    .filter(source => activeSourceIds.has(source.id))
    .map(source => createWeatherAlertSyncJob({
      database: options.database,
      dataMode: options.dataMode,
      sourceId: source.id,
      provider: createOfficialWeatherAlertProvider({
        sources: [source],
        allowPending: mode === "experimental",
        throwOnSourceFailureWithoutLastKnown: true,
        now: options.now,
      }) as WeatherAlertProvider & { readonly providerId: string },
      intervalMs: weatherAlertIntervalMs(),
      enabled: true,
      now: options.now,
    }))
}

function translationJobs(options: RuntimeRegistryOptions): RuntimeJob[] {
  const secretStore = options.translationSecretStore ?? new FileSecretStore()
  const provider = options.translationProvider ?? createDeepSeekTranslationProvider({
    apiKeyResolver: () => secretStore.get(TRANSLATION_PROVIDER_ID),
    timeoutMs: TRANSLATION_PROVIDER_TIMEOUT_MS,
  })
  return [createTranslationSyncJob({
    database: options.database,
    dataMode: options.dataMode,
    provider,
    secretStore,
    intervalMs: 60_000,
    enabled: true,
    now: options.now,
  })]
}

export function getDefaultRuntimeJobs(options: RuntimeRegistryOptions): RuntimeJob[] {
  return [...feedJobs(options), ...articleJobs(options), ...translationJobs(options), ...calendarJobs(options), ...portJobs(options), ...weatherJobs(options), ...weatherAlertJobs(options)]
}
