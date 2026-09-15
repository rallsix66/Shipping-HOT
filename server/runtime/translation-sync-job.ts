import type { Database } from "db0"
import type { ShippingDataMode } from "#/database/runtime"
import { ArticleRepository } from "#/database/article"
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
  normalizeTranslationSettings,
} from "#/services/translation-settings"
import {
  ARTICLE_TRANSLATION_CONTRACT_VERSION,
  articleBlockProtectedTerms,
  articleConservativeProjectedCostUsd,
  isArticleVersionTranslationComplete,
  planArticleTranslation,
} from "#/services/article-translation-source"
import { type PreparedTranslationSource, TranslationService, feedTranslationSources, isFeedItemProviderTranslationEligible } from "#/services/translation-service"
import { isTranslationCircuitBlockingFailure, isTranslationRetryableFailure, translationRetryBackoffMs } from "#/services/translation-failure-policy"
import { withTranslationExecutor } from "#/services/translation-executor"
import type { RuntimeJob, SyncResult } from "#/runtime/background-runtime"

export const TRANSLATION_SYNC_JOB_ID = "translation-sync"
export const TRANSLATION_SYNC_INTERVAL_MS = 60_000
export const TRANSLATION_MAX_FIELDS_PER_RUN = 5
export const TRANSLATION_PROVIDER_TIMEOUT_MS = 20_000
export const TRANSLATION_LEASE_MS = 45_000

export type TranslationWorkScope = "feed" | "article"

export interface TranslationWorkItem {
  scope: TranslationWorkScope
  feedItemId: string
  source: PreparedTranslationSource
}

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

