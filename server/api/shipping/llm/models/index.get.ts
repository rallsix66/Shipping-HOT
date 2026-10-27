import process from "node:process"
import { initShippingTables } from "#/database/shipping"
import { LlmRegistryRepository } from "#/database/llm-registry"

export default defineEventHandler(async (event) => {
  const database = useDatabase()
  const dataMode = process.env.SHIPPING_DATA_MODE === "real" ? "real" : "mock"
  await initShippingTables(database, dataMode)
  const providerId = getQuery(event).providerId
  const repo = new LlmRegistryRepository(database)
  const items = typeof providerId === "string" && providerId
    ? await repo.listModels(providerId)
    : await repo.listModels()
  return { items }
})
