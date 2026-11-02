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
  parseExtractOutput,
  parsePrefilterDecision,
  runOfflineAnalyze,
} from "#/intel/llm/analyze-pipeline"
import type { IntelAnalysisRecord } from "#/database/intel-analysis"
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

const SUCCESS_STATUSES = new Set(["completed", "reused"])

function parseOutputJson(raw: string | null): unknown {
  if (!raw) return null
  try {
    return JSON.parse(raw) as unknown
  } catch {
    return null
  }
}

function severityScoreFromRow(row: IntelAnalysisRecord): number | null {
  try {
    const basis = JSON.parse(row.basis || "{}") as Record<string, unknown>
    if (typeof basis.severity === "number" && Number.isFinite(basis.severity)) {
      return basis.severity
    }
  } catch {
    // fall through
  }
  const out = parseOutputJson(row.outputJson)
  if (out && typeof out === "object" && !Array.isArray(out)) {
    const basis = (out as Record<string, unknown>).basis
    if (basis && typeof basis === "object" && !Array.isArray(basis)) {
      const sev = (basis as Record<string, unknown>).severity
      if (typeof sev === "number" && Number.isFinite(sev)) return sev
    }
  }
  return null
}

function prefilterDecisionFromRow(row: IntelAnalysisRecord): string | null {
  const out = parseOutputJson(row.outputJson)
  if (out && typeof out === "object" && !Array.isArray(out)) {
    const decision = (out as Record<string, unknown>).decision
    if (decision === "PASS" || decision === "BLOCK" || decision === "UNKNOWN") {
      return decision
    }
    // Some rows store nested { decision: { decision: "PASS", ... } } — normalize via parser.
  }
  // Reuse parsePrefilterDecision on the raw JSON / content string when present.
  const parsed = parsePrefilterDecision(row.outputJson, false)
  return parsed
}

function extractEventTypeFromRow(row: IntelAnalysisRecord): string | null {
  const out = parseOutputJson(row.outputJson)
  if (!out || typeof out !== "object" || Array.isArray(out)) return null
  const wrap = out as Record<string, unknown>
  const extractRaw = (wrap.extract && typeof wrap.extract === "object" && !Array.isArray(wrap.extract))
    ? wrap.extract
    : wrap
  const extract = parseExtractOutput(extractRaw)
  return extract?.eventType ?? null
}

/**
 * Verify from trusted persisted intel_analysis rows that this exact run reached
 * a complete successful analyze end-state (prefilter PASS + extract + dual
 * severity, + tiebreak when scores diverge). Caller-claimed success is ignored.
 * Extract-only / failed / incomplete / BLOCK / non-policy → not ok.
 */
