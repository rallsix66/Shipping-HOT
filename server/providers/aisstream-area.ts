import type { AisAreaObservation, AisAreaObservationMessage, AisDerivedPortMetric, PortAisAreaConfig } from "@shared/ais-area"
import { AIS_AREA_BUCKET_MS, AIS_AREA_DEFAULT_LOW_SPEED_KNOTS, AIS_AREA_DEFAULT_MINIMUM_SAMPLE_SIZE, AIS_AREA_DEFAULT_TTL_MS, AIS_AREA_MAX_OBSERVATIONS, AIS_AREA_SOURCE_ID, aggregateAisPortMetric, aisAreaObservationTimestamp, assignAisAreaObservation, normalizeAisAreaPositionReport, watchedPortAisAreaConfigs } from "@shared/ais-area"
import type { DataProvenance, Port } from "@shared/shipping"

export const aisstreamAreaObservedProvenance: DataProvenance = { sourceType: "third_party", dataNature: "observed", sourceId: AIS_AREA_SOURCE_ID, sourceUrl: "https://aisstream.io/", verified: false }
export const aisstreamAreaDerivedProvenance: DataProvenance = { sourceType: "third_party", dataNature: "derived", sourceId: AIS_AREA_SOURCE_ID, sourceUrl: "https://aisstream.io/", verified: false }
export const aisstreamAreaEstimatedProvenance: DataProvenance = { sourceType: "third_party", dataNature: "estimated", sourceId: AIS_AREA_SOURCE_ID, sourceUrl: "https://aisstream.io/", verified: false }

export interface AisAreaProvider {
  getPortMetrics: (ports?: Port[], lastKnown?: AisDerivedPortMetric[]) => Promise<AisDerivedPortMetric[]>
}

export interface AisAreaSocketEvent {
  data: unknown
}

export interface AisAreaSocket {
  onopen: (() => void) | null
  onmessage: ((event: AisAreaSocketEvent) => void) | null
  onerror: ((event: unknown) => void) | null
  onclose: (() => void) | null
  send: (data: string) => void
  close: () => void
}

export interface AisAreaSessionOptions {
  apiKey: string
  endpoint?: string
  socketFactory?: (endpoint: string) => AisAreaSocket
  now?: () => Date
  timeoutMs?: number
  initialObservationWaitMs?: number
  subscriptionDebounceMs?: number
  reconnectDelaysMs?: number[]
  idleCloseMs?: number
  observationTtlMs?: number
  maxObservations?: number
  minimumSampleSize?: number
  lowSpeedThresholdKnots?: number
}

export interface AisAreaSessionStats {
  socketOpened: number
  subscriptionsSent: number
  subscriptionBboxCount: number
  positionReportsReceived: number
  validPositionReports: number
  assignedPortSamples: number
  ambiguousSamples: number
  sourceTimestampPresent: number
  distinctMmsi: number
}

const aisAreaEndpoint = "wss://stream.aisstream.io/v0/stream"

function socketFromGlobal(endpoint: string): AisAreaSocket {
  const WebSocketCtor = (globalThis as typeof globalThis & { WebSocket?: new (url: string) => unknown }).WebSocket
  if (!WebSocketCtor) throw new Error("WebSocket runtime is unavailable")
  return new WebSocketCtor(endpoint) as AisAreaSocket
}

function parseMessage(data: unknown): AisAreaObservationMessage | undefined {
  try {
    const parsed = typeof data === "string" ? JSON.parse(data) : data
    if (!parsed || typeof parsed !== "object") return undefined
    return parsed as AisAreaObservationMessage
  } catch {
    return undefined
  }
}

function bboxPayload(config: PortAisAreaConfig): [[number, number], [number, number]] {
  return [[config.bbox.south, config.bbox.west], [config.bbox.north, config.bbox.east]]
}

export function aisAreaSubscription(apiKey: string, configs: PortAisAreaConfig[]): Record<string, unknown> {
  return {
    APIKey: apiKey,
    BoundingBoxes: configs.map(bboxPayload),
    FilterMessageTypes: ["PositionReport"],
  }
}

