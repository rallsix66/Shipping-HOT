/**
 * Offline intel analyze chain (R3-1 / ADR-007 / plan section 4.1-4.2):
 * dedupe -> admitModelPayload -> prefilter -> extract -> dual severity (+ optional median).
 *
 * - Exact item/version via readIntelMaterial; GET paths never call this module.
 * - Missing rights/binding/budget/version stops before provider.
 * - Per-step paidCtx.currency = model.currency (checked against shared pool BEFORE provider).
 * - Reuse identity = reuse_key over provider/endpoint/model config + prompt + step input.
 * - Strict output validation; illegal output stays auditable failed (no completed, no re-bill).
 * - Severity attempts independent; median3 keeps all three evidences.
 * - Default resolveClaimConfig = createPaidClaimBudgetResolver({ mode: "registry" }).
 * - PRODUCTION BOUNDARY: injectable offline helper; not a claim of live HTTP/production pool wiring.
 */
import { createHash } from "node:crypto"
import type { Database } from "db0"
import type { IntelRepository } from "#/database/intel"
import { type IntelAnalysisRecord, IntelAnalysisRepository, type IntelAnalysisStep } from "#/database/intel-analysis"
import { readClipAudit } from "#/intel/manual-license"
import { readIntelMaterial } from "#/intel/material-read"
import { type ExactVersionModelLicense, admitModelPayload } from "#/intel/llm/model-payload-gate"
import { estimateTokenCost, resolveStepBinding } from "#/intel/llm/registry"
import {
  PaidCostError,
  PaidGateError,
  type PaidRequestContext,
  ProviderRejectedError,
  ReceiptBusyError,
  type ReceiptResult,
  ReceiptUnknownError,
  paidRequest,
} from "#/intel/llm/receipts"
import { type OpenAiCompatibleTransport, createOpenAiCompatibleClient } from "#/intel/llm/openai-compatible"
import {
  EXTRACT_PROMPT,
  PREFILTER_PROMPT,
  SEVERITY_SCORE_PROMPT,
  buildExtractUserMessage,
  buildPrefilterUserMessage,
  buildSeverityUserMessage,
} from "#/intel/industry/prompts"
import {
  type DimensionScores,
  type EventType,
  type SeverityBasis,
  aggregateMedianSeverity,
  computeSeverity,
  isEventType,
} from "#/intel/industry/selection"
import type { SecretStore } from "#/providers/contracts"
import type { SharedLlmBudgetGate } from "#/intel/llm/shared-budget"
import { type PaidClaimBudgetConfig, createPaidClaimBudgetResolver } from "#/services/shared-llm-budget-settings"
import type { LlmModelRecord, LlmProviderRecord } from "#/database/llm-registry"

export type { ExactVersionModelLicense }

export type PrefilterDecision = "PASS" | "BLOCK" | "UNKNOWN"

export interface ExtractedIntel {
  eventType: EventType
  countries: string[]
  ports: string[]
  cities: string[]
  chainStages: string[]
  namedEntity: string | null
  occurredAt: string | null
  effectiveFrom: string | null
  effectiveUntil: string | null
  /** Preserve original wording / nulls -- never invent. */
  numbers: Record<string, string | number | null>
  isOfficialStatement: boolean | null
  isFirstParty: boolean | null
  dimensions: DimensionScores
  /** Explicit routine-notice evidence from extract when present. */
  routineNotice?: boolean | null
}

export interface AnalyzePipelineInput {
  db: Database
  intelRepo: Pick<IntelRepository, "getItem" | "getSource" | "getVersion" | "readVersionBlocks" | "getManualVersionAction">
  analysisRepo?: IntelAnalysisRepository
  secretStore: SecretStore
  itemId: string
  versionId: string
  /**
   * Exact-version model-use license. Bare `true` is NOT accepted.
   * Must bind itemId/versionId/contentHash of the material under analysis.
   */
  modelUseLicense: ExactVersionModelLicense
  transport: OpenAiCompatibleTransport
  /** @deprecated Prefer model currency per step; retained for callers that still pass a pool hint. */
  currency?: string
  monthlyBudget?: number | null
  sharedBudget?: SharedLlmBudgetGate
  /**
   * Claim-time budget resolver. When omitted, defaults to strict DB
   * createPaidClaimBudgetResolver({ mode: "registry" }). Test overrides must pass
   * createPaidClaimBudgetResolver({ mode, overridePool }) explicitly -- never silent.
   */
  resolveClaimConfig?: (db: Database) => Promise<PaidClaimBudgetConfig>
  now?: () => Date
  timeoutMs?: number
}

export type AnalyzeDenyCode =
  | "material_unavailable"
  | "version_mismatch"
  | "payload_denied"
  | "binding_missing"
  | "budget_denied"
  | "prefilter_blocked"
  | "extract_failed"
  | "severity_failed"
  | "provider_rejected"
  | "receipt_busy"
  | "receipt_unknown"
  | "invalid_estimate"

