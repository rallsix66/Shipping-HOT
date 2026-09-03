import type { Database } from "db0"
import type { FeedItem, FeedItemDisplay, ShippingSettings, TranslationSettings } from "@shared/shipping"
import type { ProviderRuntimeRecord, SecretStore, TranslationProvider, TranslationUsage } from "#/providers/contracts"
import { type ProviderUsagePatch, RuntimeRepository, isProviderCircuitBlocked } from "#/database/runtime-jobs"
import { ShippingRepository } from "#/database/shipping"
import type { ShippingDataMode } from "#/database/runtime"
import { type TranslationCacheExactLookup, TranslationRepository } from "#/database/translation"
import { DEEPSEEK_CHAT_COMPLETIONS_ENDPOINT, DEEPSEEK_PRICING_REFERENCE, createDeepSeekTranslationProvider, estimateDeepSeekCost } from "#/providers/translation/deepseek-provider"
import { TRANSLATION_LEASE_MS, TRANSLATION_PROVIDER_TIMEOUT_MS } from "#/runtime/translation-sync-job"
import { TRANSLATION_CAPABILITY, TRANSLATION_CURRENCY, TRANSLATION_MODEL, TRANSLATION_PROVIDER_ID, assertTranslationReady, currentTranslationUsage, normalizeTranslationSettings, readTranslationStatus } from "#/services/translation-settings"
import { TRANSLATION_TEST_ENTITY_ID, TRANSLATION_TEST_SOURCE_TEXT } from "#/services/translation-test-service"
import { withTranslationExecutor } from "#/services/translation-executor"
import { type TranslationFailureCode, isTranslationCircuitBlockingFailure, isTranslationFailureCode, isTranslationRetryableFailure, translationRetryBackoffMs } from "#/services/translation-failure-policy"
import { type PreparedTranslationSource, type TranslationExecutionResult, TranslationService, feedTranslationSources, isFeedItemTranslationEligible } from "#/services/translation-service"
import { readCurrentFeedItemsForDisplay } from "#/services/feed-translation-display"

export const TRANSLATION_LIVE_ACCEPTANCE_PHASE1_EXTERNAL_CALLS = 1 as const
export const TRANSLATION_LIVE_ACCEPTANCE_PHASE2_EXTERNAL_CALLS = 1 as const
export const TRANSLATION_LIVE_ACCEPTANCE_MAX_EXTERNAL_CALLS = 2 as const
export const TRANSLATION_LIVE_ACCEPTANCE_INPUT = TRANSLATION_TEST_SOURCE_TEXT

const diagnosticProtectedTerms = ["TEST STAR", "AB123", "SGSIN", "2026-09-02", "https://example.com/status"]

export type TranslationAcceptanceObservationState = "verified" | "pending"
export type TranslationAcceptancePhaseStatus = "succeeded" | "failed" | "pending"

export interface TranslationAcceptanceChecks {
  settingsValid: boolean
  secretConfigured: boolean
  budgetAvailable: boolean
  circuitClear: boolean
  realFeedMode: boolean
  fixedInputOnly: true
  backlogExcluded: true
}

export interface TranslationAcceptancePlan {
  providerId: "deepseek"
  model: "deepseek-v4-flash"
  endpoint: typeof DEEPSEEK_CHAT_COMPLETIONS_ENDPOINT
  fixedInput: string
  maxExternalCalls: 0 | typeof TRANSLATION_LIVE_ACCEPTANCE_MAX_EXTERNAL_CALLS
  allowed: boolean
  checks: TranslationAcceptanceChecks
  blockers: string[]
}

export interface TranslationAcceptanceCandidate {
  feedItemId: string
  fieldName: "title" | "summary"
  sourceHash: string
  targetLanguage: string
}

export interface TranslationAcceptanceDiagnosticEvidence {
  attempted: boolean
  providerCalled: boolean
  externalCalls: number
  status: TranslationAcceptancePhaseStatus
  sourceHash?: string
  sourceScope: "translation_test"
  usageContract: TranslationAcceptanceObservationState
  placeholderPreserved: TranslationAcceptanceObservationState
  wrapperBoundary: TranslationAcceptanceObservationState
  providerUsagePersisted: TranslationAcceptanceObservationState
  cacheIsolation: TranslationAcceptanceObservationState
  errorCode?: string
}

export interface TranslationAcceptanceFeedEvidence {
  attempted: boolean
  providerCalled: boolean
  externalCalls: number
  status: TranslationAcceptancePhaseStatus
  candidate?: TranslationAcceptanceCandidate
  originalFactsPreserved: TranslationAcceptanceObservationState
  cachePersistence: TranslationAcceptanceObservationState
  providerUsagePersisted: TranslationAcceptanceObservationState
  retryStateCleared: TranslationAcceptanceObservationState
  feedReadback: TranslationAcceptanceObservationState
  restartReadback: TranslationAcceptanceObservationState
  providerFreeRead: TranslationAcceptanceObservationState
  errorCode?: string
}

