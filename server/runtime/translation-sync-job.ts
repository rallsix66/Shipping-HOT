import type { Database } from "db0"
import type { ShippingDataMode } from "#/database/runtime"
import { ShippingRepository } from "#/database/shipping"
import { type TranslationCacheExactLookup, TranslationRepository } from "#/database/translation"
import { RuntimeRepository, isProviderCircuitBlocked } from "#/database/runtime-jobs"
import type { SecretStore, TranslationProvider } from "#/providers/contracts"
import { DEEPSEEK_PRICING_REFERENCE, estimateDeepSeekCost } from "#/providers/translation/deepseek-provider"
import {
  TRANSLATION_CAPABILITY,
  TRANSLATION_CURRENCY,
  TRANSLATION_MODEL,
  TRANSLATION_PROVIDER_ID,
  assertTranslationReady,
  currentTranslationUsage,
} from "#/services/translation-settings"
import { type PreparedTranslationSource, TranslationService, feedTranslationSources, isFeedItemProviderTranslationEligible } from "#/services/translation-service"
import { isTranslationCircuitBlockingFailure, isTranslationRetryableFailure, translationRetryBackoffMs } from "#/services/translation-failure-policy"
import { withTranslationExecutor } from "#/services/translation-executor"
import type { RuntimeJob, SyncResult } from "#/runtime/background-runtime"

export const TRANSLATION_SYNC_JOB_ID = "translation-sync"
export const TRANSLATION_SYNC_INTERVAL_MS = 60_000
export const TRANSLATION_MAX_FIELDS_PER_RUN = 5
export const TRANSLATION_PROVIDER_TIMEOUT_MS = 20_000
export const TRANSLATION_LEASE_MS = 45_000

function errorCode(error: unknown): string {
  if (error instanceof Error && "code" in error && typeof (error as Error & { code?: unknown }).code === "string") return (error as Error & { code: string }).code
  return error instanceof Error ? error.message : String(error)
}

function identityFrom(source: PreparedTranslationSource, provider: TranslationProvider): TranslationCacheExactLookup {
  return {
    entityType: source.entityType,
    entityId: source.entityId,
    fieldName: source.fieldName,
    sourceHash: source.sourceHash,
    targetLanguage: source.targetLanguage,
    provider: provider.providerId,
    model: provider.model,
  }
}

function usageFor(source: PreparedTranslationSource, result: { status: "succeeded" | "failed" | "unconfigured", usage?: { promptTokens?: number, completionTokens?: number }, errorCode?: string, translatedText: string, providerCalled: boolean }, now: string) {
  return {
    providerId: TRANSLATION_PROVIDER_ID,
    capability: TRANSLATION_CAPABILITY,
    request: result.providerCalled,
    succeeded: result.providerCalled && result.status === "succeeded",
    failed: result.providerCalled && result.status === "failed",
    records: result.providerCalled && result.status === "succeeded" ? 1 : 0,
    charactersIn: result.providerCalled ? source.sourceText.length : undefined,
    charactersOut: result.providerCalled ? result.translatedText.length : undefined,
    tokensIn: result.usage?.promptTokens,
    tokensOut: result.usage?.completionTokens,
    estimatedCost: result.providerCalled ? estimateDeepSeekCost(result.usage, new Date(now)) : 0,
    currency: TRANSLATION_CURRENCY,
    pricingReference: DEEPSEEK_PRICING_REFERENCE,
    sourceScope: "feed",
    calledAt: now,
    errorCode: result.errorCode,
  }
}

function sortedFeedItems(items: Awaited<ReturnType<ShippingRepository["listFeedItems"]>>): typeof items {
  return [...items].sort((left, right) => {
    const leftPublished = Date.parse(left.publishedAt)
    const rightPublished = Date.parse(right.publishedAt)
    const leftValue = Number.isFinite(leftPublished) ? leftPublished : Number.NEGATIVE_INFINITY
    const rightValue = Number.isFinite(rightPublished) ? rightPublished : Number.NEGATIVE_INFINITY
    return rightValue - leftValue || left.id.localeCompare(right.id)
  })
}

