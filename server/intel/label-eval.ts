/**
 * Offline intel eval metrics — Adapted from AIHOT@44578fa scripts/eval-selection.ts skeleton (MIT).
 * Consumes saved AI predictions + human labels only. Default path never calls providers.
 *
 * Missing predictions are NOT silently dropped from full-target denominators.
 * Reports both valid-prediction accuracy and full-target completion/failure rates.
 */
import { createHash } from "node:crypto"
import type { LabelDecisionFields, LabelDecisionView } from "@shared/intel-label"

export interface FieldMetric {
  name: string
  /** Correct among pairs with both gold and prediction present. */
  validCorrect: number
  validDenominator: number
  validAccuracy: number | null
  /** Gold present in the human target set (UNKNOWN/empty gold skipped separately). */
  targetDenominator: number
  /** Predictions present for target rows. */
  completed: number
  /** Target rows with missing/failed prediction. */
  missingOrFailed: number
  /** Correct on full target set (missing prediction counts as not-correct). */
  fullSetCorrect: number
  fullSetAccuracy: number | null
  missingPrediction: number
  missingLabel: number
  skipped: number
  /** @deprecated alias of validAccuracy for older readers — prefer validAccuracy/fullSetAccuracy. */
  correct: number
  denominator: number
  accuracy: number | null
}

export interface PrefilterMetric {
  truePositive: number
  falsePositive: number
  falseNegative: number
  trueNegative: number
  missingPrediction: number
  missingLabel: number
  skipped: number
  unknownPrediction: number
  recall: number | null
  precision: number | null
  denominatorRecall: number
  denominatorPrecision: number
  /** Full gold-keep set including missing preds as false negatives for completion view. */
  fullSetRecall: number | null
  fullSetRecallDenominator: number
}

export interface CurrencyCostBucket {
  currency: string
  actualTotal: number
  receiptCount: number
  receiptIds: string[]
}

export interface EvalCostReport {
  /** Actual paid_receipt spend for selected analysis receipts — never an estimate. */
  actualReceiptTotal: number | null
  /** Null when mixed currencies (see byCurrency). */
  actualReceiptCurrency: string | null
  actualReceiptCount: number
  byCurrency: CurrencyCostBucket[]
  /** Separate estimate channel; null when not computed. */
  estimatedTotal: number | null
  budgetConfigured: boolean
  budgetMonthly: number | null
  /** R3-5: BLOCKED when budget missing; NOT_RUN when no provider re-run requested. */
  r3_5: "PASS_REPORT" | "BLOCKED" | "NOT_RUN"
  note: string
  costReadError?: string
}

export interface EvalReport {
  status: "OK" | "NOT_RUN" | "INSUFFICIENT" | "INCOMPLETE"
  reason?: string
  sampleVersion: string
  humanLabeled: number
  paired: number
  missingPredictions: number
  prefilter: PrefilterMetric
  fields: FieldMetric[]
  cost: EvalCostReport
  modelPromptVersions: Array<{
    modelName: string | null
    modelId: string | null
    promptHash: string | null
    analysisIds: string[]
    count: number
  }>
  mixedModelPrompt: boolean
}

function setsEqual(a: string[], b: string[]): boolean {
  const aa = [...a].map(s => s.toUpperCase()).sort()
  const bb = [...b].map(s => s.toUpperCase()).sort()
  if (aa.length !== bb.length) return false
  return aa.every((v, i) => v === bb[i])
}

function isEmptyGold(value: unknown): boolean {
  return value === null || value === undefined || (Array.isArray(value) && value.length === 0)
}

function fieldMetric(
  name: string,
  pairs: Array<{ pred: LabelDecisionFields | null, gold: LabelDecisionFields }>,
  pick: (d: LabelDecisionFields) => unknown,
  equal: (a: unknown, b: unknown) => boolean,
): FieldMetric {
  let validCorrect = 0
  let validDenominator = 0
  let targetDenominator = 0
  let completed = 0
  let missingOrFailed = 0
  let fullSetCorrect = 0
  let missingPrediction = 0
  let missingLabel = 0
  let skipped = 0
  for (const { pred, gold } of pairs) {
    const g = pick(gold)
    if (isEmptyGold(g)) {
      missingLabel++
      skipped++
      continue
    }
    targetDenominator++
    if (!pred) {
      missingPrediction++
      missingOrFailed++
      continue
    }
    const p = pick(pred)
    if (isEmptyGold(p)) {
      missingPrediction++
      missingOrFailed++
      continue
    }
    completed++
    validDenominator++
    const ok = equal(p, g)
    if (ok) {
      validCorrect++
      fullSetCorrect++
    }
  }
  return {
    name,
    validCorrect,
    validDenominator,
    validAccuracy: validDenominator === 0 ? null : validCorrect / validDenominator,
    targetDenominator,
    completed,
    missingOrFailed,
    fullSetCorrect,
    fullSetAccuracy: targetDenominator === 0 ? null : fullSetCorrect / targetDenominator,
    missingPrediction,
    missingLabel,
    skipped,
    correct: validCorrect,
    denominator: validDenominator,
    accuracy: validDenominator === 0 ? null : validCorrect / validDenominator,
  }
}