export type AnalyzePipelineResult =
  | {
    ok: true
    status: "completed" | "reused" | "skipped_block"
    itemId: string
    versionId: string
    contentHash: string
    prefilter: PrefilterDecision | null
    extract: ExtractedIntel | null
    severity: SeverityBasis | null
    severityScores: number[]
    analyses: IntelAnalysisRecord[]
    receiptIds: string[]
  }
  | {
    ok: false
    code: AnalyzeDenyCode | string
    reason: string
    itemId: string
    versionId: string
    analyses: IntelAnalysisRecord[]
    receiptIds: string[]
  }

/** Strict integer in [min,max] -- no Math.round coercion of floats. */
function asStrictInt(value: unknown, min: number, max: number): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || !Number.isInteger(value)) return null
  if (value < min || value > max) return null
  return value
}

/** Required string array -- wrong type fails (no silent []). */
function asStrictStringArray(value: unknown, maxLen = 120): string[] | null {
  if (!Array.isArray(value)) return null
  if (!value.every(v => typeof v === "string")) return null
  // Over-length entries fail (no silent truncate).
  if (value.some(v => (v as string).length > maxLen)) return null
  return value as string[]
}

/** UN/LOCODE: exactly 5 chars, AA + 3 alnum. Empty array allowed; invalid codes fail (no invent/drop). */
const UNLOCODE_RE = /^[A-Z]{2}[A-Z0-9]{3}$/
function asStrictUnlocodeArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null
  if (!value.every(v => typeof v === "string")) return null
  const out: string[] = []
  for (const raw of value as string[]) {
    const code = raw.trim().toUpperCase()
    if (!UNLOCODE_RE.test(code)) return null
    out.push(code)
  }
  return out
}

/** Plan chain stages ①–⑥ only. Empty array allowed; unknown marks fail (no guess mapping). */
const CHAIN_STAGES = new Set(["①", "②", "③", "④", "⑤", "⑥"])
function asStrictChainStages(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null
  if (!value.every(v => typeof v === "string")) return null
  const out: string[] = []
  for (const raw of value as string[]) {
    const s = raw.trim()
    if (!CHAIN_STAGES.has(s)) return null
    out.push(s)
  }
  return out
}

function asStrictNullableString(value: unknown): string | null | undefined {
  if (value === null) return null
  if (value === undefined) return undefined
  if (typeof value !== "string") return undefined
  return value.slice(0, 500)
}

/** Real calendar ISO date/datetime string or null. Rejects impossible dates (e.g. 2026-99-99). */
function asStrictDateOrNull(value: unknown): string | null | undefined {
  if (value === null) return null
  if (typeof value !== "string") return undefined
  const s = value.trim()
  if (!s || s.length > 64) return undefined
  // Capture optional timezone offset separately so +99:99 / +14:99 are rejected.
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(?:(Z)|([+-])(\d{2}):?(\d{2}))?)?$/)
  if (!m) return undefined
  const y = Number(m[1])
  const mo = Number(m[2])
  const d = Number(m[3])
  if (!Number.isInteger(y) || !Number.isInteger(mo) || !Number.isInteger(d)) return undefined
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return undefined
  const dt = new Date(Date.UTC(y, mo - 1, d))
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return undefined
  if (m[4] !== undefined) {
    const hh = Number(m[4])
    const mm = Number(m[5])
    const ss = m[6] !== undefined ? Number(m[6]) : 0
    if (hh > 23 || mm > 59 || ss > 59) return undefined
  }
  if (m[8] !== undefined) {
    const offH = Number(m[9])
    const offM = Number(m[10])
    // Valid civil offsets roughly UTC−12..+14; minutes must be 0..59 (reject +99:99).
    if (!Number.isInteger(offH) || !Number.isInteger(offM)) return undefined
    if (offM > 59) return undefined
    if (offH > 14 || (offH === 14 && offM > 0)) return undefined
  }
  return s
}

function asStrictNullableBool(value: unknown): boolean | null | undefined {
  if (value === null) return null
  if (typeof value === "boolean") return value
  return undefined
}

/** numbers must be a plain object (not array); values string|number|null only. No silent truncate. */
const NUMBERS_STRING_MAX = 8192
function asStrictNumbersMap(value: unknown): Record<string, string | number | null> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  const out: Record<string, string | number | null> = {}
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (v === null) {
      out[k] = null
    } else if (typeof v === "number" && Number.isFinite(v)) {
      out[k] = v
    } else if (typeof v === "string") {
      if (v.length > NUMBERS_STRING_MAX) return null
      out[k] = v
    } else {
      return null
    }
  }
  return out
}

function parseJsonObject(text: string): Record<string, unknown> | null {
  const trimmed = text.trim()
  const start = trimmed.indexOf("{")
  const end = trimmed.lastIndexOf("}")
  if (start < 0 || end <= start) return null
  try {
    const parsed = JSON.parse(trimmed.slice(start, end + 1)) as unknown
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null
    return parsed as Record<string, unknown>
  } catch {
    return null
  }
}

