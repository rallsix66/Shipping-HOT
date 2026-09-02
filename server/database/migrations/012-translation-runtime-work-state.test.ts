import NativeDatabase from "better-sqlite3"
import { createDatabase } from "db0"
import { describe, expect, it } from "vitest"
import { translationRuntimeWorkStateMigration } from "./012-translation-runtime-work-state"

function createDatabaseFor(native: InstanceType<typeof NativeDatabase>) {
  return createDatabase({
    name: "sqlite",
    dialect: "sqlite",
    getInstance: () => native,
    exec: (sql: string) => native.exec(sql),
    prepare: (sql: string) => {
      const statement = native.prepare(sql)
      return {
        all: async (...params: (string | number | boolean | null | undefined)[]) => statement.all(...params),
        get: async (...params: (string | number | boolean | null | undefined)[]) => statement.get(...params),
        run: async (...params: (string | number | boolean | null | undefined)[]) => {
          const result = statement.run(...params)
          return { success: result.changes > 0, changes: result.changes, lastInsertRowid: result.lastInsertRowid }
        },
      }
    },
    dispose: () => native.close(),
  } as never)
}

function createLegacyTranslationCache(native: InstanceType<typeof NativeDatabase>) {
  native.exec(`
    CREATE TABLE translation_cache (
      id TEXT PRIMARY KEY,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      field_name TEXT NOT NULL,
      source_text TEXT NOT NULL,
      source_hash TEXT NOT NULL,
      source_language TEXT,
      target_language TEXT NOT NULL,
      provider TEXT NOT NULL,
      model TEXT NOT NULL,
      translated_text TEXT,
      translated_at TEXT,
      status TEXT NOT NULL,
      error_message TEXT,
      preferred INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (entity_type, entity_id, field_name, source_hash, target_language, provider, model)
    );
  `)
  const insert = native.prepare(`
    INSERT INTO translation_cache (
      id, entity_type, entity_id, field_name, source_text, source_hash, source_language,
      target_language, provider, model, translated_text, translated_at, status,
      error_message, preferred, created_at, updated_at
    ) VALUES (?, 'feed_item', ?, 'title', ?, ?, 'en', 'zh-CN', 'deepseek', 'deepseek-v4-flash', ?, ?, ?, ?, ?, ?, ?)
  `)
  const timestamp = "2026-09-02T00:00:00.000Z"
  insert.run("translation:succeeded", "feed-1", "Port delay", "hash-1", "港口延误", timestamp, "succeeded", null, 1, timestamp, timestamp)
  insert.run("translation:pending", "feed-2", "Port closed", "hash-2", null, null, "pending", null, 0, timestamp, timestamp)
  insert.run("translation:failed", "feed-3", "Port storm", "hash-3", null, null, "failed", "provider unavailable", 0, timestamp, timestamp)
}

describe("translation runtime work-state migration", () => {
  it("upgrades a v11 translation cache without rewriting its original rows", async () => {
    const native = new NativeDatabase(":memory:")
    createLegacyTranslationCache(native)
    const database = createDatabaseFor(native)

    await translationRuntimeWorkStateMigration.up(database)

    const columns = native.prepare("SELECT name FROM pragma_table_info('translation_cache')").all() as Array<{ name: string }>
    expect(columns.map(column => column.name)).toEqual(expect.arrayContaining(["retry_count", "next_retry_at", "retryable", "lease_until", "last_error_code"]))
    expect(native.prepare("SELECT id, source_text, source_hash, provider, model, status FROM translation_cache ORDER BY id").all()).toEqual([
      { id: "translation:failed", source_text: "Port storm", source_hash: "hash-3", provider: "deepseek", model: "deepseek-v4-flash", status: "failed" },
      { id: "translation:pending", source_text: "Port closed", source_hash: "hash-2", provider: "deepseek", model: "deepseek-v4-flash", status: "pending" },
      { id: "translation:succeeded", source_text: "Port delay", source_hash: "hash-1", provider: "deepseek", model: "deepseek-v4-flash", status: "succeeded" },
    ])
    expect(native.prepare("SELECT retry_count, next_retry_at, retryable, lease_until, last_error_code FROM translation_cache ORDER BY id").all()).toEqual([
      { retry_count: 0, next_retry_at: null, retryable: 0, lease_until: null, last_error_code: null },
      { retry_count: 0, next_retry_at: null, retryable: 0, lease_until: null, last_error_code: null },
      { retry_count: 0, next_retry_at: null, retryable: 0, lease_until: null, last_error_code: null },
    ])
    expect(native.prepare("SELECT name FROM pragma_index_list('translation_cache') WHERE name = 'idx_translation_cache_work_state'").get()).toEqual({ name: "idx_translation_cache_work_state" })
    native.close()
  })

  it("is idempotent and supports the durable work-state scan index", async () => {
    const native = new NativeDatabase(":memory:")
    createLegacyTranslationCache(native)
    const database = createDatabaseFor(native)
    await translationRuntimeWorkStateMigration.up(database)
    await translationRuntimeWorkStateMigration.up(database)

    const plan = native.prepare(`
      EXPLAIN QUERY PLAN
      SELECT * FROM translation_cache
      WHERE provider = ? AND model = ? AND target_language = ? AND status = 'failed'
        AND retryable = 1 AND (next_retry_at IS NULL OR next_retry_at <= ?)
        AND (lease_until IS NULL OR lease_until <= ?)
      ORDER BY updated_at ASC, id ASC
      LIMIT 20
    `).all("deepseek", "deepseek-v4-flash", "zh-CN", "2026-09-02T00:00:00.000Z", "2026-09-02T00:00:00.000Z") as Array<{ detail?: string }>
    expect(plan.some(row => row.detail?.includes("idx_translation_cache_work_state"))).toBe(true)
    expect(native.prepare("SELECT COUNT(*) AS count FROM pragma_table_info('translation_cache') WHERE name = 'retry_count'").get()).toEqual({ count: 1 })
    native.close()
  })
})
