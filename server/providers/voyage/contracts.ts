import type { VoyageRecord, VoyageVesselIdentity } from "@shared/voyage"

export { VOYAGE_SYNC_CAPABILITY } from "@shared/voyage"
export type { VoyageRecord, VoyageStatus, VoyageVesselIdentity } from "@shared/voyage"

export interface VoyageProvider {
  readonly providerId: string
  getVoyages: (vessels: readonly VoyageVesselIdentity[]) => Promise<readonly VoyageRecord[]>
}
