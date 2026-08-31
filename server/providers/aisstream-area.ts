import type { AisAreaObservation, AisDerivedPortMetric, PortAisAreaConfig } from "@shared/ais-area"
import { AIS_AREA_BUCKET_MS, AIS_AREA_DEFAULT_LOW_SPEED_KNOTS, AIS_AREA_DEFAULT_MINIMUM_SAMPLE_SIZE, AIS_AREA_DEFAULT_TTL_MS, AIS_AREA_MAX_OBSERVATIONS, AIS_AREA_SOURCE_ID, aggregateAisPortMetric, aisAreaObservationTimestamp, assignAisAreaObservation, createPortAisAreaConfig, watchedPortAisAreaConfigs } from "@shared/ais-area"
import type { PortDirectoryCoordinateLookup } from "@shared/port-directory"
import type { DataProvenance, NavigationStatus, Port } from "@shared/shipping"
import { aisStreamProtocolError, aisStreamProviderError, mapAisStreamPosition, parseAisStreamMessage } from "#/providers/ais/aisstream-provider"
import { ProviderError } from "#/providers/contracts"

export const aisstreamAreaObservedProvenance: DataProvenance = { sourceType: "third_party", dataNature: "observed", sourceId: AIS_AREA_SOURCE_ID, sourceUrl: "https://aisstream.io/", verified: false }
export const aisstreamAreaDerivedProvenance: DataProvenance = { sourceType: "third_party", dataNature: "derived", sourceId: AIS_AREA_SOURCE_ID, sourceUrl: "https://aisstream.io/", verified: false }
export const aisstreamAreaEstimatedProvenance: DataProvenance = { sourceType: "third_party", dataNature: "estimated", sourceId: AIS_AREA_SOURCE_ID, sourceUrl: "https://aisstream.io/", verified: false }

export interface AisAreaProvider {
  readonly providerId: string
  getPortMetrics: (ports?: Port[], lastKnown?: AisDerivedPortMetric[]) => Promise<AisDerivedPortMetric[]>
  close: () => void | Promise<void>
  getStats?: () => AisAreaSessionStats
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
  apiKey?: string
  apiKeyResolver?: () => Promise<string | undefined>
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
  portDirectory?: PortDirectoryCoordinateLookup
}

export interface AisAreaSessionStats {
  socketOpened: number
  subscriptionsSent: number
  subscriptionBboxCount: number
  subscriptionConfirmations: number
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

function markMetricStale(metric: AisDerivedPortMetric, fetchedAt: string, error: string, errorCode?: string): AisDerivedPortMetric {
  return { ...metric, fetchedAt, stale: true, sourceStatus: "failed", coverage: "stale", error, errorCode: errorCode ?? metric.errorCode, provenance: metric.provenance?.sourceId === AIS_AREA_SOURCE_ID ? metric.provenance : aisstreamAreaDerivedProvenance, trendProvenance: aisstreamAreaEstimatedProvenance }
}

function canReconnect(error: ProviderError): boolean {
  return error.code !== "auth_failed" && error.code !== "provider_contract_changed"
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
    subscriptionConfirmations: 0,
    positionReportsReceived: 0,
    validPositionReports: 0,
    assignedPortSamples: 0,
    ambiguousSamples: 0,
    sourceTimestampPresent: 0,
  }

  private reconnectAttempt = 0
  private reconnectExhausted = false
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
  private readonly apiKey?: string
  private readonly apiKeyResolver?: () => Promise<string | undefined>
  private resolvedApiKey?: string
  private streamError?: ProviderError
  private generation = 0

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
    this.apiKey = options.apiKey
    this.apiKeyResolver = options.apiKeyResolver
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