export function computePrefilter(pairs: Array<{ pred: LabelDecisionFields | null, gold: LabelDecisionFields }>): PrefilterMetric {
  let tp = 0
  let fp = 0
  let fn = 0
  let tn = 0
  let missingPrediction = 0
  let missingLabel = 0
  let skipped = 0
  let unknownPrediction = 0
  let goldKeep = 0
  let fullRecallHits = 0
  for (const { pred, gold } of pairs) {
    if (gold.prefilterKeep === null) {
      missingLabel++
      skipped++
      continue
    }
    if (gold.prefilterKeep) goldKeep++
    if (!pred || pred.prefilterKeep === null) {
      // UNKNOWN / missing pred: do not coerce into PASS/BLOCK.
      if (pred && pred.prefilterKeep === null) unknownPrediction++
      else missingPrediction++
      continue
    }
    if (pred.prefilterKeep && gold.prefilterKeep) {
      tp++
      fullRecallHits++
    } else if (pred.prefilterKeep && !gold.prefilterKeep) {
      fp++
    } else if (!pred.prefilterKeep && gold.prefilterKeep) {
      fn++
    } else {
      tn++
    }
  }
  const denominatorRecall = tp + fn
  const denominatorPrecision = tp + fp
  // Full-set recall: missing/unknown preds on gold-keep count as misses.
  const fullSetRecallDenominator = goldKeep
  return {
    truePositive: tp,
    falsePositive: fp,
    falseNegative: fn,
    trueNegative: tn,
    missingPrediction,
    missingLabel,
    skipped,
    unknownPrediction,
    recall: denominatorRecall === 0 ? null : tp / denominatorRecall,
    precision: denominatorPrecision === 0 ? null : tp / denominatorPrecision,
    denominatorRecall,
    denominatorPrecision,
    fullSetRecall: fullSetRecallDenominator === 0 ? null : fullRecallHits / fullSetRecallDenominator,
    fullSetRecallDenominator,
  }
}

/** Content-addressed sample version — changes when any human label payload changes. */
export function computeSampleVersion(human: LabelDecisionView[]): string {
  const digest = createHash("sha256")
  const rows = [...human].sort((a, b) => a.labelItemId.localeCompare(b.labelItemId) || a.id.localeCompare(b.id))
  for (const h of rows) {
    digest.update([
      h.labelItemId,
      h.itemId,
      h.versionId,
      h.contentHash,
      h.kind,
      h.operator,
      JSON.stringify(h.decision),
      ...(h.analysisIds ?? []),
      h.promptHash ?? "",
      h.modelId ?? "",
      h.modelName ?? "",
    ].join("|"))
    digest.update("\n")
  }
  return `labelset-${digest.digest("hex").slice(0, 16)}`
}

