import { env } from "node:process"
import type { AisDerivedPortMetric } from "@shared/ais-area"
import type { DataProvenance, FeedItem, Freshness, OperationalSourceContext, Port, PortCongestionDetail, ProviderResult, Severity, ShippingProviderModes, SourceStatus, Vessel, VesselWatchTarget, Voyage, WeatherWindow, WeatherWindows } from "@shared/shipping"
import { createBaselinePortDirectoryLookup } from "@shared/port-directory"
import type { PortDirectoryCoordinateLookup } from "@shared/port-directory"
import { mockFeedItems, mockPorts, mockVessels, mockVoyages } from "@shared/shipping-fixtures"
import { type CalendarProvider, configureCalendarProviders } from "./calendar"
import { activeShippingFeedSourceIds, configureFeedProviders } from "./feed"
import { type WeatherAlertProvider, activeOfficialWeatherAlertSourceIds, createOfficialWeatherAlertProvider, officialWeatherAlertSourceIds } from "./weather-alerts"
import { aisstreamAreaDerivedProvenance, aisstreamAreaEstimatedProvenance, createAisStreamAreaProvider, createUnavailableAisAreaProvider } from "./aisstream-area"
import { createRuntimePortDirectoryLookup } from "#/database/port-directory"
import { providerHttpError } from "#/providers/contracts"

export interface VesselProvider {
  getVessels: (targets?: VesselWatchTarget[], lastKnown?: Vessel[]) => Promise<Vessel[]>
}
export interface PortProvider {
  getPorts: (lastKnown?: Port[]) => Promise<Port[]>
}
export interface ScheduleProvider {
  getVoyages: () => Promise<Voyage[]>
}
export interface WeatherProvider {
  getFeedItems: (ports?: Port[], lastKnown?: FeedItem[]) => Promise<FeedItem[]>
}
export interface AisAreaProviderResult {
  getPortMetrics: (ports?: Port[], lastKnown?: AisDerivedPortMetric[]) => Promise<AisDerivedPortMetric[]>
}

export async function fetchWeatherProviderResults(
  modelProvider: WeatherProvider,
  alertProvider: WeatherAlertProvider,
  ports: Port[],
  modelLastKnown: FeedItem[],
  alertLastKnown: FeedItem[],
): Promise<[PromiseSettledResult<FeedItem[]>, PromiseSettledResult<FeedItem[]>]> {
  return Promise.allSettled([
    modelProvider.getFeedItems(ports, modelLastKnown),
    alertProvider.getFeedItems(alertLastKnown, ports),
  ])
}

export const providerProvenances = {
  aisstream: { sourceType: "third_party", dataNature: "observed", sourceId: "aisstream", sourceUrl: "https://aisstream.io/", verified: false },
  aisstreamAreaObserved: { sourceType: "third_party", dataNature: "observed", sourceId: "aisstream-area", sourceUrl: "https://aisstream.io/", verified: false },
  aisstreamAreaDerived: aisstreamAreaDerivedProvenance,
  aisstreamAreaEstimated: aisstreamAreaEstimatedProvenance,
  openMeteo: { sourceType: "third_party", dataNature: "forecast", sourceId: "open-meteo-marine", sourceUrl: "https://open-meteo.com/", verified: false },
  portcastPublic: { sourceType: "third_party", dataNature: "derived", sourceId: "portcast-public", sourceUrl: "https://www.portcast.io/port-congestion", verified: false },
  mockVessel: { sourceType: "mock", dataNature: "observed", sourceId: "mock-vessel", verified: false },
  mockPort: { sourceType: "mock", dataNature: "derived", sourceId: "mock-port", verified: false },
  mockSchedule: { sourceType: "mock", dataNature: "planned", sourceId: "mock-schedule", verified: false },
  mockWeather: { sourceType: "mock", dataNature: "forecast", sourceId: "mock-weather", verified: false },
  officialWeatherAlerts: { sourceType: "official", dataNature: "reported", sourceId: "official-weather-alerts", verified: true },
  shippingFeed: { sourceType: "third_party", dataNature: "reported", sourceId: "shipping-feed", sourceUrl: "https://theloadstar.com/", verified: false },
  mockFeed: { sourceType: "mock", dataNature: "reported", sourceId: "mock-port-notice", sourceUrl: "https://example.com/mock/feed", verified: false },
} as const satisfies Record<string, DataProvenance>

const aisstreamProvenance: DataProvenance = providerProvenances.aisstream
const openMeteoProvenance: DataProvenance = providerProvenances.openMeteo

export function toProviderResult<T extends Freshness>(data: T[], provenance: DataProvenance, fetchedAt = new Date().toISOString(), sourceStatusOverride?: SourceStatus, errorOverride?: string): ProviderResult<T> {
  const statusPriority = ["failed", "never_succeeded", "degraded", "disabled", "healthy"] as const
  const sourceStatus = sourceStatusOverride ?? statusPriority.find(status => data.some(item => item.sourceStatus === status)) ?? "never_succeeded"
  const first = data[0]
  return {
    data,
    provenance,
    fetchedAt,
    sourceUpdatedAt: first?.sourceUpdatedAt,
    freshness: {
      updatedAt: first?.updatedAt,
      sourceUpdatedAt: first?.sourceUpdatedAt,
      fetchedAt,
      stale: sourceStatus !== "healthy" || data.some(item => item.stale),
      sourceStatus,
      error: errorOverride ?? data.find(item => item.error)?.error,
    },
  }
}

export function providerError(result: PromiseSettledResult<unknown[]>): string | undefined {
  if (result.status !== "rejected") return undefined
  return result.reason instanceof Error ? result.reason.message : "Provider failed"
}

export function providerResult<T extends Freshness>(result: PromiseSettledResult<T[]>, lastKnown: T[]): T[] {
  const fetchedAt = new Date().toISOString()
  if (result.status === "fulfilled") return result.value.map(item => ({ ...item, fetchedAt })) as T[]
  const error = providerError(result)
  return lastKnown.map(item => ({ ...item, stale: true, sourceStatus: "failed", error, fetchedAt })) as T[]
}

export function disabledProviderData<T extends Freshness>(lastKnown: T[]): T[] {
  return lastKnown.map(item => ({ ...item, stale: false, sourceStatus: "disabled", error: undefined })) as T[]
}

const weatherSourceIds = new Set(["mock-weather", "open-meteo-marine", ...officialWeatherAlertSourceIds])

export function isWeatherFeedItem(item: FeedItem): boolean {
  return weatherSourceIds.has(item.sourceId)
}

