import process from "node:process"
import { initShippingTables } from "#/database/shipping"
import { getAisLiveTracker, getBackgroundRuntime, hasBackgroundRuntimeBootstrapFailed } from "#/runtime/bootstrap"
import { readV3Readiness } from "#/services/v3-readiness"

export default defineEventHandler(async () => {
  const dataMode = process.env.SHIPPING_DATA_MODE === "real" ? "real" : "mock"
  const database = useDatabase()
  await initShippingTables(database, dataMode)
  const runtime = getBackgroundRuntime()
  const runtimeStatus = runtime?.getStatus()
  const aisLiveTracker = getAisLiveTracker()?.getStatus()
  const runtimeSnapshot = runtimeStatus && {
    running: runtimeStatus.running,
    jobs: runtimeStatus.jobs.map(job => ({
      id: job.id,
      providerId: job.providerId,
      capability: job.capability,
      enabled: job.enabled,
      status: job.status,
      lastSuccessAt: job.lastSuccessAt,
      lastSourceUpdatedAt: job.lastSourceUpdatedAt,
      nextSyncAt: job.nextSyncAt,
    })),
    aisLiveTracker,
  }
  return readV3Readiness(database, { dataMode, runtime: runtimeSnapshot, bootstrapFailed: hasBackgroundRuntimeBootstrapFailed() })
})
