import { env } from "node:process"
import type { DataProvenance, FeedItem, Freshness, Port, PortCongestionDetail, ProviderResult, SourceStatus, Vessel, Voyage } from "@shared/shipping"
import { mockFeedItems, mockPorts, mockVessels, mockVoyages, portWeatherConfig } from "@shared/shipping-fixtures"
import { type CalendarProvider, configureCalendarProviders } from "./calendar"

export interface VesselProvider {
  getVessels: (watched?: Vessel[]) => Promise<Vessel[]>
}
export interface PortProvider {
  getPorts: (lastKnown?: Port[]) => Promise<Port[]>
}
export interface ScheduleProvider {
  getVoyages: () => Promise<Voyage[]>
}
export interface WeatherProvider {
  getFeedItems: (ports?: Port[]) => Promise<FeedItem[]>
}

export const providerProvenances = {
  aisstream: { sourceType: "third_party", dataNature: "observed", sourceId: "aisstream", sourceUrl: "https://aisstream.io/", verified: false },
  openMeteo: { sourceType: "third_party", dataNature: "forecast", sourceId: "open-meteo-marine", sourceUrl: "https://open-meteo.com/", verified: false },
  portcastPublic: { sourceType: "third_party", dataNature: "derived", sourceId: "portcast-public", sourceUrl: "https://www.portcast.io/port-congestion", verified: false },
  mockVessel: { sourceType: "mock", dataNature: "observed", sourceId: "mock-vessel", verified: false },
  mockPort: { sourceType: "mock", dataNature: "derived", sourceId: "mock-port", verified: false },
  mockSchedule: { sourceType: "mock", dataNature: "planned", sourceId: "mock-schedule", verified: false },
  mockWeather: { sourceType: "mock", dataNature: "forecast", sourceId: "mock-weather", verified: false },
} as const satisfies Record<string, DataProvenance>

const aisstreamProvenance: DataProvenance = providerProvenances.aisstream
const openMeteoProvenance: DataProvenance = providerProvenances.openMeteo

export function toProviderResult<T extends Freshness>(data: T[], provenance: DataProvenance, fetchedAt = new Date().toISOString(), sourceStatusOverride?: SourceStatus): ProviderResult<T> {
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
      error: data.find(item => item.error)?.error,
    },
  }
}

export function providerResult<T extends Freshness>(result: PromiseSettledResult<T[]>, lastKnown: T[]): T[] {
  const fetchedAt = new Date().toISOString()
  if (result.status === "fulfilled") return result.value.map(item => ({ ...item, fetchedAt })) as T[]
  const error = result.reason instanceof Error ? result.reason.message : "Provider failed"
  return lastKnown.map(item => ({ ...item, stale: true, sourceStatus: "failed", error, fetchedAt })) as T[]
}

export function disabledProviderData<T extends Freshness>(lastKnown: T[]): T[] {
  return lastKnown.map(item => ({ ...item, stale: false, sourceStatus: "disabled", error: undefined })) as T[]
}

const weatherSourceIds = new Set(["mock-weather", "open-meteo-marine"])

export function isWeatherFeedItem(item: FeedItem): boolean {
  return weatherSourceIds.has(item.sourceId)
}

