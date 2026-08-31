import type { AisLiveStreamHandle, AisLiveStreamOptions, AisLiveStreamProvider } from "#/providers/ais/contracts"
import { AISSTREAM_DEFAULT_CONNECTION_TIMEOUT_MS, AISSTREAM_MAX_MMSI_PER_REQUEST, aisStreamBoundingBoxes, aisStreamEndpoint, aisStreamProtocolError, aisStreamProviderError, createAisStreamSocket, mapAisStreamPosition, parseAisStreamMessage } from "#/providers/ais/aisstream-provider"
import type { AisStreamSocket } from "#/providers/ais/aisstream-provider"

export interface AisStreamLiveProviderOptions {
  apiKey?: string
  apiKeyResolver?: () => Promise<string | undefined>
  endpoint?: string
  socketFactory?: (endpoint: string) => AisStreamSocket
  connectionTimeoutMs?: number
}

interface LiveSocketState {
  socket: AisStreamSocket
  confirmed: boolean
  closed: boolean
  connectionTimer?: ReturnType<typeof setTimeout>
}

function stableBatches(options: AisLiveStreamOptions): AisLiveStreamOptions["vessels"][] {
  const unique = new Map<string, AisLiveStreamOptions["vessels"][number]>()
  for (const vessel of options.vessels) {
    const current = unique.get(vessel.mmsi)
    if (!current || vessel.vesselId.localeCompare(current.vesselId) < 0) unique.set(vessel.mmsi, vessel)
  }
  const ordered = [...unique.values()].sort((left, right) => left.mmsi.localeCompare(right.mmsi) || left.vesselId.localeCompare(right.vesselId))
  const batches: AisLiveStreamOptions["vessels"][] = []
  for (let offset = 0; offset < ordered.length; offset += AISSTREAM_MAX_MMSI_PER_REQUEST) {
    batches.push(ordered.slice(offset, offset + AISSTREAM_MAX_MMSI_PER_REQUEST))
  }
  return batches
}

function validConnectionTimeout(value: number | undefined): number {
  return value !== undefined && Number.isFinite(value) && value > 0 ? value : AISSTREAM_DEFAULT_CONNECTION_TIMEOUT_MS
}

export class AisStreamLiveProvider implements AisLiveStreamProvider {
  readonly providerId = "aisstream"
  private readonly apiKey?: string
  private readonly apiKeyResolver?: () => Promise<string | undefined>
  private readonly endpoint: string
  private readonly socketFactory: (endpoint: string) => AisStreamSocket
  private readonly connectionTimeoutMs: number

  constructor(options: AisStreamLiveProviderOptions = {}) {
    this.apiKey = options.apiKey
    this.apiKeyResolver = options.apiKeyResolver
    this.endpoint = options.endpoint ?? aisStreamEndpoint
    this.socketFactory = options.socketFactory ?? createAisStreamSocket
    this.connectionTimeoutMs = validConnectionTimeout(options.connectionTimeoutMs)
  }

  async openStream(options: AisLiveStreamOptions): Promise<AisLiveStreamHandle> {
    const apiKey = this.apiKey ?? await this.apiKeyResolver?.()
    if (!apiKey) throw aisStreamProviderError(new Error("aisstream_api_key_missing"))
    const batches = stableBatches(options)
    if (!batches.length) return { socketCount: 0, confirmedSocketCount: 0, close: async () => undefined }

    const states: LiveSocketState[] = []
    let closed = false
    let closePromise: Promise<void> | undefined

    const terminate = (error?: Error): Promise<void> => {
      if (closePromise) return closePromise
      closed = true
      closePromise = (async () => {
        for (const state of states) {
          state.closed = true
          if (state.connectionTimer) clearTimeout(state.connectionTimer)
          state.socket.onopen = null
          state.socket.onmessage = null
          state.socket.onerror = null
          state.socket.onclose = null
          try {
            state.socket.close()
          } catch {
            // Ignore close errors while terminating the stream.
          }
        }
        if (error) await options.callbacks.onError?.(error)
        await options.callbacks.onClose?.(error)
      })()
      return closePromise
    }

    const fail = (error: unknown) => {
      void terminate(error instanceof Error ? error : aisStreamProviderError(error)).catch(() => undefined)
    }

    try {
      for (const batch of batches) {
        const socket = this.socketFactory(this.endpoint)
        const state: LiveSocketState = { socket, confirmed: false, closed: false }
        states.push(state)
        state.connectionTimer = setTimeout(() => {
          if (!state.closed) fail(new Error("aisstream_timeout"))
        }, this.connectionTimeoutMs)
        socket.onopen = () => {
          if (closed || state.closed) return
          if (state.connectionTimer) clearTimeout(state.connectionTimer)
          try {
            socket.send(JSON.stringify({
              APIKey: apiKey,
              BoundingBoxes: aisStreamBoundingBoxes,
              FiltersShipMMSI: batch.map(vessel => vessel.mmsi),
              FilterMessageTypes: ["PositionReport"],
            }))
          } catch (error) {
            fail(error)
          }
        }
        socket.onmessage = (event) => {
          void (async () => {
            if (closed || state.closed) return
            const message = await parseAisStreamMessage(event.data)
            if (!message) return
            if (message.MessageType === "SubscriptionConfirmation") {
              state.confirmed = true
              await options.callbacks.onSubscriptionConfirmed?.()
              return
            }
            const protocolFailure = aisStreamProtocolError(message)
            if (protocolFailure) {
              await terminate(aisStreamProviderError(protocolFailure))
              return
            }
            const position = mapAisStreamPosition(message, new Date().toISOString())
            if (!position || !batch.some(vessel => vessel.mmsi === position.mmsi)) return
            await options.callbacks.onPosition(position)
          })().catch(fail)
        }
        socket.onerror = event => fail(event)
        socket.onclose = () => {
          if (!closed && !state.closed) fail(new Error("aisstream_connection_closed"))
        }
      }
    } catch (error) {
      await terminate(aisStreamProviderError(error))
      throw aisStreamProviderError(error)
    }

    return {
      get socketCount() {
        return states.filter(state => !state.closed).length
      },
      get confirmedSocketCount() {
        return states.filter(state => !state.closed && state.confirmed).length
      },
      close: async () => {
        await terminate()
      },
    }
  }
}

export function createAisStreamLiveProvider(options: AisStreamLiveProviderOptions = {}): AisLiveStreamProvider {
  return new AisStreamLiveProvider(options)
}
