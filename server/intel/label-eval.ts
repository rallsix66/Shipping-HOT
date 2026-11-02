/**
 * Offline intel eval metrics — Adapted from AIHOT@44578fa scripts/eval-selection.ts skeleton (MIT).
 * Consumes saved AI predictions + human labels only. Default path never calls providers.
 */
import type { LabelDecisionFields, LabelDecisionView } from "@shared/intel-label"

export interface FieldMetric {
  name: string
  correct: number
  denominator: number
  missingPrediction: number
  missingLabel: number
  skipped: number
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
  recall: number | null
  precision: number | null
  denominatorRecall: number
  denominatorPrecision: number
}

export interface EvalCostReport {
  /** Actual paid_receipt spend for the sample versions — never an estimate. */
  actualReceiptTotal: number | null
  actualReceiptCurrency: string | null
  actualReceiptCount: number
  /** Separate estimate channel; null when not computed. */
  estimatedTotal: number | null
  budgetConfigured: boolean
  budgetMonthly: number | null
  /** R3-5: BLOCKED when budget missing; NOT_RUN when no provider re-run requested. */
  r3_5: "PASS_REPORT" | "BLOCKED" | "NOT_RUN"
  note: string
}

export interface EvalReport {
  status: "OK" | "NOT_RUN" | "INSUFFICIENT"
  reason?: string
  sampleVersion: string
  humanLabeled: number
  paired: number
  prefilter: PrefilterMetric
  fields: FieldMetric[]
  cost: EvalCostReport
  modelPromptVersions: Array<{ modelName: string | null, promptHash: string | null, count: number }>
}

function setsEqual(a: string[], b: string[]): boolean {
  const aa = [...a].map(s => s.toUpperCase()).sort()
  const bb = [...b].map(s => s.toUpperCase()).sort()
  if (aa.length !== bb.length) return false
  return aa.every((v, i) => v === bb[i])
}

