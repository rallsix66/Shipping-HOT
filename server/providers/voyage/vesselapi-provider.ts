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
  vessel?: {
    imo?: string | number
    mmsi?: string | number
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
  imo?: string
  mmsi?: string
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

function optionalIdentifier(value: unknown, pattern: RegExp, field: string): string | undefined {
  if (value === undefined || value === null || value === "") return undefined
  const candidate = typeof value === "number" && Number.isInteger(value) ? String(value) : typeof value === "string" ? value.trim() : ""
  if (!pattern.test(candidate)) throw new ProviderError("provider_contract_changed", `VesselAPI ${field} is invalid`, 200)
  return candidate
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
    imo: optionalIdentifier(eta.imo, /^\d{7}$/, "IMO"),
    mmsi: optionalIdentifier(eta.mmsi, /^\d{9}$/, "MMSI"),
  }
}

function parsePortEventResponse(value: unknown): PortEventObservation | undefined {
  const root = objectRecord(value)
  if (!root || !("portEvent" in root)) throw new ProviderError("provider_contract_changed", "VesselAPI port event response schema is invalid", 200)
  if (root.portEvent === null) return undefined
  const event = objectRecord(root.portEvent) as PortEventPayload | undefined
  if (!event) throw new ProviderError("provider_contract_changed", "VesselAPI port event response schema is invalid", 200)
  if (event.event !== "Arrival" && event.event !== "Departure") throw new ProviderError("provider_contract_changed", "VesselAPI port event type is invalid", 200)
  const vessel = event.vessel === undefined || event.vessel === null ? undefined : objectRecord(event.vessel)
  if (event.vessel !== undefined && event.vessel !== null && !vessel) throw new ProviderError("provider_contract_changed", "VesselAPI port event vessel identity is invalid", 200)
  const timestamp = optionalTimestamp(event.timestamp, "port event timestamp")
  if (!timestamp) throw new ProviderError("provider_contract_changed", "VesselAPI port event timestamp is missing", 200)
  return {
    event: event.event,
    timestamp,
    port: optionalString(event.port?.unlo_code ?? event.port?.unlocode, "port UN/LOCODE"),
    imo: optionalIdentifier(vessel?.imo, /^\d{7}$/, "port event IMO"),
    mmsi: optionalIdentifier(vessel?.mmsi, /^\d{9}$/, "port event MMSI"),
  }
}

function assertMatchingVesselIdentity(vessel: VoyageVesselIdentity, returned: { imo?: string, mmsi?: string }, idType: "imo" | "mmsi", source: string): void {
  if (vessel.imo && returned.imo && vessel.imo !== returned.imo) {
    throw new ProviderError("provider_contract_changed", `VesselAPI ${source} identity does not match the requested vessel`, 200)
  }
  if (vessel.mmsi && returned.mmsi && vessel.mmsi !== returned.mmsi) {
    throw new ProviderError("provider_contract_changed", `VesselAPI ${source} identity does not match the requested vessel`, 200)
  }
  const requestedIdentifier = idType === "imo" ? vessel.imo : vessel.mmsi
  const returnedIdentifier = idType === "imo" ? returned.imo : returned.mmsi
  if (returnedIdentifier && requestedIdentifier && returnedIdentifier !== requestedIdentifier) {
    throw new ProviderError("provider_contract_changed", `VesselAPI ${source} identity does not match the requested vessel`, 200)
  }
  if (!returned.imo && !returned.mmsi) {
    throw new ProviderError("provider_contract_changed", `VesselAPI ${source} identity is missing`, 200)
  }
  if (!((vessel.imo && returned.imo === vessel.imo) || (vessel.mmsi && returned.mmsi === vessel.mmsi))) {
    throw new ProviderError("provider_contract_changed", `VesselAPI ${source} identity does not match the requested vessel`, 200)
  }
}

function stableDestinationKey(destinationPort: string): string | undefined {
  const normalized = destinationPort.trim().toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "")
  return normalized || undefined
}

function episodeAnchor(timestamp: string): string | undefined {
  const parsed = Date.parse(timestamp)
  if (!Number.isFinite(parsed)) return undefined
  return new Date(parsed).toISOString().replace(/[.:-]/g, "")
}

export interface VoyageObservationParts {
  vessel: VoyageVesselIdentity
  eta: EtaObservation
  portEvent?: PortEventObservation
  resolvePortIdentity?: (value: string) => Promise<string | undefined>
}

export async function normalizeVesselApiVoyageObservation(parts: VoyageObservationParts): Promise<VoyageRecord | undefined> {
  const etaTimestamp = parts.eta.timestamp
  const eta = parts.eta.eta
  const destinationPort = parts.eta.destinationPort
  const destinationKey = destinationPort ? stableDestinationKey(destinationPort) : undefined
  if (!eta || !etaTimestamp || !destinationKey) return undefined
  const destinationPortId = destinationPort && parts.resolvePortIdentity
    ? await parts.resolvePortIdentity(destinationPort)
    : undefined
  const originPortId = parts.portEvent?.event === "Departure" && parts.portEvent.port && parts.resolvePortIdentity
    ? await parts.resolvePortIdentity(parts.portEvent.port)
    : undefined
  const anchor = episodeAnchor(etaTimestamp)
  if (!anchor) return undefined
  const id = `vesselapi:${parts.vessel.vesselId}:destination:${destinationKey}:episode:${anchor}`
  return {
    id,
    vesselId: parts.vessel.vesselId,
    imo: parts.vessel.imo ?? parts.eta.imo,
    mmsi: parts.vessel.mmsi ?? parts.eta.mmsi,
    originPortId,
    destinationPortId,
    voyageNumber: undefined,
    status: "unknown",
    eta,
    etd: undefined,
    source: "vesselapi",
    sourceType: "real",
    timestamp: etaTimestamp,
    lastUpdatedAt: etaTimestamp,
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
        assertMatchingVesselIdentity(vessel, eta, idType, "ETA")
        if (includeLastPortEvent) {
          try {
            const eventRequest = await request(`/portevents/vessel/${encodeURIComponent(id)}/last`, idType, apiKey)
            if (eventRequest.response.status !== 404) {
              const candidate = parsePortEventResponse(eventRequest.body)
              if (candidate) {
                try {
                  assertMatchingVesselIdentity(vessel, candidate, idType, "port event")
                  portEvent = candidate
                } catch {
                  portEvent = undefined
                }
              }
            }
          } catch {
            portEvent = undefined
          }
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