export function isOfficialWeatherAlertFeedItem(item: FeedItem): boolean {
  return officialWeatherAlertSourceIds.has(item.sourceId)
}

export const MockVesselProvider: VesselProvider = { async getVessels() {
  return structuredClone(mockVessels)
} }
export function createUnavailableVesselProvider(error: string): VesselProvider {
  return {
    async getVessels() {
      throw new Error(error)
    },
  }
}
export const MockPortProvider: PortProvider = { async getPorts() {
  return structuredClone(mockPorts)
} }
export function createUnavailablePortProvider(error: string): PortProvider {
  return {
    async getPorts() {
      throw new Error(error)
    },
  }
}
export const MockScheduleProvider: ScheduleProvider = { async getVoyages() {
  return structuredClone(mockVoyages)
} }
export function createUnavailableScheduleProvider(error: string): ScheduleProvider {
  return {
    async getVoyages() {
      throw new Error(error)
    },
  }
}
export const MockWeatherProvider: WeatherProvider = { async getFeedItems() {
  return structuredClone(mockFeedItems.filter(isWeatherFeedItem))
} }
export function createUnavailableWeatherProvider(error: string): WeatherProvider {
  return {
    async getFeedItems() {
      throw new Error(error)
    },
  }
}

export const DisabledWeatherAlertProvider: WeatherAlertProvider = { async getFeedItems() {
  return []
} }

export interface PortcastPublicPageResponse {
  ok: boolean
  status: number
  text: () => Promise<string>
}

export interface PortcastPublicPageFetcher {
  (url: string): Promise<PortcastPublicPageResponse>
}

export interface PortcastPageMetrics {
  congestionCategory?: Port["congestionLevel"]
  medianWaitingHours?: number
  previousMedianWaitingHours?: number
  weekOverWeekChangePct?: number
  longTailCongestion?: boolean
  sourceUpdatedAt?: string
}

export interface PortcastPublicPageProviderOptions {
  fetcher?: PortcastPublicPageFetcher
  now?: () => Date
  minIntervalMs?: number
}

export const PORTCAST_FRESH_MAX_AGE_DAYS = 14
export const portcastFreshMaxAgeMs = PORTCAST_FRESH_MAX_AGE_DAYS * 24 * 60 * 60 * 1000

export const portcastPublicPageUrls: Record<string, string> = {
  "port-shekou": "https://www.portcast.io/port-congestion/shekou",
  "port-yantian": "https://www.portcast.io/port-congestion/yantian",
  "port-nansha": "https://www.portcast.io/jp/port-congestion/nansha",
  "port-laem-chabang": "https://www.portcast.io/port-congestion/laem-chabang",
  "port-klang": "https://www.portcast.io/port-congestion/port-klang",
  "port-manila": "https://www.portcast.io/port-congestion/manila",
  "port-jakarta": "https://www.portcast.io/port-congestion/jakarta",
  "port-ho-chi-minh": "https://www.portcast.io/port-congestion/ho-chi-minh",
}

const portcastDefaultIntervalMs = 24 * 60 * 60 * 1000

function publicPageFetcher(): PortcastPublicPageFetcher {
  const fetchImplementation = (globalThis as typeof globalThis & { fetch?: PortcastPublicPageFetcher }).fetch
  if (!fetchImplementation) throw new Error("Fetch runtime is unavailable")
  return fetchImplementation
}

function decodeHtml(value: string): string {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_match, code: string) => String.fromCodePoint(Number(code)))
}

function visibleHtmlText(html: string): string {
  return decodeHtml(html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " "))
    .trim()
}

function sourceDate(value: string | undefined): string | undefined {
  if (!value) return undefined
  const match = value.match(/^(\d{1,2})[ -](\p{L}{3})[ -](\d{2}|\d{4})$/u)
  if (!match) return undefined
  const months = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"]
  const month = months.indexOf(match[2].toLowerCase())
  const year = match[3].length === 2 ? 2000 + Number(match[3]) : Number(match[3])
  if (month < 0) return undefined
  return new Date(Date.UTC(year, month, Number(match[1]))).toISOString()
}

function metricNumbers(value: string): number[] {
  return [...value.matchAll(/-?\d+(?:\.\d+)?/g)].map(match => Number(match[0])).filter(Number.isFinite)
}

export function parsePortcastPublicPage(html: string): PortcastPageMetrics {
  const text = visibleHtmlText(html)
  if (!text || /Congestion Category|Median Waiting Time|Port Congestion/i.test(text) === false) throw new Error("Portcast page is empty or invalid")

  const category = text.match(/Congestion Category\s+(low|medium|high|critical)/i)?.[1]?.toLowerCase() as Port["congestionLevel"] | undefined
  const longTailText = text.match(/Long Tail Congestion\s+(Yes|No)/i)?.[1]
  const lastUpdated = text.match(/Last updated on\s+(\d{1,2}\s+\p{L}{3}\s+\d{4}|\d{1,2}-\p{L}{3}-\d{2})/iu)?.[1]
  const medianIndex = text.search(/Median Waiting Time/i)
  const metricText = medianIndex < 0 ? "" : text.slice(medianIndex + "Median Waiting Time".length, medianIndex + 220)
  const currentWeekIndex = metricText.search(/Current Week/i)
  const beforeCurrentWeek = currentWeekIndex >= 0 ? metricText.slice(0, currentWeekIndex) : metricText
  const percentMatch = beforeCurrentWeek.match(/(-?\d+(?:\.\d+)?)\s*%/)
  const valuesText = percentMatch?.index === undefined ? beforeCurrentWeek : beforeCurrentWeek.slice(percentMatch.index + percentMatch[0].length)
  const values = metricNumbers(valuesText).slice(0, 2)
  const medianWaitingHours = values[0] === undefined ? undefined : values[0] * 24
  const previousMedianWaitingHours = values[1] === undefined ? undefined : values[1] * 24
  const calculatedChange = medianWaitingHours !== undefined && previousMedianWaitingHours !== undefined && previousMedianWaitingHours !== 0
    ? ((medianWaitingHours - previousMedianWaitingHours) / previousMedianWaitingHours) * 100
    : undefined
  const displayedChange = percentMatch?.[1] === undefined ? undefined : Number(percentMatch[1])
  return {
    congestionCategory: category,
    medianWaitingHours,
    previousMedianWaitingHours,
    weekOverWeekChangePct: displayedChange ?? calculatedChange,
    longTailCongestion: longTailText === undefined ? undefined : longTailText.toLowerCase() === "yes",
    sourceUpdatedAt: sourceDate(lastUpdated),
  }
}

