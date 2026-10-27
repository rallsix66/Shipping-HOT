import process from "node:process"
import { FileSecretStore } from "#/secrets/file-secret-store"
import { ShippingRepository, initShippingTables } from "#/database/shipping"
import { defaultShippingSettings } from "#/database/runtime"
import { runLlmTestConnection } from "#/intel/llm/test-connection"

export default defineEventHandler(async (event) => {
  const body = await readBody<Record<string, unknown>>(event)
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw createError({ statusCode: 400, message: "invalid_payload" })
  }
  if (typeof body.providerId !== "string" || typeof body.modelId !== "string") {
    throw createError({ statusCode: 400, message: "invalid_payload" })
  }
  // Refuse any attempt to force a live transport from the API surface.
  if ("transport" in body || "live" in body || "real" in body) {
    throw createError({ statusCode: 400, message: "live_transport_forbidden" })
  }
  const database = useDatabase()
  const dataMode = process.env.SHIPPING_DATA_MODE === "real" ? "real" : "mock"
  await initShippingTables(database, dataMode)
  const settings = await new ShippingRepository(database, dataMode).getSettings() ?? defaultShippingSettings
  const result = await runLlmTestConnection({
    db: database,
    secretStore: new FileSecretStore(),
    sharedLlmBudget: settings.sharedLlmBudget,
    providerId: body.providerId,
    modelId: body.modelId,
  })
  if (!result.ok && (result.code === "paid_budget_unconfigured" || result.code === "paid_budget_zero" || result.code === "paid_secret_missing")) {
    throw createError({ statusCode: 402, message: result.code, data: result })
  }
  return result
})
