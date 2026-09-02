export type SecretSource = "environment" | "file" | "missing"

export interface ProviderConfig {
  providerId: string
  capability: string
  model?: string
  baseUrl?: string
  enabled: boolean
  monthlyBudget?: number
  updatedAt?: string
}

/** Redacted metadata only. Secret values never enter this contract. */
export interface ProviderSecret {
  providerId: string
  configured: boolean
  source: SecretSource
  maskedLast4?: string
}

export interface SecretStore {
  get: (providerId: string) => Promise<string | undefined>
  set: (providerId: string, secret: string) => Promise<void>
  delete: (providerId: string) => Promise<void>
  has: (providerId: string) => Promise<boolean>
  source: (providerId: string) => Promise<SecretSource>
}

export interface TranslationRequest {
  sourceText: string
  sourceLanguage?: string
  targetLanguage: string
  entityType: string
  entityId: string
  fieldName: string
}

export interface TranslationResult {
  translatedText: string
}

/** The Provider returns content only; cache identity belongs to TranslationService. */
export interface TranslationProvider {
  readonly providerId: string
  readonly model: string
  translate: (request: TranslationRequest) => Promise<TranslationResult>
}

export interface TranslationCacheRecord {
  id: string
  entityType: string
  entityId: string
  fieldName: string
  sourceText: string
  sourceHash: string
  sourceLanguage?: string
  targetLanguage: string
  provider: string
  model: string
  translatedText?: string
  translatedAt?: string
  status: "pending" | "succeeded" | "failed"
  errorMessage?: string
  preferred: boolean
  createdAt: string
  updatedAt: string
}

export interface ProviderUsageRecord {
  id: string
  providerId: string
  capability: string
  windowStart: string
  requestCount: number
  successCount: number
  failureCount: number
  recordsCount: number
  cacheHitCount: number
  charactersIn?: number
  charactersOut?: number
  tokensIn?: number
  tokensOut?: number
  estimatedCost?: number
  currency?: string
  pricingReference?: string
  sourceScope?: string
  lastCalledAt?: string
  errorCode?: string
}

export type ProviderFailureCode = "auth_failed" | "entitlement_missing" | "provider_forbidden" | "rate_limited" | "provider_timeout" | "provider_unavailable" | "provider_contract_changed"

export class ProviderError extends Error {
  readonly code: ProviderFailureCode
  readonly status?: number

  constructor(code: ProviderFailureCode, message: string, status?: number) {
    super(message)
    this.name = "ProviderError"
    this.code = code
    this.status = status
  }
}

function contextText(context?: unknown): string {
  if (context instanceof Error) return context.message
  if (typeof context === "string") return context
  if (context === undefined) return ""
  try {
    return JSON.stringify(context)
  } catch {
    return String(context)
  }
}

export function providerFailureCode(status: number, context?: unknown): ProviderFailureCode {
  if (status === 401) return "auth_failed"
  if (status === 403) {
    return /feature[\s_-]+not[\s_-]+available|plan[\s_-]+restriction|endpoint[\s_-]+entitlement|subscription[\s_-]+required|entitlement/i.test(contextText(context))
      ? "entitlement_missing"
      : "provider_forbidden"
  }
  if (status === 429) return "rate_limited"
  if (status === 408 || status === 504) return "provider_timeout"
  if (status >= 500) return "provider_unavailable"
  return "provider_contract_changed"
}

export function providerHttpError(provider: string, status: number, message = `${provider} request failed (${status})`, context?: unknown): ProviderError {
  const code = providerFailureCode(status, context ?? message)
  return new ProviderError(code, message, status)
}

export function providerErrorFromUnknown(provider: string, error: unknown, fallback: ProviderFailureCode = "provider_unavailable"): ProviderError {
  if (error instanceof ProviderError) return error
  const message = error instanceof Error ? error.message : String(error)
  const code = /timeout|timed out|ETIMEDOUT|aborted/i.test(message) ? "provider_timeout" : fallback
  return new ProviderError(code, `${provider}: ${message}`)
}

export interface ProviderRuntimeRecord {
  providerId: string
  capability: string
  status: "healthy" | "degraded" | "failed" | "disabled" | "never_succeeded"
  lastRequestAt?: string
  lastSuccessAt?: string
  lastFailureAt?: string
  lastSourceUpdatedAt?: string
  lastFetchedAt?: string
  cacheAgeSeconds?: number
  ttlSeconds?: number
  nextSyncAt?: string
  consecutiveFailures: number
  errorCode?: string
  errorMessage?: string
  rateLimitResetAt?: string
  dataCount?: number
  coverage?: Record<string, unknown>
  updatedAt: string
}

export interface SyncRunRecord {
  id: string
  providerId: string
  capability: string
  startedAt: string
  completedAt?: string
  status: "running" | "success" | "failed" | "skipped"
  recordsRead?: number
  recordsWritten?: number
  errorCode?: string
  errorMessage?: string
}
