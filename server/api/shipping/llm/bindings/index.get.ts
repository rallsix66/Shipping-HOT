import process from "node:process"
import { initShippingTables } from "#/database/shipping"
import { LlmRegistryRepository } from "#/database/llm-registry"

export default defineEventHandler(async () => {
  const database = useDatabase()
  const dataMode = process.env.SHIPPING_DATA_MODE === "real" ? "real" : "mock"
  await initShippingTables(database, dataMode)
  const repo = new LlmRegistryRepository(database)
  const [items, audit] = await Promise.all([repo.listBindings(), repo.listBindingAudit(20)])
  return { items, audit }
})