export function portcastFingerprint(metrics: PortcastPageMetrics): string {
  return JSON.stringify([
    metrics.congestionCategory,
    metrics.medianWaitingHours,
    metrics.previousMedianWaitingHours,
    metrics.weekOverWeekChangePct,
    metrics.longTailCongestion,
    metrics.sourceUpdatedAt,
  ])
}

function portcastDetail(metrics: PortcastPageMetrics): PortCongestionDetail {
  return {
    coverageStatus: "public",
    congestionCategory: metrics.congestionCategory,
    medianWaitingHours: metrics.medianWaitingHours,
    previousMedianWaitingHours: metrics.previousMedianWaitingHours,
    weekOverWeekChangePct: metrics.weekOverWeekChangePct,
    longTailCongestion: metrics.longTailCongestion,
  }
}

function portcastExistingFingerprint(port: Port): string {
  return portcastFingerprint({
    congestionCategory: port.congestionDetail?.congestionCategory ?? port.congestionLevel,
    medianWaitingHours: port.congestionDetail?.medianWaitingHours,
    previousMedianWaitingHours: port.congestionDetail?.previousMedianWaitingHours,
    weekOverWeekChangePct: port.congestionDetail?.weekOverWeekChangePct,
    longTailCongestion: port.congestionDetail?.longTailCongestion,
    sourceUpdatedAt: port.sourceUpdatedAt,
  })
}

function portIdentity(port: Port): Pick<Port, "id" | "name" | "nameEn" | "country" | "unlocode" | "isWatched"> {
  return { id: port.id, name: port.name, nameEn: port.nameEn, country: port.country, unlocode: port.unlocode, isWatched: port.isWatched }
}

function isPortcastHistory(port: Port): boolean {
  return port.provenance?.sourceId === "portcast-public"
}

function portcastFreshness(sourceUpdatedAt: string | undefined, evaluatedAt: string): Pick<Port, "stale" | "sourceStatus" | "error"> {
  if (!sourceUpdatedAt) return { stale: true, sourceStatus: "degraded", error: "source_update_time_unknown" }
  const sourceTimestamp = Date.parse(sourceUpdatedAt)
  const evaluatedTimestamp = Date.parse(evaluatedAt)
  if (!Number.isFinite(sourceTimestamp) || !Number.isFinite(evaluatedTimestamp) || evaluatedTimestamp - sourceTimestamp > portcastFreshMaxAgeMs) {
    return { stale: true, sourceStatus: "degraded", error: "source_stale" }
  }
  return { stale: false, sourceStatus: "healthy", error: undefined }
}

function canReevaluatePortcastAge(port: Port): boolean {
  return port.provenance?.sourceId === "portcast-public"
    && port.congestionDetail?.coverageStatus === "public"
    && (port.sourceStatus === "healthy" || (port.sourceStatus === "degraded" && (port.error === "source_stale" || port.error === "source_update_time_unknown")))
}

function reevaluateCachedPortcast(port: Port, evaluatedAt: string): Port {
  return canReevaluatePortcastAge(port) ? { ...port, ...portcastFreshness(port.sourceUpdatedAt, evaluatedAt) } : port
}

function stalePortcastData(port: Port, url: string | undefined, fetchedAt: string, sourceStatus: "degraded" | "failed", error: string, noPublicData = false): Port {
  const historical = isPortcastHistory(port)
  const historicalData = historical
    ? {
        congestionLevel: port.congestionLevel,
        congestionDetail: port.congestionDetail,
        waitingVessels: port.waitingVessels,
        containerWaitingVessels: port.containerWaitingVessels,
        waitingHours: port.waitingHours,
        operationalStatus: port.operationalStatus,
        updatedAt: port.updatedAt,
        sourceUpdatedAt: port.sourceUpdatedAt,
      }
    : noPublicData
      ? { congestionDetail: { coverageStatus: "no_public_data" as const } }
      : {}
  return {
    ...portIdentity(port),
    ...historicalData,
    provenance: { ...(historical && port.provenance ? port.provenance : providerProvenances.portcastPublic), sourceUrl: url ?? providerProvenances.portcastPublic.sourceUrl },
    fetchedAt,
    stale: true,
    sourceStatus,
    error,
  }
}

function noPublicPortData(port: Port, url: string | undefined, fetchedAt: string): Port {
  return stalePortcastData(port, url, fetchedAt, "degraded", "no_public_data", true)
}

function failedPortcastData(port: Port, url: string | undefined, fetchedAt: string, error: string): Port {
  return stalePortcastData(port, url, fetchedAt, "failed", error)
}

interface PortcastCacheEntry {
  checkedAt: number
  fingerprint: string
  port: Port
}

export function createPortcastPublicPageProvider(options: PortcastPublicPageProviderOptions = {}): PortProvider {
  const fetcher = options.fetcher ?? publicPageFetcher()
  const now = options.now ?? (() => new Date())
  const minIntervalMs = options.minIntervalMs ?? portcastDefaultIntervalMs
  const cache = new Map<string, PortcastCacheEntry>()
  return {
    async getPorts(lastKnown = []) {
      const checkedAt = now()
      const evaluatedAt = checkedAt.toISOString()
      const fetchedAt = evaluatedAt
      return Promise.all(lastKnown.map(async (port) => {
        const url = portcastPublicPageUrls[port.id]
        const cached = cache.get(port.id)
        const previousCheckedAt = cached?.checkedAt ?? (port.provenance?.sourceId === "portcast-public" && port.fetchedAt ? Date.parse(port.fetchedAt) : Number.NaN)
        if (Number.isFinite(previousCheckedAt) && checkedAt.getTime() - previousCheckedAt < minIntervalMs) {
          const reused = reevaluateCachedPortcast(cached?.port ?? port, evaluatedAt)
          return { ...reused, isWatched: port.isWatched }
        }
        if (!url) return noPublicPortData(port, url, evaluatedAt)
        try {
          const response = await fetcher(url)
          if (!response.ok) {
            if (response.status === 404 || response.status === 410) return noPublicPortData(port, url, evaluatedAt)
            const failure = providerHttpError("Portcast public page", response.status, `Portcast public page failed (${response.status})`)
            return failedPortcastData(port, url, evaluatedAt, failure.message)
          }
          const metrics = parsePortcastPublicPage(await response.text())
          const fingerprint = portcastFingerprint(metrics)
          const unchanged = cached?.fingerprint === fingerprint || (!cached && port.provenance?.sourceId === "portcast-public" && portcastExistingFingerprint(port) === fingerprint)
          const next: Port = {
            ...portIdentity(port),
            congestionLevel: metrics.congestionCategory,
            congestionDetail: portcastDetail(metrics),
            waitingHours: metrics.medianWaitingHours,
            waitingVessels: undefined,
            containerWaitingVessels: undefined,
            operationalStatus: undefined,
            updatedAt: metrics.sourceUpdatedAt ?? (unchanged ? port.updatedAt : undefined),
            sourceUpdatedAt: metrics.sourceUpdatedAt,
            fetchedAt,
            ...portcastFreshness(metrics.sourceUpdatedAt, evaluatedAt),
            provenance: { ...providerProvenances.portcastPublic, sourceUrl: url },
          }
          cache.set(port.id, { checkedAt: checkedAt.getTime(), fingerprint, port: next })
          return next
        } catch (error) {
          return failedPortcastData(port, url, evaluatedAt, error instanceof Error ? error.message : "Portcast public page parse failed")
        }
      }))
    },
  }
}

