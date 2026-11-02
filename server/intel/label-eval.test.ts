import { describe, expect, it } from "vitest"
import type { LabelDecisionView } from "@shared/intel-label"
import {
  buildEvalReport,
  computePrefilter,
  computeSampleVersion,
  costReportFromInputs,
} from "#/intel/label-eval"

function human(id: string, decision: LabelDecisionView["decision"], extra: Partial<LabelDecisionView> = {}): LabelDecisionView {
  return {
    id: `ldc_${id}`,
    labelItemId: `lbl_${id}`,
    itemId: `item_${id}`,
    versionId: `ver_${id}`,
    contentHash: `hash_${id}`,
    kind: "human_confirm",
    operator: "tester",
    isHuman: true,
    decision,
    analysisIds: [],
    promptHash: null,
    modelId: null,
    modelName: null,
    clientRequestId: null,
    createdAt: "2026-11-02T00:00:00.000Z",
    ...extra,
  }
}

function emptyCost() {
  return costReportFromInputs({
    budgetConfigured: false,
    budgetMonthly: null,
    byCurrency: [],
    estimatedTotal: null,
    requestProviderRerun: false,
  })
}

describe("intel-eval offline metrics", () => {
  it("nOT_RUN when no human labels; never claims fixture R3-3/4", () => {
    const report = buildEvalReport({
      human: [],
      predictionsByLabelItemId: new Map(),
      sampleVersion: "empty",
      cost: emptyCost(),
    })
    expect(report.status).toBe("NOT_RUN")
    expect(report.cost.r3_5).toBe("BLOCKED")
  })

  it("reports prefilter recall/precision with explicit denominators; UNKNOWN not coerced", () => {
    const pre = computePrefilter([
      { pred: { prefilterKeep: true, eventType: null, countries: [], ports: [], effectiveFrom: null, isOfficialStatement: null }, gold: { prefilterKeep: true, eventType: null, countries: [], ports: [], effectiveFrom: null, isOfficialStatement: null } },
      { pred: { prefilterKeep: true, eventType: null, countries: [], ports: [], effectiveFrom: null, isOfficialStatement: null }, gold: { prefilterKeep: false, eventType: null, countries: [], ports: [], effectiveFrom: null, isOfficialStatement: null } },
      { pred: { prefilterKeep: false, eventType: null, countries: [], ports: [], effectiveFrom: null, isOfficialStatement: null }, gold: { prefilterKeep: true, eventType: null, countries: [], ports: [], effectiveFrom: null, isOfficialStatement: null } },
      { pred: null, gold: { prefilterKeep: true, eventType: null, countries: [], ports: [], effectiveFrom: null, isOfficialStatement: null } },
      { pred: { prefilterKeep: null, eventType: null, countries: [], ports: [], effectiveFrom: null, isOfficialStatement: null }, gold: { prefilterKeep: true, eventType: null, countries: [], ports: [], effectiveFrom: null, isOfficialStatement: null } },
    ])
    expect(pre.truePositive).toBe(1)
    expect(pre.falsePositive).toBe(1)
    expect(pre.falseNegative).toBe(1)
    expect(pre.missingPrediction).toBe(1)
    expect(pre.unknownPrediction).toBe(1)
    expect(pre.denominatorRecall).toBe(2)
    expect(pre.recall).toBeCloseTo(0.5)
    expect(pre.precision).toBeCloseTo(0.5)
    // Full gold-keep set = 4 (rows 1,3,4,5); only 1 hit → not 100%
    expect(pre.fullSetRecallDenominator).toBe(4)
    expect(pre.fullSetRecall).toBeCloseTo(0.25)
  })

  it("1 correct + N missing → INCOMPLETE; valid accuracy ≠ full-set accuracy; never fake 100% OK", () => {
    const humans = [
      human("1", { prefilterKeep: true, eventType: "port_closure", countries: ["MY"], ports: ["MYPKG"], effectiveFrom: "2026-11-02", isOfficialStatement: true }),
      ...Array.from({ length: 3 }, (_, i) => human(String(i + 2), {
        prefilterKeep: true,
        eventType: "port_closure",
        countries: ["MY"],
        ports: ["MYPKG"],
        effectiveFrom: "2026-11-02",
        isOfficialStatement: true,
      })),
    ]
    const preds = new Map([
      ["lbl_1", { prefilterKeep: true, eventType: "port_closure", countries: ["MY"], ports: ["MYPKG"], effectiveFrom: "2026-11-02", isOfficialStatement: true }],
    ])
    const report = buildEvalReport({
      human: humans,
      predictionsByLabelItemId: preds,
      cost: costReportFromInputs({
        budgetConfigured: true,
        budgetMonthly: 10,
        byCurrency: [],
        estimatedTotal: null,
        requestProviderRerun: false,
      }),
    })
    expect(report.status).toBe("INCOMPLETE")
    expect(report.missingPredictions).toBe(3)
    expect(report.paired).toBe(1)
    const eventType = report.fields.find(f => f.name === "eventType")!
    expect(eventType.validAccuracy).toBe(1)
    expect(eventType.validDenominator).toBe(1)
    expect(eventType.fullSetAccuracy).toBeCloseTo(0.25)
    expect(eventType.targetDenominator).toBe(4)
    expect(eventType.missingOrFailed).toBe(3)
  })

  it("field accuracies expose missing/skip counts", () => {
    const humans = [
      human("1", { prefilterKeep: true, eventType: "port_closure", countries: ["MY"], ports: ["MYPKG"], effectiveFrom: "2026-11-02", isOfficialStatement: true }),
      human("2", { prefilterKeep: true, eventType: "weather_hazard", countries: ["VN"], ports: [], effectiveFrom: null, isOfficialStatement: false }),
    ]
    const preds = new Map([
      ["lbl_1", { prefilterKeep: true, eventType: "port_closure", countries: ["MY"], ports: ["MYPKG"], effectiveFrom: "2026-11-02", isOfficialStatement: true }],
      ["lbl_2", { prefilterKeep: true, eventType: "weather_hazard", countries: ["TH"], ports: ["THBKK"], effectiveFrom: "2026-11-03", isOfficialStatement: false }],
    ])
    const report = buildEvalReport({
      human: humans,
      predictionsByLabelItemId: preds,
      cost: costReportFromInputs({
        budgetConfigured: true,
        budgetMonthly: 10,
        byCurrency: [{ currency: "USD", actualTotal: 0, receiptCount: 0, receiptIds: [] }],
        estimatedTotal: null,
        requestProviderRerun: false,
      }),
    })
    expect(report.status).toBe("OK")
    expect(report.cost.r3_5).toBe("NOT_RUN")
    const country = report.fields.find(f => f.name === "country")!
    expect(country.denominator).toBe(2)
    expect(country.correct).toBe(1)
    const port = report.fields.find(f => f.name === "port")!
    expect(port.missingLabel).toBeGreaterThanOrEqual(1)
  })

  it("sampleVersion is content-addressed — same count different labels changes version", () => {
    const a = [human("1", { prefilterKeep: true, eventType: "port_closure", countries: ["MY"], ports: [], effectiveFrom: null, isOfficialStatement: null })]
    const b = [human("1", { prefilterKeep: false, eventType: "port_closure", countries: ["MY"], ports: [], effectiveFrom: null, isOfficialStatement: null })]
    const va = computeSampleVersion(a)
    const vb = computeSampleVersion(b)
    expect(va).toMatch(/^labelset-[a-f0-9]{16}$/)
    expect(va).not.toBe(vb)
    expect(va).not.toBe("human-count-1")
  })

  it("fills modelPromptVersions; mixed model/prompt refused", () => {
    const humans = [
      human("1", { prefilterKeep: true, eventType: "port_closure", countries: ["MY"], ports: ["MYPKG"], effectiveFrom: null, isOfficialStatement: true }),
      human("2", { prefilterKeep: true, eventType: "port_closure", countries: ["MY"], ports: ["MYPKG"], effectiveFrom: null, isOfficialStatement: true }),
    ]
    const preds = new Map([
      ["lbl_1", { prefilterKeep: true, eventType: "port_closure", countries: ["MY"], ports: ["MYPKG"], effectiveFrom: null, isOfficialStatement: true }],
      ["lbl_2", { prefilterKeep: true, eventType: "port_closure", countries: ["MY"], ports: ["MYPKG"], effectiveFrom: null, isOfficialStatement: true }],
    ])
    const meta = new Map([
      ["lbl_1", { modelName: "m-a", modelId: "id-a", promptHash: "ph-a", analysisIds: ["an-a"] }],
      ["lbl_2", { modelName: "m-b", modelId: "id-b", promptHash: "ph-b", analysisIds: ["an-b"] }],
    ])
    const report = buildEvalReport({
      human: humans,
      predictionsByLabelItemId: preds,
      predictionMetaByLabelItemId: meta,
      cost: emptyCost(),
    })
    expect(report.status).toBe("INSUFFICIENT")
    expect(report.reason).toBe("mixed_model_prompt_refused")
    expect(report.mixedModelPrompt).toBe(true)
    expect(report.modelPromptVersions).toHaveLength(2)
    expect(report.modelPromptVersions.every(v => v.analysisIds.length > 0)).toBe(true)
  })

  it("cost buckets stay per-currency; SQL read error is not zero spend", () => {
    const ok = costReportFromInputs({
      budgetConfigured: true,
      budgetMonthly: 5,
      byCurrency: [
        { currency: "USD", actualTotal: 1.25, receiptCount: 2, receiptIds: ["r1", "r2"] },
        { currency: "CNY", actualTotal: 8, receiptCount: 1, receiptIds: ["r3"] },
      ],
      estimatedTotal: null,
      requestProviderRerun: false,
    })
    expect(ok.actualReceiptTotal).toBeNull()
    expect(ok.actualReceiptCurrency).toBeNull()
    expect(ok.actualReceiptCount).toBe(3)
    expect(ok.byCurrency).toHaveLength(2)
    expect(ok.r3_5).toBe("NOT_RUN")

    const failed = costReportFromInputs({
      budgetConfigured: true,
      budgetMonthly: 5,
      byCurrency: [],
      estimatedTotal: null,
      requestProviderRerun: false,
      costReadError: "sqlite_io",
    })
    expect(failed.actualReceiptTotal).toBeNull()
    expect(failed.costReadError).toBe("sqlite_io")
    expect(failed.note).toMatch(/cost_read_failed/)
    expect(failed.r3_5).not.toBe("PASS_REPORT")
  })

  it("same-config PASS+BLOCK (overlapping prefilter) is evaluable; same-step different prompt still refused", () => {
    const humans = [
      human("1", { prefilterKeep: true, eventType: "port_closure", countries: ["MY"], ports: ["MYPKG"], effectiveFrom: null, isOfficialStatement: true }),
      human("2", { prefilterKeep: false, eventType: null, countries: [], ports: [], effectiveFrom: null, isOfficialStatement: null }),
    ]
    const preds = new Map([
      ["lbl_1", { prefilterKeep: true, eventType: "port_closure", countries: ["MY"], ports: ["MYPKG"], effectiveFrom: null, isOfficialStatement: true }],
      ["lbl_2", { prefilterKeep: false, eventType: null, countries: [], ports: [], effectiveFrom: null, isOfficialStatement: null }],
    ])
    const sameConfigMeta = new Map([
      ["lbl_1", { modelName: "extract:N|prefilter:N", modelId: "extract:m1|prefilter:m1", promptHash: "extract:pe|prefilter:pp", analysisIds: ["an-pass"] }],
      ["lbl_2", { modelName: "prefilter:N", modelId: "prefilter:m1", promptHash: "prefilter:pp", analysisIds: ["an-block"] }],
    ])
    const ok = buildEvalReport({
      human: humans,
      predictionsByLabelItemId: preds,
      predictionMetaByLabelItemId: sameConfigMeta,
      cost: emptyCost(),
    })
    expect(ok.mixedModelPrompt).toBe(false)
    expect(ok.reason).not.toBe("mixed_model_prompt_refused")

    const conflictMeta = new Map([
      ["lbl_1", { modelName: "prefilter:N", modelId: "prefilter:m1", promptHash: "prefilter:pp", analysisIds: ["an-1"] }],
      ["lbl_2", { modelName: "prefilter:N", modelId: "prefilter:m1", promptHash: "prefilter:OTHER", analysisIds: ["an-2"] }],
    ])
    const bad = buildEvalReport({
      human: humans,
      predictionsByLabelItemId: preds,
      predictionMetaByLabelItemId: conflictMeta,
      cost: emptyCost(),
    })
    expect(bad.reason).toBe("mixed_model_prompt_refused")
    expect(bad.mixedModelPrompt).toBe(true)
  })
})