function coerceRawObject(raw: unknown): Record<string, unknown> | null {
  if (typeof raw === "string") return parseJsonObject(raw)
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null
  if ("content" in (raw as object) && typeof (raw as { content?: unknown }).content === "string") {
    return parseJsonObject(String((raw as { content: string }).content))
  }
  if ("response" in (raw as object)) {
    const response = (raw as { response?: unknown }).response
    if (typeof response === "string") return parseJsonObject(response)
    if (response && typeof response === "object" && "content" in (response as object)) {
      return parseJsonObject(String((response as { content: string }).content))
    }
    if (response && typeof response === "object" && !Array.isArray(response)) {
      return response as Record<string, unknown>
    }
  }
  return raw as Record<string, unknown>
}

export function parsePrefilterDecision(raw: unknown, contentMissing: boolean): PrefilterDecision | null {
  const obj = coerceRawObject(raw)
  if (!obj) return null
  const decision = obj.decision
  if (decision !== "PASS" && decision !== "BLOCK" && decision !== "UNKNOWN") return null
  if (decision === "BLOCK" && contentMissing) return "UNKNOWN"
  return decision
}

export function parseExtractOutput(raw: unknown): ExtractedIntel | null {
  const obj = coerceRawObject(raw)
  if (!obj || !isEventType(obj.eventType)) return null
  const dimsRaw = obj.dimensions
  if (!dimsRaw || typeof dimsRaw !== "object" || Array.isArray(dimsRaw)) return null
  const d = dimsRaw as Record<string, unknown>
  const impact = asStrictInt(d.impact, 0, 10)
  const scope = asStrictInt(d.scope, 0, 10)
  const urgency = asStrictInt(d.urgency, 0, 10)
  const actionability = asStrictInt(d.actionability, 0, 10)
  if (impact === null || scope === null || urgency === null || actionability === null) return null

  const countries = asStrictStringArray(obj.countries)
  const ports = asStrictUnlocodeArray(obj.ports)
  const cities = asStrictStringArray(obj.cities)
  const chainStages = asStrictChainStages(obj.chainStages)
  if (!countries || !ports || !cities || !chainStages) return null

  const namedEntity = asStrictNullableString(obj.namedEntity)
  if (namedEntity === undefined) return null
  const occurredAt = asStrictDateOrNull(obj.occurredAt)
  const effectiveFrom = asStrictDateOrNull(obj.effectiveFrom)
  const effectiveUntil = asStrictDateOrNull(obj.effectiveUntil)
  if (occurredAt === undefined || effectiveFrom === undefined || effectiveUntil === undefined) return null

  const numbers = asStrictNumbersMap(obj.numbers)
  if (!numbers) return null

  const isOfficialStatement = asStrictNullableBool(obj.isOfficialStatement)
  const isFirstParty = asStrictNullableBool(obj.isFirstParty)
  if (isOfficialStatement === undefined || isFirstParty === undefined) return null

  let routineNotice: boolean | null | undefined = null
  if ("routineNotice" in obj) {
    routineNotice = asStrictNullableBool(obj.routineNotice)
    if (routineNotice === undefined) return null
  }

  return {
    eventType: obj.eventType,
    countries,
    ports,
    cities,
    chainStages,
    namedEntity,
    occurredAt,
    effectiveFrom,
    effectiveUntil,
    numbers,
    isOfficialStatement,
    isFirstParty,
    dimensions: { impact, scope, urgency, actionability },
    routineNotice: routineNotice ?? null,
  }
}

export function parseSeverityScoreOutput(raw: unknown): { dimensions: DimensionScores, rumourOnly: boolean | null } | null {
  const obj = coerceRawObject(raw)
  if (!obj) return null
  const dimsRaw = obj.dimensions
  if (!dimsRaw || typeof dimsRaw !== "object" || Array.isArray(dimsRaw)) return null
  const d = dimsRaw as Record<string, unknown>
  const impact = asStrictInt(d.impact, 0, 10)
  const scope = asStrictInt(d.scope, 0, 10)
  const urgency = asStrictInt(d.urgency, 0, 10)
  const actionability = asStrictInt(d.actionability, 0, 10)
  if (impact === null || scope === null || urgency === null || actionability === null) return null
  const rumourOnly = asStrictNullableBool(obj.rumourOnly)
  if (rumourOnly === undefined) return null
  return {
    dimensions: { impact, scope, urgency, actionability },
    rumourOnly,
  }
}

function sha256Json(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex")
}

/**
 * Immutable reuse identity: provider/endpoint/model config + prompt + material + step input.
 * Mutable row IDs alone are never sufficient (in-place modelName/baseUrl edits must miss).
 */