export function buildEvalReport(input: {
  human: LabelDecisionView[]
  predictionsByLabelItemId: Map<string, LabelDecisionFields>
  predictionMetaByLabelItemId?: Map<string, {
    modelName: string | null
    modelId: string | null
    promptHash: string | null
    analysisIds: string[]
  }>
  sampleVersion?: string
  cost: EvalCostReport
  /** When true and multiple model/prompt combos present, refuse merged OK. */
  refuseMixedModelPrompt?: boolean
}): EvalReport {
  const sampleVersion = input.sampleVersion ?? computeSampleVersion(input.human)
  const meta = input.predictionMetaByLabelItemId ?? new Map()
  const versionBuckets = new Map<string, {
    modelName: string | null
    modelId: string | null
    promptHash: string | null
    analysisIds: Set<string>
    count: number
  }>()
  for (const h of input.human) {
    const m = meta.get(h.labelItemId)
    if (!m) continue
    const key = `${m.modelId ?? ""}||${m.modelName ?? ""}||${m.promptHash ?? ""}`
    const bucket = versionBuckets.get(key) ?? {
      modelName: m.modelName,
      modelId: m.modelId,
      promptHash: m.promptHash,
      analysisIds: new Set<string>(),
      count: 0,
    }
    bucket.count++
    for (const id of m.analysisIds) bucket.analysisIds.add(id)
    versionBuckets.set(key, bucket)
  }
  const modelPromptVersions = [...versionBuckets.values()].map(v => ({
    modelName: v.modelName,
    modelId: v.modelId,
    promptHash: v.promptHash,
    analysisIds: [...v.analysisIds],
    count: v.count,
  }))
  const mixedModelPrompt = modelPromptVersions.length > 1

  if (input.human.length === 0) {
    return {
      status: "NOT_RUN",
      reason: "no_human_confirmed_labels",
      sampleVersion,
      humanLabeled: 0,
      paired: 0,
      missingPredictions: 0,
      prefilter: computePrefilter([]),
      fields: [],
      cost: input.cost,
      modelPromptVersions,
      mixedModelPrompt: false,
    }
  }

  if (input.refuseMixedModelPrompt !== false && mixedModelPrompt) {
    return {
      status: "INSUFFICIENT",
      reason: "mixed_model_prompt_refused",
      sampleVersion,
      humanLabeled: input.human.length,
      paired: 0,
      missingPredictions: 0,
      prefilter: computePrefilter([]),
      fields: [],
      cost: input.cost,
      modelPromptVersions,
      mixedModelPrompt: true,
    }
  }

  const pairs = input.human.map(h => ({
    pred: input.predictionsByLabelItemId.get(h.labelItemId) ?? null,
    gold: h.decision,
  }))
  const paired = pairs.filter(p => p.pred).length
  const missingPredictions = pairs.length - paired
  const fields = [
    fieldMetric("country", pairs, d => d.countries, (a, b) => setsEqual(a as string[], b as string[])),
    fieldMetric("eventType", pairs, d => d.eventType, (a, b) => a === b),
    fieldMetric("port", pairs, d => d.ports, (a, b) => setsEqual(a as string[], b as string[])),
    fieldMetric("effectiveFrom", pairs, d => d.effectiveFrom, (a, b) => a === b),
    fieldMetric("official", pairs, d => d.isOfficialStatement, (a, b) => a === b),
  ]
  const prefilter = computePrefilter(pairs)

  if (paired === 0) {
    return {
      status: "INSUFFICIENT",
      reason: "no_paired_predictions",
      sampleVersion,
      humanLabeled: input.human.length,
      paired: 0,
      missingPredictions,
      prefilter,
      fields,
      cost: input.cost,
      modelPromptVersions,
      mixedModelPrompt,
    }
  }

  // 1 correct + N missing must not look like 100% OK.
  const status = missingPredictions > 0 ? "INCOMPLETE" : "OK"
  return {
    status,
    reason: missingPredictions > 0 ? "missing_predictions_in_target_set" : undefined,
    sampleVersion,
    humanLabeled: input.human.length,
    paired,
    missingPredictions,
    prefilter,
    fields,
    cost: input.cost,
    modelPromptVersions,
    mixedModelPrompt,
  }
}

export function costReportFromInputs(input: {
  budgetConfigured: boolean
  budgetMonthly: number | null
  byCurrency: CurrencyCostBucket[]
  estimatedTotal: number | null
  requestProviderRerun: boolean
  costReadError?: string
}): EvalCostReport {
  const byCurrency = input.byCurrency
  const actualReceiptCount = byCurrency.reduce((n, b) => n + b.receiptCount, 0)
  const single = byCurrency.length === 1 ? byCurrency[0]! : null
  const actualReceiptTotal = byCurrency.length === 0
    ? null
    : single
      ? single.actualTotal
      : null
  const actualReceiptCurrency = single?.currency ?? null
  const base = {
    actualReceiptTotal,
    actualReceiptCurrency,
    actualReceiptCount,
    byCurrency,
    estimatedTotal: input.estimatedTotal,
    costReadError: input.costReadError,
  }
  if (input.costReadError) {
    return {
      ...base,
      budgetConfigured: input.budgetConfigured,
      budgetMonthly: input.budgetMonthly,
      r3_5: input.budgetConfigured ? "NOT_RUN" : "BLOCKED",
      note: `cost_read_failed: ${input.costReadError}`,
    }
  }
  if (!input.budgetConfigured) {
    return {
      ...base,
      budgetConfigured: false,
      budgetMonthly: null,
      r3_5: "BLOCKED",
      note: "shared_llm_budget_unconfigured — R3-5 BLOCKED; no provider calls",
    }
  }
  if (!input.requestProviderRerun) {
    return {
      ...base,
      budgetConfigured: true,
      budgetMonthly: input.budgetMonthly,
      r3_5: "NOT_RUN",
      note: "default offline eval — provider re-run not requested; estimate vs actual kept separate",
    }
  }
  return {
    ...base,
    budgetConfigured: true,
    budgetMonthly: input.budgetMonthly,
    r3_5: "PASS_REPORT",
    note: "budget configured; actuals from selected analysis receipts only",
  }
}
