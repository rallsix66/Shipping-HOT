import process from "node:process"
import { FileSecretStore } from "#/secrets/file-secret-store"
import { initShippingTables } from "#/database/shipping"
import { LlmRegistryRepository } from "#/database/llm-registry"

export default defineEventHandler(async () => {
  const database = useDatabase()
  const dataMode = process.env.SHIPPING_DATA_MODE === "real" ? "real" : "mock"
  await initShippingTables(database, dataMode)
  const repo = new LlmRegistryRepository(database)
  const store = new FileSecretStore()
  const providers = await repo.listProviders()
  const items = []
  for (const provider of providers) {
    const secret = await store.redacted(provider.secretRef)
    items.push({
      ...provider,
      secret: {
        configured: secret.configured,
        source: secret.source,
        maskedLast4: secret.maskedLast4,
      },
    })
  }
  return { items }
})
