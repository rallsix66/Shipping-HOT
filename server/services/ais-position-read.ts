import type { Database } from "db0"
import { type AisPositionRecord, AisPositionRepository } from "#/database/ais-positions"
import { RuntimeRepository } from "#/database/runtime-jobs"
import type { ShippingDataMode } from "#/database/runtime"
import type { ProviderRuntimeRecord } from "#/providers/contracts"
import { AIS_TRACKING_CAPABILITY } from "#/providers/ais/contracts"
import { getConfiguredAisProviderId } from "#/runtime/registry"

export interface AisPositionReadRecord extends AisPositionRecord {
  sourceStatus: ProviderRuntimeRecord["status"]
  errorCode?: string
  lastProviderSuccessAt?: string
  lastProviderFailureAt?: string
}

export interface AisPositionReadOptions {
  database: Database
  dataMode: ShippingDataMode
  vesselId: string
  now?: Date
  ttlMs?: number
}

async function currentRuntime(database: Database): Promise<ProviderRuntimeRecord | undefined> {
  const runtime = new RuntimeRepository(database)
  const configuredProviderId = getConfiguredAisProviderId()
  const configured = await runtime.getProviderRuntime(configuredProviderId, AIS_TRACKING_CAPABILITY)
  if (configured) return configured
  return (await runtime.listProviderRuntime()).find(record => record.capability === AIS_TRACKING_CAPABILITY && record.status !== "disabled")
}

export async function readAisLatestPosition(options: AisPositionReadOptions): Promise<AisPositionReadRecord | undefined> {
  const [position, runtime] = await Promise.all([
    new AisPositionRepository(options.database, options.dataMode).getLatestPosition(options.vesselId, options.now, options.ttlMs),
    currentRuntime(options.database),
  ])
  if (!position) return undefined
  return {
    ...position,
    sourceStatus: runtime?.status ?? "never_succeeded",
    errorCode: runtime?.errorCode,
    lastProviderSuccessAt: runtime?.lastSuccessAt,
    lastProviderFailureAt: runtime?.lastFailureAt,
  }
}