interface AisSocketEvent {
  data: unknown
}
interface AisSocket {
  onopen: (() => void) | null
  onmessage: ((event: AisSocketEvent) => void) | null
  onerror: ((event: unknown) => void) | null
  onclose: (() => void) | null
  send: (data: string) => void
  close: () => void
}

interface AisPositionReport {
  UserID?: number
  Latitude?: number
  Longitude?: number
  Sog?: number
  Cog?: number
  NavigationalStatus?: number
}

interface AisStreamMessage {
  MessageType?: string
  MetaData?: { MMSI?: number | string, ShipName?: string, time_utc?: string }
  Metadata?: { MMSI?: number | string, ShipName?: string, time_utc?: string }
  Message?: { PositionReport?: AisPositionReport }
}

export interface AisStreamVesselProviderOptions {
  apiKey: string
  endpoint?: string
  timeoutMs?: number
  socketFactory?: (endpoint: string) => AisSocket
}

const aisEndpoint = "wss://stream.aisstream.io/v0/stream"

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

function mmsiValue(value: unknown): string | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return String(value)
  return stringValue(value)
}

function aisMetaData(message: AisStreamMessage) {
  return message.MetaData ?? message.Metadata
}

export function normalizeProviderTimestamp(value: unknown): string | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    const date = new Date(value * 1000)
    return Number.isNaN(date.getTime()) ? undefined : date.toISOString()
  }
  if (typeof value !== "string" || !value.trim()) return undefined
  const text = value.trim()
  if (/^\d+(?:\.\d+)?$/.test(text)) return normalizeProviderTimestamp(Number(text))
  if (!/(?:Z|[+-]\d{2}:?\d{2})$/i.test(text)) return undefined
  const timestamp = Date.parse(text)
  return Number.isNaN(timestamp) ? undefined : new Date(timestamp).toISOString()
}

function navigationStatus(value: number | undefined): Vessel["navigationStatus"] {
  return value === 1 ? "anchored" : value === 5 ? "moored" : value === 6 ? "aground" : value === 0 ? "under_way" : "unknown"
}

function parseAisMessage(data: unknown): AisStreamMessage | undefined {
  try {
    const parsed = typeof data === "string" ? JSON.parse(data) : data
    if (!parsed || typeof parsed !== "object") return undefined
    return parsed as AisStreamMessage
  } catch {
    return undefined
  }
}

function socketFromGlobal(endpoint: string): AisSocket {
  const WebSocketCtor = (globalThis as typeof globalThis & { WebSocket?: new (url: string) => unknown }).WebSocket
  if (!WebSocketCtor) throw new Error("WebSocket runtime is unavailable")
  return new WebSocketCtor(endpoint) as AisSocket
}

function aisIdentity(target: VesselWatchTarget) {
  return {
    id: target.id,
    name: target.name,
    mmsi: target.mmsi,
    imo: target.imo,
    isWatched: target.isWatched,
  }
}

export function sanitizeAisVessel(vessel: Vessel, target?: VesselWatchTarget): Vessel {
  const identity = target ? aisIdentity(target) : aisIdentity(vessel)
  return {
    ...identity,
    latitude: vessel.latitude,
    longitude: vessel.longitude,
    speed: vessel.speed,
    course: vessel.course,
    navigationStatus: vessel.navigationStatus,
    statusChangedAt: vessel.statusChangedAt,
    updatedAt: vessel.updatedAt,
    sourceUpdatedAt: vessel.sourceUpdatedAt,
    fetchedAt: vessel.fetchedAt,
    stale: vessel.stale,
    sourceStatus: vessel.sourceStatus,
    error: vessel.error,
    provenance: aisstreamProvenance,
  }
}

function identityOnlyAisVessel(target: VesselWatchTarget, fetchedAt: string, sourceStatus: SourceStatus = "degraded", error = "AIS observation unavailable"): Vessel {
  return {
    ...aisIdentity(target),
    navigationStatus: "unknown",
    fetchedAt,
    stale: true,
    sourceStatus,
    error,
    provenance: aisstreamProvenance,
  }
}

function normalizeAisPosition(message: AisStreamMessage, watched: VesselWatchTarget, previous: Vessel | undefined, fetchedAt: string): Vessel | undefined {
  const position = message.Message?.PositionReport
  const metadata = aisMetaData(message)
  const mmsi = mmsiValue(metadata?.MMSI) ?? (position?.UserID === undefined ? undefined : String(position.UserID))
  if (!position || !mmsi || mmsi !== watched.mmsi) return undefined
  const updatedAt = normalizeProviderTimestamp(metadata?.time_utc)
  const hasTrustedTimestamp = updatedAt !== undefined
  const currentNavigationStatus = navigationStatus(numberValue(position.NavigationalStatus))
  const statusChangedAt = currentNavigationStatus === "unknown"
    ? undefined
    : previous?.navigationStatus === currentNavigationStatus && previous.statusChangedAt
      ? previous.statusChangedAt
      : updatedAt ?? fetchedAt
  return {
    ...aisIdentity({ ...watched, name: stringValue(metadata?.ShipName) ?? watched.name }),
    mmsi,
    latitude: numberValue(position.Latitude),
    longitude: numberValue(position.Longitude),
    speed: numberValue(position.Sog),
    course: numberValue(position.Cog),
    navigationStatus: currentNavigationStatus,
    statusChangedAt,
    updatedAt,
    sourceUpdatedAt: updatedAt,
    fetchedAt,
    stale: !hasTrustedTimestamp,
    sourceStatus: hasTrustedTimestamp ? "healthy" : "degraded",
    error: hasTrustedTimestamp ? undefined : "Provider timestamp unavailable",
    provenance: aisstreamProvenance,
  }
}

