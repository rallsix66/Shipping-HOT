import { FileSecretStore, SecretManagedByEnvironmentError } from "#/secrets/file-secret-store"
import { TRANSLATION_PROVIDER_ID } from "#/services/translation-settings"

export default defineEventHandler(async () => {
  const store = new FileSecretStore()
  try {
    await store.delete(TRANSLATION_PROVIDER_ID)
    return await store.redacted(TRANSLATION_PROVIDER_ID)
  } catch (error) {
    if (error instanceof SecretManagedByEnvironmentError) throw createError({ statusCode: 409, message: "managed_by_environment" })
    throw createError({ statusCode: 500, message: "secret_store_failed" })
  }
})