export function buildAnalysisReuseKey(input: {
  step: IntelAnalysisStep
  providerId: string
  baseUrl: string
  modelId: string
  modelName: string
  unitPriceIn: number
  unitPriceOut: number
  currency: string
  promptHash: string
  contentHash: string
  stepInputFingerprint: string
}): string {
  return sha256Json({
    v: 1,
    step: input.step,
    providerId: input.providerId,
    baseUrl: input.baseUrl,
    modelId: input.modelId,
    modelName: input.modelName,
    unitPriceIn: input.unitPriceIn,
    unitPriceOut: input.unitPriceOut,
    currency: input.currency,
    promptHash: input.promptHash,
    contentHash: input.contentHash,
    stepInputFingerprint: input.stepInputFingerprint,
  })
}

function chatContentFromReceiptResponse(response: unknown): string {
  if (typeof response === "string") return response
  if (response && typeof response === "object") {
    const r = response as Record<string, unknown>
    if (typeof r.content === "string") return r.content
  }
  return ""
}
async function callChatStep(input: {
  ctx: PaidRequestContext
  provider: LlmProviderRecord
  model: LlmModelRecord
  capability: "intel_prefilter" | "intel_extract"
  purpose: string
  identity: unknown
  attemptTag: string
  system: string
  user: string
  transport: OpenAiCompatibleTransport
  estimatedTokensIn?: number
  estimatedTokensOut?: number
}): Promise<ReceiptResult> {
  // Per-step currency MUST equal the real model currency BEFORE provider.
  // CNY pool + USD model fails in claim assert with zero attempt/provider.
  const ctx: PaidRequestContext = {
    ...input.ctx,
    currency: input.model.currency,
  }
  const tokensIn = input.estimatedTokensIn ?? 400
  const tokensOut = input.estimatedTokensOut ?? 200
  const estimatedCost = estimateTokenCost(input.model, tokensIn, tokensOut)
  return paidRequest(
    ctx,
    {
      providerId: input.provider.secretRef,
      capability: input.capability,
      model: input.model.modelName,
      purpose: input.purpose,
      subject: `${input.purpose}:${input.model.id}`,
      identity: input.identity,
      requestSummary: {
        kind: "intel_analyze",
        purpose: input.purpose,
        modelId: input.model.id,
        providerId: input.provider.id,
        modelCurrency: input.model.currency,
      },
      attemptTag: input.attemptTag,
      estimatedCost,
    },
    async (apiKey) => {
      const client = createOpenAiCompatibleClient({
        baseUrl: input.provider.baseUrl,
        apiKey,
        transport: input.transport,
      })
      const response = await client.chat({
        model: input.model.modelName,
        temperature: 0,
        messages: [
          { role: "system", content: input.system },
          { role: "user", content: input.user },
        ],
      })
      const content = response.choices[0]?.message.content ?? ""
      return {
        response: { kind: "analyze_chat", content, transport: "injected" },
        requestId: response.id,
        usage: {
          tokensIn: response.usage?.prompt_tokens ?? tokensIn,
          tokensOut: response.usage?.completion_tokens ?? tokensOut,
        },
        cost: {
          amount: estimateTokenCost(
            input.model,
            response.usage?.prompt_tokens ?? tokensIn,
            response.usage?.completion_tokens ?? tokensOut,
          ),
          currency: input.model.currency,
          basis: "estimated",
        },
      }
    },
  )
}

function mapPaidError(error: unknown): { code: AnalyzeDenyCode, reason: string } {
  if (error instanceof PaidGateError) return { code: "budget_denied", reason: error.code }
  if (error instanceof PaidCostError) return { code: "invalid_estimate", reason: error.message }
  if (error instanceof ProviderRejectedError) return { code: "provider_rejected", reason: error.message }
  if (error instanceof ReceiptBusyError) return { code: "receipt_busy", reason: error.message }
  if (error instanceof ReceiptUnknownError) return { code: "receipt_unknown", reason: error.message }
  return { code: "extract_failed", reason: error instanceof Error ? error.message : "unknown_error" }
}

function reuseKeyForBinding(step: IntelAnalysisStep, provider: LlmProviderRecord, model: LlmModelRecord, promptHash: string, contentHash: string, stepInputFingerprint: string): string {
  return buildAnalysisReuseKey({
    step,
    providerId: provider.id,
    baseUrl: provider.baseUrl,
    modelId: model.id,
    modelName: model.modelName,
    unitPriceIn: model.unitPriceIn,
    unitPriceOut: model.unitPriceOut,
    currency: model.currency,
    promptHash,
    contentHash,
    stepInputFingerprint,
  })
}