export function createAisStreamVesselProvider(options: AisStreamVesselProviderOptions): VesselProvider {
  const endpoint = options.endpoint ?? aisEndpoint
  const timeoutMs = options.timeoutMs ?? 5000
  const socketFactory = options.socketFactory ?? socketFromGlobal
  return {
    async getVessels(targets = [], lastKnown = []) {
      const fetchedAt = new Date().toISOString()
      const lastKnownById = new Map(lastKnown
        .filter(vessel => vessel.provenance?.sourceId === "aisstream")
        .map(vessel => [vessel.id, sanitizeAisVessel(vessel)]))
      const watchedVessels = targets.filter(vessel => vessel.isWatched && vessel.mmsi)
      if (!watchedVessels.length) {
        return targets.map(target => identityOnlyAisVessel(target, fetchedAt, "degraded", target.isWatched ? "MMSI unavailable for real vessel lookup" : "AIS observation unavailable"))
      }
      const watchedByMmsi = new Map(watchedVessels.map(vessel => [vessel.mmsi!, vessel]))
      const received = new Map<string, Vessel>()
      await new Promise<void>((resolve, reject) => {
        let settled = false
        const socket = socketFactory(endpoint)
        let timer: ReturnType<typeof setTimeout> | undefined
        const finish = (error?: Error) => {
          if (settled) return
          settled = true
          if (timer) clearTimeout(timer)
          socket.close()
          if (error) reject(error)
          else resolve()
        }
        timer = setTimeout(() => finish(received.size > 0 ? undefined : new Error("AISStream request timed out")), timeoutMs)
        socket.onopen = () => {
          socket.send(JSON.stringify({
            APIKey: options.apiKey,
            BoundingBoxes: [[[-90, -180], [90, 180]]],
            FiltersShipMMSI: [...watchedByMmsi.keys()],
            FilterMessageTypes: ["PositionReport"],
          }))
        }
        socket.onmessage = (event) => {
          const message = parseAisMessage(event.data)
          if (!message || message.MessageType !== "PositionReport") return
          const metadata = aisMetaData(message)
          const mmsi = mmsiValue(metadata?.MMSI) ?? (message.Message?.PositionReport?.UserID === undefined ? undefined : String(message.Message.PositionReport.UserID))
          const vessel = mmsi ? watchedByMmsi.get(mmsi) : undefined
          if (!vessel) return
          const normalized = normalizeAisPosition(message, vessel, lastKnownById.get(vessel.id), fetchedAt)
          if (!normalized) return
          received.set(normalized.id, normalized)
          if (received.size === watchedByMmsi.size) finish()
        }
        socket.onerror = () => finish(received.size > 0 ? undefined : new Error("AISStream request failed"))
        socket.onclose = () => {
          if (!settled && received.size === 0) finish(new Error("AISStream connection closed"))
          else if (!settled) finish()
        }
      })
      return targets.map((target) => {
        if (!target.isWatched) return identityOnlyAisVessel(target, fetchedAt)
        if (!target.mmsi) return identityOnlyAisVessel(target, fetchedAt, "degraded", "MMSI unavailable for real vessel lookup")
        const receivedVessel = received.get(target.id)
        if (receivedVessel) return receivedVessel
        const previous = lastKnownById.get(target.id)
        return previous
          ? { ...previous, ...aisIdentity(target), stale: true, sourceStatus: "degraded" as const, error: "AIS update unavailable", fetchedAt, provenance: aisstreamProvenance }
          : identityOnlyAisVessel(target, fetchedAt)
      })
    },
  }
}

export interface WeatherFetchResponse {
  ok: boolean
  status: number
  json: () => Promise<unknown>
}

type WeatherFetcher = (url: string) => Promise<WeatherFetchResponse>
interface WeatherPortConfig {
  id: string
  name: string
  nameEn: string
  latitude: number
  longitude: number
}

interface OpenMeteoPayload {
  current?: { time?: number | string, wave_height?: number, wave_direction?: number, swell_wave_height?: number, swell_wave_direction?: number, swell_wave_period?: number, wind_speed_10m?: number, wind_gusts_10m?: number }
  hourly?: { time?: Array<number | string>, wave_height?: Array<number | undefined>, wave_direction?: Array<number | undefined>, swell_wave_height?: Array<number | undefined>, swell_wave_direction?: Array<number | undefined>, swell_wave_period?: Array<number | undefined>, wind_speed_10m?: Array<number | undefined>, wind_gusts_10m?: Array<number | undefined> }
}

export const weatherRiskThresholds = {
  warningWindKmh: 45,
  criticalWindKmh: 65,
  warningWaveHeightM: 2.5,
  criticalWaveHeightM: 4,
  forecastWindowHours: 72,
  forecastDays: 7,
} as const

const weatherWindowHours = { h24: 24, h72: 72, d7: 168 } as const

function weatherFetcher(): WeatherFetcher {
  const fetchImplementation = (globalThis as typeof globalThis & { fetch?: WeatherFetcher }).fetch
  if (!fetchImplementation) throw new Error("Fetch runtime is unavailable")
  return fetchImplementation
}

function validWeatherPayload(value: unknown): OpenMeteoPayload {
  if (!value || typeof value !== "object") throw new Error("Open-Meteo response is malformed")
  const current = (value as OpenMeteoPayload).current
  const hourly = (value as OpenMeteoPayload).hourly
  const currentValid = current && typeof current === "object" && normalizeProviderTimestamp(current.time) !== undefined
  const hourlyValid = hourly && Array.isArray(hourly.time) && hourly.time.some(time => normalizeProviderTimestamp(time) !== undefined)
  if (!currentValid && !hourlyValid) throw new Error("Open-Meteo response is malformed: current/hourly timestamp is missing or invalid")
  return value as OpenMeteoPayload
}

interface WeatherPoint {
  timestamp: string
  waveHeight?: number
  waveDirection?: number
  swellWaveHeight?: number
  swellDirection?: number
  swellPeriod?: number
  windSpeed?: number
  windGusts?: number
}

