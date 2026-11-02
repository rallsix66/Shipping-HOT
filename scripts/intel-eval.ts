#!/usr/bin/env node
/**
 * scripts/intel-eval.ts — offline R3 label eval closed loop.
 * Adapted from AIHOT@44578fa scripts/eval-selection.ts (MIT): reuse selection→metrics skeleton;
 * target swapped to shipping prefilter + extract fields (plan §5.3 B).
 *
 * Default: NEVER calls model providers. Consumes saved predictions + human labels.
 * Future paid re-runs must pass --request-provider-rerun AND existing auth/budget gates
 * (not implemented here — refuse rather than auto-open paid).
 */
import { mkdirSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"
import process from "node:process"
import { fileURLToPath } from "node:url"

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)))

async function main() {
  const args = new Set(process.argv.slice(2))
  if (args.has("--request-provider-rerun")) {
    console.error("REFUSED: provider re-run is gated; use existing auth/budget paidRequest path — intel-eval default stays offline.")
    process.exit(2)
  }
  const outDir = resolve(process.env.INTEL_EVAL_OUT
    ?? resolve(ROOT, ".tmp/r3-1-llm-registry-20261027/r3-label-eval-20261102"))
  mkdirSync(outDir, { recursive: true })

  // Dynamic import through tsx alias when available; otherwise pure metrics fixture mode.
  let report
  try {
    const { buildEvalReport, costReportFromInputs } = await import("../server/intel/label-eval.ts")
    const { IntelLabelRepository } = await import("../server/database/intel-label.ts")
    const { initializeShippingDatabase } = await import("../server/database/runtime.ts")
    const { createDatabase } = await import("db0")
    const { default: sqlite } = await import("db0/connectors/better-sqlite3")
    const dbPath = process.env.SHIPPING_DB_PATH
    if (!dbPath) {
      report = buildEvalReport({
        human: [],
        predictionsByLabelItemId: new Map(),
        sampleVersion: "no_db",
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
      report.reason = "SHIPPING_DB_PATH unset — NOT_RUN (no fixture pass-rate claimed as R3-3/4)"
    } else {
      const db = createDatabase(sqlite({ path: dbPath }))
      await initializeShippingDatabase(db, process.env.SHIPPING_DATA_MODE === "real" ? "real" : "mock")
      const labels = new IntelLabelRepository(db)
      const human = await labels.listHumanDecisions()
      const predictions = new Map()
      for (const h of human) {
        const item = await labels.getItem(h.labelItemId)
        if (!item || item.contentHash !== h.contentHash) continue
        const ai = await labels.latestAiPrelabel(h.labelItemId)
        if (ai && ai.contentHash === h.contentHash) predictions.set(h.labelItemId, ai.decision)
      }
      let actualReceiptTotal: number | null = null
      let actualReceiptCurrency: string | null = null
      let actualReceiptCount = 0
      try {
        const row = await db.prepare(`
          SELECT COUNT(*) AS c,
                 COALESCE(SUM(actual_cost), 0) AS total,
                 MAX(currency) AS currency
          FROM paid_receipt
          WHERE cost_basis = 'actual' AND actual_cost IS NOT NULL
        `).get() as { c: number, total: number, currency?: string }
        actualReceiptCount = Number(row?.c ?? 0)
        actualReceiptTotal = Number(row?.total ?? 0)
        actualReceiptCurrency = row?.currency ?? null
      } catch {
        actualReceiptCount = 0
      }
      let budgetConfigured = false
      let budgetMonthly: number | null = null
      try {
        const { readSharedLlmBudgetSettings } = await import("../server/services/shared-llm-budget-settings.ts")
        const { ShippingRepository } = await import("../server/database/shipping.ts")
        const settings = await new ShippingRepository(db, "mock").getSettings()
        const viewed = readSharedLlmBudgetSettings(settings?.sharedLlmBudget)
        budgetConfigured = viewed.configured
        budgetMonthly = viewed.monthlyBudget
      } catch {
        budgetConfigured = false
      }
      report = buildEvalReport({
        human,
        predictionsByLabelItemId: predictions,
        sampleVersion: `human-${human.length}`,
        cost: costReportFromInputs({
          budgetConfigured,
          budgetMonthly,
          actualReceiptTotal,
          actualReceiptCurrency,
          actualReceiptCount,
          estimatedTotal: null,
          requestProviderRerun: false,
        }),
      })
    }
  } catch (error) {
    report = {
      status: "NOT_RUN",
      reason: `eval_bootstrap_failed: ${error instanceof Error ? error.message : String(error)}`,
      sampleVersion: "error",
      humanLabeled: 0,
      paired: 0,
      prefilter: {
        truePositive: 0,
        falsePositive: 0,
        falseNegative: 0,
        trueNegative: 0,
        missingPrediction: 0,
        missingLabel: 0,
        skipped: 0,
        recall: null,
        precision: null,
        denominatorRecall: 0,
        denominatorPrecision: 0,
      },
      fields: [],
      cost: {
        actualReceiptTotal: null,
        actualReceiptCurrency: null,
        actualReceiptCount: 0,
        estimatedTotal: null,
        budgetConfigured: false,
        budgetMonthly: null,
        r3_5: "BLOCKED",
        note: "bootstrap failed",
      },
      modelPromptVersions: [],
    }
  }

  const outPath = resolve(outDir, "intel-eval-report.json")
  writeFileSync(outPath, JSON.stringify(report, null, 2), "utf8")
  console.log(JSON.stringify({ ok: true, outPath, status: report.status, r3_5: report.cost.r3_5, humanLabeled: report.humanLabeled }, null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
