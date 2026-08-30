import type { Database } from "db0"
import type { ShippingDataMode } from "#/database/runtime"
import { AisPositionRepository } from "#/database/ais-positions"
import type { AisTrackingProvider, AisTrackingVessel } from "#/providers/ais/contracts"
import { AIS_TRACKING_CAPABILITY } from "#/providers/ais/contracts"
import { createVesselWatchlistService } from "#/search/vessel-watchlist"
import type { RuntimeJob } from "#/runtime/background-runtime"

export interface AisTrackingJobOptions {
  database: Database
  dataMode: ShippingDataMode
  provider: AisTrackingProvider
  intervalMs: number
  enabled?: boolean
  now?: () => Date
}

function warningDetails(unknownVesselCount: number, invalidCoordinateCount: number): { errorCode?: string, errorMessage?: string } {
  if (unknownVesselCount > 0) return { errorCode: "unknown_vessel_position", errorMessage: `${unknownVesselCount} provider position(s) did not match the watched MMSI set` }
  if (invalidCoordinateCount > 0) return { errorCode: "invalid_coordinate", errorMessage: `${invalidCoordinateCount} provider position(s) were rejected` }
  return {}
}

export function createAisTrackingJob(options: AisTrackingJobOptions): RuntimeJob {
  const watchlist = createVesselWatchlistService(options.database, options.dataMode)
  const positions = new AisPositionRepository(options.database, options.dataMode)
  const now = options.now ?? (() => new Date())
  return {
    id: "ais-tracking",
    providerId: options.provider.providerId,
    capability: AIS_TRACKING_CAPABILITY,
    intervalMs: options.intervalMs,
    enabled: options.enabled ?? true,
    run: async () => {
      const watched = await watchlist.list()
      const vessels: AisTrackingVessel[] = watched
        .filter(item => item.aisEnabled && item.aisTrackingAvailable && item.mmsi)
        .map(item => ({ vesselId: item.id, mmsi: item.mmsi! }))
      if (!vessels.length) {
        return {
          status: "skipped",
          recordsRead: 0,
          recordsWritten: 0,
          errorCode: "no_eligible_ais_targets",
          errorMessage: "No eligible watched vessel with valid MMSI",
        }
      }

      const received = await options.provider.getLatestPositions(vessels)
      const saved = await positions.savePositions(received, vessels, now().toISOString())
      const sourceUpdatedAt = [...received]
        .map(position => Date.parse(position.timestamp))
        .filter(timestamp => Number.isFinite(timestamp))
        .sort((a, b) => b - a)[0]
      return {
        status: "success",
        recordsRead: received.length,
        recordsWritten: saved.written,
        sourceUpdatedAt: sourceUpdatedAt === undefined ? undefined : new Date(sourceUpdatedAt).toISOString(),
        ...warningDetails(saved.unknownVesselCount, saved.invalidCoordinateCount),
      }
    },
  }
}