function weatherPointMap(marine: OpenMeteoPayload, wind: OpenMeteoPayload): WeatherPoint[] {
  const points = new Map<string, WeatherPoint>()
  const ensure = (value: unknown) => {
    const timestamp = normalizeProviderTimestamp(value)
    if (!timestamp) return undefined
    const point = points.get(timestamp) ?? { timestamp }
    points.set(timestamp, point)
    return point
  }
  const marineHourly = marine.hourly
  marineHourly?.time?.forEach((time, index) => {
    const point = ensure(time)
    if (!point) return
    point.waveHeight = numberValue(marineHourly.wave_height?.[index])
    point.waveDirection = numberValue(marineHourly.wave_direction?.[index])
    point.swellWaveHeight = numberValue(marineHourly.swell_wave_height?.[index])
    point.swellDirection = numberValue(marineHourly.swell_wave_direction?.[index])
    point.swellPeriod = numberValue(marineHourly.swell_wave_period?.[index])
  })
  const windHourly = wind.hourly
  windHourly?.time?.forEach((time, index) => {
    const point = ensure(time)
    if (!point) return
    point.windSpeed = numberValue(windHourly.wind_speed_10m?.[index])
    point.windGusts = numberValue(windHourly.wind_gusts_10m?.[index])
  })
  const marineCurrent = marine.current
  const windCurrent = wind.current
  const currentPoint = ensure(marineCurrent?.time ?? windCurrent?.time)
  if (currentPoint) {
    currentPoint.waveHeight ??= numberValue(marineCurrent?.wave_height)
    currentPoint.waveDirection ??= numberValue(marineCurrent?.wave_direction)
    currentPoint.swellWaveHeight ??= numberValue(marineCurrent?.swell_wave_height)
    currentPoint.swellDirection ??= numberValue(marineCurrent?.swell_wave_direction)
    currentPoint.swellPeriod ??= numberValue(marineCurrent?.swell_wave_period)
    currentPoint.windSpeed ??= numberValue(windCurrent?.wind_speed_10m)
    currentPoint.windGusts ??= numberValue(windCurrent?.wind_gusts_10m)
  }
  return [...points.values()].sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp)).slice(0, weatherWindowHours.d7 + 1)
}

function maximum(values: Array<number | undefined>): number | undefined {
  const present = values.filter((value): value is number => value !== undefined)
  return present.length ? Math.max(...present) : undefined
}

function severityRank(value: Severity): number {
  return { info: 0, watch: 1, warning: 2, critical: 3 }[value]
}

function maximumWithDirection(points: WeatherPoint[], valueKey: "waveHeight" | "swellWaveHeight", directionKey: "waveDirection" | "swellDirection") {
  let value: number | undefined
  let direction: number | undefined
  for (const point of points) {
    const candidate = point[valueKey]
    if (candidate !== undefined && (value === undefined || candidate > value)) {
      value = candidate
      direction = point[directionKey]
    }
  }
  return { value, direction }
}

function weatherWindow(points: WeatherPoint[], hours: number): WeatherWindow {
  const start = points[0]?.timestamp
  const endLimit = start ? Date.parse(start) + hours * 60 * 60 * 1000 : Number.POSITIVE_INFINITY
  const scoped = points.filter(point => Date.parse(point.timestamp) <= endLimit)
  const wave = maximumWithDirection(scoped, "waveHeight", "waveDirection")
  const swell = maximumWithDirection(scoped, "swellWaveHeight", "swellDirection")
  const maxSwellPeriodSeconds = maximum(scoped.map(point => point.swellPeriod))
  const maxWindSpeedKmh = maximum(scoped.map(point => point.windSpeed))
  const maxWindGustKmh = maximum(scoped.map(point => point.windGusts))
  const maxWind = Math.max(maxWindSpeedKmh ?? 0, maxWindGustKmh ?? 0)
  const severity: Severity = (wave.value !== undefined && wave.value >= weatherRiskThresholds.criticalWaveHeightM) || maxWind >= weatherRiskThresholds.criticalWindKmh
    ? "critical"
    : (wave.value !== undefined && wave.value >= weatherRiskThresholds.warningWaveHeightM) || maxWind >= weatherRiskThresholds.warningWindKmh
        ? "warning"
        : "info"
  return {
    severity,
    forecastStartAt: scoped[0]?.timestamp,
    forecastEndAt: scoped.at(-1)?.timestamp,
    maxWaveHeightM: wave.value,
    maxSwellWaveHeightM: swell.value,
    maxSwellPeriodSeconds,
    maxWindSpeedKmh,
    maxWindGustKmh,
    waveDirectionDeg: wave.direction,
    swellDirectionDeg: swell.direction,
    swellWaveDirectionDeg: swell.direction,
  }
}

function weatherFeedItem(port: WeatherPortConfig, marine: OpenMeteoPayload, wind: OpenMeteoPayload, fetchedAt: string): FeedItem | undefined {
  const points = weatherPointMap(marine, wind)
  const windows: WeatherWindows = {
    h24: weatherWindow(points, weatherWindowHours.h24),
    h72: weatherWindow(points, weatherWindowHours.h72),
    d7: weatherWindow(points, weatherWindowHours.d7),
  }
  const overall = Object.values(windows).sort((a, b) => severityRank(b.severity) - severityRank(a.severity))[0]
  if (!overall || severityRank(overall.severity) === 0) return undefined
  const updatedAt = normalizeProviderTimestamp(marine.current?.time ?? wind.current?.time ?? points[0]?.timestamp)
  if (!updatedAt) throw new Error("Open-Meteo timestamp is malformed")
  const h72 = windows.h72
  const waveText = h72.maxWaveHeightM === undefined ? "浪高未知" : `浪高 ${h72.maxWaveHeightM.toFixed(1)} m`
  const swellText = h72.maxSwellWaveHeightM === undefined ? "涌浪未知" : `涌浪 ${h72.maxSwellWaveHeightM.toFixed(1)} m${h72.maxSwellPeriodSeconds === undefined ? "" : ` / ${h72.maxSwellPeriodSeconds.toFixed(1)} s`}`
  const windText = h72.maxWindSpeedKmh === undefined ? "风速未知" : `风速 ${Math.round(h72.maxWindSpeedKmh)} km/h`
  const gustText = h72.maxWindGustKmh === undefined ? "" : `，阵风 ${Math.round(h72.maxWindGustKmh)} km/h`
  const windowSummary = `24 小时 ${windows.h24.severity} / 72 小时 ${windows.h72.severity} / 7 天 ${windows.d7.severity}`
  return {
    id: `weather-${port.id}`,
    sourceId: "open-meteo-marine",
    category: "weather",
    type: "weather_risk",
    title: `${port.nameEn} 未来 7 天天气${overall.severity === "critical" ? "严重" : "预警"}`,
    summary: `${windText}${gustText}，${waveText}，${swellText}。模型窗口：${windowSummary}，仅作为运营关注信号。`,
    sourceUrl: "https://marine-api.open-meteo.com/",
    publishedAt: updatedAt,
    publicationTimeKnown: true,
    eventEligibility: true,
    severity: overall.severity,
    relatedPortIds: [port.id],
    relatedVesselIds: [],
    relatedVoyageIds: [],
    weather: { riskSource: "model", forecastWindowHours: weatherRiskThresholds.forecastWindowHours, forecastStartAt: h72.forecastStartAt, forecastEndAt: h72.forecastEndAt, waveHeightM: h72.maxWaveHeightM, waveDirectionDeg: h72.waveDirectionDeg, swellWaveHeightM: h72.maxSwellWaveHeightM, swellDirectionDeg: h72.swellDirectionDeg, swellWaveDirectionDeg: h72.swellWaveDirectionDeg, swellPeriodSeconds: h72.maxSwellPeriodSeconds, windSpeedKmh: h72.maxWindSpeedKmh, windGustKmh: h72.maxWindGustKmh, windows },
    tags: ["model", "weather_risk"],
    updatedAt,
    sourceUpdatedAt: undefined,
    fetchedAt,
    stale: false,
    sourceStatus: "healthy",
    provenance: openMeteoProvenance,
  }
}

