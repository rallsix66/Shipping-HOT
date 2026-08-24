import process from "node:process"
import type { Database } from "db0"
import type { ShippingDataMode } from "#/database/runtime"
import type { AisTrackingProvider } from "#/providers/ais/contracts"
import { createAisTrackingProviderForDatabase } from "#/providers/ais"
import { createAisTrackingJob } from "#/runtime/ais-tracking-job"
import type { RuntimeJob } from "#/runtime/background-runtime"

export interface RuntimeRegistryOptions {
  database: Database
  dataMode: ShippingDataMode
  aisProvider?: AisTrackingProvider
  now?: () => Date
}

function intervalMs(): number {
  const minutes = Number(process.env.SHIPPING_AIS_INTERVAL_MINUTES ?? 15)
  return Math.max(1, Number.isFinite(minutes) ? minutes : 15) * 60 * 1000
}

export function getDefaultRuntimeJobs(options: RuntimeRegistryOptions): RuntimeJob[] {
  const providerId = process.env.SHIPPING_AIS_PROVIDER?.trim().toLowerCase() || "mock"
  const provider = options.aisProvider ?? createAisTrackingProviderForDatabase(options.database, {
    providerId,
    dataMode: options.dataMode,
    now: options.now,
  })
  return [createAisTrackingJob({
    database: options.database,
    dataMode: options.dataMode,
    provider,
    intervalMs: intervalMs(),
    enabled: !(options.dataMode === "real" && provider.providerId === "mock"),
    now: options.now,
  })]
}
