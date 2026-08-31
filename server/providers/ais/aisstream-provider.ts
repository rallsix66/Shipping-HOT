import type { AisPosition, AisTrackingProvider, AisTrackingVessel } from "#/providers/ais/contracts"
import { ProviderError } from "#/providers/contracts"

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
  connectionTimeoutMs?: number
  observationWindowMs?: number
  /** @deprecated Use connectionTimeoutMs and observationWindowMs. */
  timeoutMs?: number
  now?: () => Date
}

export interface AisStreamMessage {
  MessageType?: string
  error?: unknown
  Error?: unknown
  message?: unknown
  code?: unknown
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

export const aisStreamEndpoint = "wss://stream.aisstream.io/v0/stream"
export const aisStreamBoundingBoxes = [[[-90, -180], [90, 180]]] as const

export const AISSTREAM_MAX_MMSI_PER_REQUEST = 50
export const AISSTREAM_DEFAULT_CONNECTION_TIMEOUT_MS = 5_000
export const AISSTREAM_DEFAULT_OBSERVATION_WINDOW_MS = 30_000

export function createAisStreamSocket(endpoint: string): AisStreamSocket {
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
  const mmsi = String(number)
  return /^\d{9}$/.test(mmsi) ? mmsi : undefined
}

function timestampValue(value: unknown): string | undefined {
  if (typeof value === "number" || (typeof value === "string" && /^\d+(?:\.\d+)?$/.test(value.trim()))) {
    const numeric = Number(value)
    const milliseconds = numeric < 100_000_000_000 ? numeric * 1000 : numeric
    if (Number.isFinite(milliseconds)) return new Date(milliseconds).toISOString()
  }
  if (typeof value === "string") {
    const timestamp = Date.parse(value)
    if (Number.isFinite(timestamp)) return new Date(timestamp).toISOString()
  }
  return undefined
}

function navigationStatus(value: number | undefined): string | undefined {
  if (value === undefined) return undefined
  return value === 0 ? "under_way" : value === 1 ? "anchored" : value === 5 ? "moored" : value === 6 ? "aground" : "unknown"
}

export async function parseAisStreamMessage(data: unknown): Promise<AisStreamMessage | undefined> {
  try {
    let text: string | undefined
    if (typeof data === "string") {
      text = data
    } else if (typeof Blob !== "undefined" && data instanceof Blob) {
      text = await data.text()
    } else if (typeof ArrayBuffer !== "undefined" && data instanceof ArrayBuffer) {
      text = new TextDecoder("utf-8", { fatal: false }).decode(new Uint8Array(data))
    } else if (typeof ArrayBuffer !== "undefined" && ArrayBuffer.isView(data)) {
      const view = data as ArrayBufferView & { buffer: ArrayBufferLike }
      text = new TextDecoder("utf-8", { fatal: false }).decode(new Uint8Array(view.buffer, view.byteOffset, view.byteLength))
    } else {
      return undefined
    }
    const parsed = JSON.parse(text)
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as AisStreamMessage : undefined
  } catch {
    return undefined
  }
}

function errorText(value: unknown): string | undefined {
  if (value instanceof Error) return value.message || undefined
  if (typeof value === "string") return value
  if (!value || typeof value !== "object") return undefined
  const record = value as Record<string, unknown>
  const codeValue = record.code ?? record.Code
  const code = typeof codeValue === "string" || typeof codeValue === "number" ? String(codeValue) : undefined
  const message = typeof record.message === "string" ? record.message : typeof record.Message === "string" ? record.Message : undefined
  if (code || message) return [code, message].filter(Boolean).join(" ")
  for (const key of ["error", "Error", "message", "Message"]) {
    const nested = errorText(record[key])
    if (nested) return nested
  }
  return undefined
}

export function aisStreamProtocolError(message: AisStreamMessage): Error | undefined {
  const record = message as Record<string, unknown>
  const hasError = Object.prototype.hasOwnProperty.call(record, "error")
    || Object.prototype.hasOwnProperty.call(record, "Error")
  const errorValue = Object.prototype.hasOwnProperty.call(record, "error") ? record.error : record.Error
  const messageType = typeof message.MessageType === "string" ? message.MessageType : ""
  if (!hasError && !/error/i.test(messageType)) return undefined
  return new Error(errorText(errorValue) ?? errorText(message.message) ?? "aisstream_unavailable")
}

export function mapAisStreamPosition(message: AisStreamMessage, _fetchedAt: string, sourceType: AisPosition["sourceType"] = "real"): AisPosition | undefined {
  if (message.MessageType !== "PositionReport") return undefined
  const report = message.Message?.PositionReport
  if (!report) return undefined
  const metadata = message.MetaData ?? message.Metadata
  const metadataMmsi = mmsiValue(metadata?.MMSI)
  const reportMmsi = mmsiValue(report.UserID)
  if (metadataMmsi && reportMmsi && metadataMmsi !== reportMmsi) return undefined
  const mmsi = metadataMmsi ?? reportMmsi
  const latitude = numberValue(report.Latitude)
  const longitude = numberValue(report.Longitude)
  const timestamp = timestampValue(metadata?.time_utc)
  if (!mmsi || latitude === undefined || longitude === undefined || !timestamp) return undefined
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
    timestamp,
    source: "aisstream",
    sourceType,
  }
}

