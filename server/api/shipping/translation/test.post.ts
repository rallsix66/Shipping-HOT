import process from "node:process"
import { FileSecretStore } from "#/secrets/file-secret-store"
import { ShippingRepository, initShippingTables } from "#/database/shipping"
import { defaultShippingSettings } from "#/database/runtime"
import { isAllowedTranslationTestBody, runTranslationTest } from "#/services/translation-test-service"
import { TranslationGateError } from "#/services/translation-settings"

export default defineEventHandler(async (event) => {
  const body = await readBody<unknown>(event)
  if (!isAllowedTranslationTestBody(body)) {
    throw createError({ statusCode: 400, message: "translation_test_input_forbidden" })
  }
  const database = useDatabase()
  const dataMode = process.env.SHIPPING_DATA_MODE === "real" ? "real" : "mock"
  await initShippingTables(database, dataMode)
  const settings = await new ShippingRepository(database, dataMode).getSettings() ?? defaultShippingSettings
  try {
    const result = await runTranslationTest({ database, settings, secretStore: new FileSecretStore() })
    if (!result.ok) throw createError({ statusCode: 502, message: result.errorCode ?? "translation_provider_failed" })
    return result
  } catch (error) {
    if (error instanceof TranslationGateError) throw createError({ statusCode: error.statusCode, message: error.code })
    throw error
  }
})