export interface OpenMeteoWeatherProviderOptions {
  fetcher?: WeatherFetcher
  marineEndpoint?: string
  weatherEndpoint?: string
  now?: () => Date
  minIntervalMs?: number
  portDirectory?: PortDirectoryCoordinateLookup
}

export function createOpenMeteoWeatherProvider(options: OpenMeteoWeatherProviderOptions = {}): WeatherProvider {
  const fetcher = options.fetcher ?? weatherFetcher()
  const marineEndpoint = options.marineEndpoint ?? "https://marine-api.open-meteo.com/v1/marine"
  const weatherEndpoint = options.weatherEndpoint ?? "https://api.open-meteo.com/v1/forecast"
  const now = options.now ?? (() => new Date())
  const minIntervalMs = options.minIntervalMs ?? 30 * 60 * 1000
  const portDirectory = options.portDirectory ?? createBaselinePortDirectoryLookup()
  const cache = new Map<string, { checkedAt: number, items: FeedItem[] }>()
  return {
    async getFeedItems(ports: Port[] = [], lastKnown = []) {
      const checkedAt = now()
      const modelLastKnown = lastKnown.filter(item => item.sourceId === "open-meteo-marine")
      const failures: string[] = []
      const results = await Promise.all(ports.map(async (port) => {
        const cached = cache.get(port.id)
        if (cached && checkedAt.getTime() - cached.checkedAt < minIntervalMs) return structuredClone(cached.items)
        const previous = modelLastKnown.filter(item => item.relatedPortIds.includes(port.id))
        let coordinates
        try {
          coordinates = port.unlocode ? await portDirectory.getPortCoordinate(port.unlocode) : undefined
        } catch (error) {
          const message = error instanceof Error ? error.message : "Port Directory coordinate lookup failed"
          failures.push(message)
          return previous.map(item => ({ ...item, stale: true, sourceStatus: "failed" as const, error: message, fetchedAt: now().toISOString() }))
        }
        if (!coordinates) {
          const message = `Port Directory coordinate unavailable for ${port.unlocode ?? port.id}`
          failures.push(message)
          return previous.map(item => ({ ...item, stale: true, sourceStatus: "failed" as const, error: message, fetchedAt: now().toISOString() }))
        }
        const marineUrl = new URL(marineEndpoint)
        marineUrl.searchParams.set("latitude", String(coordinates.latitude))
        marineUrl.searchParams.set("longitude", String(coordinates.longitude))
        marineUrl.searchParams.set("current", "wave_height,wave_direction,swell_wave_height,swell_wave_direction,swell_wave_period")
        marineUrl.searchParams.set("hourly", "wave_height,wave_direction,swell_wave_height,swell_wave_direction,swell_wave_period")
        marineUrl.searchParams.set("forecast_days", String(weatherRiskThresholds.forecastDays))
        marineUrl.searchParams.set("timeformat", "unixtime")
        marineUrl.searchParams.set("cell_selection", "sea")
        const weatherUrl = new URL(weatherEndpoint)
        weatherUrl.searchParams.set("latitude", String(coordinates.latitude))
        weatherUrl.searchParams.set("longitude", String(coordinates.longitude))
        weatherUrl.searchParams.set("current", "wind_speed_10m,wind_gusts_10m")
        weatherUrl.searchParams.set("hourly", "wind_speed_10m,wind_gusts_10m")
        weatherUrl.searchParams.set("forecast_days", String(weatherRiskThresholds.forecastDays))
        weatherUrl.searchParams.set("timeformat", "unixtime")
        weatherUrl.searchParams.set("wind_speed_unit", "kmh")
        try {
          const [marineResponse, weatherResponse] = await Promise.all([fetcher(marineUrl.toString()), fetcher(weatherUrl.toString())])
          if (!marineResponse.ok) throw providerHttpError("Open-Meteo marine", marineResponse.status, `Open-Meteo marine request failed (${marineResponse.status})`)
          if (!weatherResponse.ok) throw providerHttpError("Open-Meteo weather", weatherResponse.status, `Open-Meteo weather request failed (${weatherResponse.status})`)
          const marinePayload = validWeatherPayload(await marineResponse.json())
          const weatherPayload = validWeatherPayload(await weatherResponse.json())
          const fetchedAt = now().toISOString()
          const item = weatherFeedItem({ id: port.id, name: port.name, nameEn: port.nameEn, latitude: coordinates.latitude, longitude: coordinates.longitude }, marinePayload, weatherPayload, fetchedAt)
          const items = item ? [{ ...item, fetchedAt }] : []
          cache.set(port.id, { checkedAt: checkedAt.getTime(), items })
          return items
        } catch (error) {
          const message = error instanceof Error ? error.message : "Open-Meteo port request failed"
          const failureFetchedAt = now().toISOString()
          failures.push(message)
          return previous.map(item => ({ ...item, stale: true, sourceStatus: "failed" as const, error: message, fetchedAt: failureFetchedAt }))
        }
      }))
      const modelItems = results.flat().filter((item): item is FeedItem => item !== undefined)
      if (failures.length && modelItems.length === 0) throw new Error(failures[0])
      return modelItems
    },
  }
}