function usageFor(source: PreparedTranslationSource, scope: TranslationWorkScope, result: { status: "succeeded" | "failed" | "unconfigured", usage?: { promptTokens?: number, completionTokens?: number }, errorCode?: string, translatedText: string, providerCalled: boolean }, now: string) {
  return {
    providerId: TRANSLATION_PROVIDER_ID,
    capability: TRANSLATION_CAPABILITY,
    // Only a real Provider call produces request/cost; cache, same-language,
    // stale/version/hash releases and budget blocks never reach this function.
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
    sourceScope: scope,
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

/**
 * Deterministic fairness order. When both kinds have pending work the first two
 * positions are Feed then Article, so neither can starve the other, and the rest
 * alternate. A single kind keeps its natural order. The run applies
 * TRANSLATION_MAX_FIELDS_PER_RUN to *processed* work, not to this ordering, so a
 * source that cannot be claimed never burns another source's slot.
 */
export function orderTranslationWork(feed: TranslationWorkItem[], article: TranslationWorkItem[]): TranslationWorkItem[] {
  if (feed.length === 0 || article.length === 0) return [...feed, ...article]
  const queues: [TranslationWorkItem[], TranslationWorkItem[]] = [feed.slice(), article.slice()]
  const ordered: TranslationWorkItem[] = []
  let turn = 0
  while (queues[0].length > 0 || queues[1].length > 0) {
    const index = queues[turn % 2].length > 0 ? turn % 2 : (turn + 1) % 2
    const next = queues[index].shift()
    if (next) ordered.push(next)
    turn += 1
  }
  return ordered
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
  const articleRepository = new ArticleRepository(options.database)
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
          return { status: "skipped", errorCode: currentRuntime?.errorCode ?? "translation_provider_circuit_blocked", errorMessage: currentRuntime?.errorMessage }
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
        const targetLanguage = settings?.translation?.targetLanguage
        const feedService = new TranslationService(translationRepository, provider, {
          targetLanguage,
          preference: { providerId: provider.providerId, model: provider.model },
          now: () => now().toISOString(),
        })
        const articleService = new TranslationService(translationRepository, provider, {
          targetLanguage,
          preference: { providerId: provider.providerId, model: provider.model },
          now: () => now().toISOString(),
          contractVersion: ARTICLE_TRANSLATION_CONTRACT_VERSION,
        })

        // C-5: Feed title/summary plus eligible current ArticleVersion blocks.
        const feedWork: TranslationWorkItem[] = []
        for (const item of feedItems) {
          if (!isFeedItemProviderTranslationEligible(item, runAt)) continue
          for (const source of feedTranslationSources(item, targetLanguage, undefined, runAt)) {
            feedWork.push({ scope: "feed", feedItemId: item.id, source: feedService.prepare(source) })
          }
        }
        const articleWork: TranslationWorkItem[] = []
        for (const item of feedItems) {
          if (!isFeedItemProviderTranslationEligible(item, runAt)) continue
          const detail = await articleRepository.getArticle(item.id)
          if (!detail?.currentVersion || detail.state.currentVersionId !== detail.currentVersion.id) continue
          // Historical/superseded, incomplete, restricted and same-language
          // versions are excluded here; they remain readable from cache.
          const plan = planArticleTranslation({
            // Eligibility uses the mutable current completeness, matching what the
            // reader is shown, so a version whose source is no longer complete is
            // never paid for or reported as fully translated.
            version: { ...detail.currentVersion, completenessStatus: detail.state.completenessStatus },
            blocks: detail.blocks,
            targetLanguage: targetLanguage ?? "zh-CN",
            prepare: articleService.prepare.bind(articleService),
          })
          if (!plan.eligible) continue
          for (const source of plan.pending) articleWork.push({ scope: "article", feedItemId: item.id, source })
        }
        const candidateCount = feedWork.length + articleWork.length
        const work = orderTranslationWork(feedWork, articleWork)

        let processed = 0
        let succeeded = 0
        let stopAfterFailure = false
        let terminalStatus: SyncResult["status"] = "success"
        let terminalErrorCode: string | undefined

        for (const item of work) {
          if (processed >= maxFields || stopAfterFailure) break
          const service = item.scope === "article" ? articleService : feedService
          const prepared = item.source
          const claimAt = now()
          const claimAtIso = claimAt.toISOString()
          const leaseUntil = new Date(claimAt.getTime() + TRANSLATION_LEASE_MS).toISOString()
          const identity = identityFrom(prepared, provider)
          const claimed = await translationRepository.claimTranslationWork({ ...identity, sourceText: prepared.sourceText, sourceLanguage: prepared.sourceLanguage, now: claimAtIso, leaseUntil })
          if (!claimed) continue
          processed += 1

          // C-6: re-read real state after claiming, before any Provider call.
          const revalidated = item.scope === "article"
            ? await revalidateArticle(shippingRepository, articleRepository, item, articleService, now)
            : await revalidateFeed(shippingRepository, item, feedService, now)
          if (!revalidated.ok) {
            // A deferral is retryable by design (the version can come back, e.g. an
            // A -> B -> A revert), but it must still back off: without nextRetryAt the
            // same row would be re-claimed and re-released on every run while
            // retry_count grew without ever throttling anything.
            const deferredAt = now()
            await translationRepository.releaseTranslationClaim({
              ...identity,
              leaseUntil,
              errorCode: revalidated.errorCode,
              errorMessage: revalidated.errorMessage,
              retryable: revalidated.retryable,
              nextRetryAt: revalidated.retryable ? translationDeferralRetryAt(claimed.retryCount ?? 0, deferredAt) : undefined,
            })
            continue
          }
          const latestSource = revalidated.latest
          if (await translationRepository.findExactSuccessful(identity)) {
            await translationRepository.releaseTranslationClaim({ ...identity, leaseUntil, errorCode: "translation_exact_cache_appeared", errorMessage: "exact success appeared before call", retryable: false })
            continue
          }

          const latestRuntime = await runtimeRepository.getProviderRuntime(TRANSLATION_PROVIDER_ID, TRANSLATION_CAPABILITY)
          const latestUsage = await currentTranslationUsage(options.database, now())
          const gateSettings = normalizeTranslationSettings((await shippingRepository.getSettings())?.translation)
          try {
            await assertTranslationReady(gateSettings, options.secretStore, latestUsage.estimatedCost)
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
          // C-9: article-only projected budget guard. The projected cost is a
          // local conservative estimate and is never recorded as actual spend. It is
          // measured on the placeholder-protected text, which is what the Provider
          // actually receives.
          if (item.scope === "article" && latestUsage.estimatedCost + articleConservativeProjectedCostUsd(latestSource.sourceText, latestSource.targetLanguage, latestSource.maxTokens, latestSource.protectedTerms ?? []) > gateSettings.monthlyBudget) {
            const blockedAt = now().toISOString()
            await translationRepository.releaseTranslationClaim({ ...identity, leaseUntil, errorCode: "translation_budget_projected_exceeded", errorMessage: "projected cost would exceed monthly budget", retryable: true, nextRetryAt: new Date(Date.parse(blockedAt) + translationRetryBackoffMs(claimed.retryCount ?? 0)).toISOString() })
            terminalStatus = "skipped"
            terminalErrorCode = "translation_budget_projected_exceeded"
            break
          }

          const execution = await service.execute(latestSource)
          const completedAt = now().toISOString()
          const usagePatch = usageFor(latestSource, item.scope, execution, completedAt)
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
          recordsRead: candidateCount,
          recordsWritten: succeeded,
          errorCode: terminalErrorCode,
        }
      })
    },
  }
}

