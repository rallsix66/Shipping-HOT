import { describe, expect, it } from "vitest"
import type { LabelDecisionView } from "@shared/intel-label"
import { buildEvalReport, computePrefilter, costReportFromInputs } from "#/intel/label-eval"

function human(id: string, decision: LabelDecisionView["decision"]): LabelDecisionView {
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
    createdAt: "2026-11-02T00:00:00.000Z",
  }
}

describe("intel-eval offline metrics", () => {
  it("nOT_RUN when no human labels; never claims fixture R3-3/4", () => {
    const report = buildEvalReport({
      human: [],
      predictionsByLabelItemId: new Map(),
      sampleVersion: "empty",
      cost: costReportFromInputs({
        budgetConfigured: false,
        budgetMonthly: null,
        actualReceiptTotal: null,
        actualReceiptCurrency: null,
        actualReceiptCount: 0,
        estimatedTotal: null,
        requestProviderRerun: false,
      }),
    })
    expect(report.status).toBe("NOT_RUN")
    expect(report.cost.r3_5).toBe("BLOCKED")
  })

  it("reports prefilter recall/precision with explicit denominators", () => {
    const pre = computePrefilter([
      { pred: { prefilterKeep: true, eventType: null, countries: [], ports: [], effectiveFrom: null, isOfficialStatement: null }, gold: { prefilterKeep: true, eventType: null, countries: [], ports: [], effectiveFrom: null, isOfficialStatement: null } },
      { pred: { prefilterKeep: true, eventType: null, countries: [], ports: [], effectiveFrom: null, isOfficialStatement: null }, gold: { prefilterKeep: false, eventType: null, countries: [], ports: [], effectiveFrom: null, isOfficialStatement: null } },
      { pred: { prefilterKeep: false, eventType: null, countries: [], ports: [], effectiveFrom: null, isOfficialStatement: null }, gold: { prefilterKeep: true, eventType: null, countries: [], ports: [], effectiveFrom: null, isOfficialStatement: null } },
      { pred: null, gold: { prefilterKeep: true, eventType: null, countries: [], ports: [], effectiveFrom: null, isOfficialStatement: null } },
    ])
    expect(pre.truePositive).toBe(1)
    expect(pre.falsePositive).toBe(1)
    expect(pre.falseNegative).toBe(1)
    expect(pre.missingPrediction).toBe(1)
    expect(pre.denominatorRecall).toBe(2)
    expect(pre.recall).toBeCloseTo(0.5)
    expect(pre.precision).toBeCloseTo(0.5)
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
      sampleVersion: "t1",
      cost: costReportFromInputs({
        budgetConfigured: true,
        budgetMonthly: 10,
        actualReceiptTotal: 0,
        actualReceiptCurrency: "USD",
        actualReceiptCount: 0,
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
})
