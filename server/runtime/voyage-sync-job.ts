import type { Database } from "db0"
import type { ShippingDataMode } from "#/database/runtime"
import { VoyageRepository } from "#/database/voyages"
import type { VoyageProvider } from "#/providers/voyage/contracts"
import { VOYAGE_SYNC_CAPABILITY } from "#/providers/voyage/contracts"
import { createVesselWatchlistService } from "#/search/vessel-watchlist"
import type { RuntimeJob } from "#/runtime/background-runtime"

export interface VoyageSyncJobOptions {
  database: Database
  dataMode: ShippingDataMode
  provider: VoyageProvider
  intervalMs: number
  enabled?: boolean
  now?: () => Date
}

export function createVoyageSyncJob(options: VoyageSyncJobOptions): RuntimeJob {
  const watchlist = createVesselWatchlistService(options.database, options.dataMode)
  const voyages = new VoyageRepository(options.database, options.dataMode)
  const now = options.now ?? (() => new Date())
  return {
    id: "voyage-sync",
    providerId: options.provider.providerId,
    capability: VOYAGE_SYNC_CAPABILITY,
    intervalMs: options.intervalMs,
    enabled: options.enabled ?? true,
    run: async () => {
      const watched = await watchlist.list()
      const vessels = watched
        .filter(item => Boolean(item.imo || item.mmsi))
        .map(item => ({ vesselId: item.id, imo: item.imo, mmsi: item.mmsi }))
      if (!vessels.length) return { status: "skipped", recordsRead: 0, recordsWritten: 0, errorCode: "no_eligible_voyage_targets", errorMessage: "No watched vessels have an IMO or MMSI for Voyage/ETA lookup" }
      const received = await options.provider.getVoyages(vessels)
      if (!received.length) return { status: "skipped", recordsRead: 0, recordsWritten: 0, errorCode: "no_voyage_eta_observed", errorMessage: "No VesselAPI ETA observation was available for eligible watched vessels" }
      const saved = await voyages.saveVoyages(received, now().toISOString(), { requestedVesselIds: vessels.map(vessel => vessel.vesselId) })
      const sourceUpdatedAt = saved.acceptedSourceUpdatedAt
        .map(timestamp => Date.parse(timestamp))
        .filter(timestamp => Number.isFinite(timestamp))
        .sort((a, b) => b - a)[0]
      if (sourceUpdatedAt === undefined) {
        const errorCode = saved.episodeStaleSkipped > 0
          ? "stale_voyage_episode_observation"
          : saved.episodeTransitionConflicts > 0
            ? "voyage_episode_transition_conflict"
            : "no_voyage_eta_observed"
        return { status: "skipped", recordsRead: received.length, recordsWritten: 0, errorCode, errorMessage: "No accepted VesselAPI ETA observation was available" }
      }
      return {
        status: "success",
        recordsRead: received.length,
        recordsWritten: saved.historyWritten,
        sourceUpdatedAt: new Date(sourceUpdatedAt).toISOString(),
      }
    },
  }
}
