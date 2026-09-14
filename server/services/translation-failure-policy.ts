import type { ProviderCircuitBlockCode } from "#/database/runtime-jobs"

export const TRANSLATION_RETRYABLE_FAILURE_CODES = [
  "rate_limited",
  "provider_timeout",
  "provider_unavailable",
  "insufficient_system_resource",
] as const

export const TRANSLATION_CIRCUIT_BLOCKING_FAILURE_CODES = [
  "auth_failed",
  "provider_forbidden",
  "entitlement_missing",
  "provider_contract_changed",
] as const

// Deterministic, non-retryable translation failures: retrying under the same
// settings/cap cannot help, so the block is marked failed rather than looped.
export const TRANSLATION_NON_RETRYABLE_FAILURE_CODES = [
  "translation_placeholder_changed",
  "translation_output_truncated",
  "translation_content_filtered",
  "translation_tool_calls_not_supported",
] as const

export const TRANSLATION_FAILURE_CODES = [
  ...TRANSLATION_CIRCUIT_BLOCKING_FAILURE_CODES,
  ...TRANSLATION_RETRYABLE_FAILURE_CODES,
  ...TRANSLATION_NON_RETRYABLE_FAILURE_CODES,
] as const

export type TranslationFailureCode = typeof TRANSLATION_FAILURE_CODES[number]

export function isTranslationFailureCode(value: string | undefined): value is TranslationFailureCode {
  return typeof value === "string" && (TRANSLATION_FAILURE_CODES as readonly string[]).includes(value)
}

export function isTranslationRetryableFailure(value: string | undefined): boolean {
  return typeof value === "string" && (TRANSLATION_RETRYABLE_FAILURE_CODES as readonly string[]).includes(value)
}

export function isTranslationCircuitBlockingFailure(value: string | undefined): value is ProviderCircuitBlockCode {
  return typeof value === "string" && (TRANSLATION_CIRCUIT_BLOCKING_FAILURE_CODES as readonly string[]).includes(value)
}

export function translationRetryBackoffMs(retryCount: number): number {
  const normalizedRetryCount = Number.isFinite(retryCount) ? Math.max(0, Math.floor(retryCount)) : 0
  const minutes = normalizedRetryCount >= 6 ? 60 : 2 ** normalizedRetryCount
  return minutes * 60_000
}