  private async resolveApiKey(): Promise<string> {
    const apiKey = this.apiKey ?? this.resolvedApiKey ?? await this.apiKeyResolver?.()
    if (!apiKey) throw aisStreamProviderError(new Error("aisstream_api_key_missing"))
    this.resolvedApiKey = apiKey
    return apiKey
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
    if (!this.resolvedApiKey) throw aisStreamProviderError(new Error("aisstream_api_key_missing"))
    this.socket.send(JSON.stringify(aisAreaSubscription(this.resolvedApiKey, configs)))
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

    if (this.reconnectAttempt >= this.reconnectDelaysMs.length) {
      this.reconnectExhausted = true
      return
    }

    const delay = this.reconnectDelaysMs[this.reconnectAttempt]
    this.reconnectAttempt++
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined
      void this.ensureConnected().catch(() => {
        this.scheduleReconnect()
      })
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
        this.scheduleReconnect()
        return
      }
      const generation = ++this.generation
      this.socket = socket
      this.socketOpen = false
      this.streamError = undefined
      const finish = (error?: Error) => {
        if (settled) return
        settled = true
        if (timer) clearTimeout(timer)
        if (error) {
          const failure = aisStreamProviderError(error)
          reject(failure)
          if (canReconnect(failure)) this.scheduleReconnect()
        } else {
          resolve()
        }
      }
      timer = setTimeout(() => {
        if (!opened) {
          try {
            socket.close()
          } catch { /* Ignore close errors during timeout. */ }
          finish(new Error("aisstream_timeout"))
        }
      }, this.timeoutMs)
      socket.onopen = () => {
        if (this.socket !== socket || this.generation !== generation) {
          try {
            socket.close()
          } catch { /* Ignore stale socket close errors. */ }
          return
        }
        opened = true
        this.socketOpen = true
        this.stats.socketOpened++
        this.reconnectExhausted = false
        try {
          this.sendSubscription(this.desiredConfigs)
          finish()
        } catch (error) {
          const failure = aisStreamProviderError(error)
          this.streamError = failure
          this.socketOpen = false
          try {
            socket.close()
          } catch { /* Ignore close errors after subscription failure. */ }
          finish(failure)
        }
      }
      socket.onmessage = (event) => {
        const configsAtArrival = [...this.activeConfigs]
        void this.handleMessage(socket, generation, configsAtArrival, event.data).catch((error) => {
          this.handleStreamError(socket, generation, error)
        })
      }
      socket.onerror = (event) => {
        const error = aisStreamProviderError(event)
        this.streamError = error
        this.socketOpen = false
        if (!opened) finish(error)
        else if (canReconnect(error)) this.scheduleReconnect()
      }
      socket.onclose = () => {
        this.socketOpen = false
        if (this.socket !== socket || this.generation !== generation) return
        if (!opened) {
          finish(aisStreamProviderError(new Error("aisstream_connection_closed")))
        } else {
          this.streamError ??= aisStreamProviderError(new Error("aisstream_connection_closed"))
          if (canReconnect(this.streamError)) this.scheduleReconnect()
        }
      }
    }).finally(() => {
      this.connectPromise = undefined
    })
    return this.connectPromise
  }

  private isCurrentSocket(socket: AisAreaSocket, generation: number): boolean {
    return this.socket === socket && this.generation === generation && this.socketOpen
  }

  private async handleMessage(socket: AisAreaSocket, generation: number, configsAtArrival: PortAisAreaConfig[], data: unknown): Promise<void> {
    const message = await parseAisStreamMessage(data)
    if (!this.isCurrentSocket(socket, generation)) return
    if (!message) return
    if (message.MessageType === "SubscriptionConfirmation") {
      this.stats.subscriptionConfirmations++
      return
    }
    const protocolFailure = aisStreamProtocolError(message)
    if (protocolFailure) {
      this.handleStreamError(socket, generation, protocolFailure)
      return
    }
    if (message.MessageType === "PositionReport") this.stats.positionReportsReceived++
    const position = mapAisStreamPosition(message, this.now().toISOString())
    if (!position || !this.isCurrentSocket(socket, generation)) return
    this.stats.validPositionReports++
    this.stats.sourceTimestampPresent++
    const observation: Omit<AisAreaObservation, "portId" | "areaAmbiguous"> = {
      mmsi: position.mmsi,
      latitude: position.latitude,
      longitude: position.longitude,
      speed: position.speed,
      course: position.course,
      navigationStatus: (position.navigationStatus ?? "unknown") as NavigationStatus,
      sourceUpdatedAt: position.timestamp,
      fetchedAt: this.now().toISOString(),
    }
    const assigned = assignAisAreaObservation(observation, configsAtArrival)
    if (!assigned || !this.isCurrentSocket(socket, generation)) return
    this.stats.assignedPortSamples++
    if (assigned.areaAmbiguous) this.stats.ambiguousSamples++
    this.storeObservation(assigned)
    this.reconnectAttempt = 0
    this.reconnectExhausted = false
  }

  private handleStreamError(socket: AisAreaSocket, generation: number, error: unknown): void {
    if (!this.isCurrentSocket(socket, generation)) return
    this.streamError = aisStreamProviderError(error)
    this.socketOpen = false
    try {
      socket.close()
    } catch { /* Ignore close errors after a stream failure. */ }
    if (canReconnect(this.streamError)) this.scheduleReconnect()
  }

  private async resolvePortConfigs(ports: Port[]): Promise<PortAisAreaConfig[]> {
    if (!this.options.portDirectory) return watchedPortAisAreaConfigs(ports)
    const watched = ports.filter(port => port.isWatched && port.unlocode)
    const configs = await Promise.all(watched.map(async (port) => {
      const coordinate = await this.options.portDirectory!.getPortCoordinate(port.unlocode!)
      return coordinate ? createPortAisAreaConfig(port.id, coordinate) : undefined
    }))
    return configs.filter((config): config is PortAisAreaConfig => config !== undefined)
  }

  async getPortMetrics(ports: Port[] = [], lastKnown: AisDerivedPortMetric[] = []): Promise<AisDerivedPortMetric[]> {
    const configs = await this.resolvePortConfigs(ports)
    this.setDesiredConfigs(configs)
    if (!configs.length) {
      this.close()
      return []
    }
    if (this.reconnectExhausted && !this.socketOpen && !this.connectPromise && !this.reconnectTimer) {
      this.reconnectAttempt = 0
      this.reconnectExhausted = false
    }
    try {
      await this.resolveApiKey()
      await this.ensureConnected()
      if (this.initialObservationWaitMs > 0) await new Promise(resolve => setTimeout(resolve, this.initialObservationWaitMs))
      if (this.streamError) throw this.streamError
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
      const failure = aisStreamProviderError(error)
      const stale = configs.map(config => lastKnownByPort.get(config.portId)).filter((metric): metric is AisDerivedPortMetric => metric !== undefined).map(metric => markMetricStale(metric, fetchedAt, sanitizeAreaError(failure), failure.code))
      if (canReconnect(failure)) this.scheduleReconnect()
      if (stale.length) return stale
      throw failure
    }
  }

  close() {
    if (this.subscriptionTimer) clearTimeout(this.subscriptionTimer)
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    this.clearIdleTimer()
    this.subscriptionTimer = undefined
    this.reconnectTimer = undefined
    this.desiredConfigs = []
    this.activeConfigs = []
    this.streamError = undefined
    this.generation++
    this.socketOpen = false
    this.reconnectAttempt = 0
    this.reconnectExhausted = false
    try {
      this.socket?.close()
    } catch { /* Ignore close errors during shutdown. */ }
    this.socket = undefined
  }
}