export interface TranslationAcceptanceBrowserEvidence {
  feedItemId: string
  fieldName: "title" | "summary"
  sourceHash: string
  uiReadback: TranslationAcceptanceObservationState
  originalDisclosure: TranslationAcceptanceObservationState
  consoleErrors: number
  externalCalls: number
}

export interface TranslationAcceptanceEvidence {
  plan: TranslationAcceptancePlan
  liveVerification: "verified_live" | "pending"
  serverAcceptance: TranslationAcceptanceObservationState
  externalCalls: number
  diagnostic: TranslationAcceptanceDiagnosticEvidence
  phase1: TranslationAcceptanceDiagnosticEvidence
  phase2: TranslationAcceptanceFeedEvidence
  candidate?: TranslationAcceptanceCandidate
  cachePersistence: TranslationAcceptanceObservationState
  restartReadback: TranslationAcceptanceObservationState
  feedApiReadback: TranslationAcceptanceObservationState
  feedUiReadback: TranslationAcceptanceObservationState
  providerFreeRead: TranslationAcceptanceObservationState
  reason?: string
}

export interface TranslationAcceptancePreflightInput {
  settings?: Partial<TranslationSettings> | null
  configured: boolean
  estimatedMonthSpend: number
  runtime?: ProviderRuntimeRecord
  allowExternalCalls?: boolean
  realFeedMode?: boolean
}

export interface TranslationAcceptanceObservation {
  externalCalls?: number
  providerCalled?: boolean
  usageContract?: TranslationAcceptanceObservationState
  placeholderPreserved?: TranslationAcceptanceObservationState
  cachePersistence?: TranslationAcceptanceObservationState
  restartReadback?: TranslationAcceptanceObservationState
  feedApiReadback?: TranslationAcceptanceObservationState
  feedUiReadback?: TranslationAcceptanceObservationState
  feedReadback?: TranslationAcceptanceObservationState
}

export interface TranslationLiveAcceptanceOptions {
  database: Database
  dataMode: ShippingDataMode
  secretStore: SecretStore
  provider?: TranslationProvider
  allowExternalCalls?: boolean
  now?: () => Date
  reopenDatabase?: () => Promise<{ database: Database, close?: () => Promise<void> | void }>
  beforePhase2Gate?: () => Promise<void>
}

export interface TranslationLiveAcceptanceRunResult {
  evidence: TranslationAcceptanceEvidence
  candidate?: TranslationAcceptanceCandidate
}

export function buildTranslationAcceptancePlan(input: TranslationAcceptancePreflightInput): TranslationAcceptancePlan {
  const raw = input.settings
  const settings = normalizeTranslationSettings(raw)
  const settingsValid = raw?.enabled === true
    && (raw.providerId === undefined || raw.providerId === TRANSLATION_PROVIDER_ID)
    && (raw.model === undefined || raw.model === TRANSLATION_MODEL)
  const budgetAvailable = settings.monthlyBudget > 0 && input.estimatedMonthSpend < settings.monthlyBudget
  const circuitClear = !isProviderCircuitBlocked(input.runtime)
  const realFeedMode = input.realFeedMode !== false
  const checks: TranslationAcceptanceChecks = {
    settingsValid,
    secretConfigured: input.configured,
    budgetAvailable,
    circuitClear,
    realFeedMode,
    fixedInputOnly: true,
    backlogExcluded: true,
  }
  const blockers: string[] = []
  if (!settingsValid) blockers.push("translation_settings_invalid_or_disabled")
  if (!input.configured) blockers.push("translation_secret_missing")
  if (!budgetAvailable) blockers.push(settings.monthlyBudget > 0 ? "translation_budget_exhausted" : "translation_budget_zero")
  if (!circuitClear) blockers.push("translation_provider_circuit_blocked")
  if (!realFeedMode) blockers.push("translation_real_mode_required")
  if (input.allowExternalCalls !== true) blockers.push("external_call_not_authorized_for_this_run")
  return {
    providerId: "deepseek",
    model: "deepseek-v4-flash",
    endpoint: DEEPSEEK_CHAT_COMPLETIONS_ENDPOINT,
    fixedInput: TRANSLATION_LIVE_ACCEPTANCE_INPUT,
    maxExternalCalls: blockers.length === 0 ? TRANSLATION_LIVE_ACCEPTANCE_MAX_EXTERNAL_CALLS : 0,
    allowed: blockers.length === 0,
    checks,
    blockers,
  }
}

function emptyDiagnostic(overrides: Partial<TranslationAcceptanceDiagnosticEvidence> = {}): TranslationAcceptanceDiagnosticEvidence {
  return {
    attempted: false,
    providerCalled: false,
    externalCalls: 0,
    status: "pending",
    sourceScope: "translation_test",
    usageContract: "pending",
    placeholderPreserved: "pending",
    wrapperBoundary: "pending",
    providerUsagePersisted: "pending",
    cacheIsolation: "pending",
    ...overrides,
  }
}