export async function runOfflineAnalyze(input: AnalyzePipelineInput): Promise<AnalyzePipelineResult> {
  const analysisRepo = input.analysisRepo ?? new IntelAnalysisRepository(input.db)
  const receiptIds: string[] = []
  const analyses: IntelAnalysisRecord[] = []
  const nowIso = () => (input.now ? input.now() : new Date()).toISOString()

  // Default budget path: strict DB registry resolver. Test overrides must be explicit.
  const resolveClaimConfig = input.resolveClaimConfig
    ?? createPaidClaimBudgetResolver({ mode: "registry" })

  const materialResult = await readIntelMaterial(input.intelRepo, input.itemId, input.versionId)
  if (!materialResult.ok) {
    return {
      ok: false,
      code: materialResult.code === "version_not_found" ? "version_mismatch" : "material_unavailable",
      reason: materialResult.code,
      itemId: input.itemId,
      versionId: input.versionId,
      analyses,
      receiptIds,
    }
  }
  const material = materialResult.material
  if (material.version.id !== input.versionId || material.itemId !== input.itemId) {
    return {
      ok: false,
      code: "version_mismatch",
      reason: "exact item/version required",
      itemId: input.itemId,
      versionId: input.versionId,
      analyses,
      receiptIds,
    }
  }

  const manual = await input.intelRepo.getManualVersionAction(
    material.source.id,
    material.itemId,
    material.version.id,
  )
  const clipAudit = readClipAudit(manual)
  const materialRef = {
    itemId: material.itemId,
    versionId: material.version.id,
    contentHash: material.version.contentHash,
  }
  const gate = admitModelPayload({
    clipAudit,
    license: input.modelUseLicense,
    materialRef,
  })
  if (!gate.allow) {
    const row = await analysisRepo.insert({
      itemId: material.itemId,
      versionId: material.version.id,
      contentHash: material.version.contentHash,
      step: "prefilter",
      status: "denied",
      provenance: "system",
      basis: JSON.stringify({ code: gate.code, reason: gate.reason }),
      errorCode: gate.code,
      createdAt: nowIso(),
    })
    analyses.push(row)
    return {
      ok: false,
      code: "payload_denied",
      reason: `${gate.code}: ${gate.reason}`,
      itemId: material.itemId,
      versionId: material.version.id,
      analyses,
      receiptIds,
    }
  }

  const prefilterResolved = await resolveStepBinding(input.db, "prefilter")
  const extractResolved = await resolveStepBinding(input.db, "extract")
  if (!prefilterResolved.ok || !extractResolved.ok) {
    const miss = !prefilterResolved.ok ? prefilterResolved : extractResolved
    const row = await analysisRepo.insert({
      itemId: material.itemId,
      versionId: material.version.id,
      contentHash: material.version.contentHash,
      step: !prefilterResolved.ok ? "prefilter" : "extract",
      status: "denied",
      provenance: "system",
      basis: JSON.stringify({ code: miss.ok ? "binding_missing" : miss.code }),
      errorCode: miss.ok ? "binding_missing" : miss.code,
      createdAt: nowIso(),
    })
    analyses.push(row)
    return {
      ok: false,
      code: "binding_missing",
      reason: miss.ok ? "binding_missing" : miss.code,
      itemId: material.itemId,
      versionId: material.version.id,
      analyses,
      receiptIds,
    }
  }
  const prefilterBinding = prefilterResolved
  const extractBinding = extractResolved

  // Base paid context; each callChatStep overrides currency to the step model currency.
  const paidCtx: PaidRequestContext = {
    db: input.db,
    secretStore: input.secretStore,
    monthlyBudget: input.monthlyBudget,
    currency: prefilterBinding.model.currency,
    sharedBudget: input.sharedBudget,
    resolveClaimConfig,
    now: input.now,
    timeoutMs: input.timeoutMs,
  }

  const contentMissing = !material.bodyText || !material.bodyText.trim()
  const title = material.title
  const bodyText = material.bodyText

  // ---------- prefilter (with dedupe) ----------
  let prefilterDecision: PrefilterDecision | null = null
  {
    const userMsg = buildPrefilterUserMessage({ title, bodyText, contentMissing })
    const reuseKey = reuseKeyForBinding(
      "prefilter",
      prefilterBinding.provider,
      prefilterBinding.model,
      PREFILTER_PROMPT.hash,
      material.version.contentHash,
      sha256Json({ user: userMsg }),
    )
    const reusable = await analysisRepo.findReusable({
      itemId: material.itemId,
      versionId: material.version.id,
      contentHash: material.version.contentHash,
      step: "prefilter",
      reuseKey,
    })
    if (reusable?.outputJson) {
      const reusedDecision = parsePrefilterDecision(reusable.outputJson, contentMissing)
      if (reusedDecision) {
        prefilterDecision = reusedDecision
        const row = await analysisRepo.insert({
          itemId: material.itemId,
          versionId: material.version.id,
          contentHash: material.version.contentHash,
          step: "prefilter",
          status: "reused",
          providerId: prefilterBinding.provider.id,
          modelId: prefilterBinding.model.id,
          modelName: prefilterBinding.model.modelName,
          promptHash: PREFILTER_PROMPT.hash,
          reuseKey,
          output: { decision: reusedDecision, reusedFrom: reusable.id },
          provenance: "system",
          basis: JSON.stringify({ reusedFrom: reusable.id, decision: reusedDecision, reuseKey }),
          receiptId: reusable.receiptId,
          createdAt: nowIso(),
        })
        analyses.push(row)
        if (reusable.receiptId) receiptIds.push(reusable.receiptId)
      }
    }
    if (!prefilterDecision) {
      try {
        const result = await callChatStep({
          ctx: paidCtx,
          provider: prefilterBinding.provider,
          model: prefilterBinding.model,
          capability: "intel_prefilter",
          purpose: "intel_prefilter",
          identity: {
            step: "prefilter",
            itemId: material.itemId,
            versionId: material.version.id,
            contentHash: material.version.contentHash,
            promptHash: PREFILTER_PROMPT.hash,
            reuseKey,
            modelId: prefilterBinding.model.id,
            modelName: prefilterBinding.model.modelName,
            baseUrl: prefilterBinding.provider.baseUrl,
          },
          attemptTag: "prefilter-1",
          system: PREFILTER_PROMPT.text,
          user: userMsg,
          transport: input.transport,
        })
        receiptIds.push(result.receiptId)
        const content = chatContentFromReceiptResponse(result.response)
        const decision = parsePrefilterDecision(content, contentMissing)
        if (!decision) {
          const row = await analysisRepo.insert({
            itemId: material.itemId,
            versionId: material.version.id,
            contentHash: material.version.contentHash,
            step: "prefilter",
            status: "failed",
            providerId: prefilterBinding.provider.id,
            modelId: prefilterBinding.model.id,
            modelName: prefilterBinding.model.modelName,
            promptHash: PREFILTER_PROMPT.hash,
            reuseKey,
            output: { content },
            provenance: "ai",
            basis: JSON.stringify({ parse: "invalid_prefilter" }),
            receiptId: result.receiptId,
            errorCode: "invalid_prefilter",
            createdAt: nowIso(),
          })
          analyses.push(row)
          return {
            ok: false,
            code: "extract_failed",
            reason: "invalid_prefilter_output",
            itemId: material.itemId,
            versionId: material.version.id,
            analyses,
            receiptIds,
          }
        }
        prefilterDecision = decision
        const row = await analysisRepo.insert({
          itemId: material.itemId,
          versionId: material.version.id,
          contentHash: material.version.contentHash,
          step: "prefilter",
          status: result.reused ? "reused" : "completed",
          providerId: prefilterBinding.provider.id,
          modelId: prefilterBinding.model.id,
          modelName: prefilterBinding.model.modelName,
          promptHash: PREFILTER_PROMPT.hash,
          reuseKey,
          output: { decision, content },
          provenance: "ai",
          basis: JSON.stringify({ decision, receiptReused: result.reused, reuseKey }),
          receiptId: result.receiptId,
          createdAt: nowIso(),
        })
        analyses.push(row)
      } catch (error) {
        const mapped = mapPaidError(error)
        const row = await analysisRepo.insert({
          itemId: material.itemId,
          versionId: material.version.id,
          contentHash: material.version.contentHash,
          step: "prefilter",
          status: mapped.code === "budget_denied" || mapped.code === "invalid_estimate" ? "denied" : "failed",
          providerId: prefilterBinding.provider.id,
          modelId: prefilterBinding.model.id,
          modelName: prefilterBinding.model.modelName,
          promptHash: PREFILTER_PROMPT.hash,
          reuseKey,
          provenance: "system",
          basis: JSON.stringify(mapped),
          errorCode: mapped.code,
          createdAt: nowIso(),
        })
        analyses.push(row)
        return {
          ok: false,
          code: mapped.code === "budget_denied" ? "budget_denied" : mapped.code,
          reason: mapped.reason,
          itemId: material.itemId,
          versionId: material.version.id,
          analyses,
          receiptIds,
        }
      }
    }
  }

  if (prefilterDecision === "BLOCK") {
    return {
      ok: true,
      status: "skipped_block",
      itemId: material.itemId,
      versionId: material.version.id,
      contentHash: material.version.contentHash,
      prefilter: prefilterDecision,
      extract: null,
      severity: null,
      severityScores: [],
      analyses,
      receiptIds,
    }
  }

  // ---------- extract ----------
  let extract: ExtractedIntel | null = null
  {
    const userMsg = buildExtractUserMessage({ title, bodyText })
    const reuseKey = reuseKeyForBinding(
      "extract",
      extractBinding.provider,
      extractBinding.model,
      EXTRACT_PROMPT.hash,
      material.version.contentHash,
      sha256Json({ user: userMsg }),
    )
    const reusable = await analysisRepo.findReusable({
      itemId: material.itemId,
      versionId: material.version.id,
      contentHash: material.version.contentHash,
      step: "extract",
      reuseKey,
    })
    if (reusable?.outputJson) {
      try {
        const parsedOut = JSON.parse(reusable.outputJson) as { extract?: unknown }
        const parsed = parseExtractOutput(parsedOut.extract ?? reusable.outputJson)
        if (parsed) {
          extract = parsed
          const row = await analysisRepo.insert({
            itemId: material.itemId,
            versionId: material.version.id,
            contentHash: material.version.contentHash,
            step: "extract",
            status: "reused",
            providerId: extractBinding.provider.id,
            modelId: extractBinding.model.id,
            modelName: extractBinding.model.modelName,
            promptHash: EXTRACT_PROMPT.hash,
            reuseKey,
            output: { extract: parsed, reusedFrom: reusable.id },
            provenance: "system",
            basis: JSON.stringify({ reusedFrom: reusable.id, reuseKey }),
            receiptId: reusable.receiptId,
            createdAt: nowIso(),
          })
          analyses.push(row)
          if (reusable.receiptId) receiptIds.push(reusable.receiptId)
        }
      } catch {
        // fall through
      }
    }
    if (!extract) {
      try {
        const result = await callChatStep({
          ctx: paidCtx,
          provider: extractBinding.provider,
          model: extractBinding.model,
          capability: "intel_extract",
          purpose: "intel_extract",
          identity: {
            step: "extract",
            itemId: material.itemId,
            versionId: material.version.id,
            contentHash: material.version.contentHash,
            promptHash: EXTRACT_PROMPT.hash,
            reuseKey,
            modelId: extractBinding.model.id,
            modelName: extractBinding.model.modelName,
            baseUrl: extractBinding.provider.baseUrl,
          },
          attemptTag: "extract-1",
          system: EXTRACT_PROMPT.text,
          user: userMsg,
          transport: input.transport,
        })
        receiptIds.push(result.receiptId)
        const content = chatContentFromReceiptResponse(result.response)
        const parsed = parseExtractOutput(content)
        if (!parsed) {
          const row = await analysisRepo.insert({
            itemId: material.itemId,
            versionId: material.version.id,
            contentHash: material.version.contentHash,
            step: "extract",
            status: "failed",
            providerId: extractBinding.provider.id,
            modelId: extractBinding.model.id,
            modelName: extractBinding.model.modelName,
            promptHash: EXTRACT_PROMPT.hash,
            reuseKey,
            output: { content },
            provenance: "ai",
            basis: JSON.stringify({ parse: "invalid_extract" }),
            receiptId: result.receiptId,
            errorCode: "invalid_extract",
            createdAt: nowIso(),
          })
          analyses.push(row)
          return {
            ok: false,
            code: "extract_failed",
            reason: "invalid_extract_output",
            itemId: material.itemId,
            versionId: material.version.id,
            analyses,
            receiptIds,
          }
        }
        extract = parsed
        const row = await analysisRepo.insert({
          itemId: material.itemId,
          versionId: material.version.id,
          contentHash: material.version.contentHash,
          step: "extract",
          status: result.reused ? "reused" : "completed",
          providerId: extractBinding.provider.id,
          modelId: extractBinding.model.id,
          modelName: extractBinding.model.modelName,
          promptHash: EXTRACT_PROMPT.hash,
          reuseKey,
          output: { extract: parsed, content },
          provenance: "ai",
          basis: JSON.stringify({ eventType: parsed.eventType, receiptReused: result.reused, reuseKey }),
          receiptId: result.receiptId,
          createdAt: nowIso(),
        })
        analyses.push(row)
      } catch (error) {
        const mapped = mapPaidError(error)
        const row = await analysisRepo.insert({
          itemId: material.itemId,
          versionId: material.version.id,
          contentHash: material.version.contentHash,
          step: "extract",
          status: mapped.code === "budget_denied" || mapped.code === "invalid_estimate" ? "denied" : "failed",
          providerId: extractBinding.provider.id,
          modelId: extractBinding.model.id,
          modelName: extractBinding.model.modelName,
          promptHash: EXTRACT_PROMPT.hash,
          reuseKey,
          provenance: "system",
          basis: JSON.stringify(mapped),
          errorCode: mapped.code,
          createdAt: nowIso(),
        })
        analyses.push(row)
        return {
          ok: false,
          code: mapped.code === "budget_denied" ? "budget_denied" : "extract_failed",
          reason: mapped.reason,
          itemId: material.itemId,
          versionId: material.version.id,
          analyses,
          receiptIds,
        }
      }
    }
  }

  // ---------- dual severity (+ optional third median) ----------
  const severityScores: number[] = []
  const severityBases: SeverityBasis[] = []
  const extractFingerprint = sha256Json(extract)

  async function runSeverityAttempt(attemptIndex: number, step: IntelAnalysisStep): Promise<"ok" | "fail"> {
    const attemptTag = `severity-${attemptIndex}`
    const userMsg = buildSeverityUserMessage({
      title,
      bodyText,
      extract,
      attemptIndex,
    })
    const reuseKey = reuseKeyForBinding(
      step,
      extractBinding.provider,
      extractBinding.model,
      SEVERITY_SCORE_PROMPT.hash,
      material.version.contentHash,
      sha256Json({ user: userMsg, extractFingerprint, attemptIndex }),
    )
    try {
      const result = await callChatStep({
        ctx: paidCtx,
        provider: extractBinding.provider,
        model: extractBinding.model,
        capability: "intel_extract",
        purpose: "intel_severity_score",
        identity: {
          step,
          attemptIndex,
          itemId: material.itemId,
          versionId: material.version.id,
          contentHash: material.version.contentHash,
          promptHash: SEVERITY_SCORE_PROMPT.hash,
          reuseKey,
          modelId: extractBinding.model.id,
          modelName: extractBinding.model.modelName,
          baseUrl: extractBinding.provider.baseUrl,
          extractFingerprint,
        },
        attemptTag,
        system: SEVERITY_SCORE_PROMPT.text,
        user: userMsg,
        transport: input.transport,
      })
      receiptIds.push(result.receiptId)
      const content = chatContentFromReceiptResponse(result.response)
      const scored = parseSeverityScoreOutput(content)
      if (!scored) {
        const row = await analysisRepo.insert({
          itemId: material.itemId,
          versionId: material.version.id,
          contentHash: material.version.contentHash,
          step,
          attemptIndex,
          status: "failed",
          providerId: extractBinding.provider.id,
          modelId: extractBinding.model.id,
          modelName: extractBinding.model.modelName,
          promptHash: SEVERITY_SCORE_PROMPT.hash,
          reuseKey,
          output: { content },
          provenance: "ai",
          basis: JSON.stringify({ parse: "invalid_severity_score" }),
          receiptId: result.receiptId,
          errorCode: "invalid_severity_score",
          createdAt: nowIso(),
        })
        analyses.push(row)
        return "fail"
      }
      // Each scoring attempt is independent -- do NOT carry prior rumourOnly.
      const basis = computeSeverity(extract!.eventType, scored.dimensions, {
        isOfficialStatement: extract!.isOfficialStatement,
        isFirstParty: extract!.isFirstParty,
        rumourOnly: scored.rumourOnly,
        routineNotice: extract!.routineNotice,
      }, { attemptIndex })
      severityScores.push(basis.severity)
      severityBases.push(basis)
      const row = await analysisRepo.insert({
        itemId: material.itemId,
        versionId: material.version.id,
        contentHash: material.version.contentHash,
        step,
        attemptIndex,
        status: result.reused ? "reused" : "completed",
        providerId: extractBinding.provider.id,
        modelId: extractBinding.model.id,
        modelName: extractBinding.model.modelName,
        promptHash: SEVERITY_SCORE_PROMPT.hash,
        reuseKey,
        output: { scored, basis, content },
        provenance: "ai",
        basis: JSON.stringify({
          severity: basis.severity,
          capsApplied: basis.capsApplied,
          receiptReused: result.reused,
          attemptIndex,
          rumourOnly: scored.rumourOnly,
        }),
        receiptId: result.receiptId,
        createdAt: nowIso(),
      })
      analyses.push(row)
      return "ok"
    } catch (error) {
      const mapped = mapPaidError(error)
      const row = await analysisRepo.insert({
        itemId: material.itemId,
        versionId: material.version.id,
        contentHash: material.version.contentHash,
        step,
        attemptIndex,
        status: mapped.code === "budget_denied" || mapped.code === "invalid_estimate" ? "denied" : "failed",
        providerId: extractBinding.provider.id,
        modelId: extractBinding.model.id,
        modelName: extractBinding.model.modelName,
        promptHash: SEVERITY_SCORE_PROMPT.hash,
        reuseKey,
        provenance: "system",
        basis: JSON.stringify(mapped),
        errorCode: mapped.code,
        createdAt: nowIso(),
      })
      analyses.push(row)
      return "fail"
    }
  }

  if ((await runSeverityAttempt(1, "severity")) === "fail") {
    return {
      ok: false,
      code: "severity_failed",
      reason: "severity_attempt_1_failed",
      itemId: material.itemId,
      versionId: material.version.id,
      analyses,
      receiptIds,
    }
  }
  if ((await runSeverityAttempt(2, "severity")) === "fail") {
    return {
      ok: false,
      code: "severity_failed",
      reason: "severity_attempt_2_failed",
      itemId: material.itemId,
      versionId: material.version.id,
      analyses,
      receiptIds,
    }
  }

  let finalSeverity = severityBases[0]!
  if (Math.abs(severityScores[0]! - severityScores[1]!) > 1) {
    if ((await runSeverityAttempt(3, "severity_tiebreak")) === "fail") {
      return {
        ok: false,
        code: "severity_failed",
        reason: "severity_tiebreak_failed",
        itemId: material.itemId,
        versionId: material.version.id,
        analyses,
        receiptIds,
      }
    }
    finalSeverity = aggregateMedianSeverity(
      extract!.eventType,
      [severityBases[0]!, severityBases[1]!, severityBases[2]!],
    )
  }

  const allReused = analyses.length > 0 && analyses.every(a => a.status === "reused")
  return {
    ok: true,
    status: allReused ? "reused" : "completed",
    itemId: material.itemId,
    versionId: material.version.id,
    contentHash: material.version.contentHash,
    prefilter: prefilterDecision,
    extract,
    severity: finalSeverity,
    severityScores,
    analyses,
    receiptIds,
  }
}
