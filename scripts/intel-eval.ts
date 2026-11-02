#!/usr/bin/env node
/**
 * scripts/intel-eval.ts — offline R3 label eval closed loop.
 * Adapted from AIHOT@44578fa scripts/eval-selection.ts (MIT): reuse selection→metrics skeleton;
 * target swapped to shipping prefilter + extract fields (plan §5.3 B).
 *
 * Default: NEVER calls model providers. Consumes saved predictions + human labels.
 * Read-only against an existing DB: does not run migrations or mutate data_mode.
 * Future paid re-runs must pass --request-provider-rerun AND existing auth/budget gates
 * (not implemented here — refuse rather than auto-open paid).
 */
import { mkdirSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"
import process from "node:process"
import { fileURLToPath } from "node:url"

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)))

interface ExitPayload {
  ok: boolean
  outPath?: string
  status?: string
  r3_5?: string
  humanLabeled?: number
  error?: string
}

async function main() {
  const args = new Set(process.argv.slice(2))
  if (args.has("--request-provider-rerun")) {
    console.error("REFUSED: provider re-run is gated; use existing auth/budget paidRequest path — intel-eval default stays offline.")
    process.exit(2)
  }
  const outDir = resolve(process.env.INTEL_EVAL_OUT
    ?? resolve(ROOT, ".tmp/r3-1-llm-registry-20261027/r3-label-eval-rc-20261102"))
  mkdirSync(outDir, { recursive: true })
  const outPath = resolve(outDir, "intel-eval-report.json")

  try {
    const { buildEvalReport, computeSampleVersion, costReportFromInputs } = await import("../server/intel/label-eval.ts")
    const { IntelLabelRepository } = await import("../server/database/intel-label.ts")
    const { latestSchemaVersion, readDatabaseMetadata } = await import("../server/database/runtime.ts")
    const { createDatabase } = await import("db0")
    const { default: sqlite } = await import("db0/connectors/better-sqlite3")

    const dbPath = process.env.SHIPPING_DB_PATH
    if (!dbPath) {
      const report = buildEvalReport({
        human: [],
        predictionsByLabelItemId: new Map(),
        sampleVersion: "no_db",
        cost: costReportFromInputs({
          budgetConfigured: false,
          budgetMonthly: null,
          byCurrency: [],
          estimatedTotal: null,
          requestProviderRerun: false,
        }),
      })
      report.reason = "SHIPPING_DB_PATH unset — NOT_RUN (no fixture pass-rate claimed as R3-3/4)"
      writeFileSync(outPath, JSON.stringify(report, null, 2), "utf8")
      const payload: ExitPayload = { ok: true, outPath, status: report.status, r3_5: report.cost.r3_5, humanLabeled: report.humanLabeled }
      console.log(JSON.stringify(payload, null, 2))
      return
    }

    const db = createDatabase(sqlite({ path: dbPath }))
    // Read-only bootstrap: never initializeShippingDatabase / never rewrite data_mode.
    let meta
    try {
      meta = await readDatabaseMetadata(db)
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      const fail = {
        status: "NOT_RUN",
        reason: `eval_db_metadata_failed: ${msg}`,
        sampleVersion: "error",
        humanLabeled: 0,
        paired: 0,
        missingPredictions: 0,
        prefilter: {
          truePositive: 0,
          falsePositive: 0,
          falseNegative: 0,
          trueNegative: 0,
          missingPrediction: 0,
          missingLabel: 0,
          skipped: 0,
          unknownPrediction: 0,
          recall: null,
          precision: null,
          denominatorRecall: 0,
          denominatorPrecision: 0,
          fullSetRecall: null,
          fullSetRecallDenominator: 0,
        },
        fields: [],
        cost: costReportFromInputs({
          budgetConfigured: false,
          budgetMonthly: null,
          byCurrency: [],
          estimatedTotal: null,
          requestProviderRerun: false,
          costReadError: msg,
        }),
        modelPromptVersions: [],
        mixedModelPrompt: false,
      }
      writeFileSync(outPath, JSON.stringify(fail, null, 2), "utf8")
      console.log(JSON.stringify({ ok: false, outPath, status: fail.status, error: fail.reason } satisfies ExitPayload, null, 2))
      process.exitCode = 1
      return
    }

    if (!meta || meta.schemaVersion < 34) {
      const reason = `schema_too_old: got ${meta?.schemaVersion ?? "missing"}, need >=34 for label tables (latest=${latestSchemaVersion})`
      const fail = buildEvalReport({
        human: [],
        predictionsByLabelItemId: new Map(),
        sampleVersion: "schema",
        cost: costReportFromInputs({
          budgetConfigured: false,
          budgetMonthly: null,
          byCurrency: [],
          estimatedTotal: null,
          requestProviderRerun: false,
        }),
      })
      fail.status = "NOT_RUN"
      fail.reason = reason
      writeFileSync(outPath, JSON.stringify(fail, null, 2), "utf8")
      console.log(JSON.stringify({ ok: false, outPath, status: fail.status, error: reason } satisfies ExitPayload, null, 2))
      process.exitCode = 1
      return
    }

    const labels = new IntelLabelRepository(db)
    const human = await labels.listHumanDecisions()
    const predictions = new Map()
    const predictionMeta = new Map()
    const analysisIds = new Set<string>()
    for (const h of human) {
      const item = await labels.getItem(h.labelItemId)
      if (!item || item.contentHash !== h.contentHash) continue
      const ai = await labels.latestAiPrelabel(h.labelItemId)
      if (ai && ai.contentHash === h.contentHash) {
        predictions.set(h.labelItemId, ai.decision)
        predictionMeta.set(h.labelItemId, {
          modelName: ai.modelName,
          modelId: ai.modelId,
          promptHash: ai.promptHash,
          analysisIds: ai.analysisIds,
        })
        for (const id of ai.analysisIds) analysisIds.add(id)
      }
    }

    let byCurrency: Array<{ currency: string, actualTotal: number, receiptCount: number, receiptIds: string[] }> = []
    let costReadError: string | undefined
    try {
      const idList = [...analysisIds]
      if (idList.length > 0) {
        // Bind selected analysis rows → distinct receipt ids → paid_receipt actuals only.
        const placeholders = idList.map(() => "?").join(",")
        const analysisRows = await db.prepare(`
          SELECT id, receipt_id FROM intel_analysis
          WHERE id IN (${placeholders}) AND receipt_id IS NOT NULL
        `).all(...idList) as Array<{ id: string, receipt_id: string }>
        const receiptIds = [...new Set(analysisRows.map(r => String(r.receipt_id)).filter(Boolean))]
        if (receiptIds.length > 0) {
          const rph = receiptIds.map(() => "?").join(",")
          const receiptRows = await db.prepare(`
            SELECT id, currency, actual_cost
            FROM paid_receipt
            WHERE id IN (${rph})
              AND cost_basis = 'actual'
              AND actual_cost IS NOT NULL
          `).all(...receiptIds) as Array<{ id: string, currency: string | null, actual_cost: number }>
          const buckets = new Map<string, { currency: string, actualTotal: number, receiptCount: number, receiptIds: string[] }>()
          for (const row of receiptRows) {
            const currency = row.currency && String(row.currency).trim() ? String(row.currency) : "UNKNOWN"
            const bucket = buckets.get(currency) ?? { currency, actualTotal: 0, receiptCount: 0, receiptIds: [] }
            bucket.actualTotal += Number(row.actual_cost)
            bucket.receiptCount += 1
            bucket.receiptIds.push(String(row.id))
            buckets.set(currency, bucket)
          }
          byCurrency = [...buckets.values()]
        }
      }
    } catch (error) {
      costReadError = error instanceof Error ? error.message : String(error)
      byCurrency = []
    }

    let budgetConfigured = false
    let budgetMonthly: number | null = null
    try {
      const { readSharedLlmBudgetSettings } = await import("../server/services/shared-llm-budget-settings.ts")
      const settingsRow = await db.prepare("SELECT data FROM settings WHERE id = 'default'").get() as
        | { data?: string }
        | undefined
      let shared: unknown = null
      if (settingsRow?.data) {
        try {
          const parsed = JSON.parse(String(settingsRow.data)) as { sharedLlmBudget?: unknown }
          shared = parsed.sharedLlmBudget ?? null
        } catch {
          shared = null
        }
      }
      const viewed = readSharedLlmBudgetSettings(shared as never)
      budgetConfigured = viewed.configured
      budgetMonthly = viewed.monthlyBudget
    } catch {
      budgetConfigured = false
    }

    const report = buildEvalReport({
      human,
      predictionsByLabelItemId: predictions,
      predictionMetaByLabelItemId: predictionMeta,
      sampleVersion: computeSampleVersion(human),
      cost: costReportFromInputs({
        budgetConfigured,
        budgetMonthly,
        byCurrency,
        estimatedTotal: null,
        requestProviderRerun: false,
        costReadError,
      }),
    })

    writeFileSync(outPath, JSON.stringify(report, null, 2), "utf8")
    const failed = Boolean(costReadError) || (report.status === "NOT_RUN" && Boolean(report.reason?.startsWith("eval_")))
    const payload: ExitPayload = {
      ok: !failed && !costReadError,
      outPath,
      status: report.status,
      r3_5: report.cost.r3_5,
      humanLabeled: report.humanLabeled,
      error: costReadError,
    }
    console.log(JSON.stringify(payload, null, 2))
    if (costReadError) process.exitCode = 1
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    const fail = {
      status: "NOT_RUN",
      reason: `eval_bootstrap_failed: ${msg}`,
      sampleVersion: "error",
      humanLabeled: 0,
      paired: 0,
      missingPredictions: 0,
      prefilter: {
        truePositive: 0,
        falsePositive: 0,
        falseNegative: 0,
        trueNegative: 0,
        missingPrediction: 0,
        missingLabel: 0,
        skipped: 0,
        unknownPrediction: 0,
        recall: null,
        precision: null,
        denominatorRecall: 0,
        denominatorPrecision: 0,
        fullSetRecall: null,
        fullSetRecallDenominator: 0,
      },
      fields: [],
      cost: {
        actualReceiptTotal: null,
        actualReceiptCurrency: null,
        actualReceiptCount: 0,
        byCurrency: [],
        estimatedTotal: null,
        budgetConfigured: false,
        budgetMonthly: null,
        r3_5: "BLOCKED",
        note: "bootstrap failed",
        costReadError: msg,
      },
      modelPromptVersions: [],
      mixedModelPrompt: false,
    }
    writeFileSync(outPath, JSON.stringify(fail, null, 2), "utf8")
    console.log(JSON.stringify({ ok: false, outPath, status: fail.status, error: fail.reason } satisfies ExitPayload, null, 2))
    process.exitCode = 1
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
