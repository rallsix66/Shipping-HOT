import type { Database } from "db0"
import { portDirectoryBaseline } from "@shared/port-directory"
import type { ShippingDataMode } from "#/database/runtime"
import { ShippingRepository } from "#/database/shipping"
import { JMA_TYPHOON_SOURCE_ID, syncJmaTropicalCyclones } from "#/providers/jma-tropical-cyclone"
import type { RuntimeJob } from "#/runtime/background-runtime"

export const TROPICAL_CYCLONE_SYNC_CAPABILITY = "tropical_cyclone_sync" as const

export interface TropicalCycloneSyncJobOptions {
  database: Database
  dataMode: ShippingDataMode
  intervalMs: number
  enabled?: boolean
  now?: () => Date
  fetcher?: (url: string) => Promise<Response>
  repository?: ShippingRepository
  useLiveJma?: boolean
}

export function createTropicalCycloneSyncJob(options: TropicalCycloneSyncJobOptions): RuntimeJob {
  const repository = options.repository ?? new ShippingRepository(options.database, options.dataMode)
  const now = options.now ?? (() => new Date())
  const fetcher = options.fetcher ?? fetch
  const useLive = options.useLiveJma ?? options.dataMode === "real"
  return {
    id: "tropical-cyclone-sync",
    providerId: JMA_TYPHOON_SOURCE_ID,
    capability: TROPICAL_CYCLONE_SYNC_CAPABILITY,
    intervalMs: options.intervalMs,
    enabled: options.enabled ?? useLive,
    run: async () => {
      if (!useLive) {
        await repository.saveTropicalCycloneSyncMeta({
          sourceId: JMA_TYPHOON_SOURCE_ID,
          outcome: "not_run",
        })
        return { status: "skipped", recordsRead: 0, recordsWritten: 0 }
      }
      const result = await syncJmaTropicalCyclones(fetcher, now())
      if (result.outcome === "failed") {
        await repository.saveTropicalCycloneSyncMeta({
          sourceId: JMA_TYPHOON_SOURCE_ID,
          lastCheckedAt: result.fetchedAt,
          outcome: "failed",
          errorCode: result.errorCode,
          errorMessage: result.errorMessage,
        })
        return {
          status: "failed",
          recordsRead: 0,
          recordsWritten: 0,
          errorCode: result.errorCode,
          errorMessage: result.errorMessage,
        }
      }
      const ports = portDirectoryBaseline.map(row => ({
        portId: row.shippingPortId,
        unlocode: row.unlocode,
        latitude: row.latitude,
        longitude: row.longitude,
      }))
      await repository.replaceTropicalCyclones(result.cyclones, {
        sourceId: JMA_TYPHOON_SOURCE_ID,
        lastCheckedAt: result.fetchedAt,
        outcome: result.outcome,
      }, ports)
      return {
        status: "success",
        recordsRead: result.cyclones.length,
        recordsWritten: result.cyclones.length,
        sourceUpdatedAt: result.fetchedAt,
      }
    },
  }
}
