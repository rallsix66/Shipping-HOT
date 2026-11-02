/**
 * Offline intel analyze chain (R3-1 / ADR-007 / plan §4.1–4.2):
 * dedupe → admitModelPayload → prefilter → extract → dual severity (+ optional median).
 *
 * - Exact item/version via readIntelMaterial; GET paths never call this module.
 * - Missing rights/binding/budget/version stops before provider.
 * - UNKNOWN prefilter does not exclude; BLOCK stops; missing body demotes BLOCK→UNKNOWN.
 * - Two independent severity scores; third median only when |diff| > 1; third failure ≠ forged complete.
 * - Each paid step has its own receipt/budget; reusable completed rows avoid double-pay.
 * - Persist material version, model, prompt hash, provenance/basis; failures stay auditable.
 */
import type { Database } from "db0"
import type { IntelRepository } from "#/database/intel"
import { type IntelAnalysisRecord, IntelAnalysisRepository, type IntelAnalysisStep } from "#/database/intel-analysis"
import { readClipAudit } from "#/intel/manual-license"
import { readIntelMaterial } from "#/intel/material-read"
import { admitModelPayload } from "#/intel/llm/model-payload-gate"
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
  computeSeverity,
  isEventType,
  median3,
} from "#/intel/industry/selection"
import type { SecretStore } from "#/providers/contracts"
import type { SharedLlmBudgetGate } from "#/intel/llm/shared-budget"
import type { PaidClaimBudgetConfig } from "#/services/shared-llm-budget-settings"
import type { LlmModelRecord, LlmProviderRecord } from "#/database/llm-registry"

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
  /** Preserve original wording / nulls — never invent. */
  numbers: Record<string, string | number | null>
  isOfficialStatement: boolean | null
  isFirstParty: boolean | null
  dimensions: DimensionScores
}

export interface AnalyzePipelineInput {
  db: Database
  intelRepo: Pick<IntelRepository, "getItem" | "getSource" | "getVersion" | "readVersionBlocks" | "getManualVersionAction">
  analysisRepo?: IntelAnalysisRepository
  secretStore: SecretStore
  itemId: string
  versionId: string
  /** Explicit model-use grant. readIntelMaterial is NOT a grant. */
  modelUsePermitted: boolean
  transport: OpenAiCompatibleTransport
  currency: string
  monthlyBudget?: number | null
  sharedBudget?: SharedLlmBudgetGate
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

function asFiniteInt(value: unknown, min: number, max: number): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null
  const n = Math.round(value)
  if (n < min || n > max) return null
  return n
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((v): v is string => typeof v === "string").map(v => v.slice(0, 120))
}

function asNullableString(value: unknown): string | null {
  if (value === null || value === undefined) return null
  if (typeof value !== "string") return null
  return value.slice(0, 500)
}

function asNullableBool(value: unknown): boolean | null {
  if (value === null || value === undefined) return null
  if (typeof value === "boolean") return value
  return null
}

/** Preserve raw numeric wording; do not coerce or invent. */
function asNumbersMap(value: unknown): Record<string, string | number | null> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {}
  const out: Record<string, string | number | null> = {}
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (v === null) out[k] = null
    else if (typeof v === "number" && Number.isFinite(v)) out[k] = v
    else if (typeof v === "string") out[k] = v.slice(0, 200)
    // drop invented object/array shapes
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

export function parsePrefilterDecision(raw: unknown, contentMissing: boolean): PrefilterDecision | null {
  let obj: Record<string, unknown> | null = null
  if (typeof raw === "string") {
    obj = parseJsonObject(raw)
  } else if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    obj = raw as Record<string, unknown>
  } else if (raw && typeof raw === "object" && "response" in (raw as object)) {
    const response = (raw as { response?: unknown }).response
    if (typeof response === "string") {
      obj = parseJsonObject(response)
    } else if (response && typeof response === "object" && "content" in (response as object)) {
      const content = (response as { content?: unknown }).content
      if (typeof content === "string") obj = parseJsonObject(content)
    }
  }
  if (!obj) return null
  const decision = obj.decision
  if (decision !== "PASS" && decision !== "BLOCK" && decision !== "UNKNOWN") return null
  if (decision === "BLOCK" && contentMissing) return "UNKNOWN"
  return decision
}

