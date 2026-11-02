/**
 * A1 — explicit offline analyze → policy-auto orchestration.
 *
 * Default OFF. No HTTP route, no cron, no BackgroundRuntime hook, and GET/browse
 * paths must never import-call this entry. Reuses runOfflineAnalyze +
 * PolicyAutoService.applyFromExactIntel without expanding ExactVersion license
 * issuance (A2 / production授权仍未接通).
 */
import type { Database } from "db0"
import { IntelAnalysisRepository } from "#/database/intel-analysis"
import { PolicyRepository } from "#/database/policy"
import {
  type AnalyzePipelineInput,
  type AnalyzePipelineResult,
  runOfflineAnalyze,
} from "#/intel/llm/analyze-pipeline"
import {
  type PolicyAutoResult,
  PolicyAutoService,
  isPolicyAutoEventType,
} from "#/intel/policy-auto"

/** Documented env name; never enables by itself — caller must pass enablePolicyAuto:true. */
export const OFFLINE_POLICY_AUTO_ENV = "SHIPPING_OFFLINE_POLICY_AUTO_AFTER_ANALYZE"

export interface OfflineAnalyzePolicyInput extends AnalyzePipelineInput {
  /**
   * Explicit opt-in for policy apply after a successful exact analyze run.
   * Default false. Env SHIPPING_OFFLINE_POLICY_AUTO_AFTER_ANALYZE alone does not enable.
   */
  enablePolicyAuto?: boolean
  /** Optional injected service (tests / fault injection). */
  policyAuto?: PolicyAutoService
  policies?: PolicyRepository
  analysisRepoForPolicy?: IntelAnalysisRepository
  enteredBy?: string
  isFixture?: boolean
}

export interface OfflineAnalyzePolicyResult {
  analyze: AnalyzePipelineResult
  /** Null when policy step was not attempted. */
  policy: PolicyAutoResult | null
  /** Why policy apply was skipped (disabled / non-policy / block / incomplete / …). */
  policySkippedReason: string | null
  /** Set when policy apply threw; analyze rows remain for retry without re-pay. */
  policyError: string | null
}

export interface RetryPolicyFromExactRunInput {
  db: Database
  intelRepo: AnalyzePipelineInput["intelRepo"]
  analysisRepo?: IntelAnalysisRepository
  policyAuto?: PolicyAutoService
  policies?: PolicyRepository
  itemId: string
  versionId: string
  contentHash: string
  runId: string
  enteredBy?: string
  isFixture?: boolean
  now?: () => Date
}

function resolvePolicyAuto(
  db: Database,
  injected: PolicyAutoService | undefined,
  policies: PolicyRepository | undefined,
): PolicyAutoService {
  if (injected) return injected
  return new PolicyAutoService(db, policies ?? new PolicyRepository(db))
}

function singleRunId(analyses: Array<{ runId?: string | null }>): string | null {
  const ids = [...new Set(
    analyses
      .map(a => a.runId)
      .filter((v): v is string => typeof v === "string" && v.length > 0),
  )]
  return ids.length === 1 ? ids[0]! : null
}

/**
 * Decide whether this successful analyze result may call applyFromExactIntel.
 * Failures / BLOCK / non-policy / incomplete identity never apply.
 */
export function decidePolicyApplyAfterAnalyze(
  enablePolicyAuto: boolean | undefined,
  analyze: AnalyzePipelineResult,
): { apply: true, runId: string } | { apply: false, reason: string } {
  if (enablePolicyAuto !== true) {
    return { apply: false, reason: "policy_auto_disabled" }
  }
  if (!analyze.ok) {
    return { apply: false, reason: `analyze_not_ok:${analyze.code}` }
  }
  if (analyze.status === "skipped_block") {
    return { apply: false, reason: "prefilter_blocked" }
  }
  if (analyze.status !== "completed" && analyze.status !== "reused") {
    return { apply: false, reason: `analyze_status:${analyze.status}` }
  }
  if (!analyze.extract || !isPolicyAutoEventType(analyze.extract.eventType)) {
    return { apply: false, reason: "event_type_not_policy" }
  }
  const mismatch = analyze.analyses.some(
    a => a.itemId !== analyze.itemId
      || a.versionId !== analyze.versionId
      || a.contentHash !== analyze.contentHash,
  )
  if (mismatch) return { apply: false, reason: "analysis_identity_mismatch" }

  const runId = singleRunId(analyze.analyses)
  if (!runId) return { apply: false, reason: "run_id_unresolved" }
  return { apply: true, runId }
}

/**
 * Explicit offline entry: runOfflineAnalyze, then optionally applyFromExactIntel.
 * Does not invent license evidence; does not open production triggers.
 */
export async function runOfflineAnalyzeThenPolicy(
  input: OfflineAnalyzePolicyInput,
): Promise<OfflineAnalyzePolicyResult> {
  const analyze = await runOfflineAnalyze(input)
  const decision = decidePolicyApplyAfterAnalyze(input.enablePolicyAuto, analyze)
  if (!decision.apply) {
    return {
      analyze,
      policy: null,
      policySkippedReason: decision.reason,
      policyError: null,
    }
  }
  if (!analyze.ok) {
    return {
      analyze,
      policy: null,
      policySkippedReason: "analyze_not_ok",
      policyError: null,
    }
  }

  const policyAuto = resolvePolicyAuto(input.db, input.policyAuto, input.policies)
  const analysisRepo = input.analysisRepoForPolicy
    ?? input.analysisRepo
    ?? new IntelAnalysisRepository(input.db)
  const now = input.now ? input.now() : new Date()

  try {
    const policy = await policyAuto.applyFromExactIntel(
      { intelRepo: input.intelRepo, analysisRepo },
      {
        itemId: analyze.itemId,
        versionId: analyze.versionId,
        contentHash: analyze.contentHash,
        runId: decision.runId,
        enteredBy: input.enteredBy ?? "offline-analyze-policy",
        isFixture: input.isFixture ?? true,
      },
      now,
    )
    return {
      analyze,
      policy,
      policySkippedReason: null,
      policyError: null,
    }
  } catch (error) {
    return {
      analyze,
      policy: null,
      policySkippedReason: null,
      policyError: error instanceof Error ? error.message : "policy_apply_failed",
    }
  }
}

/**
 * Recover policy落库 after a prior successful analyze without re-paying Provider.
 * Requires exact item/version/hash + runId already persisted in intel_analysis.
 */
export async function retryPolicyApplyFromExactRun(
  input: RetryPolicyFromExactRunInput,
): Promise<PolicyAutoResult> {
  const policyAuto = resolvePolicyAuto(input.db, input.policyAuto, input.policies)
  const analysisRepo = input.analysisRepo ?? new IntelAnalysisRepository(input.db)
  const now = input.now ? input.now() : new Date()
  return await policyAuto.applyFromExactIntel(
    { intelRepo: input.intelRepo, analysisRepo },
    {
      itemId: input.itemId,
      versionId: input.versionId,
      contentHash: input.contentHash,
      runId: input.runId,
      enteredBy: input.enteredBy ?? "offline-analyze-policy-retry",
      isFixture: input.isFixture ?? true,
    },
    now,
  )
}
