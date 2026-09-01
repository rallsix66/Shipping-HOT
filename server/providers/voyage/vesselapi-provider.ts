import type { VoyageRecord, VoyageVesselIdentity } from "@shared/voyage"
import type { PortDirectoryRepository } from "#/database/port-directory"
import { ProviderError, providerErrorFromUnknown, providerHttpError } from "#/providers/contracts"
import type { VoyageProvider } from "#/providers/voyage/contracts"

const defaultEndpoint = "https://api.vesselapi.com/v1"

type Fetcher = (input: string, init?: RequestInit) => Promise<Response>

interface VesselEtaPayload {
  destination?: string
  destination_port?: string
  eta?: string
  timestamp?: string
  imo?: string | number
  mmsi?: string | number
  vessel_name?: string
  draught?: number
}

interface PortEventPayload {
  event?: string
  timestamp?: string
  port?: {
    unlo_code?: string
    unlocode?: string
    name?: string
  }
}

interface EtaObservation {
  eta?: string
  timestamp?: string
  destinationPort?: string
  imo?: string
  mmsi?: string
}

interface PortEventObservation {
  event: "Arrival" | "Departure"
  timestamp?: string
  port?: string
}

export interface VesselApiVoyageProviderOptions {
  apiKey?: string
  apiKeyResolver?: () => Promise<string | undefined>
  endpoint?: string
  timeoutMs?: number
  fetcher?: Fetcher
  portDirectory?: Pick<PortDirectoryRepository, "resolvePortIdentity">
  includeLastPortEvent?: boolean
}

function objectRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}

function optionalIdentifier(value: unknown, pattern: RegExp): string | undefined {
  const candidate = typeof value === "number" && Number.isInteger(value) ? String(value) : typeof value === "string" ? value.trim() : ""
  return pattern.test(candidate) ? candidate : undefined
}

function optionalTimestamp(value: unknown, field: string): string | undefined {
  if (value === undefined || value === null || value === "") return undefined
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) throw new ProviderError("provider_contract_changed", `VesselAPI ${field} is invalid`, 200)
  return new Date(value).toISOString()
}

function optionalString(value: unknown, field: string): string | undefined {
  if (value === undefined || value === null || value === "") return undefined
  if (typeof value !== "string") throw new ProviderError("provider_contract_changed", `VesselAPI ${field} is invalid`, 200)
  return value.trim() || undefined
}

function errorContext(value: unknown): Record<string, unknown> | undefined {
  const root = objectRecord(value)
  const error = objectRecord(root?.error)
  if (!error) return undefined
  return {
    code: typeof error.code === "string" ? error.code : undefined,
    message: typeof error.message === "string" ? error.message : undefined,
  }
}

function parseEtaResponse(value: unknown): EtaObservation | undefined {
  const root = objectRecord(value)
  if (!root || !("vesselEta" in root)) throw new ProviderError("provider_contract_changed", "VesselAPI ETA response schema is invalid", 200)
  if (root.vesselEta === null) return undefined
  const eta = objectRecord(root.vesselEta) as VesselEtaPayload | undefined
  if (!eta) throw new ProviderError("provider_contract_changed", "VesselAPI ETA response schema is invalid", 200)
  const etaValue = optionalTimestamp(eta.eta, "ETA")
  if (!etaValue) return undefined
  return {
    eta: etaValue,
    timestamp: optionalTimestamp(eta.timestamp, "timestamp"),
    destinationPort: optionalString(eta.destination_port, "destination_port"),
    imo: optionalIdentifier(eta.imo, /^\d{7}$/),
    mmsi: optionalIdentifier(eta.mmsi, /^\d{9}$/),
  }
}

function parsePortEventResponse(value: unknown): PortEventObservation | undefined {
  const root = objectRecord(value)
  if (!root || !("portEvent" in root)) throw new ProviderError("provider_contract_changed", "VesselAPI port event response schema is invalid", 200)
  if (root.portEvent === null) return undefined
  const event = objectRecord(root.portEvent) as PortEventPayload | undefined
  if (!event) throw new ProviderError("provider_contract_changed", "VesselAPI port event response schema is invalid", 200)
  if (event.event !== "Arrival" && event.event !== "Departure") throw new ProviderError("provider_contract_changed", "VesselAPI port event type is invalid", 200)
  return {
    event: event.event,
    timestamp: optionalTimestamp(event.timestamp, "port event timestamp"),
    port: optionalString(event.port?.unlo_code ?? event.port?.unlocode, "port UN/LOCODE"),
  }
}

function latestTimestamp(...values: (string | undefined)[]): string | undefined {
  return values
    .filter((value): value is string => value !== undefined)
    .sort((left, right) => Date.parse(right) - Date.parse(left))[0]
}

