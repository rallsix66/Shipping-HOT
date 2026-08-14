import type { FeedItem, Freshness, Port, Vessel, Voyage } from "@shared/shipping"
import { mockFeedItems, mockPorts, mockVessels, mockVoyages, portWeatherConfig } from "@shared/shipping-fixtures"

export interface VesselProvider { getVessels(watched?: Vessel[]): Promise<Vessel[]> }
export interface PortProvider { getPorts(): Promise<Port[]> }
export interface ScheduleProvider { getVoyages(): Promise<Voyage[]> }
export interface WeatherProvider { getFeedItems(ports?: Port[]): Promise<FeedItem[]> }

export function providerResult<T extends Freshness>(result: PromiseSettledResult<T[]>, lastKnown: T[]): T[] {
  if (result.status === "fulfilled") return result.value
  const error = result.reason instanceof Error ? result.reason.message : "Provider failed"
  return lastKnown.map(item => ({ ...item, stale: true, sourceStatus: "failed", error })) as T[]
}

export function disabledProviderData<T extends Freshness>(lastKnown: T[]): T[] {
  return lastKnown.map(item => ({ ...item, stale: false, sourceStatus: "disabled", error: undefined })) as T[]
}

export const MockVesselProvider: VesselProvider = { async getVessels() { return structuredClone(mockVessels) } }
export const MockPortProvider: PortProvider = { async getPorts() { return structuredClone(mockPorts) } }
export const MockScheduleProvider: ScheduleProvider = { async getVoyages() { return structuredClone(mockVoyages) } }
export const MockWeatherProvider: WeatherProvider = { async getFeedItems() { return structuredClone(mockFeedItems) } }

type AisSocketEvent = { data: unknown }
interface AisSocket {
  onopen: (() => void) | null
  onmessage: ((event: AisSocketEvent) => void) | null
  onerror: ((event: unknown) => void) | null
  onclose: (() => void) | null
  send(data: string): void
  close(): void
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
  const mmsi = stringValue(message.Metadata?.MMSI) ?? (position?.UserID === undefined ? undefined : String(position.UserID))
  if (!position || !mmsi || mmsi !== watched.mmsi) return undefined
  const updatedAt = stringValue(message.Metadata?.time_utc)
  return {
    id: watched.id,
    name: stringValue(message.Metadata?.ShipName) ?? watched.name,
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
    updatedAt: updatedAt && !Number.isNaN(Date.parse(updatedAt)) ? new Date(updatedAt).toISOString() : undefined,
    stale: false,
    sourceStatus: "healthy",
  }
}

export function createAisStreamVesselProvider(options: AisStreamVesselProviderOptions): VesselProvider {
  const endpoint = options.endpoint ?? aisEndpoint
  const timeoutMs = options.timeoutMs ?? 5000
  const socketFactory = options.socketFactory ?? socketFromGlobal
  return {
    async getVessels(watched = []) {
      const watchedVessels = watched.filter(vessel => vessel.isWatched && vessel.mmsi)
      if (!watchedVessels.length) return watched.map(vessel => vessel.isWatched ? { ...vessel, stale: true, sourceStatus: "degraded" as const } : vessel)
      const watchedByMmsi = new Map(watchedVessels.map(vessel => [vessel.mmsi!, vessel]))
      const received = new Map<string, Vessel>()
      await new Promise<void>((resolve, reject) => {
        let settled = false
        const socket = socketFactory(endpoint)
        const finish = (error?: Error) => {
          if (settled) return
          settled = true
          clearTimeout(timer)
          socket.close()
          if (error) reject(error)
          else resolve()
        }
        const timer = setTimeout(() => finish(new Error("AISStream request timed out")), timeoutMs)
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
          const mmsi = stringValue(message.Metadata?.MMSI) ?? (message.Message?.PositionReport?.UserID === undefined ? undefined : String(message.Message.PositionReport.UserID))
          const vessel = mmsi ? watchedByMmsi.get(mmsi) : undefined
          if (!vessel) return
          const normalized = normalizeAisPosition(message, vessel)
          if (!normalized) return
          received.set(normalized.id, normalized)
          if (received.size === watchedByMmsi.size) finish()
        }
        socket.onerror = () => finish(new Error("AISStream request failed"))
        socket.onclose = () => {
          if (!settled && received.size === 0) finish(new Error("AISStream connection closed"))
          else if (!settled) finish()
        }
      })
      return [
        ...watchedVessels.map(vessel => received.get(vessel.id) ?? { ...vessel, stale: true, sourceStatus: "degraded" as const }),
        ...watched.filter(vessel => !vessel.isWatched),
      ]
    },
  }
}

