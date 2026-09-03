import { FileSecretStore } from "#/secrets/file-secret-store"
import { TRANSLATION_PROVIDER_ID } from "#/services/translation-settings"

export default defineEventHandler(async () => {
  return new FileSecretStore().redacted(TRANSLATION_PROVIDER_ID)
})