function fieldMetric(
  name: string,
  pairs: Array<{ pred: LabelDecisionFields | null, gold: LabelDecisionFields }>,
  pick: (d: LabelDecisionFields) => unknown,
  equal: (a: unknown, b: unknown) => boolean,
): FieldMetric {
  let correct = 0
  let denominator = 0
  let missingPrediction = 0
  let missingLabel = 0
  let skipped = 0
  for (const { pred, gold } of pairs) {
    const g = pick(gold)
    if (g === null || g === undefined || (Array.isArray(g) && g.length === 0)) {
      missingLabel++
      skipped++
      continue
    }
    if (!pred) {
      missingPrediction++
      continue
    }
    const p = pick(pred)
    if (p === null || p === undefined || (Array.isArray(p) && p.length === 0)) {
      missingPrediction++
      continue
    }
    denominator++
    if (equal(p, g)) correct++
  }
  return {
    name,
    correct,
    denominator,
    missingPrediction,
    missingLabel,
    skipped,
    accuracy: denominator === 0 ? null : correct / denominator,
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
  for (const { pred, gold } of pairs) {
    if (gold.prefilterKeep === null) {
      missingLabel++
      skipped++
      continue
    }
    if (!pred || pred.prefilterKeep === null) {
      missingPrediction++
      continue
    }
    if (pred.prefilterKeep && gold.prefilterKeep) tp++
    else if (pred.prefilterKeep && !gold.prefilterKeep) fp++
    else if (!pred.prefilterKeep && gold.prefilterKeep) fn++
    else tn++
  }
  const denominatorRecall = tp + fn
  const denominatorPrecision = tp + fp
  return {
    truePositive: tp,
    falsePositive: fp,
    falseNegative: fn,
    trueNegative: tn,
    missingPrediction,
    missingLabel,
    skipped,
    recall: denominatorRecall === 0 ? null : tp / denominatorRecall,
    precision: denominatorPrecision === 0 ? null : tp / denominatorPrecision,
    denominatorRecall,
    denominatorPrecision,
  }
}

export function buildEvalReport(input: {
  human: LabelDecisionView[]
  predictionsByLabelItemId: Map<string, LabelDecisionFields>
  sampleVersion: string
  cost: EvalCostReport
}): EvalReport {
  if (input.human.length === 0) {
    return {
      status: "NOT_RUN",
      reason: "no_human_confirmed_labels",
      sampleVersion: input.sampleVersion,
      humanLabeled: 0,
      paired: 0,
      prefilter: computePrefilter([]),
      fields: [],
      cost: input.cost,
      modelPromptVersions: [],
    }
  }
  const pairs = input.human.map(h => ({
    pred: input.predictionsByLabelItemId.get(h.labelItemId) ?? null,
    gold: h.decision,
  }))
  const paired = pairs.filter(p => p.pred).length
  if (paired === 0) {
    return {
      status: "INSUFFICIENT",
      reason: "no_paired_predictions",
      sampleVersion: input.sampleVersion,
      humanLabeled: input.human.length,
      paired: 0,
      prefilter: computePrefilter(pairs),
      fields: [],
      cost: input.cost,
      modelPromptVersions: [],
    }
  }
  const fields = [
    fieldMetric("country", pairs, d => d.countries, (a, b) => setsEqual(a as string[], b as string[])),
    fieldMetric("eventType", pairs, d => d.eventType, (a, b) => a === b),
    fieldMetric("port", pairs, d => d.ports, (a, b) => setsEqual(a as string[], b as string[])),
    fieldMetric("effectiveFrom", pairs, d => d.effectiveFrom, (a, b) => a === b),
    fieldMetric("official", pairs, d => d.isOfficialStatement, (a, b) => a === b),
  ]
  const versions = new Map<string, number>()
  for (const h of input.human) {
    // human rows don't carry model; count from prediction side via gold operator only for audit size
    void h
  }
  return {
    status: "OK",
    sampleVersion: input.sampleVersion,
    humanLabeled: input.human.length,
    paired,
    prefilter: computePrefilter(pairs),
    fields,
    cost: input.cost,
    modelPromptVersions: [...versions.entries()].map(([k, count]) => {
      const [modelName, promptHash] = k.split("||")
      return { modelName: modelName || null, promptHash: promptHash || null, count }
    }),
  }
}

export function costReportFromInputs(input: {
  budgetConfigured: boolean
  budgetMonthly: number | null
  actualReceiptTotal: number | null
  actualReceiptCurrency: string | null
  actualReceiptCount: number
  estimatedTotal: number | null
  requestProviderRerun: boolean
}): EvalCostReport {
  if (!input.budgetConfigured) {
    return {
      actualReceiptTotal: input.actualReceiptTotal,
      actualReceiptCurrency: input.actualReceiptCurrency,
      actualReceiptCount: input.actualReceiptCount,
      estimatedTotal: input.estimatedTotal,
      budgetConfigured: false,
      budgetMonthly: null,
      r3_5: "BLOCKED",
      note: "shared_llm_budget_unconfigured — R3-5 BLOCKED; no provider calls",
    }
  }
  if (!input.requestProviderRerun) {
    return {
      actualReceiptTotal: input.actualReceiptTotal,
      actualReceiptCurrency: input.actualReceiptCurrency,
      actualReceiptCount: input.actualReceiptCount,
      estimatedTotal: input.estimatedTotal,
      budgetConfigured: true,
      budgetMonthly: input.budgetMonthly,
      r3_5: "NOT_RUN",
      note: "default offline eval — provider re-run not requested; estimate vs actual kept separate",
    }
  }
  return {
    actualReceiptTotal: input.actualReceiptTotal,
    actualReceiptCurrency: input.actualReceiptCurrency,
    actualReceiptCount: input.actualReceiptCount,
    estimatedTotal: input.estimatedTotal,
    budgetConfigured: true,
    budgetMonthly: input.budgetMonthly,
    r3_5: "PASS_REPORT",
    note: "budget configured; actuals from receipts only",
  }
}
