import process from "node:process"
import { throwLlmRegistryHttpError } from "../_errors"
import { FileSecretStore } from "#/secrets/file-secret-store"
import { initShippingTables } from "#/database/shipping"
import { LlmRegistryError, LlmRegistryRepository } from "#/database/llm-registry"
import { patchProviderWithSecret } from "#/services/llm-provider-write"

function parseSecret(body: Record<string, unknown>): string | undefined {
  if (!("apiKey" in body)) return undefined
  if (typeof body.apiKey !== "string") throw new LlmRegistryError("secret_payload_invalid")
  const trimmed = body.apiKey.trim()
  if (!trimmed) throw new LlmRegistryError("secret_required")
  if (trimmed.length > 512) throw new LlmRegistryError("secret_too_long")
  return trimmed
}

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, "id")
  if (!id) throw createError({ statusCode: 400, message: "invalid_id" })
  const body = await readBody<Record<string, unknown>>(event)
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw createError({ statusCode: 400, message: "invalid_payload" })
  }
  if ("secretRef" in body) throw createError({ statusCode: 400, message: "secret_ref_immutable" })

  const database = useDatabase()
  const dataMode = process.env.SHIPPING_DATA_MODE === "real" ? "real" : "mock"
  await initShippingTables(database, dataMode)
  const repo = new LlmRegistryRepository(database)
  try {
    const apiKey = parseSecret(body)
    const result = await patchProviderWithSecret(
      { repo, secretStore: new FileSecretStore() },
      id,
      {
        name: body.name,
        baseUrl: body.baseUrl,
        enabled: body.enabled,
        apiKey,
      },
    )
    return {
      ...result.provider,
      secret: result.secret,
    }
  } catch (error) {
    throwLlmRegistryHttpError(error)
  }
})
