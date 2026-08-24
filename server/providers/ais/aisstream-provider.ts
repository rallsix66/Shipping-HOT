import type { AisPosition, AisTrackingProvider, AisTrackingVessel } from "#/providers/ais/contracts"

export interface AisStreamSocketEvent {
  data: unknown
}

export interface AisStreamSocket {
  onopen: (() => void) | null
  onmessage: ((event: AisStreamSocketEvent) => void) | null
  onerror: ((event: unknown) => void) | null
  onclose: (() => void) | null
  send: (data: string) => void
  close: () => void
}

export interface AisStreamProviderOptions {
  apiKey?: string
  apiKeyResolver?: () => Promise<string | undefined>
  endpoint?: string
  socketFactory?: (endpoint: string) => AisStreamSocket
  timeoutMs?: number
  now?: () => Date
}

interface AisStreamMessage {
  MessageType?: string
  MetaData?: { MMSI?: number | string, time_utc?: number | string }
  Metadata?: { MMSI?: number | string, time_utc?: number | string }
  Message?: { PositionReport?: {
    UserID?: number | string
    Latitude?: number | string
    Longitude?: number | string
    Sog?: number | string
    Cog?: number | string
    TrueHeading?: number | string
    Heading?: number | string
    NavigationalStatus?: number | string
  } }
}

const aisStreamEndpoint = "wss://stream.aisstream.io/v0/stream"

function socketFromGlobal(endpoint: string): AisStreamSocket {
  const WebSocketCtor = (globalThis as typeof globalThis & { WebSocket?: new (url: string) => unknown }).WebSocket
  if (!WebSocketCtor) throw new Error("aisstream_websocket_unavailable")
  return new WebSocketCtor(endpoint) as AisStreamSocket
}

function numberValue(value: unknown): number | undefined {
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined
  if (typeof value !== "string" || !value.trim()) return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

function mmsiValue(value: unknown): string | undefined {
  const number = numberValue(value)
  if (number === undefined || !Number.isInteger(number) || number <= 0) return undefined
  return String(number)
}

function timestampValue(value: unknown, fallback: string): string {
  if (typeof value === "number" || (typeof value === "string" && /^\d+(?:\.\d+)?$/.test(value.trim()))) {
    const numeric = Number(value)
    const milliseconds = numeric < 100_000_000_000 ? numeric * 1000 : numeric
    if (Number.isFinite(milliseconds)) return new Date(milliseconds).toISOString()
  }
  if (typeof value === "string") {
    const timestamp = Date.parse(value)
    if (Number.isFinite(timestamp)) return new Date(timestamp).toISOString()
  }
  return fallback
}

function navigationStatus(value: number | undefined): string | undefined {
  if (value === undefined) return undefined
  return value === 0 ? "under_way" : value === 1 ? "anchored" : value === 5 ? "moored" : value === 6 ? "aground" : "unknown"
}

function parseMessage(data: unknown): AisStreamMessage | undefined {
  try {
    const parsed = typeof data === "string" ? JSON.parse(data) : data
    return parsed && typeof parsed === "object" ? parsed as AisStreamMessage : undefined
  } catch {
    return undefined
  }
}

export function mapAisStreamPosition(message: AisStreamMessage, fetchedAt: string, sourceType: AisPosition["sourceType"] = "real"): AisPosition | undefined {
  if (message.MessageType !== "PositionReport") return undefined
  const report = message.Message?.PositionReport
  if (!report) return undefined
  const metadata = message.MetaData ?? message.Metadata
  const mmsi = mmsiValue(metadata?.MMSI ?? report.UserID)
  const latitude = numberValue(report.Latitude)
  const longitude = numberValue(report.Longitude)
  if (!mmsi || latitude === undefined || longitude === undefined) return undefined
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return undefined
  const heading = numberValue(report.TrueHeading ?? report.Heading)
  return {
    mmsi,
    latitude,
    longitude,
    speed: numberValue(report.Sog),
    course: numberValue(report.Cog),
    heading: heading !== undefined && heading <= 360 ? heading : undefined,
    navigationStatus: navigationStatus(numberValue(report.NavigationalStatus)),
    timestamp: timestampValue(metadata?.time_utc, fetchedAt),
    source: "aisstream",
    sourceType,
  }
}

function safeProviderError(error: unknown): Error {
  if (error instanceof Error && error.message && !/api.?key|wss?:\/\//i.test(error.message)) return new Error(error.message.slice(0, 200))
  return new Error("aisstream_unavailable")
}

export class AisStreamTrackingProvider implements AisTrackingProvider {
  readonly providerId = "aisstream"
  private readonly endpoint: string
  private readonly socketFactory: (endpoint: string) => AisStreamSocket
  private readonly timeoutMs: number
  private readonly now: () => Date
  private readonly apiKey?: string
  private readonly apiKeyResolver?: () => Promise<string | undefined>

  constructor(options: AisStreamProviderOptions) {
    this.endpoint = options.endpoint ?? aisStreamEndpoint
    this.socketFactory = options.socketFactory ?? socketFromGlobal
    this.timeoutMs = Math.max(1, options.timeoutMs ?? 2500)
    this.now = options.now ?? (() => new Date())
    this.apiKey = options.apiKey
    this.apiKeyResolver = options.apiKeyResolver
  }

  async subscribe(_vessels: readonly AisTrackingVessel[]): Promise<void> {}

  async unsubscribe(_vessels: readonly AisTrackingVessel[]): Promise<void> {}

  async getLatestPositions(vessels: readonly AisTrackingVessel[]): Promise<readonly AisPosition[]> {
    if (!vessels.length) return []
    const apiKey = this.apiKey ?? await this.apiKeyResolver?.()
    if (!apiKey) throw new Error("aisstream_api_key_missing")
    const trackedMmsi = new Set(vessels.map(vessel => vessel.mmsi))
    const positions = new Map<string, AisPosition>()
    const fetchedAt = this.now().toISOString()
    let socket: AisStreamSocket | undefined
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      socket = this.socketFactory(this.endpoint)
      const result = await new Promise<readonly AisPosition[]>((resolve, reject) => {
        let settled = false
        let opened = false
        const finish = (error?: Error) => {
          if (settled) return
          settled = true
          if (timer) clearTimeout(timer)
          if (error) reject(error)
          else resolve([...positions.values()])
        }
        timer = setTimeout(() => finish(opened ? undefined : new Error("aisstream_timeout")), this.timeoutMs)
        socket!.onopen = () => {
          opened = true
          socket!.send(JSON.stringify({ APIKey: apiKey, FiltersShipMMSI: [...trackedMmsi], FilterMessageTypes: ["PositionReport"] }))
        }
        socket!.onmessage = (event) => {
          const position = mapAisStreamPosition(parseMessage(event.data) ?? {}, fetchedAt)
          if (!position) return
          positions.set(position.mmsi, position)
          if ([...trackedMmsi].every(mmsi => positions.has(mmsi))) finish()
        }
        socket!.onerror = event => finish(safeProviderError(event))
        socket!.onclose = () => {
          if (!settled) finish(positions.size ? undefined : new Error("aisstream_connection_closed"))
        }
      })
      return result
    } catch (error) {
      throw safeProviderError(error)
    } finally {
      if (timer) clearTimeout(timer)
      try {
        socket?.close()
      } catch {
        // Ignore close errors after a bounded read.
      }
    }
  }
}

export function createAisStreamTrackingProvider(options: AisStreamProviderOptions): AisTrackingProvider {
  return new AisStreamTrackingProvider(options)
}