export interface VoyageObservationParts {
  vessel: VoyageVesselIdentity
  eta: EtaObservation
  portEvent?: PortEventObservation
  resolvePortIdentity?: (value: string) => Promise<string | undefined>
}

export async function normalizeVesselApiVoyageObservation(parts: VoyageObservationParts): Promise<VoyageRecord | undefined> {
  const lastUpdatedAt = latestTimestamp(parts.eta.timestamp, parts.portEvent?.timestamp)
  if (!lastUpdatedAt) return undefined
  const destinationPortId = parts.eta.destinationPort && parts.resolvePortIdentity
    ? await parts.resolvePortIdentity(parts.eta.destinationPort)
    : undefined
  const originPortId = parts.portEvent?.event === "Departure" && parts.portEvent.port && parts.resolvePortIdentity
    ? await parts.resolvePortIdentity(parts.portEvent.port)
    : undefined
  const departureTimestamp = parts.portEvent?.event === "Departure" ? parts.portEvent.timestamp : undefined
  const id = parts.portEvent?.event === "Departure" && departureTimestamp && parts.portEvent.port
    ? `vesselapi:${parts.vessel.vesselId}:departure:${parts.portEvent.port}:${departureTimestamp}`
    : `vesselapi:${parts.vessel.vesselId}:eta:${lastUpdatedAt}`
  return {
    id,
    vesselId: parts.vessel.vesselId,
    imo: parts.vessel.imo ?? parts.eta.imo,
    mmsi: parts.vessel.mmsi ?? parts.eta.mmsi,
    originPortId,
    destinationPortId,
    voyageNumber: undefined,
    status: "unknown",
    eta: parts.eta.eta,
    etd: undefined,
    source: "vesselapi",
    sourceType: "real",
    timestamp: lastUpdatedAt,
    lastUpdatedAt,
  }
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json() as unknown
  } catch {
    return undefined
  }
}

export function createVesselApiVoyageProvider(options: VesselApiVoyageProviderOptions): VoyageProvider {
  const endpoint = (options.endpoint ?? defaultEndpoint).replace(/\/$/, "")
  const timeoutMs = Math.max(1, options.timeoutMs ?? 10_000)
  const fetcher = options.fetcher ?? ((input, init) => fetch(input, init))
  const resolveApiKey = options.apiKeyResolver ?? (async () => options.apiKey)
  const includeLastPortEvent = options.includeLastPortEvent ?? true

  async function request(path: string, idType: "imo" | "mmsi", apiKey: string): Promise<{ response: Response, body: unknown }> {
    const url = new URL(`${endpoint}${path}`)
    url.searchParams.set("filter.idType", idType)
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const response = await fetcher(url.toString(), {
        headers: { Accept: "application/json", Authorization: `Bearer ${apiKey}` },
        signal: controller.signal,
      })
      const body = await readJson(response)
      if (!response.ok) {
        if (response.status === 404) return { response, body }
        throw providerHttpError("VesselAPI", response.status, `VesselAPI request failed (${response.status})`, errorContext(body))
      }
      return { response, body }
    } catch (error) {
      if (controller.signal.aborted) throw new ProviderError("provider_timeout", "VesselAPI request timed out")
      throw providerErrorFromUnknown("VesselAPI", error)
    } finally {
      clearTimeout(timer)
    }
  }

  return {
    providerId: "vesselapi",
    async getVoyages(vessels) {
      const apiKey = (await resolveApiKey())?.trim()
      if (!apiKey) throw new ProviderError("auth_failed", "VESSELAPI_API_KEY missing")
      const results: VoyageRecord[] = []
      for (const vessel of vessels) {
        const idType = vessel.imo ? "imo" : vessel.mmsi ? "mmsi" : undefined
        const id = vessel.imo ?? vessel.mmsi
        if (!idType || !id) continue
        const etaRequest = await request(`/vessel/${encodeURIComponent(id)}/eta`, idType, apiKey)
        if (etaRequest.response.status === 404) continue
        const eta = parseEtaResponse(etaRequest.body)
        if (!eta) continue
        let portEvent: PortEventObservation | undefined
        if (includeLastPortEvent) {
          const eventRequest = await request(`/portevents/vessel/${encodeURIComponent(id)}/last`, idType, apiKey)
          if (eventRequest.response.status !== 404) portEvent = parsePortEventResponse(eventRequest.body)
        }
        const normalized = await normalizeVesselApiVoyageObservation({
          vessel,
          eta,
          portEvent,
          resolvePortIdentity: options.portDirectory?.resolvePortIdentity,
        })
        if (normalized) results.push(normalized)
      }
      return results
    },
  }
}