export function aisStreamProviderError(error: unknown): ProviderError {
  if (error instanceof ProviderError) return error
  const text = errorText(error)?.trim() ?? ""
  const directCode = text.toLowerCase()
  if (directCode === "aisstream_timeout") return new ProviderError("provider_timeout", directCode)
  if (directCode === "aisstream_api_key_missing" || directCode === "aisstream_auth_failed") return new ProviderError("auth_failed", directCode)
  if (directCode === "aisstream_rate_limited") return new ProviderError("rate_limited", directCode)
  if (directCode === "aisstream_subscription_failed") return new ProviderError("provider_contract_changed", directCode)
  if (directCode === "aisstream_connection_closed" || directCode === "aisstream_unavailable" || directCode === "aisstream_websocket_unavailable") return new ProviderError("provider_unavailable", directCode)
  if (/api.?key|auth|credential|unauthori[sz]ed|forbidden|\b401\b|\b403\b/i.test(text)) return new ProviderError("auth_failed", "aisstream_auth_failed")
  if (/rate|limit|quota|\b429\b/i.test(text)) return new ProviderError("rate_limited", "aisstream_rate_limited")
  if (/subscri|filter|bounding|\b400\b/i.test(text)) return new ProviderError("provider_contract_changed", "aisstream_subscription_failed")
  return new ProviderError("provider_unavailable", "aisstream_unavailable")
}

export class AisStreamTrackingProvider implements AisTrackingProvider {
  readonly providerId = "aisstream"
  private readonly endpoint: string
  private readonly socketFactory: (endpoint: string) => AisStreamSocket
  private readonly connectionTimeoutMs: number
  private readonly observationWindowMs: number
  private readonly now: () => Date
  private readonly apiKey?: string
  private readonly apiKeyResolver?: () => Promise<string | undefined>

  constructor(options: AisStreamProviderOptions) {
    this.endpoint = options.endpoint ?? aisStreamEndpoint
    this.socketFactory = options.socketFactory ?? createAisStreamSocket
    const legacyTimeoutMs = options.timeoutMs
    const connectionTimeoutMs = options.connectionTimeoutMs ?? legacyTimeoutMs ?? AISSTREAM_DEFAULT_CONNECTION_TIMEOUT_MS
    const observationWindowMs = options.observationWindowMs ?? legacyTimeoutMs ?? AISSTREAM_DEFAULT_OBSERVATION_WINDOW_MS
    this.connectionTimeoutMs = Number.isFinite(connectionTimeoutMs) && connectionTimeoutMs > 0 ? connectionTimeoutMs : AISSTREAM_DEFAULT_CONNECTION_TIMEOUT_MS
    this.observationWindowMs = Number.isFinite(observationWindowMs) && observationWindowMs > 0 ? observationWindowMs : AISSTREAM_DEFAULT_OBSERVATION_WINDOW_MS
    this.now = options.now ?? (() => new Date())
    this.apiKey = options.apiKey
    this.apiKeyResolver = options.apiKeyResolver
  }