function sanitizeAreaError(error: unknown): string {
  if (error instanceof Error && error.message && !/api.?key|wss?:\/\//i.test(error.message)) return error.message.slice(0, 200)
  return "AIS area stream unavailable"
}

function markMetricStale(metric: AisDerivedPortMetric, fetchedAt: string, error: string): AisDerivedPortMetric {
  return { ...metric, fetchedAt, stale: true, sourceStatus: "failed", coverage: "stale", error, provenance: metric.provenance?.sourceId === AIS_AREA_SOURCE_ID ? metric.provenance : aisstreamAreaDerivedProvenance, trendProvenance: aisstreamAreaEstimatedProvenance }
}

export class AisAreaSession {
  private socket: AisAreaSocket | undefined
  private socketOpen = false
  private connectPromise: Promise<void> | undefined
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined
  private subscriptionTimer: ReturnType<typeof setTimeout> | undefined
  private idleTimer: ReturnType<typeof setTimeout> | undefined
  private desiredConfigs: PortAisAreaConfig[] = []
  private activeConfigs: PortAisAreaConfig[] = []
  private readonly observations = new Map<string, AisAreaObservation>()
  private readonly metrics = new Map<string, AisDerivedPortMetric>()
  private readonly stats = {
    socketOpened: 0,
    subscriptionsSent: 0,
    subscriptionBboxCount: 0,
    positionReportsReceived: 0,
    validPositionReports: 0,
    assignedPortSamples: 0,
    ambiguousSamples: 0,
    sourceTimestampPresent: 0,
  }

  private reconnectAttempt = 0
  private readonly endpoint: string
  private readonly socketFactory: (endpoint: string) => AisAreaSocket
  private readonly now: () => Date
  private readonly timeoutMs: number
  private readonly initialObservationWaitMs: number
  private readonly subscriptionDebounceMs: number
  private readonly reconnectDelaysMs: number[]
  private readonly idleCloseMs: number
  private readonly observationTtlMs: number
  private readonly maxObservations: number
  private readonly minimumSampleSize: number
  private readonly lowSpeedThresholdKnots: number

  constructor(private readonly options: AisAreaSessionOptions) {
    this.endpoint = options.endpoint ?? aisAreaEndpoint
    this.socketFactory = options.socketFactory ?? socketFromGlobal
    this.now = options.now ?? (() => new Date())
    this.timeoutMs = options.timeoutMs ?? 5000
    this.initialObservationWaitMs = options.initialObservationWaitMs ?? 25
    this.subscriptionDebounceMs = Math.max(1000, options.subscriptionDebounceMs ?? 1000)
    this.reconnectDelaysMs = options.reconnectDelaysMs ?? [1000, 2000, 5000, 10000]
    this.idleCloseMs = options.idleCloseMs ?? 120000
    this.observationTtlMs = options.observationTtlMs ?? AIS_AREA_DEFAULT_TTL_MS
    this.maxObservations = Math.max(1, options.maxObservations ?? AIS_AREA_MAX_OBSERVATIONS)
    this.minimumSampleSize = options.minimumSampleSize ?? AIS_AREA_DEFAULT_MINIMUM_SAMPLE_SIZE
    this.lowSpeedThresholdKnots = options.lowSpeedThresholdKnots ?? AIS_AREA_DEFAULT_LOW_SPEED_KNOTS
  }

  get currentSocket(): AisAreaSocket | undefined {
    return this.socket
  }

  get currentConfigs(): PortAisAreaConfig[] {
    return [...this.activeConfigs]
  }

  get observationCount(): number {
    return this.observations.size
  }

  get liveStats(): AisAreaSessionStats {
    return { ...this.stats, distinctMmsi: this.observations.size }
  }

  private clearIdleTimer() {
    if (this.idleTimer) clearTimeout(this.idleTimer)
    this.idleTimer = undefined
  }

  private scheduleIdleClose() {
    this.clearIdleTimer()
    this.idleTimer = setTimeout(() => {
      this.close()
    }, this.idleCloseMs)
  }

  private sendSubscription(configs: PortAisAreaConfig[]) {
    if (!this.socket || !this.socketOpen || !configs.length) return
    this.activeConfigs = [...configs]
    this.socket.send(JSON.stringify(aisAreaSubscription(this.options.apiKey, configs)))
    this.stats.subscriptionsSent++
    this.stats.subscriptionBboxCount = configs.length
  }

  private pruneObservations(now: Date) {
    const nowTimestamp = now.getTime()
    for (const [mmsi, observation] of this.observations) {
      const timestamp = aisAreaObservationTimestamp(observation)
      if (!Number.isFinite(timestamp) || nowTimestamp - timestamp > this.observationTtlMs) this.observations.delete(mmsi)
    }
  }

  private storeObservation(observation: AisAreaObservation) {
    this.observations.set(observation.mmsi, observation)
    while (this.observations.size > this.maxObservations) {
      let oldestMmsi: string | undefined
      let oldestTimestamp = Number.POSITIVE_INFINITY
      for (const [mmsi, candidate] of this.observations) {
        const timestamp = aisAreaObservationTimestamp(candidate)
        if (!Number.isFinite(timestamp)) {
          oldestMmsi = mmsi
          break
        }
        if (timestamp < oldestTimestamp) {
          oldestTimestamp = timestamp
          oldestMmsi = mmsi
        }
      }
      if (!oldestMmsi) break
      this.observations.delete(oldestMmsi)
    }
  }

  private setDesiredConfigs(configs: PortAisAreaConfig[]) {
    this.desiredConfigs = configs
    this.clearIdleTimer()
    if (!this.socket || !this.socketOpen) return
    if (this.subscriptionTimer) clearTimeout(this.subscriptionTimer)
    if (JSON.stringify(this.activeConfigs.map(config => config.portId)) === JSON.stringify(configs.map(config => config.portId))) return
    this.subscriptionTimer = setTimeout(() => {
      this.subscriptionTimer = undefined
      this.sendSubscription(this.desiredConfigs)
    }, this.subscriptionDebounceMs)
  }

  private scheduleReconnect() {
    if (!this.desiredConfigs.length || this.reconnectTimer) return
    const delay = this.reconnectDelaysMs[Math.min(this.reconnectAttempt, this.reconnectDelaysMs.length - 1)] ?? 10000
    this.reconnectAttempt++
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined
      void this.ensureConnected().catch(() => undefined)
    }, delay)
  }

  private async ensureConnected(): Promise<void> {
    if (this.socket && this.socketOpen) return
    if (this.connectPromise) return this.connectPromise
    this.connectPromise = new Promise<void>((resolve, reject) => {
      let settled = false
      let timer: ReturnType<typeof setTimeout> | undefined
      let opened = false
      let socket: AisAreaSocket
      try {
        socket = this.socketFactory(this.endpoint)
      } catch (error) {
        reject(new Error(sanitizeAreaError(error)))
        return
      }
      this.socket = socket
      this.socketOpen = false
      const finish = (error?: Error) => {
        if (settled) return
        settled = true
        if (timer) clearTimeout(timer)
        if (error) reject(error)
        else resolve()
      }
      timer = setTimeout(() => {
        if (!opened) {
          try {
            socket.close()
          } catch { /* Ignore close errors during timeout. */ }
          finish(new Error("AIS area stream timed out"))
        }
      }, this.timeoutMs)
      socket.onopen = () => {
        opened = true
        this.socketOpen = true
        this.stats.socketOpened++
        this.reconnectAttempt = 0
        this.sendSubscription(this.desiredConfigs)
        finish()
      }
      socket.onmessage = (event) => {
        const message = parseMessage(event.data) ?? {}
        if (message.MessageType === "PositionReport") this.stats.positionReportsReceived++
        const normalized = normalizeAisAreaPositionReport(message, this.now().toISOString())
        if (!normalized) return
        this.stats.validPositionReports++
        if (normalized.sourceUpdatedAt) this.stats.sourceTimestampPresent++
        const assigned = assignAisAreaObservation(normalized, this.activeConfigs)
        if (!assigned) return
        this.stats.assignedPortSamples++
        if (assigned.areaAmbiguous) this.stats.ambiguousSamples++
        this.storeObservation(assigned)
      }
      socket.onerror = (event) => {
        const error = new Error(sanitizeAreaError(event))
        if (!opened) finish(error)
        this.socketOpen = false
        this.scheduleReconnect()
      }
      socket.onclose = () => {
        this.socketOpen = false
        if (!opened) finish(new Error("AIS area stream closed before subscription"))
        this.scheduleReconnect()
      }
    }).finally(() => {
      this.connectPromise = undefined
    })
    return this.connectPromise
  }

  async getPortMetrics(ports: Port[] = [], lastKnown: AisDerivedPortMetric[] = []): Promise<AisDerivedPortMetric[]> {
    const configs = watchedPortAisAreaConfigs(ports)
    this.setDesiredConfigs(configs)
    if (!configs.length) {
      this.close()
      return []
    }
    try {
      await this.ensureConnected()
      if (this.initialObservationWaitMs > 0) await new Promise(resolve => setTimeout(resolve, this.initialObservationWaitMs))
      const now = this.now()
      this.pruneObservations(now)
      const fetchedAt = now.toISOString()
      const lastKnownByPort = new Map(lastKnown.filter(metric => metric.provenance?.sourceId === AIS_AREA_SOURCE_ID).map(metric => [metric.portId, metric]))
      const result = configs.map((config) => {
        const previous = this.metrics.get(config.portId) ?? lastKnownByPort.get(config.portId)
        const observations = [...this.observations.values()].filter(observation => observation.portId === config.portId)
        const metric = observations.length === 0 && previous?.sampleSize
          ? markMetricStale(previous, fetchedAt, "AIS area observations stale")
          : aggregateAisPortMetric(config, observations, {
              now: fetchedAt,
              previous,
              ttlMs: this.observationTtlMs,
              minimumSampleSize: this.minimumSampleSize,
              lowSpeedThresholdKnots: this.lowSpeedThresholdKnots,
              provenance: aisstreamAreaDerivedProvenance,
              observationProvenance: aisstreamAreaObservedProvenance,
              trendProvenance: aisstreamAreaEstimatedProvenance,
            })
        this.metrics.set(config.portId, metric)
        return metric
      })
      this.scheduleIdleClose()
      return result
    } catch (error) {
      const fetchedAt = this.now().toISOString()
      const lastKnownByPort = new Map(lastKnown.filter(metric => metric.provenance?.sourceId === AIS_AREA_SOURCE_ID).map(metric => [metric.portId, metric]))
      const stale = configs.map(config => lastKnownByPort.get(config.portId)).filter((metric): metric is AisDerivedPortMetric => metric !== undefined).map(metric => markMetricStale(metric, fetchedAt, sanitizeAreaError(error)))
      this.scheduleReconnect()
      if (stale.length) return stale
      throw new Error(sanitizeAreaError(error))
    }
  }

  close() {
    if (this.subscriptionTimer) clearTimeout(this.subscriptionTimer)
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    this.clearIdleTimer()
    this.desiredConfigs = []
    this.activeConfigs = []
    this.socketOpen = false
    try {
      this.socket?.close()
    } catch { /* Ignore close errors during shutdown. */ }
    this.socket = undefined
  }
}

export function createAisStreamAreaProvider(options: AisAreaSessionOptions): AisAreaProvider {
  const session = new AisAreaSession(options)
  return {
    getPortMetrics: (ports = [], lastKnown = []) => session.getPortMetrics(ports, lastKnown),
  }
}

export function createUnavailableAisAreaProvider(error: string): AisAreaProvider {
  return { async getPortMetrics() {
    throw new Error(error)
  } }
}

export const AisAreaProviderDefaults = {
  endpoint: aisAreaEndpoint,
  ttlMs: AIS_AREA_DEFAULT_TTL_MS,
  bucketMs: AIS_AREA_BUCKET_MS,
  maxObservations: AIS_AREA_MAX_OBSERVATIONS,
  minimumSampleSize: AIS_AREA_DEFAULT_MINIMUM_SAMPLE_SIZE,
  lowSpeedThresholdKnots: AIS_AREA_DEFAULT_LOW_SPEED_KNOTS,
}
