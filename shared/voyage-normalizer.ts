import type { SourceLineage, Voyage } from "./shipping"
import { calculateDelayMinutes } from "./shipping-rules"
import type { VoyageRecord, VoyageStatus } from "./voyage"

export interface NormalizedVoyageFields {
  baselineEtd?: string | null
  baselineEta?: string | null
  latestEtd?: string | null
  latestEta?: string | null
  delayMinutes?: number | null
}

function normalizedString(value: string | null | undefined, fallback?: string): string | undefined {
  return value === undefined ? fallback : value ?? undefined
}

function legacyStatus(status: VoyageStatus, delayMinutes?: number): Voyage["status"] {
  if (status === "arrived" || status === "cancelled") return "arrived"
  if (delayMinutes !== undefined && delayMinutes > 0) return "delayed"
  if (status === "planned") return "planned"
  if (status === "unknown") return "unknown"
  return "in_transit"
}

export function voyageRecordToShippingVoyage(record: VoyageRecord, fields: NormalizedVoyageFields = {}): Voyage {
  const baselineEta = normalizedString(fields.baselineEta, record.eta)
  const baselineEtd = normalizedString(fields.baselineEtd, record.etd)
  const latestEta = normalizedString(fields.latestEta, record.eta)
  const latestEtd = normalizedString(fields.latestEtd, record.etd)
  const delayMinutes = fields.delayMinutes == null
    ? calculateDelayMinutes(baselineEta, latestEta)
    : fields.delayMinutes

  return {
    id: record.id,
    vesselId: record.vesselId,
    voyageNumber: record.voyageNumber,
    originPortId: record.originPortId,
    destinationPortId: record.destinationPortId,
    baselineEtd,
    baselineEta,
    baselineEtdSource: record.source,
    baselineEtaSource: record.source,
    latestEtd,
    latestEta,
    latestEtdSource: record.source,
    latestEtaSource: record.source,
    latestEtaObservedAt: record.lastUpdatedAt,
    delayMinutes,
    status: legacyStatus(record.status, delayMinutes),
    updatedAt: record.lastUpdatedAt,
    sourceUpdatedAt: record.lastUpdatedAt,
    stale: false,
    sourceStatus: "healthy",
    source_type: record.sourceType as SourceLineage,
  }
}

export function mergeNormalizedVoyageFields(voyage: Voyage, fields: NormalizedVoyageFields): Voyage {
  const baselineEta = normalizedString(fields.baselineEta, voyage.baselineEta)
  const baselineEtd = normalizedString(fields.baselineEtd, voyage.baselineEtd)
  const latestEta = normalizedString(fields.latestEta, voyage.latestEta)
  const latestEtd = normalizedString(fields.latestEtd, voyage.latestEtd)
  const delayMinutes = fields.delayMinutes == null
    ? calculateDelayMinutes(baselineEta, latestEta)
    : fields.delayMinutes

  return {
    ...voyage,
    baselineEtd,
    baselineEta,
    latestEtd,
    latestEta,
    delayMinutes,
  }
}
