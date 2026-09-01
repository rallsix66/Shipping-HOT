import type { SourceLineage } from "./shipping"

export const VOYAGE_SYNC_CAPABILITY = "voyage_sync"

export type VoyageStatus = "planned" | "departed" | "in_transit" | "arrived" | "cancelled" | "unknown"

export interface VoyageVesselIdentity {
  vesselId: string
  imo?: string
  mmsi?: string
}

export interface VoyageRecord extends VoyageVesselIdentity {
  id: string
  originPortId?: string
  destinationPortId?: string
  voyageNumber?: string
  status: VoyageStatus
  eta?: string
  etd?: string
  source: string
  sourceType: SourceLineage
  timestamp: string
  lastUpdatedAt: string
}

export interface VoyageEtaHistoryRecord {
  id: string
  voyageId: string
  vesselId: string
  eta?: string
  etd?: string
  source: string
  sourceType: SourceLineage
  observedAt: string
  createdAt: string
}