export function parseExtractOutput(raw: unknown): ExtractedIntel | null {
  let obj: Record<string, unknown> | null = null
  if (typeof raw === "string") {
    obj = parseJsonObject(raw)
  } else if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    if ("content" in (raw as object) && typeof (raw as { content?: unknown }).content === "string") {
      obj = parseJsonObject(String((raw as { content: string }).content))
    } else if ("response" in (raw as object)) {
      const response = (raw as { response?: unknown }).response
      if (typeof response === "string") {
        obj = parseJsonObject(response)
      } else if (response && typeof response === "object" && "content" in (response as object)) {
        obj = parseJsonObject(String((response as { content: string }).content))
      } else if (response && typeof response === "object") {
        obj = response as Record<string, unknown>
      }
    } else {
      obj = raw as Record<string, unknown>
    }
  }
  if (!obj || !isEventType(obj.eventType)) return null
  const dimsRaw = obj.dimensions
  if (!dimsRaw || typeof dimsRaw !== "object" || Array.isArray(dimsRaw)) return null
  const d = dimsRaw as Record<string, unknown>
  const impact = asFiniteInt(d.impact, 0, 10)
  const scope = asFiniteInt(d.scope, 0, 10)
  const urgency = asFiniteInt(d.urgency, 0, 10)
  const actionability = asFiniteInt(d.actionability, 0, 10)
  if (impact === null || scope === null || urgency === null || actionability === null) return null
  return {
    eventType: obj.eventType,
    countries: asStringArray(obj.countries),
    ports: asStringArray(obj.ports),
    cities: asStringArray(obj.cities),
    chainStages: asStringArray(obj.chainStages),
    namedEntity: asNullableString(obj.namedEntity),
    occurredAt: asNullableString(obj.occurredAt),
    effectiveFrom: asNullableString(obj.effectiveFrom),
    effectiveUntil: asNullableString(obj.effectiveUntil),
    numbers: asNumbersMap(obj.numbers),
    isOfficialStatement: asNullableBool(obj.isOfficialStatement),
    isFirstParty: asNullableBool(obj.isFirstParty),
    dimensions: { impact, scope, urgency, actionability },
  }
}

export function parseSeverityScoreOutput(raw: unknown): { dimensions: DimensionScores, rumourOnly: boolean | null } | null {
  let obj: Record<string, unknown> | null = null
  if (typeof raw === "string") {
    obj = parseJsonObject(raw)
  } else if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    if ("content" in (raw as object) && typeof (raw as { content?: unknown }).content === "string") {
      obj = parseJsonObject(String((raw as { content: string }).content))
    } else if ("response" in (raw as object)) {
      const response = (raw as { response?: unknown }).response
      if (typeof response === "string") {
        obj = parseJsonObject(response)
      } else if (response && typeof response === "object" && "content" in (response as object)) {
        obj = parseJsonObject(String((response as { content: string }).content))
      } else if (response && typeof response === "object") {
        obj = response as Record<string, unknown>
      }
    } else {
      obj = raw as Record<string, unknown>
    }
  }
  if (!obj) return null
  const dimsRaw = obj.dimensions
  if (!dimsRaw || typeof dimsRaw !== "object" || Array.isArray(dimsRaw)) return null
  const d = dimsRaw as Record<string, unknown>
  const impact = asFiniteInt(d.impact, 0, 10)
  const scope = asFiniteInt(d.scope, 0, 10)
  const urgency = asFiniteInt(d.urgency, 0, 10)
  const actionability = asFiniteInt(d.actionability, 0, 10)
  if (impact === null || scope === null || urgency === null || actionability === null) return null
  return {
    dimensions: { impact, scope, urgency, actionability },
    rumourOnly: asNullableBool(obj.rumourOnly),
  }
}

