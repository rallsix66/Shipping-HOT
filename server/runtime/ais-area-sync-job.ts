import type { Database } from "db0"
import { AIS_AREA_SOURCE_ID } from "@shared/ais-area"
import type { ShippingDataMode } from "#/database/runtime"
import { ShippingRepository } from "#/database/shipping"
import type { AisAreaProvider } from "#/providers/aisstream-area"
import type { RuntimeJob } from "#/runtime/background-runtime"

const aisAreaProviderFailureCodes = new Set([
  "auth_failed",
  "entitlement_missing",
  "provider_forbidden",
  "rate_limited",
  "provider_timeout",
  "provider_unavailable",
  "provider_contract_changed",
])

export interface AisAreaSyncJobOptions {
  database: Database
  dataMode: ShippingDataMode
  provider: AisAreaProvider
  intervalMs: number
  enabled?: boolean
}

function isAisAreaProviderFailureMetric(metric: Pick<AisDerivedPortMetric, "sourceStatus" | "errorCode">): boolean {
  return metric.sourceStatus === "failed" && typeof metric.errorCode === "string" && aisAreaProviderFailureCodes.has(metric.errorCode)
}

function hasCurrentAisAreaObservation(metric: AisDerivedPortMetric): boolean {
  return metric.sampleSize > 0
    && !metric.stale
    && metric.sourceStatus !== "failed"
    && metric.coverage !== "no_observation"
    && metric.sourceUpdatedAt !== undefined
    && Number.isFinite(Date.parse(metric.sourceUpdatedAt))
}

function latestSourceUpdatedAt(metrics: readonly AisDerivedPortMetric[]): string | undefined {
  return metrics
    .filter(hasCurrentAisAreaObservation)
    .map(metric => metric.sourceUpdatedAt)
    .filter((value): value is string => value !== undefined && Number.isFinite(Date.parse(value)))
    .sort((left, right) => Date.parse(right) - Date.parse(left))[0]
}

export function createAisAreaSyncJob(options: AisAreaSyncJobOptions): RuntimeJob {
  const repository = new ShippingRepository(options.database, options.dataMode)
  return {
    id: "ais-area-sync",
    providerId: options.provider.providerId,
    capability: "ais_area",
    intervalMs: options.intervalMs,
    enabled: options.enabled ?? true,
    run: async () => {
      const ports = (await repository.listPorts()).filter(port => port.isWatched && Boolean(port.unlocode))
      if (!ports.length) return { status: "skipped", recordsRead: 0, recordsWritten: 0, errorCode: "no_eligible_ais_area_ports" }

      const lastKnown = await repository.listAisPortMetrics()
      const metrics = await options.provider.getPortMetrics(ports, lastKnown)
      const failed = metrics.filter(isAisAreaProviderFailureMetric)
      const observed = metrics.filter(hasCurrentAisAreaObservation)
      const recordsRead = observed.reduce((total, metric) => total + metric.sampleSize, 0)
      for (const metric of metrics) await repository.upsertAisPortMetric(metric)
      if (failed.length) {
        const first = failed[0]
        return {
          status: "failed" as const,
          recordsRead,
          recordsWritten: metrics.length,
          sourceUpdatedAt: latestSourceUpdatedAt(observed),
          errorCode: first.errorCode ?? "provider_unavailable",
          errorMessage: first.error ?? "AIS area provider failed",
        }
      }

      if (!observed.length) return { status: "skipped", recordsRead: 0, recordsWritten: metrics.length, errorCode: "no_ais_area_observation" }

      return {
        status: "success" as const,
        recordsRead,
        recordsWritten: metrics.length,
        sourceUpdatedAt: latestSourceUpdatedAt(observed),
      }
    },
  }
}

export const AIS_AREA_SYNC_CAPABILITY = "ais_area"
export const AIS_AREA_SYNC_SOURCE_ID = AIS_AREA_SOURCE_ID