function emptyFeed(overrides: Partial<TranslationAcceptanceFeedEvidence> = {}): TranslationAcceptanceFeedEvidence {
  return {
    attempted: false,
    providerCalled: false,
    externalCalls: 0,
    status: "pending",
    originalFactsPreserved: "pending",
    cachePersistence: "pending",
    providerUsagePersisted: "pending",
    retryStateCleared: "pending",
    feedReadback: "pending",
    restartReadback: "pending",
    providerFreeRead: "pending",
    ...overrides,
  }
}

function buildEvidence(
  plan: TranslationAcceptancePlan,
  diagnostic: TranslationAcceptanceDiagnosticEvidence,
  phase2: TranslationAcceptanceFeedEvidence,
  reason?: string,
): TranslationAcceptanceEvidence {
  const serverComplete = plan.allowed
    && diagnostic.externalCalls === TRANSLATION_LIVE_ACCEPTANCE_PHASE1_EXTERNAL_CALLS
    && diagnostic.providerCalled
    && diagnostic.status === "succeeded"
    && diagnostic.usageContract === "verified"
    && diagnostic.placeholderPreserved === "verified"
    && diagnostic.wrapperBoundary === "verified"
    && diagnostic.providerUsagePersisted === "verified"
    && diagnostic.cacheIsolation === "verified"
    && phase2.externalCalls === TRANSLATION_LIVE_ACCEPTANCE_PHASE2_EXTERNAL_CALLS
    && phase2.providerCalled
    && phase2.status === "succeeded"
    && phase2.originalFactsPreserved === "verified"
    && phase2.cachePersistence === "verified"
    && phase2.providerUsagePersisted === "verified"
    && phase2.retryStateCleared === "verified"
    && phase2.feedReadback === "verified"
    && phase2.restartReadback === "verified"
    && phase2.providerFreeRead === "verified"
    && diagnostic.externalCalls + phase2.externalCalls === TRANSLATION_LIVE_ACCEPTANCE_MAX_EXTERNAL_CALLS
  return {
    plan,
    liveVerification: "pending",
    serverAcceptance: serverComplete ? "verified" : "pending",
    externalCalls: diagnostic.externalCalls + phase2.externalCalls,
    diagnostic,
    phase1: diagnostic,
    phase2,
    candidate: phase2.candidate,
    cachePersistence: phase2.cachePersistence,
    restartReadback: phase2.restartReadback,
    feedApiReadback: phase2.feedReadback,
    feedUiReadback: "pending",
    providerFreeRead: phase2.providerFreeRead,
    reason: reason ?? (serverComplete ? "browser_ui_readback_pending" : plan.blockers.join(", ") || phase2.errorCode || diagnostic.errorCode || "acceptance_evidence_incomplete"),
  }
}

export function buildTranslationAcceptanceEvidence(plan: TranslationAcceptancePlan, observation: TranslationAcceptanceObservation = {}): TranslationAcceptanceEvidence {
  const externalCalls = Math.max(0, Math.floor(observation.externalCalls ?? 0))
  const diagnostic = emptyDiagnostic({
    attempted: externalCalls > 0 || observation.providerCalled === true,
    providerCalled: observation.providerCalled === true,
    externalCalls,
    status: observation.providerCalled && observation.usageContract === "verified" && observation.placeholderPreserved === "verified" ? "succeeded" : externalCalls ? "failed" : "pending",
    usageContract: observation.usageContract ?? "pending",
    placeholderPreserved: observation.placeholderPreserved ?? "pending",
    wrapperBoundary: observation.usageContract === "verified" ? "verified" : "pending",
    cacheIsolation: "pending",
  })
  const phase2 = emptyFeed({
    cachePersistence: observation.cachePersistence ?? "pending",
    restartReadback: observation.restartReadback ?? "pending",
    feedReadback: observation.feedReadback ?? observation.feedApiReadback ?? "pending",
    providerFreeRead: observation.feedApiReadback === "verified" ? "verified" : "pending",
  })
  return buildEvidence(plan, diagnostic, phase2, plan.blockers.join(", ") || "acceptance_evidence_incomplete")
}

/** Read-only preflight. It never constructs a Provider and never calls DeepSeek. */
export async function readTranslationAcceptancePreflight(
  database: Database,
  settings: TranslationSettings | undefined,
  secretStore: SecretStore,
  now = new Date(),
  options: { allowExternalCalls?: boolean, realFeedMode?: boolean } = {},
): Promise<TranslationAcceptanceEvidence> {
  const status = await readTranslationStatus(database, { translation: settings } as ShippingSettings, secretStore, now)
  const runtime = await new RuntimeRepository(database).getProviderRuntime(TRANSLATION_PROVIDER_ID, TRANSLATION_CAPABILITY)
  const plan = buildTranslationAcceptancePlan({
    settings,
    configured: status.configured,
    estimatedMonthSpend: status.estimatedMonthSpend,
    runtime,
    allowExternalCalls: options.allowExternalCalls,
    realFeedMode: options.realFeedMode,
  })
  return buildTranslationAcceptanceEvidence(plan)
}