function chatContentFromReceiptResponse(response: unknown): string {
  if (typeof response === "string") return response
  if (response && typeof response === "object") {
    const r = response as Record<string, unknown>
    if (typeof r.content === "string") return r.content
    if (r.kind === "analyze_chat" && typeof r.content === "string") return r.content
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
  const tokensIn = input.estimatedTokensIn ?? 400
  const tokensOut = input.estimatedTokensOut ?? 200
  const estimatedCost = estimateTokenCost(input.model, tokensIn, tokensOut)
  return paidRequest(
    input.ctx,
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

export async function runOfflineAnalyze(input: AnalyzePipelineInput): Promise<AnalyzePipelineResult> {
  const analysisRepo = input.analysisRepo ?? new IntelAnalysisRepository(input.db)
  const receiptIds: string[] = []
  const analyses: IntelAnalysisRecord[] = []
  const nowIso = () => (input.now ? input.now() : new Date()).toISOString()

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
  const gate = admitModelPayload({
    clipAudit,
    modelUsePermitted: input.modelUsePermitted,
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

  const paidCtx: PaidRequestContext = {
    db: input.db,
    secretStore: input.secretStore,
    monthlyBudget: input.monthlyBudget,
    currency: input.currency,
    sharedBudget: input.sharedBudget,
    resolveClaimConfig: input.resolveClaimConfig,
    now: input.now,
    timeoutMs: input.timeoutMs,
  }

  const contentMissing = !material.bodyText || !material.bodyText.trim()
  const title = material.title
  const bodyText = material.bodyText

  // ---------- prefilter (with dedupe) ----------
  let prefilterDecision: PrefilterDecision | null = null
  {
    const reusable = await analysisRepo.findReusable({
      itemId: material.itemId,
      versionId: material.version.id,
      contentHash: material.version.contentHash,
      step: "prefilter",
      modelId: prefilterBinding.model.id,
      promptHash: PREFILTER_PROMPT.hash,
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
          output: { decision: reusedDecision, reusedFrom: reusable.id },
          provenance: "system",
          basis: JSON.stringify({ reusedFrom: reusable.id, decision: reusedDecision }),
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
            modelId: prefilterBinding.model.id,
          },
          attemptTag: "prefilter-1",
          system: PREFILTER_PROMPT.text,
          user: buildPrefilterUserMessage({ title, bodyText, contentMissing }),
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
          output: { decision, content },
          provenance: "ai",
          basis: JSON.stringify({ decision, receiptReused: result.reused }),
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
          provenance: "system",
          basis: JSON.stringify(mapped),
          errorCode: mapped.code,
          createdAt: nowIso(),
        })
        analyses.push(row)
        return {
          ok: false,
          code: mapped.code,
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
  // UNKNOWN and PASS both continue (UNKNOWN 不当排除)

  // ---------- extract ----------
  let extract: ExtractedIntel | null = null
  {
    const reusable = await analysisRepo.findReusable({
      itemId: material.itemId,
      versionId: material.version.id,
      contentHash: material.version.contentHash,
      step: "extract",
      modelId: extractBinding.model.id,
      promptHash: EXTRACT_PROMPT.hash,
    })
    if (reusable?.outputJson) {
      try {
        const parsed = parseExtractOutput(JSON.parse(reusable.outputJson))
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
            output: { extract: parsed, reusedFrom: reusable.id },
            provenance: "system",
            basis: JSON.stringify({ reusedFrom: reusable.id }),
            receiptId: reusable.receiptId,
            createdAt: nowIso(),
          })
          analyses.push(row)
          if (reusable.receiptId) receiptIds.push(reusable.receiptId)
        }
      } catch {
        // fall through to paid call
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
            modelId: extractBinding.model.id,
          },
          attemptTag: "extract-1",
          system: EXTRACT_PROMPT.text,
          user: buildExtractUserMessage({ title, bodyText }),
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
          output: { extract: parsed, content },
          provenance: "ai",
          basis: JSON.stringify({ eventType: parsed.eventType, receiptReused: result.reused }),
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
  let rumourOnly: boolean | null = null

  async function runSeverityAttempt(attemptIndex: number, step: IntelAnalysisStep): Promise<"ok" | "fail"> {
    const attemptTag = `severity-${attemptIndex}`
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
          modelId: extractBinding.model.id,
        },
        attemptTag,
        system: SEVERITY_SCORE_PROMPT.text,
        user: buildSeverityUserMessage({
          title,
          bodyText,
          extract,
          attemptIndex,
        }),
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
      if (scored.rumourOnly !== null) rumourOnly = scored.rumourOnly
      const basis = computeSeverity(extract!.eventType, scored.dimensions, {
        isOfficialStatement: extract!.isOfficialStatement,
        isFirstParty: extract!.isFirstParty,
        rumourOnly,
      })
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
        output: { scored, basis, content },
        provenance: "ai",
        basis: JSON.stringify({ severity: basis.severity, capsApplied: basis.capsApplied, receiptReused: result.reused }),
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
      // Third failure must NOT forge completion.
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
    const med = median3(severityScores[0]!, severityScores[1]!, severityScores[2]!)
    finalSeverity = {
      ...severityBases[2]!,
      severity: med,
      capsApplied: [...severityBases[2]!.capsApplied, "median3"],
    }
  } else {
    // Prefer the first score when within 1; record agreement in basis already.
    finalSeverity = severityBases[0]!
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