export const MockVesselProvider: VesselProvider = { async getVessels() {
  return structuredClone(mockVessels)
} }
export const MockPortProvider: PortProvider = { async getPorts() {
  return structuredClone(mockPorts)
} }
export const MockScheduleProvider: ScheduleProvider = { async getVoyages() {
  return structuredClone(mockVoyages)
} }
export const MockWeatherProvider: WeatherProvider = { async getFeedItems() {
  return structuredClone(mockFeedItems.filter(isWeatherFeedItem))
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

export const portcastPublicPageUrls: Record<string, string> = {
  "port-shekou": "https://www.portcast.io/port-congestion/shekou",
  "port-yantian": "https://www.portcast.io/port-congestion/yantian",
  "port-nansha": "https://www.portcast.io/jp/port-congestion/nansha",
  "port-laem-chabang": "https://www.portcast.io/port-congestion/laem-chabang",
  "port-klang": "https://www.portcast.io/port-congestion/port-klang",
  "port-manila": "https://www.portcast.io/port-congestion/manila",
  "port-jakarta": "https://www.portcast.io/port-congestion/jakarta",
  "port-ho-chi-minh": "https://www.portcast.io/de/port-congestion/ho-chi-minh",
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

function withPortcastAttempt(port: Port, url: string): Port {
  return port.provenance?.sourceId === "portcast-public"
    ? { ...port, provenance: { ...port.provenance, sourceUrl: url } }
    : port
}

function noPublicPortData(port: Port, url: string | undefined, fetchedAt: string): Port {
  return {
    ...withPortcastAttempt(port, url ?? providerProvenances.portcastPublic.sourceUrl),
    fetchedAt,
    stale: true,
    sourceStatus: "degraded",
    error: "no_public_data",
    congestionDetail: { coverageStatus: "no_public_data" },
  }
}

function failedPortcastData(port: Port, url: string | undefined, fetchedAt: string, error: string): Port {
  return {
    ...withPortcastAttempt(port, url ?? providerProvenances.portcastPublic.sourceUrl),
    fetchedAt,
    stale: true,
    sourceStatus: "failed",
    error,
  }
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
      const fetchedAt = checkedAt.toISOString()
      return Promise.all(lastKnown.map(async (port) => {
        const url = portcastPublicPageUrls[port.id]
        const cached = cache.get(port.id)
        const previousCheckedAt = cached?.checkedAt ?? (port.provenance?.sourceId === "portcast-public" && port.fetchedAt ? Date.parse(port.fetchedAt) : Number.NaN)
        if (Number.isFinite(previousCheckedAt) && checkedAt.getTime() - previousCheckedAt < minIntervalMs) {
          return { ...(cached?.port ?? port), isWatched: port.isWatched }
        }
        if (!url) return noPublicPortData(port, url, fetchedAt)
        try {
          const response = await fetcher(url)
          if (!response.ok) {
            if (response.status === 404 || response.status === 410) return noPublicPortData(port, url, fetchedAt)
            return failedPortcastData(port, url, fetchedAt, `Portcast public page failed (${response.status})`)
          }
          const metrics = parsePortcastPublicPage(await response.text())
          const fingerprint = portcastFingerprint(metrics)
          const unchanged = cached?.fingerprint === fingerprint || (!cached && port.provenance?.sourceId === "portcast-public" && portcastExistingFingerprint(port) === fingerprint)
          const next: Port = {
            ...port,
            congestionLevel: metrics.congestionCategory ?? port.congestionLevel,
            congestionDetail: portcastDetail(metrics),
            waitingHours: metrics.medianWaitingHours ?? port.waitingHours,
            updatedAt: unchanged ? port.updatedAt : fetchedAt,
            sourceUpdatedAt: metrics.sourceUpdatedAt,
            fetchedAt,
            stale: false,
            sourceStatus: "healthy",
            error: undefined,
            provenance: { ...providerProvenances.portcastPublic, sourceUrl: url },
          }
          cache.set(port.id, { checkedAt: checkedAt.getTime(), fingerprint, port: next })
          return next
        } catch (error) {
          return failedPortcastData(port, url, fetchedAt, error instanceof Error ? error.message : "Portcast public page parse failed")
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

function normalizeAisPosition(message: AisStreamMessage, watched: Vessel): Vessel | undefined {
  const position = message.Message?.PositionReport
  const metadata = aisMetaData(message)
  const mmsi = mmsiValue(metadata?.MMSI) ?? (position?.UserID === undefined ? undefined : String(position.UserID))
  if (!position || !mmsi || mmsi !== watched.mmsi) return undefined
  const updatedAt = normalizeProviderTimestamp(metadata?.time_utc)
  const hasTrustedTimestamp = updatedAt !== undefined
  return {
    id: watched.id,
    name: stringValue(metadata?.ShipName) ?? watched.name,
    imo: watched.imo,
    mmsi,
    callSign: watched.callSign,
    carrier: watched.carrier,
    shipType: watched.shipType,
    isWatched: true,
    latitude: numberValue(position.Latitude),
    longitude: numberValue(position.Longitude),
    speed: numberValue(position.Sog),
    course: numberValue(position.Cog),
    navigationStatus: navigationStatus(numberValue(position.NavigationalStatus)),
    statusChangedAt: watched.statusChangedAt,
    destination: watched.destination,
    eta: watched.eta,
    updatedAt,
    sourceUpdatedAt: updatedAt,
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
    async getVessels(watched = []) {
      const watchedVessels = watched.filter(vessel => vessel.isWatched && vessel.mmsi)
      if (!watchedVessels.length) {
        return watched.map(vessel => vessel.isWatched
          ? { ...vessel, stale: true, sourceStatus: "degraded" as const, error: "MMSI unavailable for real vessel lookup" }
          : vessel)
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
          const normalized = normalizeAisPosition(message, vessel)
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
      return watched.map((vessel) => {
        if (!vessel.isWatched) return vessel
        if (!vessel.mmsi) return { ...vessel, stale: true, sourceStatus: "degraded" as const, error: "MMSI unavailable for real vessel lookup" }
        return received.get(vessel.id) ?? { ...vessel, stale: true, sourceStatus: "degraded" as const }
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
  current?: { time?: number | string, wave_height?: number, wind_speed_10m?: number, wind_gusts_10m?: number }
}

export const weatherRiskThresholds = {
  warningWindKmh: 45,
  criticalWindKmh: 65,
  warningWaveHeightM: 2.5,
  criticalWaveHeightM: 4,
} as const

function weatherFetcher(): WeatherFetcher {
  const fetchImplementation = (globalThis as typeof globalThis & { fetch?: WeatherFetcher }).fetch
  if (!fetchImplementation) throw new Error("Fetch runtime is unavailable")
  return fetchImplementation
}

function validWeatherPayload(value: unknown): OpenMeteoPayload {
  if (!value || typeof value !== "object") throw new Error("Open-Meteo response is malformed")
  const current = (value as OpenMeteoPayload).current
  if (!current || typeof current !== "object" || normalizeProviderTimestamp(current.time) === undefined) throw new Error("Open-Meteo response is malformed: current timestamp is missing or invalid")
  return value as OpenMeteoPayload
}

function weatherFeedItem(port: WeatherPortConfig, marine: OpenMeteoPayload, wind: OpenMeteoPayload): FeedItem | undefined {
  const marineCurrent = marine.current
  const windCurrent = wind.current
  const waveHeight = numberValue(marineCurrent?.wave_height)
  const windSpeed = numberValue(windCurrent?.wind_speed_10m)
  const windGusts = numberValue(windCurrent?.wind_gusts_10m)
  const maxWind = Math.max(windSpeed ?? 0, windGusts ?? 0)
  const severity = (waveHeight !== undefined && waveHeight >= weatherRiskThresholds.criticalWaveHeightM) || maxWind >= weatherRiskThresholds.criticalWindKmh
    ? "critical"
    : (waveHeight !== undefined && waveHeight >= weatherRiskThresholds.warningWaveHeightM) || maxWind >= weatherRiskThresholds.warningWindKmh
        ? "warning"
        : undefined
  if (!severity) return undefined
  const updatedAt = normalizeProviderTimestamp(marineCurrent?.time ?? windCurrent?.time)
  if (!updatedAt) throw new Error("Open-Meteo timestamp is malformed")
  const windText = windSpeed === undefined ? "风速未知" : `风速 ${Math.round(windSpeed)} km/h`
  const gustText = windGusts === undefined ? "" : `，阵风 ${Math.round(windGusts)} km/h`
  const waveText = waveHeight === undefined ? "浪高未知" : `浪高 ${waveHeight.toFixed(1)} m`
  return {
    id: `weather-${port.id}`,
    sourceId: "open-meteo-marine",
    category: "weather",
    type: "weather_risk",
    title: `${port.nameEn} 航运天气${severity === "critical" ? "严重" : "预警"}`,
    summary: `${windText}${gustText}，${waveText}。仅作为运营关注信号。`,
    sourceUrl: "https://marine-api.open-meteo.com/",
    publishedAt: updatedAt,
    severity,
    relatedPortIds: [port.id],
    relatedVesselIds: [],
    relatedVoyageIds: [],
    updatedAt,
    sourceUpdatedAt: updatedAt,
    stale: false,
    sourceStatus: "healthy",
    provenance: openMeteoProvenance,
  }
}

export interface OpenMeteoWeatherProviderOptions {
  fetcher?: WeatherFetcher
  marineEndpoint?: string
  weatherEndpoint?: string
}

export function createOpenMeteoWeatherProvider(options: OpenMeteoWeatherProviderOptions = {}): WeatherProvider {
  const fetcher = options.fetcher ?? weatherFetcher()
  const marineEndpoint = options.marineEndpoint ?? "https://marine-api.open-meteo.com/v1/marine"
  const weatherEndpoint = options.weatherEndpoint ?? "https://api.open-meteo.com/v1/forecast"
  return {
    async getFeedItems(ports = mockPorts) {
      const results = await Promise.all(ports.map(async (port) => {
        const coordinates = portWeatherConfig[port.id as keyof typeof portWeatherConfig]
        if (!coordinates) return undefined
        const marineUrl = new URL(marineEndpoint)
        marineUrl.searchParams.set("latitude", String(coordinates.latitude))
        marineUrl.searchParams.set("longitude", String(coordinates.longitude))
        marineUrl.searchParams.set("current", "wave_height")
        marineUrl.searchParams.set("timeformat", "unixtime")
        marineUrl.searchParams.set("cell_selection", "sea")
        const weatherUrl = new URL(weatherEndpoint)
        weatherUrl.searchParams.set("latitude", String(coordinates.latitude))
        weatherUrl.searchParams.set("longitude", String(coordinates.longitude))
        weatherUrl.searchParams.set("current", "wind_speed_10m,wind_gusts_10m")
        weatherUrl.searchParams.set("timeformat", "unixtime")
        weatherUrl.searchParams.set("wind_speed_unit", "kmh")
        const [marineResponse, weatherResponse] = await Promise.all([fetcher(marineUrl.toString()), fetcher(weatherUrl.toString())])
        if (!marineResponse.ok) throw new Error(`Open-Meteo marine request failed (${marineResponse.status})`)
        if (!weatherResponse.ok) throw new Error(`Open-Meteo weather request failed (${weatherResponse.status})`)
        return weatherFeedItem({ id: port.id, name: port.name, nameEn: port.nameEn, latitude: coordinates.latitude, longitude: coordinates.longitude }, validWeatherPayload(await marineResponse.json()), validWeatherPayload(await weatherResponse.json()))
      }))
      return results.filter((item): item is FeedItem => item !== undefined)
    },
  }
}

interface ProviderEnvironment {
  [key: string]: string | undefined
  SHIPPING_VESSEL_PROVIDER?: string
  AISSTREAM_API_KEY?: string
  SHIPPING_PORT_PROVIDER?: string
  SHIPPING_WEATHER_PROVIDER?: string
}

export function configureProviders(environment: ProviderEnvironment = { ...env }) {
  const vesselMode = environment.SHIPPING_VESSEL_PROVIDER === "aisstream" && environment.AISSTREAM_API_KEY ? "aisstream" : "mock"
  const portMode = environment.SHIPPING_PORT_PROVIDER === "portcast" ? "portcast" : "mock"
  const weatherMode = environment.SHIPPING_WEATHER_PROVIDER === "open-meteo" ? "open-meteo" : "mock"
  return {
    providers: {
      vessel: vesselMode === "aisstream" ? createAisStreamVesselProvider({ apiKey: environment.AISSTREAM_API_KEY! }) : MockVesselProvider,
      port: portMode === "portcast" ? createPortcastPublicPageProvider() : MockPortProvider,
      schedule: MockScheduleProvider,
      weather: weatherMode === "open-meteo" ? createOpenMeteoWeatherProvider() : MockWeatherProvider,
    },
    modes: {
      vessel: vesselMode,
      port: portMode,
      schedule: "mock" as const,
      weather: weatherMode,
    },
  }
}

const configured = configureProviders()
const configuredCalendar = configureCalendarProviders()
export const providers = { ...configured.providers, calendar: configuredCalendar.provider as CalendarProvider }
export const providerModes = { ...configured.modes, calendar: configuredCalendar.modes.calendar }
export const calendarProviderModes = configuredCalendar.modes

export const realProviders = {
  vessel: "AISStream",
  port: "Portcast public page",
  schedule: "deferred",
  weather: "Open-Meteo Marine API",
  calendar: "Calendarific / OfficialHolidayProvider / ManualHolidayProvider",
} as const
