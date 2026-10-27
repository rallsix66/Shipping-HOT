import { LlmRegistryError } from "#/database/llm-registry"

const BAD_REQUEST = new Set([
  "invalid_id",
  "invalid_name",
  "invalid_base_url",
  "invalid_api_compat",
  "invalid_enabled",
  "invalid_provider_id",
  "invalid_model_id",
  "invalid_model_name",
  "invalid_purpose",
  "invalid_unit_price_in",
  "invalid_unit_price_out",
  "invalid_currency",
  "invalid_step",
  "model_purpose_mismatch",
  "second_opinion_same_provider",
  "model_duplicate",
  "secret_payload_invalid",
  "secret_required",
  "secret_too_long",
])

const CONFLICT = new Set([
  "provider_exists",
  "model_exists",
  "provider_in_use",
  "model_in_use",
  "managed_by_environment",
])

const NOT_FOUND = new Set([
  "provider_not_found",
  "model_not_found",
])

export function throwLlmRegistryHttpError(error: unknown): never {
  if (error instanceof LlmRegistryError) {
    if (BAD_REQUEST.has(error.code)) throw createError({ statusCode: 400, message: error.code })
    if (CONFLICT.has(error.code)) throw createError({ statusCode: 409, message: error.code })
    if (NOT_FOUND.has(error.code)) throw createError({ statusCode: 404, message: error.code })
    throw createError({ statusCode: 400, message: error.code })
  }
  throw error
}
