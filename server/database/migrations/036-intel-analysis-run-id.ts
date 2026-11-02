import type { Database } from "db0"

/**
 * R3-1 RC3: persistent analyze-run identity so label/eval select one coherent run
 * (not latest-success extract stitched with time-neighbor steps). Additive only.
 */
export const intelAnalysisRunIdMigration = {
  version: 36,
  name: "intel-analysis-run-id",
  async up(db: Database) {
    await db.exec(`
      ALTER TABLE intel_analysis
        ADD COLUMN run_id TEXT NULL
    `)
    await db.exec(`
      CREATE INDEX IF NOT EXISTS idx_intel_analysis_run
        ON intel_analysis(item_id, version_id, run_id, created_at)
    `)
  },
} as const
