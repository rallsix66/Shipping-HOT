import process from "node:process"
import { throwLlmRegistryHttpError } from "../_errors"
import { FileSecretStore, SecretManagedByEnvironmentError } from "#/secrets/file-secret-store"
import { initShippingTables } from "#/database/shipping"
import {
  LlmRegistryError,
  LlmRegistryRepository,
  assertSecretWriteTargetAllowed,
  llmSecretRefForProviderId,
  parseProviderBaseUrl,
} from "#/database/llm-registry"

function parseSecret(body: Record<string, unknown>): string | undefined {
  if (!("apiKey" in body)) return undefined
  if (typeof body.apiKey !== "string") throw new LlmRegistryError("secret_payload_invalid")
  const trimmed = body.apiKey.trim()
  if (!trimmed) throw new LlmRegistryError("secret_required")
  if (trimmed.length > 512) throw new LlmRegistryError("secret_too_long")
  return trimmed
}

export default defineEventHandler(async (event) => {
  const body = await readBody<Record<string, unknown>>(event)
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw createError({ statusCode: 400, message: "invalid_payload" })
  }
  // Client must not supply secretRef; server assigns isolated namespace.
  if ("secretRef" in body) throw createError({ statusCode: 400, message: "secret_ref_immutable" })

  const database = useDatabase()
  const dataMode = process.env.SHIPPING_DATA_MODE === "real" ? "real" : "mock"
  await initShippingTables(database, dataMode)
  const repo = new LlmRegistryRepository(database)
  try {
    // Validate full request (including optional apiKey) BEFORE any DB/secret write.
    const apiKey = parseSecret(body)
    parseProviderBaseUrl(body.baseUrl)
    if (body.apiCompat !== undefined && body.apiCompat !== "openai") throw new LlmRegistryError("invalid_api_compat")
    // Pre-compute namespaced ref; reject reserved bare collision targets.
    if (typeof body.id === "string" && body.id) {
      assertSecretWriteTargetAllowed(llmSecretRefForProviderId(body.id))
    }

    const provider = await repo.createProvider({
      id: body.id,
      name: body.name,
      baseUrl: body.baseUrl,
      apiCompat: body.apiCompat,
      enabled: body.enabled,
    })
    const store = new FileSecretStore()
    if (apiKey) {
      try {
        assertSecretWriteTargetAllowed(provider.secretRef)
        await store.set(provider.secretRef, apiKey)
      } catch (error) {
        // Compensate: registry row must not remain if secret write failed.
        try {
          await repo.deleteProvider(provider.id)
        } catch {
          // best-effort compensate
        }
        if (error instanceof LlmRegistryError) throw error
        if (error instanceof SecretManagedByEnvironmentError) throw createError({ statusCode: 409, message: "managed_by_environment" })
        throw createError({ statusCode: 500, message: "secret_store_failed" })
      }
    }
    const secret = await store.redacted(provider.secretRef)
    return {
      ...provider,
      secret: { configured: secret.configured, source: secret.source, maskedLast4: secret.maskedLast4 },
    }
  } catch (error) {
    throwLlmRegistryHttpError(error)
  }
})
