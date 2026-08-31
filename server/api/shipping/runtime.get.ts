import { getAisLiveTracker, getBackgroundRuntime } from "#/runtime/bootstrap"

export default defineEventHandler(() => {
  const runtime = getBackgroundRuntime()
  return {
    ...(runtime?.getStatus() ?? { running: false, jobs: [] }),
    aisLiveTracker: getAisLiveTracker()?.getStatus() ?? {
      running: false,
      targetCount: 0,
      socketCount: 0,
      confirmedSocketCount: 0,
      reconnectAttempt: 0,
      providerStatus: "never_succeeded",
    },
  }
})
