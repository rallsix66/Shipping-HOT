import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import NativeDatabase from "better-sqlite3"
import { type Database, createDatabase } from "db0"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { ArticleBlock, ArticleVersion } from "@shared/article"
import { ARTICLE_TRANSLATION_CONTRACT_VERSION } from "./article-translation-source"
import { buildArticleTranslationView } from "./article-translation-view"
import { TranslationRepository } from "#/database/translation"
import { initShippingTables } from "#/database/shipping"
import { TranslationService } from "#/services/translation-service"

function wrap(native: NativeDatabase): Database {
  return createDatabase({
    name: "sqlite",
    dialect: "sqlite",
    getInstance: () => native,
    exec: (sql: string) => native.exec(sql),
    prepare: (sql: string) => {
      const statement = native.prepare(sql)
      return {
        all: async (...params: unknown[]) => statement.all(...(params as never[])),
        get: async (...params: unknown[]) => statement.get(...(params as never[])),
        run: async (...params: unknown[]) => {
          const result = statement.run(...(params as never[]))
          return { success: result.changes > 0, changes: result.changes, lastInsertRowid: result.lastInsertRowid }
        },
      }
    },
  } as never) as unknown as Database
}

const N = 20

function version(id: string, overrides: Partial<ArticleVersion> = {}): ArticleVersion {
  return {
    id,
    feedItemId: "feed:test:1",
    contentHash: "a".repeat(64),
    language: "en",
    sourcePublishedAt: null,
    sourceUpdatedAt: null,
    fetchedAt: "2026-09-12T00:00:00.000Z",
    extractorVersion: "article-extractor-v1",
    completenessStatus: "complete",
    accessPolicy: "allowed",
    redistributionPolicy: "full",
    createdAt: "2026-09-12T00:00:00.000Z",
    ...overrides,
  }
}

function blocks(): ArticleBlock[] {
  return Array.from({ length: N }, (_, index) => ({ id: `b${index}`, blockKey: `${index}`, order: index, type: "paragraph" as const, text: `Paragraph ${index} original body text.` }))
}

describe("buildArticleTranslationView", () => {
  let dir: string
  let native: NativeDatabase
  let database: Database
  let repository: TranslationRepository

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "atv-"))
    native = new NativeDatabase(join(dir, "db.sqlite3"))
    database = wrap(native)
    await initShippingTables(database, "mock")
    repository = new TranslationRepository(database)
  })
  afterEach(() => {
    native.close()
    try {
      rmSync(dir, { recursive: true, force: true })
    } catch { /* disposable */ }
  })

  async function saveCache(versionId: string, block: ArticleBlock, targetLanguage: string, status: "succeeded" | "pending" | "failed") {
    const service = new TranslationService(repository, undefined, { targetLanguage, contractVersion: ARTICLE_TRANSLATION_CONTRACT_VERSION })
    const prepared = service.prepare({ entityType: "article_block", entityId: versionId, fieldName: block.blockKey, sourceText: block.text, sourceLanguage: "en", targetLanguage })
    const now = "2026-09-12T01:00:00.000Z"
    await repository.save({
      id: `c:${versionId}:${block.blockKey}`,
      entityType: "article_block",
      entityId: versionId,
      fieldName: block.blockKey,
      sourceText: block.text,
      sourceHash: prepared.sourceHash,
      targetLanguage,
      provider: "deepseek",
      model: "deepseek-v4-flash",
      translatedText: status === "succeeded" ? `中:${block.text}` : undefined,
      translatedAt: status === "succeeded" ? now : undefined,
      status,
      preferred: false,
      createdAt: now,
      updatedAt: now,
    })
  }

  it("reports complete at 20/20", async () => {
    const v = version("version-a")
    for (const block of blocks()) await saveCache(v.id, block, "zh-CN", "succeeded")
    const view = await buildArticleTranslationView({ version: v, blocks: blocks(), targetLanguage: "zh-CN", repository })
    expect(view).toMatchObject({ status: "complete", total: N, translated: N, completedCount: N, pending: 0, failed: 0, missing: 0 })
    expect(view.blocks.every(block => block.source === "translation" && block.translatedText?.startsWith("中:"))).toBe(true)
  })

  it("reads the cache in a single batch call (no N+1)", async () => {
    const spy = vi.spyOn(repository, "findSuccessfulBatch")
    const v = version("version-n")
    for (const block of blocks()) await saveCache(v.id, block, "zh-CN", "succeeded")
    const view = await buildArticleTranslationView({ version: v, blocks: blocks(), targetLanguage: "zh-CN", repository })
    expect(spy).toHaveBeenCalledTimes(1)
    expect(view).toMatchObject({ status: "complete", translated: N })
  })

  it("reports partial at 19/20", async () => {
    const v = version("version-a")
    const all = blocks()
    for (const block of all.slice(0, N - 1)) await saveCache(v.id, block, "zh-CN", "succeeded")
    const view = await buildArticleTranslationView({ version: v, blocks: all, targetLanguage: "zh-CN", repository })
    expect(view).toMatchObject({ status: "partial", total: N, translated: N - 1, completedCount: N - 1, missing: 1 })
  })

  it("counts same-language blocks as original (no provider, no fake translation)", async () => {
    const v = version("version-zh", { language: "zh-CN" })
    const view = await buildArticleTranslationView({ version: v, blocks: blocks(), targetLanguage: "zh-CN", repository })
    expect(view).toMatchObject({ status: "complete", originalSameLanguage: N, translated: 0, completedCount: N })
    expect(view.blocks.every(block => block.source === "original" && block.translatedText === block.text)).toBe(true)
  })

  it("isolates version caches (A translation never surfaces for B)", async () => {
    const a = version("version-a")
    for (const block of blocks()) await saveCache(a.id, block, "zh-CN", "succeeded")
    const b = version("version-b")
    const bView = await buildArticleTranslationView({ version: b, blocks: blocks(), targetLanguage: "zh-CN", repository })
    expect(bView.status).toBe("untranslated")
    expect(bView.translated).toBe(0)
    const aView = await buildArticleTranslationView({ version: a, blocks: blocks(), targetLanguage: "zh-CN", repository })
    expect(aView.status).toBe("complete")
  })

  it("classifies pending and failed blocks and marks ineligible versions", async () => {
    const v = version("version-p")
    const all = blocks()
    await saveCache(v.id, all[0], "zh-CN", "succeeded")
    await saveCache(v.id, all[1], "zh-CN", "pending")
    await saveCache(v.id, all[2], "zh-CN", "failed")
    const view = await buildArticleTranslationView({ version: v, blocks: all, targetLanguage: "zh-CN", repository })
    expect(view).toMatchObject({ status: "partial", translated: 1, pending: 1, failed: 1, missing: N - 3 })
    const ineligible = await buildArticleTranslationView({ version: version("v-i", { completenessStatus: "summary_only" }), blocks: all, targetLanguage: "zh-CN", repository })
    expect(ineligible).toMatchObject({ eligible: false, status: "ineligible", translated: 0 })
  })
})