interface RevalidationFailure {
  ok: false
  errorCode: string
  errorMessage: string
  retryable: boolean
}
type RevalidationResult = { ok: true, latest: PreparedTranslationSource } | RevalidationFailure

/**
 * Article revalidation deferrals. "The state moved underneath this claim" is not
 * a poison input: a superseded version can become current again (the supported
 * A -> B -> A revert) and a tightened/loosened completeness rule can flip back,
 * so these codes stay retryable with the normal growing backoff. A non-retryable
 * release would make the block untranslatable for the life of the version with
 * no in-product recovery.
 */
function articleDeferral(errorCode: string, errorMessage: string): RevalidationFailure {
  return { ok: false, errorCode, errorMessage, retryable: true }
}

/**
 * Retry time for a retryable deferral release. A deferral must still back off:
 * releasing without `nextRetryAt` leaves `next_retry_at` NULL, so every 60s run
 * re-claims and re-releases the same row while `retry_count` grows without ever
 * throttling anything.
 */
export function translationDeferralRetryAt(retryCount: number, at: Date): string {
  return new Date(at.getTime() + translationRetryBackoffMs(retryCount)).toISOString()
}

/** C-6 Feed revalidation: eligibility + field + sourceHash must be unchanged. */
export async function revalidateFeed(shippingRepository: ShippingRepository, item: TranslationWorkItem, service: TranslationService, now: () => Date): Promise<RevalidationResult> {
  const latestItem = (await shippingRepository.listFeedItems({ now: now(), view: "current" })).find(candidate => candidate.id === item.feedItemId)
  if (!latestItem || !isFeedItemProviderTranslationEligible(latestItem, now())) {
    return { ok: false, errorCode: "translation_source_no_longer_eligible", errorMessage: "source is no longer eligible", retryable: false }
  }
  const latestSource = feedTranslationSources(latestItem, item.source.targetLanguage, item.source.sourceLanguage, now()).find(candidate => candidate.fieldName === item.source.fieldName)
  if (!latestSource) {
    return { ok: false, errorCode: "translation_source_no_longer_eligible", errorMessage: "source is no longer eligible", retryable: false }
  }
  const latest = service.prepare(latestSource)
  if (latest.sourceHash !== item.source.sourceHash) {
    return { ok: false, errorCode: "translation_source_changed", errorMessage: "source hash changed before call", retryable: false }
  }
  return { ok: true, latest }
}

/** C-6 Article revalidation: current version, policy, block and hash unchanged. */
export async function revalidateArticle(shippingRepository: ShippingRepository, articleRepository: ArticleRepository, item: TranslationWorkItem, service: TranslationService, now: () => Date): Promise<RevalidationResult> {
  const latestItem = (await shippingRepository.listFeedItems({ now: now(), view: "current" })).find(candidate => candidate.id === item.feedItemId)
  if (!latestItem || !isFeedItemProviderTranslationEligible(latestItem, now())) {
    // Article-scoped: a stale/expired Feed item can become current again (the same
    // reasoning as the version deferrals), so this stays retryable-with-backoff
    // rather than poisoning every block of the article for the life of the version.
    // The Feed title/summary path keeps its existing terminal semantics.
    return articleDeferral("translation_source_no_longer_eligible", "source is no longer eligible")
  }
  const detail = await articleRepository.getArticle(item.feedItemId)
  if (!detail?.currentVersion || detail.state.currentVersionId !== item.source.entityId || detail.currentVersion.id !== item.source.entityId) {
    return articleDeferral("translation_article_version_changed", "article version is no longer current")
  }
  if (!isArticleVersionTranslationComplete(detail.state, detail.currentVersion.redistributionPolicy)) {
    return articleDeferral("translation_article_version_changed", "article version is no longer translatable")
  }
  const block = detail.blocks.find(candidate => candidate.blockKey === item.source.fieldName)
  if (!block) {
    return articleDeferral("translation_article_block_missing", "article block no longer exists")
  }
  const latest = service.prepare({
    entityType: "article_block",
    entityId: detail.currentVersion.id,
    fieldName: block.blockKey,
    sourceText: block.text,
    sourceLanguage: item.source.sourceLanguage,
    targetLanguage: item.source.targetLanguage,
    protectedTerms: articleBlockProtectedTerms(block),
    maxTokens: item.source.maxTokens,
  })
  if (latest.sourceHash !== item.source.sourceHash) {
    return articleDeferral("translation_source_changed", "source hash changed before call")
  }
  return { ok: true, latest }
}
