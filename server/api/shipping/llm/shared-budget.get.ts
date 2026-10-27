import process from "node:process"
import { ShippingRepository, initShippingTables } from "#/database/shipping"
import { defaultShippingSettings } from "#/database/runtime"
import { readSharedLlmBudgetStatus } from "#/services/shared-llm-budget-settings"

/**
 * Shared LLM pool status for Settings UI.
 * Provider-free / receipt-free GET (aggregate over local usage + pending/unknown only).
 */
export default defineEventHandler(async () => {
  const database = useDatabase()
  const dataMode = process.env.SHIPPING_DATA_MODE === "real" ? "real" : "mock"
  await initShippingTables(database, dataMode)
  const settings = await new ShippingRepository(database, dataMode).getSettings() ?? defaultShippingSettings
  return await readSharedLlmBudgetStatus(database, settings)
})
