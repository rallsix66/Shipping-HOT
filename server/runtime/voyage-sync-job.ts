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
      const vessels = watched.map(item => ({ vesselId: item.id, imo: item.imo, mmsi: item.mmsi }))
      if (!vessels.length) return { status: "success", recordsRead: 0, recordsWritten: 0 }
      const received = await options.provider.getVoyages(vessels)
      const saved = await voyages.saveVoyages(received, now().toISOString())
      const sourceUpdatedAt = [...received]
        .map(voyage => Date.parse(voyage.lastUpdatedAt))
        .filter(timestamp => Number.isFinite(timestamp))
        .sort((a, b) => b - a)[0]
      return {
        status: "success",
        recordsRead: received.length,
        recordsWritten: saved.historyWritten,
        sourceUpdatedAt: sourceUpdatedAt === undefined ? undefined : new Date(sourceUpdatedAt).toISOString(),
      }
    },
  }
}
