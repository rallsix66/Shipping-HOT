import { bootstrapBackgroundRuntime, shutdownBackgroundRuntime } from "#/runtime/bootstrap"
import { productionIntelOptions } from "#/runtime/intel-production"

export default defineNitroPlugin((nitroApp) => {
  void bootstrapBackgroundRuntime({ ...productionIntelOptions(), installSignalHandlers: true }).catch((error: unknown) => {
    logger.error("background runtime bootstrap failed", { errorCode: error instanceof Error ? error.message : "bootstrap_failed" })
  })
  nitroApp.hooks.hook("close", () => shutdownBackgroundRuntime())
})
