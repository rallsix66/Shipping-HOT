import { FileSecretStore, SecretManagedByEnvironmentError } from "#/secrets/file-secret-store"
import { TRANSLATION_PROVIDER_ID } from "#/services/translation-settings"
import { parseTranslationSecretBody } from "#/services/translation-secret"

export default defineEventHandler(async (event) => {
  let apiKey: string
  try {
    apiKey = parseTranslationSecretBody(await readBody<unknown>(event))
  } catch (error) {
    const code = error instanceof Error ? error.message : "secret_payload_invalid"
    throw createError({ statusCode: 400, message: ["secret_payload_invalid", "secret_required", "secret_too_long"].includes(code) ? code : "secret_payload_invalid" })
  }
  const store = new FileSecretStore()
  try {
    await store.set(TRANSLATION_PROVIDER_ID, apiKey)
    return await store.redacted(TRANSLATION_PROVIDER_ID)
  } catch (error) {
    if (error instanceof SecretManagedByEnvironmentError) throw createError({ statusCode: 409, message: "managed_by_environment" })
    throw createError({ statusCode: 500, message: "secret_store_failed" })
  }
})