export interface TranslationSyncJobOptions {
  database: Database
  dataMode: ShippingDataMode
  provider: TranslationProvider
  secretStore: SecretStore
  intervalMs?: number
  enabled?: boolean
  now?: () => Date
  maxFieldsPerRun?: number
}

export function createTranslationSyncJob(options: TranslationSyncJobOptions): RuntimeJob {
  const shippingRepository = new ShippingRepository(options.database, options.dataMode)
  const translationRepository = new TranslationRepository(options.database)
  const runtimeRepository = new RuntimeRepository(options.database)
  const now = options.now ?? (() => new Date())
  const maxFields = Math.max(1, Math.min(Math.floor(options.maxFieldsPerRun ?? TRANSLATION_MAX_FIELDS_PER_RUN), TRANSLATION_MAX_FIELDS_PER_RUN))
  const provider = options.provider

  return {
    id: TRANSLATION_SYNC_JOB_ID,
    providerId: provider.providerId,
    capability: TRANSLATION_CAPABILITY,
    intervalMs: options.intervalMs ?? TRANSLATION_SYNC_INTERVAL_MS,
    enabled: options.enabled ?? true,
    usageAlreadyRecorded: true,
    run: async (): Promise<SyncResult> => {
      if (provider.providerId !== TRANSLATION_PROVIDER_ID || provider.model !== TRANSLATION_MODEL) {
        return { status: "skipped", errorCode: "translation_provider_or_model_not_allowed" }
      }
      return withTranslationExecutor(async () => {
        const runAt = now()
        const nowIso = runAt.toISOString()
        const currentRuntime = await runtimeRepository.getProviderRuntime(TRANSLATION_PROVIDER_ID, TRANSLATION_CAPABILITY)
        if (isProviderCircuitBlocked(currentRuntime)) {
          return { status: "skipped", errorCode: currentRuntime?.errorCode ?? "translation_provider_circuit_blocked" }
        }

        const settings = await shippingRepository.getSettings()
        const usage = await currentTranslationUsage(options.database, runAt)
        try {
          await assertTranslationReady(settings?.translation, options.secretStore, usage.estimatedCost)
        } catch (error) {
          return { status: "skipped", errorCode: errorCode(error) }
        }

        await translationRepository.recoverStaleLeases({ provider: provider.providerId, model: provider.model, now: nowIso, limit: 100 })
        const feedItems = sortedFeedItems(await shippingRepository.listFeedItems({ now: runAt, view: "current" }))
        const sources = feedItems
          .filter(item => isFeedItemProviderTranslationEligible(item, runAt))
          .flatMap(item => feedTranslationSources(item, settings?.translation?.targetLanguage, undefined, runAt))
        const service = new TranslationService(translationRepository, provider, {
          targetLanguage: settings?.translation?.targetLanguage,
          preference: { providerId: provider.providerId, model: provider.model },
          now: () => now().toISOString(),
        })
        let processed = 0
        let succeeded = 0
        let stopAfterFailure = false
        let terminalStatus: SyncResult["status"] = "success"
        let terminalErrorCode: string | undefined

        for (const source of sources) {
          if (processed >= maxFields || stopAfterFailure) break
          const prepared = service.prepare(source)
          const claimAt = now()
          const claimAtIso = claimAt.toISOString()
          const leaseUntil = new Date(claimAt.getTime() + TRANSLATION_LEASE_MS).toISOString()
          const identity = identityFrom(prepared, provider)
          const claimed = await translationRepository.claimTranslationWork({ ...identity, sourceText: prepared.sourceText, sourceLanguage: prepared.sourceLanguage, now: claimAtIso, leaseUntil })
          if (!claimed) continue
          processed += 1

          const latestFeedItems = await shippingRepository.listFeedItems({ now: now(), view: "current" })
          const latestItem = latestFeedItems.find(item => item.id === source.entityId)
          const latestSource = latestItem && isFeedItemProviderTranslationEligible(latestItem, now())
            ? feedTranslationSources(latestItem, prepared.targetLanguage, prepared.sourceLanguage, now()).find(candidate => candidate.fieldName === source.fieldName)
            : undefined
          if (!latestSource) {
            await translationRepository.releaseTranslationClaim({ ...identity, leaseUntil, errorCode: "translation_source_no_longer_eligible", errorMessage: "source is no longer eligible", retryable: false })
            continue
          }
          const latestPrepared = service.prepare(latestSource)
          if (latestPrepared.sourceHash !== claimed.sourceHash) {
            await translationRepository.releaseTranslationClaim({ ...identity, leaseUntil, errorCode: "translation_source_changed", errorMessage: "source hash changed before call", retryable: false })
            continue
          }
          if (await translationRepository.findExactSuccessful(identity)) {
            await translationRepository.releaseTranslationClaim({ ...identity, leaseUntil, errorCode: "translation_exact_cache_appeared", errorMessage: "exact success appeared before call", retryable: false })
            continue
          }

          const latestRuntime = await runtimeRepository.getProviderRuntime(TRANSLATION_PROVIDER_ID, TRANSLATION_CAPABILITY)
          const latestUsage = await currentTranslationUsage(options.database, now())
          try {
            await assertTranslationReady((await shippingRepository.getSettings())?.translation, options.secretStore, latestUsage.estimatedCost)
          } catch (error) {
            const gateFailureAt = now().toISOString()
            await translationRepository.releaseTranslationClaim({ ...identity, leaseUntil, errorCode: "translation_gate_changed", errorMessage: errorCode(error), retryable: true, nextRetryAt: gateFailureAt })
            terminalStatus = "skipped"
            terminalErrorCode = errorCode(error)
            break
          }
          if (isProviderCircuitBlocked(latestRuntime)) {
            await translationRepository.releaseTranslationClaim({ ...identity, leaseUntil, errorCode: "translation_circuit_changed", errorMessage: "provider circuit blocked before call", retryable: true, nextRetryAt: nowIso })
            terminalStatus = "skipped"
            terminalErrorCode = latestRuntime?.errorCode ?? "translation_provider_circuit_blocked"
            break
          }

          const execution = await service.execute(latestSource)
          const completedAt = now().toISOString()
          const usagePatch = usageFor(latestPrepared, execution, completedAt)
          if (execution.status === "succeeded") {
            await translationRepository.completeTranslationSuccess({ ...identity, leaseUntil, now: completedAt, translatedText: execution.translatedText, translatedAt: completedAt, providerUsage: usagePatch })
            succeeded += 1
            continue
          }
          if (execution.status === "unconfigured") {
            await translationRepository.releaseTranslationClaim({ ...identity, leaseUntil, errorCode: "translation_provider_unconfigured", errorMessage: "provider unavailable", retryable: true, nextRetryAt: completedAt })
            terminalStatus = "failed"
            terminalErrorCode = "translation_provider_unconfigured"
            break
          }
          const code = execution.errorCode ?? "provider_unavailable"
          if (isTranslationRetryableFailure(code)) {
            await translationRepository.completeRetryableFailure({ ...identity, leaseUntil, now: completedAt, errorCode: code, errorMessage: execution.errorMessage ?? code, nextRetryAt: new Date(Date.parse(completedAt) + translationRetryBackoffMs(claimed.retryCount ?? 0)).toISOString(), providerUsage: usagePatch })
          } else {
            await translationRepository.completeNonRetryableFailure({ ...identity, leaseUntil, now: completedAt, errorCode: code, errorMessage: execution.errorMessage ?? code, providerUsage: usagePatch })
          }
          if (isTranslationCircuitBlockingFailure(code)) await runtimeRepository.blockProviderCircuit({ providerId: TRANSLATION_PROVIDER_ID, capability: TRANSLATION_CAPABILITY, errorCode: code, errorMessage: execution.errorMessage ?? code, updatedAt: completedAt })
          terminalStatus = "failed"
          terminalErrorCode = code
          stopAfterFailure = true
        }

        return {
          status: terminalStatus,
          recordsRead: sources.length,
          recordsWritten: succeeded,
          errorCode: terminalErrorCode,
        }
      })
    },
  }
}
