import { bootstrapBackgroundRuntime, shutdownBackgroundRuntime } from "#/runtime/bootstrap"

export default defineNitroPlugin((nitroApp) => {
  void bootstrapBackgroundRuntime({ installSignalHandlers: true }).catch((error: unknown) => {
    logger.error("background runtime bootstrap failed", { errorCode: error instanceof Error ? error.message : "bootstrap_failed" })
  })
  nitroApp.hooks.hook("close", () => {
    shutdownBackgroundRuntime()
  })
})
