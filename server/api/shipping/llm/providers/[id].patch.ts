import process from "node:process"
import { throwLlmRegistryHttpError } from "../_errors"
import { FileSecretStore, SecretManagedByEnvironmentError } from "#/secrets/file-secret-store"
import { initShippingTables } from "#/database/shipping"
import { LlmRegistryError, LlmRegistryRepository } from "#/database/llm-registry"

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, "id")
  if (!id) throw createError({ statusCode: 400, message: "invalid_id" })
  const body = await readBody<Record<string, unknown>>(event)
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw createError({ statusCode: 400, message: "invalid_payload" })
  }
  const database = useDatabase()
  const dataMode = process.env.SHIPPING_DATA_MODE === "real" ? "real" : "mock"
  await initShippingTables(database, dataMode)
  const repo = new LlmRegistryRepository(database)
  try {
    const provider = await repo.updateProvider(id, {
      name: body.name,
      baseUrl: body.baseUrl,
      enabled: body.enabled,
    })
    if ("apiKey" in body) {
      if (typeof body.apiKey !== "string") throw new LlmRegistryError("secret_payload_invalid")
      const trimmed = body.apiKey.trim()
      if (!trimmed) throw new LlmRegistryError("secret_required")
      if (trimmed.length > 512) throw new LlmRegistryError("secret_too_long")
      try {
        await new FileSecretStore().set(provider.secretRef, trimmed)
      } catch (error) {
        if (error instanceof SecretManagedByEnvironmentError) throw createError({ statusCode: 409, message: "managed_by_environment" })
        throw createError({ statusCode: 500, message: "secret_store_failed" })
      }
    }
    const secret = await new FileSecretStore().redacted(provider.secretRef)
    return {
      ...provider,
      secret: { configured: secret.configured, source: secret.source, maskedLast4: secret.maskedLast4 },
    }
  } catch (error) {
    throwLlmRegistryHttpError(error)
  }
})