interface ProviderEnvironment {
  [key: string]: string | undefined
  SHIPPING_VESSEL_PROVIDER?: string
  SHIPPING_DATA_MODE?: string
  SHIPPING_AIS_AREA_PROVIDER?: string
  AISSTREAM_API_KEY?: string
  SHIPPING_PORT_PROVIDER?: string
  SHIPPING_WEATHER_PROVIDER?: string
  SHIPPING_WEATHER_ALERT_PROVIDER?: string
  SHIPPING_FEED_PROVIDER?: string
}

export function configureProviders(environment: ProviderEnvironment = { ...env }) {
  const dataMode: "mock" | "real" = environment.SHIPPING_DATA_MODE === "real" ? "real" : "mock"
  const vesselMode = environment.SHIPPING_VESSEL_PROVIDER === "aisstream" ? "aisstream" : dataMode === "real" ? "unavailable" : "mock"
  const aisAreaMode: ShippingProviderModes["aisArea"] = environment.SHIPPING_AIS_AREA_PROVIDER === "aisstream" ? "aisstream" : "off"
  const portMode = environment.SHIPPING_PORT_PROVIDER === "portcast" ? "portcast" : dataMode === "real" ? "unavailable" : "mock"
  const weatherMode = environment.SHIPPING_WEATHER_PROVIDER === "open-meteo" ? "open-meteo" : dataMode === "real" ? "unavailable" : "mock"
  const configuredFeed = configureFeedProviders({ SHIPPING_DATA_MODE: environment.SHIPPING_DATA_MODE, SHIPPING_FEED_PROVIDER: environment.SHIPPING_FEED_PROVIDER })
  const weatherAlertMode = environment.SHIPPING_WEATHER_ALERT_PROVIDER === "public" || environment.SHIPPING_WEATHER_ALERT_PROVIDER === "experimental"
    ? environment.SHIPPING_WEATHER_ALERT_PROVIDER
    : "off"
  const weatherAlertProvider = weatherAlertMode !== "off"
    ? createOfficialWeatherAlertProvider({ allowPending: weatherAlertMode === "experimental" })
    : DisabledWeatherAlertProvider
  const portDirectory = createRuntimePortDirectoryLookup(environment.SHIPPING_DATA_MODE === "real" ? "real" : "mock")
  return {
    providers: {
      vessel: vesselMode === "aisstream"
        ? environment.AISSTREAM_API_KEY
          ? createAisStreamVesselProvider({ apiKey: environment.AISSTREAM_API_KEY })
          : createUnavailableVesselProvider("AISSTREAM_API_KEY missing")
        : vesselMode === "mock" ? MockVesselProvider : createUnavailableVesselProvider("Real Vessel provider not configured"),
      port: portMode === "portcast" ? createPortcastPublicPageProvider() : portMode === "mock" ? MockPortProvider : createUnavailablePortProvider("Real Port provider not configured"),
      aisArea: aisAreaMode === "aisstream"
        ? environment.AISSTREAM_API_KEY
          ? createAisStreamAreaProvider({ apiKey: environment.AISSTREAM_API_KEY, portDirectory })
          : createUnavailableAisAreaProvider("AISSTREAM_API_KEY missing")
        : createUnavailableAisAreaProvider("AIS area provider disabled"),
      schedule: dataMode === "real" ? createUnavailableScheduleProvider("Real Schedule provider not configured") : MockScheduleProvider,
      weather: weatherMode === "open-meteo" ? createOpenMeteoWeatherProvider({ portDirectory }) : weatherMode === "mock" ? MockWeatherProvider : createUnavailableWeatherProvider("Real Weather provider not configured"),
      weatherAlerts: weatherAlertProvider,
      feed: configuredFeed.provider,
    },
    modes: {
      dataMode,
      vessel: vesselMode,
      aisArea: aisAreaMode,
      port: portMode,
      schedule: dataMode === "real" ? "unavailable" as const : "mock" as const,
      weather: weatherMode,
      weatherAlerts: weatherAlertMode,
      feed: configuredFeed.modes.feed,
    },
  }
}

const configured = configureProviders()
const configuredCalendar = configureCalendarProviders()
export const providers = { ...configured.providers, calendar: configuredCalendar.provider as CalendarProvider } as typeof configured.providers & { calendar: CalendarProvider }
export const providerModes = { ...configured.modes, calendar: configuredCalendar.modes.calendar, calendarSourceIds: configuredCalendar.modes.calendarSourceIds }
export const calendarProviderModes = configuredCalendar.modes

export function createOperationalSourceContext(modes: ShippingProviderModes): OperationalSourceContext {
  const activeSourceIds = new Set<string>()
  const allowMock = modes.dataMode !== "real"
  if (allowMock && modes.vessel === "mock") activeSourceIds.add("mock-vessel")
  if (modes.vessel === "aisstream") activeSourceIds.add("aisstream")
  if (modes.aisArea === "aisstream") activeSourceIds.add("aisstream-area")
  if (allowMock && modes.port === "mock") activeSourceIds.add("mock-port")
  if (modes.port === "portcast") activeSourceIds.add("portcast-public")
  if (allowMock && modes.schedule === "mock") activeSourceIds.add("mock-schedule")
  if (allowMock && modes.weather === "mock") activeSourceIds.add("mock-weather")
  if (modes.weather === "open-meteo") activeSourceIds.add("open-meteo-marine")
  if (modes.weatherAlerts === "public" || modes.weatherAlerts === "experimental") {
    for (const sourceId of activeOfficialWeatherAlertSourceIds({ allowPending: modes.weatherAlerts === "experimental" })) activeSourceIds.add(sourceId)
  }
  if (allowMock && modes.feed === "mock") activeSourceIds.add("mock-port-notice")
  if (modes.feed === "public") {
    for (const sourceId of activeShippingFeedSourceIds()) activeSourceIds.add(sourceId)
  }
  if (allowMock && modes.calendar === "mock") {
    activeSourceIds.add("mock-calendar")
  } else {
    for (const sourceId of modes.calendarSourceIds ?? []) activeSourceIds.add(sourceId)
  }
  return { modes, activeSourceIds }
}

export const operationalSourceContext = createOperationalSourceContext(providerModes)

export const realProviders = {
  vessel: "AISStream",
  aisArea: "AISStream area PositionReport",
  port: "Portcast public page",
  schedule: "deferred",
  weather: "Open-Meteo Marine API",
  weatherAlerts: "JMA / TMD / BMKG official weather alerts",
  feed: "The Loadstar / The Maritime Executive / official port notices",
  calendar: "Calendarific / OfficialHolidayProvider / ManualHolidayProvider",
} as const
