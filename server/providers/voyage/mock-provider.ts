import type { VoyageRecord, VoyageVesselIdentity } from "@shared/voyage"
import type { PortDirectoryRepository } from "#/database/port-directory"
import type { VoyageProvider } from "#/providers/voyage/contracts"

export interface MockVoyageProviderOptions {
  portDirectory: Pick<PortDirectoryRepository, "resolvePortIdentity">
  now?: () => Date
}

export function createMockVoyageProvider(options: MockVoyageProviderOptions): VoyageProvider {
  const now = options.now ?? (() => new Date())
  return {
    providerId: "mock-voyage",
    async getVoyages(vessels: readonly VoyageVesselIdentity[]): Promise<readonly VoyageRecord[]> {
      const originPortId = await options.portDirectory.resolvePortIdentity("Shekou")
      const destinationPortId = await options.portDirectory.resolvePortIdentity("Manila")
      if (!originPortId || !destinationPortId) throw new Error("voyage_port_identity_unavailable")
      const timestamp = now().toISOString()
      const eta = new Date(now().getTime() + 72 * 60 * 60 * 1000).toISOString()
      const etd = new Date(now().getTime() - 2 * 60 * 60 * 1000).toISOString()
      return vessels.map((vessel, index) => ({
        id: `mock-voyage:${vessel.vesselId}:${index + 1}`,
        vesselId: vessel.vesselId,
        imo: vessel.imo,
        mmsi: vessel.mmsi,
        originPortId,
        destinationPortId,
        voyageNumber: `MOCK-${String(index + 1).padStart(3, "0")}`,
        status: "in_transit",
        eta,
        etd,
        source: "mock-voyage",
        sourceType: "mock",
        timestamp,
        lastUpdatedAt: timestamp,
      }))
    },
  }
}
