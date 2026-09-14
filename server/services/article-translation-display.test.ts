import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import NativeDatabase from "better-sqlite3"
import { type Database, createDatabase } from "db0"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { ArticleBlock, ArticleVersion, FeedArticleDetail } from "@shared/article"
import { ARTICLE_TRANSLATION_CONTRACT_VERSION } from "./article-translation-source"
import { readArticleTranslationView } from "./article-translation-display"
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

function version(id: string, overrides: Partial<ArticleVersion> = {}): ArticleVersion {
  return {
    id,
    feedItemId: "feed:test:1",
    contentHash: "a".repeat(64),
    language: "en",
    fetchedAt: "2026-09-12T00:00:00.000Z",
    extractorVersion: "article-extractor-v1",
    completenessStatus: "complete",
    accessPolicy: "allowed",
    redistributionPolicy: "full",
    createdAt: "2026-09-12T00:00:00.000Z",
    ...overrides,
  }
}

function blocks(prefix: string): ArticleBlock[] {
  return [
    { id: `${prefix}b0`, blockKey: "0", order: 0, type: "paragraph", text: `${prefix} paragraph zero.` },
    { id: `${prefix}b1`, blockKey: "1", order: 1, type: "paragraph", text: `${prefix} paragraph one.` },
  ]
}

function detail(currentVersion: ArticleVersion, articleBlocks: ArticleBlock[]): FeedArticleDetail {
  return {
    feedItemId: "feed:test:1",
    state: {
      feedItemId: "feed:test:1",
      sourceId: "test",
      originalUrl: "https://example.test/a",
      completenessStatus: currentVersion.completenessStatus,
      currentVersionId: currentVersion.id,
      updatedAt: "2026-09-12T00:00:00.000Z",
    },
    currentVersion,
    blocks: articleBlocks,
    versions: [{ id: currentVersion.id, contentHash: currentVersion.contentHash, fetchedAt: currentVersion.fetchedAt, createdAt: currentVersion.createdAt, extractorVersion: currentVersion.extractorVersion, completenessStatus: currentVersion.completenessStatus }],
  }
}

describe("readArticleTranslationView", () => {
  let dir: string
  let native: NativeDatabase
  let database: Database
  let repository: TranslationRepository

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "atd-"))
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

  async function saveCache(versionId: string, block: ArticleBlock) {
    const service = new TranslationService(repository, undefined, { targetLanguage: "zh-CN", contractVersion: ARTICLE_TRANSLATION_CONTRACT_VERSION })
    const prepared = service.prepare({ entityType: "article_block", entityId: versionId, fieldName: block.blockKey, sourceText: block.text, sourceLanguage: "en", targetLanguage: "zh-CN" })
    const now = "2026-09-12T01:00:00.000Z"
    await repository.save({
      id: `c:${versionId}:${block.blockKey}`,
      entityType: "article_block",
      entityId: versionId,
      fieldName: block.blockKey,
      sourceText: block.text,
      sourceHash: prepared.sourceHash,
      targetLanguage: "zh-CN",
      provider: "deepseek",
      model: "deepseek-v4-flash",
      translatedText: `中:${block.text}`,
      translatedAt: now,
      status: "succeeded",
      preferred: false,
      createdAt: now,
      updatedAt: now,
    })
  }

  it("returns the current version translation", async () => {
    const a = version("version-a")
    for (const block of blocks("A")) await saveCache(a.id, block)
    const view = await readArticleTranslationView(database, detail(a, blocks("A")))
    expect(view).toMatchObject({ versionId: "version-a", status: "complete", translated: 2 })
  })

  it("returns the history version translation and never leaks A into B", async () => {
    const a = version("version-a")
    for (const block of blocks("A")) await saveCache(a.id, block)
    const view = await readArticleTranslationView(database, detail(a, blocks("A")))
    expect(view?.blocks.map(block => block.translatedText)).toEqual(["中:A paragraph zero.", "中:A paragraph one."])
    const b = version("version-b")
    const bView = await readArticleTranslationView(database, detail(b, blocks("B")))
    expect(bView).toMatchObject({ versionId: "version-b", status: "untranslated", translated: 0 })
    expect(bView?.blocks.every(block => block.translatedText === undefined)).toBe(true)
  })

  it("returns null when there is no displayed version", async () => {
    const view = await readArticleTranslationView(database, { feedItemId: "feed:test:1", state: detail(version("v"), []).state, blocks: [], versions: [] })
    expect(view).toBeNull()
  })

  it("reports ineligible for a summary_only version", async () => {
    const v = version("version-s", { completenessStatus: "summary_only" })
    const view = await readArticleTranslationView(database, detail(v, blocks("S")))
    expect(view).toMatchObject({ status: "ineligible", eligible: false })
  })

  it("reads cache without claims, provider calls or usage writes even when settings are disabled", async () => {
    const a = version("version-a")
    for (const block of blocks("A")) await saveCache(a.id, block)
    const saveSpy = vi.spyOn(TranslationRepository.prototype, "save").mockRejectedValue(new Error("save must not be called on a read path"))
    const view = await readArticleTranslationView(database, detail(a, blocks("A")), { enabled: false, targetLanguage: "zh-CN" } as never)
    saveSpy.mockRestore()
    expect(view).toMatchObject({ status: "complete", translated: 2 })
    const usage = native.prepare("select count(*) as n from provider_usage").get() as { n: number }
    expect(usage.n).toBe(0)
  })

  it("reports ineligible when the current version's mutable completeness is no longer complete", async () => {
    const a = version("version-a")
    for (const block of blocks("A")) await saveCache(a.id, block)
    const stale = detail(a, blocks("A"))
    // The immutable version row still says complete, but the source was
    // re-observed and is now incomplete, which is what the page displays.
    stale.state.completenessStatus = "incomplete"
    await expect(readArticleTranslationView(database, stale)).resolves.toMatchObject({ eligible: false, status: "ineligible" })
  })

  it("judges a history version by its own completeness, not the current state's", async () => {
    const a = version("version-a")
    for (const block of blocks("A")) await saveCache(a.id, block)
    const history = detail(a, blocks("A"))
    // A newer version B is current and is incomplete; the displayed A version is
    // still complete and its cached translation stays readable.
    history.state.currentVersionId = "version-b"
    history.state.completenessStatus = "incomplete"
    await expect(readArticleTranslationView(database, history)).resolves.toMatchObject({ versionId: "version-a", status: "complete", translated: 2 })
  })
})
