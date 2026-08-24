import type { AisPosition, AisTrackingProvider, AisTrackingVessel } from "#/providers/ais/contracts"

function sampleCoordinate(mmsi: string, divisor: number, offset: number): number {
  const numeric = Number(mmsi.slice(-4)) || 0
  return offset + (numeric % 1000) / divisor
}

export function createMockAisTrackingProvider(now: () => Date = () => new Date()): AisTrackingProvider {
  return {
    providerId: "mock",
    async subscribe() {},
    async unsubscribe() {},
    async getLatestPositions(vessels: readonly AisTrackingVessel[]): Promise<readonly AisPosition[]> {
      const timestamp = now().toISOString()
      return vessels.map(vessel => ({
        vesselId: vessel.vesselId,
        mmsi: vessel.mmsi,
        latitude: sampleCoordinate(vessel.mmsi, 100, -5),
        longitude: sampleCoordinate(vessel.mmsi, 20, 100),
        speed: 10,
        course: 90,
        heading: 90,
        navigationStatus: "under_way",
        timestamp,
        source: "mock-ais",
        sourceType: "mock",
      }))
    },
  }
}
