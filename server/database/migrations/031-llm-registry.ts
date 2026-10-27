import type { Database } from "db0"

/**
 * R3-1 LLM registry (ADR-007). Additive, idempotent CREATE TABLE IF NOT EXISTS.
 * No budgets table — paid gate continues over provider_usage + paid_receipt_attempt.
 * Secrets stay in SecretStore; secret_ref uses isolated namespace `llm-registry:<providerId>`
 * (never a bare translation/env id such as deepseek).
 */
export const llmRegistryMigration = {
  version: 31,
  name: "llm-registry",
  async up(db: Database) {
    await db.exec(`
      CREATE TABLE IF NOT EXISTS llm_provider (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        base_url TEXT NOT NULL,
        api_compat TEXT NOT NULL CHECK (api_compat IN ('openai')),
        secret_ref TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `)
    await db.exec(`
      CREATE TABLE IF NOT EXISTS llm_model (
        id TEXT PRIMARY KEY,
        provider_id TEXT NOT NULL REFERENCES llm_provider(id) ON DELETE CASCADE,
        model_name TEXT NOT NULL,
        purpose TEXT NOT NULL CHECK (purpose IN ('chat', 'embedding')),
        unit_price_in REAL NOT NULL CHECK (unit_price_in >= 0),
        unit_price_out REAL NOT NULL CHECK (unit_price_out >= 0),
        currency TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (provider_id, model_name, purpose)
      )
    `)
    await db.exec("CREATE INDEX IF NOT EXISTS idx_llm_model_provider ON llm_model(provider_id, enabled)")
    await db.exec(`
      CREATE TABLE IF NOT EXISTS llm_step_binding (
        step TEXT PRIMARY KEY CHECK (step IN (
          'prefilter', 'extract', 'group', 'group_second_opinion',
          'summary', 'daily_report', 'embeddings', 'translation'
        )),
        model_id TEXT NOT NULL REFERENCES llm_model(id),
        updated_at TEXT NOT NULL,
        updated_by TEXT NOT NULL
      )
    `)
    await db.exec(`
      CREATE TABLE IF NOT EXISTS llm_binding_audit (
        id TEXT PRIMARY KEY,
        step TEXT NOT NULL,
        previous_model_id TEXT NULL,
        model_id TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        updated_by TEXT NOT NULL
      )
    `)
    await db.exec("CREATE INDEX IF NOT EXISTS idx_llm_binding_audit_step ON llm_binding_audit(step, updated_at)")
  },
} as const