export interface WeatherFetchResponse {
  ok: boolean
  status: number
  json(): Promise<unknown>
}

type WeatherFetcher = (url: string) => Promise<WeatherFetchResponse>
type WeatherPortConfig = { id: string, name: string, nameEn: string, latitude: number, longitude: number }

interface OpenMeteoPayload {
  current?: { time?: string, wave_height?: number, wind_speed_10m?: number, wind_gusts_10m?: number }
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
  if (!current || typeof current !== "object" || typeof current.time !== "string") throw new Error("Open-Meteo response is malformed: current weather is missing")
  return value as OpenMeteoPayload
}

function weatherFeedItem(port: WeatherPortConfig, marine: OpenMeteoPayload, wind: OpenMeteoPayload): FeedItem | undefined {
  const marineCurrent = marine.current
  const windCurrent = wind.current
  const waveHeight = numberValue(marineCurrent?.wave_height)
  const windSpeed = numberValue(windCurrent?.wind_speed_10m)
  const windGusts = numberValue(windCurrent?.wind_gusts_10m)
  const maxWind = Math.max(windSpeed ?? 0, windGusts ?? 0)
  const severity = waveHeight !== undefined && waveHeight >= weatherRiskThresholds.criticalWaveHeightM || maxWind >= weatherRiskThresholds.criticalWindKmh
    ? "critical"
    : waveHeight !== undefined && waveHeight >= weatherRiskThresholds.warningWaveHeightM || maxWind >= weatherRiskThresholds.warningWindKmh
      ? "warning"
      : undefined
  if (!severity) return undefined
  const updatedAt = marineCurrent?.time ?? windCurrent?.time
  if (!updatedAt || Number.isNaN(Date.parse(updatedAt))) throw new Error("Open-Meteo timestamp is malformed")
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
    publishedAt: new Date(updatedAt).toISOString(),
    severity,
    relatedPortIds: [port.id],
    relatedVesselIds: [],
    relatedVoyageIds: [],
    updatedAt: new Date(updatedAt).toISOString(),
    stale: false,
    sourceStatus: "healthy",
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
        marineUrl.searchParams.set("cell_selection", "sea")
        const weatherUrl = new URL(weatherEndpoint)
        weatherUrl.searchParams.set("latitude", String(coordinates.latitude))
        weatherUrl.searchParams.set("longitude", String(coordinates.longitude))
        weatherUrl.searchParams.set("current", "wind_speed_10m,wind_gusts_10m")
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
  SHIPPING_WEATHER_PROVIDER?: string
}

export function configureProviders(env: ProviderEnvironment = { ...process.env }) {
  const vesselMode = env.SHIPPING_VESSEL_PROVIDER === "aisstream" && env.AISSTREAM_API_KEY ? "aisstream" : "mock"
  const weatherMode = env.SHIPPING_WEATHER_PROVIDER === "open-meteo" ? "open-meteo" : "mock"
  return {
    providers: {
      vessel: vesselMode === "aisstream" ? createAisStreamVesselProvider({ apiKey: env.AISSTREAM_API_KEY! }) : MockVesselProvider,
      port: MockPortProvider,
      schedule: MockScheduleProvider,
      weather: weatherMode === "open-meteo" ? createOpenMeteoWeatherProvider() : MockWeatherProvider,
    },
    modes: {
      vessel: vesselMode,
      port: "mock" as const,
      schedule: "mock" as const,
      weather: weatherMode,
    },
  }
}

const configured = configureProviders()
export const providers = configured.providers
export const providerModes = configured.modes

export const realProviders = {
  vessel: "AISStream",
  port: "deferred",
  schedule: "deferred",
  weather: "Open-Meteo Marine API",
} as const