export function createAisStreamAreaProvider(options: AisAreaSessionOptions): AisAreaProvider {
  const session = new AisAreaSession(options)
  return {
    providerId: "aisstream-area",
    getPortMetrics: (ports = [], lastKnown = []) => session.getPortMetrics(ports, lastKnown),
    close: () => session.close(),
    getStats: () => session.liveStats,
  }
}

export function createUnavailableAisAreaProvider(error: string): AisAreaProvider {
  return {
    providerId: "unavailable",
    async getPortMetrics() {
      const failure = aisStreamProviderError(new Error(error))
      throw new ProviderError(failure.code, error, failure.status)
    },
    close: () => undefined,
    getStats: () => ({ socketOpened: 0, subscriptionsSent: 0, subscriptionBboxCount: 0, subscriptionConfirmations: 0, positionReportsReceived: 0, validPositionReports: 0, assignedPortSamples: 0, ambiguousSamples: 0, sourceTimestampPresent: 0, distinctMmsi: 0 }),
  }
}

export const AisAreaProviderDefaults = {
  endpoint: aisAreaEndpoint,
  ttlMs: AIS_AREA_DEFAULT_TTL_MS,
  bucketMs: AIS_AREA_BUCKET_MS,
  maxObservations: AIS_AREA_MAX_OBSERVATIONS,
  minimumSampleSize: AIS_AREA_DEFAULT_MINIMUM_SAMPLE_SIZE,
  lowSpeedThresholdKnots: AIS_AREA_DEFAULT_LOW_SPEED_KNOTS,
}
