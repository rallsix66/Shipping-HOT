import process from "node:process"
import { FileSecretStore } from "#/secrets/file-secret-store"
import { ShippingRepository, initShippingTables } from "#/database/shipping"
import { defaultShippingSettings } from "#/database/runtime"
import { readTranslationStatus } from "#/services/translation-settings"

export default defineEventHandler(async () => {
  const database = useDatabase()
  const dataMode = process.env.SHIPPING_DATA_MODE === "real" ? "real" : "mock"
  await initShippingTables(database, dataMode)
  const settings = await new ShippingRepository(database, dataMode).getSettings() ?? defaultShippingSettings
  return readTranslationStatus(database, settings, new FileSecretStore())
})