function safeErrorCode(error: unknown): string {
  if (error && typeof error === "object" && "code" in error && typeof (error as { code?: unknown }).code === "string") return (error as { code: string }).code
  return error instanceof Error ? error.message : String(error)
}

function isKnownProviderFailureCode(value: string | undefined): value is TranslationFailureCode {
  return isTranslationFailureCode(value)
}

export function isDiagnosticUsageScope(value: string | undefined): boolean {
  return value === "translation_test" || value === "mixed"
}

function usageContractIsValid(usage: TranslationUsage | undefined): boolean {
  if (!usage) return false
  const values = [usage.promptTokens, usage.promptCacheHitTokens, usage.promptCacheMissTokens, usage.completionTokens, usage.totalTokens]
  if (values.some(value => value === undefined || !Number.isSafeInteger(value) || value < 0)) return false
  return usage.promptTokens === (usage.promptCacheHitTokens as number) + (usage.promptCacheMissTokens as number)
    && usage.totalTokens === (usage.promptTokens as number) + (usage.completionTokens as number)
}

function usagePatch(source: PreparedTranslationSource, result: TranslationExecutionResult, sourceScope: string, now: string): ProviderUsagePatch {
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
    sourceScope,
    calledAt: now,
    errorCode: result.errorCode,
  }
}

function sameUsageDelta(before: Awaited<ReturnType<typeof currentTranslationUsage>>, after: Awaited<ReturnType<typeof currentTranslationUsage>>, result: TranslationExecutionResult, calledAt?: string): boolean {
  const expectedRequest = result.providerCalled ? 1 : 0
  const expectedSuccess = result.providerCalled && result.status === "succeeded" ? 1 : 0
  const expectedFailure = result.providerCalled && result.status === "failed" ? 1 : 0
  return after.requestCount - before.requestCount === expectedRequest
    && after.successCount - before.successCount === expectedSuccess
    && after.failureCount - before.failureCount === expectedFailure
    && Math.abs(after.estimatedCost - before.estimatedCost - (result.providerCalled ? estimateDeepSeekCost(result.usage, calledAt ? new Date(calledAt) : new Date()) : 0)) < 1e-12
}

function sortedCurrentFeed(items: FeedItem[]): FeedItem[] {
  return [...items].sort((left, right) => {
    const leftPublished = Date.parse(left.publishedAt)
    const rightPublished = Date.parse(right.publishedAt)
    const leftValue = Number.isFinite(leftPublished) ? leftPublished : Number.NEGATIVE_INFINITY
    const rightValue = Number.isFinite(rightPublished) ? rightPublished : Number.NEGATIVE_INFINITY
    return rightValue - leftValue || left.id.localeCompare(right.id)
  })
}

