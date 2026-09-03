export const TRANSLATION_SECRET_MAX_LENGTH = 4096

export function parseTranslationSecretBody(body: unknown): string {
  if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).length !== 1 || !("apiKey" in body)) {
    throw new Error("secret_payload_invalid")
  }
  const apiKey = (body as { apiKey?: unknown }).apiKey
  if (typeof apiKey !== "string") throw new Error("secret_required")
  const trimmed = apiKey.trim()
  if (!trimmed) throw new Error("secret_required")
  if (trimmed.length > TRANSLATION_SECRET_MAX_LENGTH) throw new Error("secret_too_long")
  return trimmed
}