export function verifyPersistedExactRunAnalyzeSuccess(
  rows: IntelAnalysisRecord[],
  identity: {
    itemId: string
    versionId: string
    contentHash: string
    runId: string
  },
): { ok: true } | { ok: false, reason: string } {
  if (![identity.itemId, identity.versionId, identity.contentHash, identity.runId]
    .every(v => typeof v === "string" && v.length > 0)) {
    return { ok: false, reason: "invalid_exact_identity" }
  }

  const runRows = rows.filter(r => r.runId === identity.runId)
  if (!runRows.length) return { ok: false, reason: "run_not_found" }

  if (runRows.some(r =>
    r.itemId !== identity.itemId
    || r.versionId !== identity.versionId
    || r.contentHash !== identity.contentHash,
  )) {
    return { ok: false, reason: "analysis_identity_mismatch" }
  }

  const okRows = (step: string) => runRows.filter(
    r => r.step === step && SUCCESS_STATUSES.has(r.status),
  )

  const prefilterOk = okRows("prefilter")
  if (!prefilterOk.length) {
    const anyPre = runRows.filter(r => r.step === "prefilter")
    // BLOCK is normally status completed|reused (caught above); keep defensive path.
    if (anyPre.some(r => prefilterDecisionFromRow(r) === "BLOCK")) {
      return { ok: false, reason: "prefilter_blocked" }
    }
    if (anyPre.some(r => r.status === "failed" || r.status === "denied")) {
      return { ok: false, reason: "analyze_failed:prefilter" }
    }
    return { ok: false, reason: "analyze_incomplete:prefilter" }
  }

  // Prefer latest successful prefilter decision for this run.
  const preDecision = prefilterDecisionFromRow(
    prefilterOk.slice().sort((a, b) => a.createdAt.localeCompare(b.createdAt)).at(-1)!,
  )
  if (preDecision === "BLOCK") return { ok: false, reason: "prefilter_blocked" }
  if (preDecision !== "PASS") return { ok: false, reason: "analyze_incomplete:prefilter_not_pass" }

  const extractOk = okRows("extract")
  if (!extractOk.length) {
    if (runRows.some(r => r.step === "extract" && (r.status === "failed" || r.status === "denied"))) {
      return { ok: false, reason: "analyze_failed:extract" }
    }
    return { ok: false, reason: "analyze_incomplete:extract" }
  }
  const eventType = extractEventTypeFromRow(
    extractOk.slice().sort((a, b) => a.createdAt.localeCompare(b.createdAt)).at(-1)!,
  )
  if (!eventType) return { ok: false, reason: "extract_parse_failed" }
  if (!isPolicyAutoEventType(eventType)) {
    return { ok: false, reason: "event_type_not_policy" }
  }

  const severityOk = okRows("severity")
  const byAttempt = new Map<number, IntelAnalysisRecord>()
  for (const row of severityOk) {
    const prev = byAttempt.get(row.attemptIndex)
    if (!prev || row.createdAt >= prev.createdAt) byAttempt.set(row.attemptIndex, row)
  }
  const sev1 = byAttempt.get(1)
  const sev2 = byAttempt.get(2)
  if (!sev1 || !sev2) {
    if (runRows.some(r => r.step === "severity" && (r.status === "failed" || r.status === "denied"))) {
      return { ok: false, reason: "analyze_failed:severity" }
    }
    return { ok: false, reason: "analyze_incomplete:severity" }
  }

  const score1 = severityScoreFromRow(sev1)
  const score2 = severityScoreFromRow(sev2)
  if (score1 === null || score2 === null) {
    return { ok: false, reason: "analyze_incomplete:severity_score" }
  }

  if (Math.abs(score1 - score2) > 1) {
    const tieOk = okRows("severity_tiebreak")
    if (!tieOk.length) {
      if (runRows.some(r => r.step === "severity_tiebreak" && (r.status === "failed" || r.status === "denied"))) {
        return { ok: false, reason: "analyze_failed:severity_tiebreak" }
      }
      return { ok: false, reason: "analyze_incomplete:severity_tiebreak" }
    }
  }

  return { ok: true }
}

/**
 * Recover policy落库 after a prior successful analyze without re-paying Provider.
 * Requires exact item/version/hash + runId already persisted in intel_analysis,
 * and that run must prove a complete successful analyze end-state from DB rows
 * (not caller claim; not extract-only). Zero new Provider calls.
 */
export async function retryPolicyApplyFromExactRun(
  input: RetryPolicyFromExactRunInput,
): Promise<PolicyAutoResult> {
  const policyAuto = resolvePolicyAuto(input.db, input.policyAuto, input.policies)
  const analysisRepo = input.analysisRepo ?? new IntelAnalysisRepository(input.db)
  const now = input.now ? input.now() : new Date()

  const persisted = await analysisRepo.listForVersion(input.itemId, input.versionId)
  const verified = verifyPersistedExactRunAnalyzeSuccess(persisted, {
    itemId: input.itemId,
    versionId: input.versionId,
    contentHash: input.contentHash,
    runId: input.runId,
  })
  if (!verified.ok) {
    return {
      outcome: "rejected",
      reason: `analyze_success_unverified:${verified.reason}`,
    }
  }

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