function identityFor(source: PreparedTranslationSource, provider: TranslationProvider): TranslationCacheExactLookup {
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

function currentFieldDisplay(items: readonly FeedItemDisplay[], candidate: TranslationAcceptanceCandidate, translatedText: string): boolean {
  const item = items.find(value => value.id === candidate.feedItemId)
  if (!item) return false
  return candidate.fieldName === "title" ? item.displayTitle === translatedText : item.displaySummary === translatedText
}

async function verifyRestartReadback(
  options: TranslationLiveAcceptanceOptions,
  candidate: TranslationAcceptanceCandidate,
  translatedText: string,
  settings: ShippingSettings | undefined,
  now: Date,
): Promise<TranslationAcceptanceObservationState> {
  if (!options.reopenDatabase) return "pending"
  const reopened = await options.reopenDatabase()
  try {
    const repository = new TranslationRepository(reopened.database)
    const cache = await repository.findExactSuccessful({
      entityType: "feed_item",
      entityId: candidate.feedItemId,
      fieldName: candidate.fieldName,
      sourceHash: candidate.sourceHash,
      targetLanguage: candidate.targetLanguage,
      provider: TRANSLATION_PROVIDER_ID,
      model: TRANSLATION_MODEL,
    })
    if (!cache || cache.translatedText !== translatedText || cache.status !== "succeeded") return "pending"
    const display = await readCurrentFeedItemsForDisplay(reopened.database, options.dataMode, settings, now)
    return currentFieldDisplay(display, candidate, translatedText) ? "verified" : "pending"
  } finally {
    await reopened.close?.()
  }
}

function hardLimitedProvider(provider: TranslationProvider, count: () => number, increment: () => void): TranslationProvider {
  return {
    providerId: provider.providerId,
    model: provider.model,
    async translate(request) {
      if (count() >= TRANSLATION_LIVE_ACCEPTANCE_MAX_EXTERNAL_CALLS) {
        const error = new Error("translation_acceptance_external_call_limit")
        Object.assign(error, { code: "provider_contract_changed" })
        throw error
      }
      increment()
      return provider.translate(request)
    },
  }
}

async function runTranslationLiveAcceptanceUnlocked(options: TranslationLiveAcceptanceOptions): Promise<TranslationLiveAcceptanceRunResult> {
  const now = options.now ?? (() => new Date())
  const runAt = now()
  const shippingRepository = new ShippingRepository(options.database, options.dataMode)
  const settings = await shippingRepository.getSettings()
  const preflight = await readTranslationAcceptancePreflight(options.database, settings?.translation, options.secretStore, runAt, {
    allowExternalCalls: options.allowExternalCalls,
    realFeedMode: options.dataMode === "real",
  })
  if (!preflight.plan.allowed) return { evidence: preflight }

  const runtimeRepository = new RuntimeRepository(options.database)
  const translationRepository = new TranslationRepository(options.database)
  let gate
  try {
    gate = await assertTranslationReady(settings?.translation, options.secretStore, (await currentTranslationUsage(options.database, runAt)).estimatedCost)
  } catch (error) {
    const plan = { ...preflight.plan, allowed: false, maxExternalCalls: 0 as const, blockers: [...preflight.plan.blockers, safeErrorCode(error)] }
    return { evidence: buildTranslationAcceptanceEvidence(plan) }
  }

  const rawProvider = options.provider ?? createDeepSeekTranslationProvider({ apiKey: gate.apiKey, timeoutMs: TRANSLATION_PROVIDER_TIMEOUT_MS })
  if (rawProvider.providerId !== TRANSLATION_PROVIDER_ID || rawProvider.model !== TRANSLATION_MODEL) {
    const plan = { ...preflight.plan, allowed: false, maxExternalCalls: 0 as const, blockers: [...preflight.plan.blockers, "translation_provider_or_model_not_allowed"] }
    return { evidence: buildTranslationAcceptanceEvidence(plan) }
  }
  let providerCallCount = 0
  const provider = hardLimitedProvider(rawProvider, () => providerCallCount, () => {
    providerCallCount += 1
  })
  const service = new TranslationService(translationRepository, provider, {
    targetLanguage: gate.settings.targetLanguage,
    preference: { providerId: provider.providerId, model: provider.model },
    now: () => now().toISOString(),
  })

  const diagnosticSource = service.prepare({
    entityType: "translation_test",
    entityId: TRANSLATION_TEST_ENTITY_ID,
    fieldName: "summary",
    sourceText: TRANSLATION_LIVE_ACCEPTANCE_INPUT,
    targetLanguage: gate.settings.targetLanguage,
    protectedTerms: diagnosticProtectedTerms,
  })
  const diagnosticIdentity = identityFor(diagnosticSource, provider)
  const diagnosticBeforeCache = await translationRepository.findWork(diagnosticIdentity)
  const diagnosticUsageBefore = await currentTranslationUsage(options.database, now())
  const diagnostic = await service.execute(diagnosticSource)
  const diagnosticAt = now().toISOString()
  const diagnosticEstimatedCost = estimateDeepSeekCost(diagnostic.usage, new Date(diagnosticAt))
  const diagnosticUsageContractValid = usageContractIsValid(diagnostic.usage)
    && Number.isFinite(diagnosticEstimatedCost)
    && diagnosticEstimatedCost >= 0
  const recordedDiagnostic = diagnosticUsageContractValid
    ? diagnostic
    : { ...diagnostic, status: "failed" as const, errorCode: "provider_contract_changed", usage: undefined }
  const diagnosticUsage = diagnosticUsageContractValid
    ? { ...usagePatch(diagnosticSource, diagnostic, "translation_test", diagnosticAt), records: 0 }
    : { ...usagePatch(diagnosticSource, diagnostic, "translation_test", diagnosticAt), succeeded: false, failed: true, records: 0, estimatedCost: 0, errorCode: "provider_contract_changed" }
  await runtimeRepository.recordProviderUsage(diagnosticUsage)
  const diagnosticUsageAfter = await currentTranslationUsage(options.database, new Date(diagnosticAt))
  const diagnosticLatestUsage = await runtimeRepository.findLatestProviderUsage({ providerId: TRANSLATION_PROVIDER_ID, capability: TRANSLATION_CAPABILITY })
  const diagnosticAfterCache = await translationRepository.findWork(diagnosticIdentity)
  const diagnosticUsageValid = diagnosticUsageContractValid
    && Math.abs((diagnosticUsage.estimatedCost ?? 0) - diagnosticEstimatedCost) < 1e-12
  const diagnosticEvidence = emptyDiagnostic({
    attempted: providerCallCount > 0,
    providerCalled: diagnostic.providerCalled,
    externalCalls: providerCallCount,
    status: recordedDiagnostic.status === "failed" ? "failed" : "succeeded",
    sourceHash: diagnostic.sourceHash,
    usageContract: diagnosticUsageValid && sameUsageDelta(diagnosticUsageBefore, diagnosticUsageAfter, diagnostic, diagnosticAt) && isDiagnosticUsageScope(diagnosticLatestUsage?.sourceScope) ? "verified" : "pending",
    placeholderPreserved: diagnostic.status === "succeeded" && diagnostic.translatedText.includes("TEST STAR") && diagnostic.translatedText.includes("AB123") && diagnostic.translatedText.includes("SGSIN") && diagnostic.translatedText.includes("2026-09-02") && diagnostic.translatedText.includes("https://example.com/status") ? "verified" : "pending",
    wrapperBoundary: diagnostic.status === "succeeded" && !/^\s*(?:Translation|Here is the translation|Translated text|翻译如下|译文)\s*[:：]/i.test(diagnostic.translatedText) ? "verified" : "pending",
    providerUsagePersisted: sameUsageDelta(diagnosticUsageBefore, diagnosticUsageAfter, recordedDiagnostic, diagnosticAt) && isDiagnosticUsageScope(diagnosticLatestUsage?.sourceScope) ? "verified" : "pending",
    cacheIsolation: JSON.stringify(diagnosticBeforeCache) === JSON.stringify(diagnosticAfterCache) ? "verified" : "pending",
    errorCode: diagnostic.errorCode ?? recordedDiagnostic.errorCode,
  })

  if (diagnosticEvidence.errorCode && isTranslationCircuitBlockingFailure(diagnosticEvidence.errorCode)) {
    await runtimeRepository.blockProviderCircuit({
      providerId: TRANSLATION_PROVIDER_ID,
      capability: TRANSLATION_CAPABILITY,
      errorCode: diagnosticEvidence.errorCode,
      errorMessage: diagnostic.errorMessage ?? diagnosticEvidence.errorCode,
      updatedAt: diagnosticAt,
    })
  }

  if (diagnosticEvidence.status !== "succeeded" || diagnosticEvidence.usageContract !== "verified" || diagnosticEvidence.placeholderPreserved !== "verified" || diagnosticEvidence.wrapperBoundary !== "verified" || diagnosticEvidence.providerUsagePersisted !== "verified" || diagnosticEvidence.cacheIsolation !== "verified") {
    const phase2 = emptyFeed({ errorCode: diagnosticEvidence.errorCode ?? "translation_phase1_failed" })
    return { evidence: buildEvidence(preflight.plan, diagnosticEvidence, phase2, diagnosticEvidence.errorCode ?? "translation_phase1_failed") }
  }

  const currentItems = sortedCurrentFeed(await shippingRepository.listFeedItems({ now: runAt, view: "current" }))
  let candidateSource: PreparedTranslationSource | undefined
  let candidateItem: FeedItem | undefined
  for (const item of currentItems) {
    if (item.source_type === "mock" || !isFeedItemTranslationEligible(item, runAt)) continue
    const sources = feedTranslationSources(item, gate.settings.targetLanguage, undefined, runAt)
    for (const source of sources) {
      const prepared = service.prepare(source)
      if (await translationRepository.findExactSuccessful(identityFor(prepared, provider))) continue
      candidateSource = prepared
      candidateItem = item
      break
    }
    if (candidateSource) break
  }
  if (!candidateSource || !candidateItem) {
    return { evidence: buildEvidence(preflight.plan, diagnosticEvidence, emptyFeed({ errorCode: "no_uncached_current_feed_candidate" }), "no_uncached_current_feed_candidate") }
  }

  const candidate: TranslationAcceptanceCandidate = {
    feedItemId: candidateItem.id,
    fieldName: candidateSource.fieldName as "title" | "summary",
    sourceHash: candidateSource.sourceHash,
    targetLanguage: candidateSource.targetLanguage,
  }
  const originalFacts = { title: candidateItem.title, summary: candidateItem.summary }
  const claimAt = now()
  const claimAtIso = claimAt.toISOString()
  const leaseUntil = new Date(claimAt.getTime() + TRANSLATION_LEASE_MS).toISOString()
  const identity = identityFor(candidateSource, provider)
  const claimed = await translationRepository.claimTranslationWork({ ...identity, sourceText: candidateSource.sourceText, sourceLanguage: candidateSource.sourceLanguage, now: claimAtIso, leaseUntil })
  if (!claimed) {
    const phase2 = emptyFeed({ candidate, errorCode: "translation_candidate_claim_unavailable" })
    return { evidence: buildEvidence(preflight.plan, diagnosticEvidence, phase2, "translation_candidate_claim_unavailable"), candidate }
  }

  await options.beforePhase2Gate?.()
  const latestItems = await shippingRepository.listFeedItems({ now: now(), view: "current" })
  const latestItem = latestItems.find(item => item.id === candidate.feedItemId)
  const latestSource = latestItem && latestItem.source_type !== "mock" && isFeedItemTranslationEligible(latestItem, now())
    ? feedTranslationSources(latestItem, candidateSource.targetLanguage, candidateSource.sourceLanguage, now()).find(source => source.fieldName === candidate.fieldName)
    : undefined
  if (!latestSource) {
    await translationRepository.releaseTranslationClaim({ ...identity, leaseUntil, errorCode: "translation_source_no_longer_eligible", errorMessage: "source is no longer eligible", retryable: false })
    return { evidence: buildEvidence(preflight.plan, diagnosticEvidence, emptyFeed({ candidate, originalFactsPreserved: "verified", cachePersistence: "verified", errorCode: "translation_source_no_longer_eligible" }), "translation_source_no_longer_eligible"), candidate }
  }
  const latestPrepared = service.prepare(latestSource)
  if (latestPrepared.sourceHash !== claimed.sourceHash) {
    await translationRepository.releaseTranslationClaim({ ...identity, leaseUntil, errorCode: "translation_source_changed", errorMessage: "source hash changed before call", retryable: false })
    const originalFactsPreserved = Boolean(latestItem && latestItem.title === originalFacts.title && latestItem.summary === originalFacts.summary)
    return { evidence: buildEvidence(preflight.plan, diagnosticEvidence, emptyFeed({ candidate, originalFactsPreserved: originalFactsPreserved ? "verified" : "pending", cachePersistence: "verified", errorCode: "translation_source_changed" }), "translation_source_changed"), candidate }
  }

  const latestRuntime = await runtimeRepository.getProviderRuntime(TRANSLATION_PROVIDER_ID, TRANSLATION_CAPABILITY)
  const latestUsage = await currentTranslationUsage(options.database, now())
  let latestGate
  try {
    latestGate = await assertTranslationReady((await shippingRepository.getSettings())?.translation, options.secretStore, latestUsage.estimatedCost)
  } catch (error) {
    const code = safeErrorCode(error)
    await translationRepository.releaseTranslationClaim({ ...identity, leaseUntil, errorCode: "translation_gate_changed", errorMessage: code, retryable: true, nextRetryAt: now().toISOString() })
    return { evidence: buildEvidence(preflight.plan, diagnosticEvidence, emptyFeed({ candidate, originalFactsPreserved: "verified", cachePersistence: "verified", errorCode: code }), "translation_gate_changed"), candidate }
  }
  if (latestGate.settings.providerId !== provider.providerId || latestGate.settings.model !== provider.model || latestGate.settings.targetLanguage !== candidate.targetLanguage || isProviderCircuitBlocked(latestRuntime)) {
    await translationRepository.releaseTranslationClaim({ ...identity, leaseUntil, errorCode: "translation_gate_changed", errorMessage: "provider gate changed before call", retryable: true, nextRetryAt: now().toISOString() })
    return { evidence: buildEvidence(preflight.plan, diagnosticEvidence, emptyFeed({ candidate, originalFactsPreserved: "verified", cachePersistence: "verified", errorCode: "translation_gate_changed" }), "translation_gate_changed"), candidate }
  }
  if (await translationRepository.findExactSuccessful(identity)) {
    await translationRepository.releaseTranslationClaim({ ...identity, leaseUntil, errorCode: "translation_exact_cache_appeared", errorMessage: "exact success appeared before call", retryable: false })
    return { evidence: buildEvidence(preflight.plan, diagnosticEvidence, emptyFeed({ candidate, originalFactsPreserved: "verified", cachePersistence: "verified", errorCode: "translation_exact_cache_appeared" }), "translation_exact_cache_appeared"), candidate }
  }
  if (providerCallCount >= TRANSLATION_LIVE_ACCEPTANCE_MAX_EXTERNAL_CALLS) {
    await translationRepository.releaseTranslationClaim({ ...identity, leaseUntil, errorCode: "translation_acceptance_external_call_limit", errorMessage: "acceptance call limit reached before Feed call", retryable: false })
    return { evidence: buildEvidence(preflight.plan, diagnosticEvidence, emptyFeed({ candidate, originalFactsPreserved: "verified", cachePersistence: "verified", errorCode: "translation_acceptance_external_call_limit" }), "translation_acceptance_external_call_limit"), candidate }
  }

  const phase2Execution = await service.execute(latestSource)
  const phase2At = now().toISOString()
  const phase2UsageContractValid = usageContractIsValid(phase2Execution.usage)
  const phase2Usage = phase2UsageContractValid
    ? usagePatch(latestPrepared, phase2Execution, "feed", phase2At)
    : { ...usagePatch(latestPrepared, phase2Execution, "feed", phase2At), succeeded: false, failed: true, records: 0, estimatedCost: 0, errorCode: "provider_contract_changed" }
  let persisted
  let phase2ErrorCode: string | undefined
  if (phase2Execution.status === "succeeded" && phase2UsageContractValid) {
    persisted = await translationRepository.completeTranslationSuccess({ ...identity, leaseUntil, translatedText: phase2Execution.translatedText, translatedAt: phase2At, now: phase2At, providerUsage: phase2Usage })
  } else {
    const code: TranslationFailureCode = isKnownProviderFailureCode(phase2Execution.errorCode) ? phase2Execution.errorCode : "provider_contract_changed"
    phase2ErrorCode = code
    if (isTranslationRetryableFailure(code)) {
      persisted = await translationRepository.completeRetryableFailure({ ...identity, leaseUntil, errorCode: code, errorMessage: phase2Execution.errorMessage ?? code, nextRetryAt: new Date(Date.parse(phase2At) + translationRetryBackoffMs(claimed.retryCount ?? 0)).toISOString(), now: phase2At, providerUsage: phase2Usage })
    } else {
      persisted = await translationRepository.completeNonRetryableFailure({ ...identity, leaseUntil, errorCode: code, errorMessage: phase2Execution.errorMessage ?? code, now: phase2At, providerUsage: phase2Usage })
    }
    if (isTranslationCircuitBlockingFailure(code)) {
      await runtimeRepository.blockProviderCircuit({ providerId: TRANSLATION_PROVIDER_ID, capability: TRANSLATION_CAPABILITY, errorCode: code, errorMessage: phase2Execution.errorMessage ?? code, updatedAt: phase2At })
    }
  }

  const persistedSuccess = phase2Execution.status === "succeeded" && phase2UsageContractValid
    && persisted.status === "succeeded"
    && persisted.translatedText === phase2Execution.translatedText
    && persisted.sourceHash === candidate.sourceHash
    && persisted.provider === provider.providerId
    && persisted.model === provider.model
    && !persisted.leaseUntil
    && persisted.retryCount === 0
    && !persisted.nextRetryAt
    && persisted.retryable === false
    && !persisted.lastErrorCode
  const phase2LatestItem = (await shippingRepository.listFeedItems({ now: now(), view: "current" })).find(item => item.id === candidate.feedItemId)
  const originalFactsStillPreserved = Boolean(phase2LatestItem && phase2LatestItem.title === originalFacts.title && phase2LatestItem.summary === originalFacts.summary)
  const displayItems = await readCurrentFeedItemsForDisplay(options.database, options.dataMode, await shippingRepository.getSettings(), new Date(phase2At))
  const displayReadback = persistedSuccess && currentFieldDisplay(displayItems, candidate, phase2Execution.translatedText)
  const restartReadback = persistedSuccess
    ? await verifyRestartReadback(options, candidate, phase2Execution.translatedText, await shippingRepository.getSettings(), new Date(phase2At))
    : "pending"
  const phase2LatestUsage = await runtimeRepository.findLatestProviderUsage({ providerId: TRANSLATION_PROVIDER_ID, capability: TRANSLATION_CAPABILITY })
  const phase2 = emptyFeed({
    attempted: phase2Execution.providerCalled,
    providerCalled: phase2Execution.providerCalled,
    externalCalls: providerCallCount - diagnosticEvidence.externalCalls,
    status: phase2Execution.status === "succeeded" && phase2UsageContractValid ? "succeeded" : "failed",
    candidate,
    originalFactsPreserved: originalFactsStillPreserved ? "verified" : "pending",
    cachePersistence: persisted ? "verified" : "pending",
    providerUsagePersisted: persisted && phase2LatestUsage?.lastCalledAt === phase2At ? "verified" : "pending",
    retryStateCleared: persistedSuccess ? "verified" : "pending",
    feedReadback: displayReadback ? "verified" : "pending",
    restartReadback,
    providerFreeRead: displayReadback ? "verified" : "pending",
    errorCode: phase2ErrorCode ?? phase2Execution.errorCode,
  })
  return { evidence: buildEvidence(preflight.plan, diagnosticEvidence, phase2, persistedSuccess ? "browser_ui_readback_pending" : phase2.errorCode ?? "translation_phase2_failed"), candidate }
}

/** Executes the bounded runner; it never uses the ordinary translation-sync job. */
export async function runTranslationLiveAcceptance(options: TranslationLiveAcceptanceOptions): Promise<TranslationLiveAcceptanceRunResult> {
  return withTranslationExecutor(() => runTranslationLiveAcceptanceUnlocked(options))
}

export function finalizeTranslationAcceptanceEvidence(
  serverEvidence: TranslationAcceptanceEvidence,
  browserEvidence?: TranslationAcceptanceBrowserEvidence,
): TranslationAcceptanceEvidence {
  if (!browserEvidence || serverEvidence.serverAcceptance !== "verified" || !serverEvidence.candidate) return serverEvidence
  const candidateMatches = browserEvidence.feedItemId === serverEvidence.candidate.feedItemId
    && browserEvidence.fieldName === serverEvidence.candidate.fieldName
    && browserEvidence.sourceHash === serverEvidence.candidate.sourceHash
  const browserVerified = candidateMatches
    && browserEvidence.uiReadback === "verified"
    && browserEvidence.originalDisclosure === "verified"
    && browserEvidence.consoleErrors === 0
    && browserEvidence.externalCalls === 0
  if (!browserVerified) return serverEvidence
  return { ...serverEvidence, liveVerification: "verified_live", feedUiReadback: "verified", reason: undefined }
}