  async subscribe(_vessels: readonly AisTrackingVessel[]): Promise<void> {}

  async unsubscribe(_vessels: readonly AisTrackingVessel[]): Promise<void> {}

  async getLatestPositions(vessels: readonly AisTrackingVessel[]): Promise<readonly AisPosition[]> {
    if (!vessels.length) return []
    try {
      const apiKey = this.apiKey ?? await this.apiKeyResolver?.()
      if (!apiKey) throw new Error("aisstream_api_key_missing")
      const trackedMmsi = [...new Set(vessels.map(vessel => vessel.mmsi))]
      const positions = new Map<string, AisPosition>()
      const fetchedAt = this.now().toISOString()
      for (let offset = 0; offset < trackedMmsi.length; offset += AISSTREAM_MAX_MMSI_PER_REQUEST) {
        const batch = trackedMmsi.slice(offset, offset + AISSTREAM_MAX_MMSI_PER_REQUEST)
        const result = await this.getLatestPositionsBatch(apiKey, batch, fetchedAt)
        for (const position of result) positions.set(position.mmsi, position)
      }
      return [...positions.values()]
    } catch (error) {
      throw aisStreamProviderError(error)
    }
  }

  private async getLatestPositionsBatch(apiKey: string, trackedMmsi: readonly string[], fetchedAt: string): Promise<readonly AisPosition[]> {
    let socket: AisStreamSocket | undefined
    let connectionTimer: ReturnType<typeof setTimeout> | undefined
    let observationTimer: ReturnType<typeof setTimeout> | undefined
    const positions = new Map<string, AisPosition>()
    try {
      socket = this.socketFactory(this.endpoint)
      return await new Promise<readonly AisPosition[]>((resolve, reject) => {
        let settled = false
        let opened = false
        let subscriptionConfirmed = false
        const finish = (error?: Error) => {
          if (settled) return
          settled = true
          if (connectionTimer) clearTimeout(connectionTimer)
          if (observationTimer) clearTimeout(observationTimer)
          if (error) reject(error)
          else resolve([...positions.values()])
        }
        connectionTimer = setTimeout(() => {
          if (!opened) finish(new Error("aisstream_timeout"))
        }, this.connectionTimeoutMs)
        socket!.onopen = () => {
          opened = true
          if (connectionTimer) clearTimeout(connectionTimer)
          try {
            socket!.send(JSON.stringify({
              APIKey: apiKey,
              BoundingBoxes: aisStreamBoundingBoxes,
              FiltersShipMMSI: [...trackedMmsi],
              FilterMessageTypes: ["PositionReport"],
            }))
            if (!settled) observationTimer = setTimeout(() => finish(), this.observationWindowMs)
          } catch (error) {
            finish(aisStreamProviderError(error))
          }
        }
        socket!.onmessage = (event) => {
          void (async () => {
            const message = await parseAisStreamMessage(event.data)
            if (message?.MessageType === "SubscriptionConfirmation") {
              subscriptionConfirmed = true
              return
            }
            const error = message ? aisStreamProtocolError(message) : undefined
            if (error) {
              finish(error)
              return
            }
            const position = mapAisStreamPosition(message ?? {}, fetchedAt)
            if (!position || !trackedMmsi.includes(position.mmsi)) return
            positions.set(position.mmsi, position)
            if (trackedMmsi.every(mmsi => positions.has(mmsi))) finish()
          })()
        }
        socket!.onerror = event => finish(aisStreamProviderError(event))
        socket!.onclose = () => {
          if (!settled) finish(positions.size || subscriptionConfirmed ? undefined : new Error("aisstream_connection_closed"))
        }
      })
    } finally {
      if (connectionTimer) clearTimeout(connectionTimer)
      if (observationTimer) clearTimeout(observationTimer)
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
