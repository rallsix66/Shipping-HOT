import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import NativeDatabase from "better-sqlite3"
import { createDatabase } from "db0"
import { describe, expect, it } from "vitest"
import type { ArticleBlock, ArticleVersion } from "@shared/article"
import { ArticleRepository } from "./article"
import { ShippingRepository, initShippingTables } from "./shipping"
import { readDatabaseMetadata } from "./runtime"

function createNativeDatabase(path = ":memory:") {
  const native = new NativeDatabase(path)
  const database = createDatabase({
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
  return { database, native }
}

const FEED_ITEM = "feed:test:article-1"
const BASE = "2026-09-12T00:00:00.000Z"

function version(overrides: Partial<ArticleVersion> = {}): ArticleVersion {
  return {
    id: "version-1",
    feedItemId: FEED_ITEM,
    contentHash: "hash-a",
    language: "en",
    sourcePublishedAt: "2026-09-11T00:00:00.000Z",
    sourceUpdatedAt: null,
    fetchedAt: BASE,
    extractorVersion: "extractor-1",
    completenessStatus: "complete",
    accessPolicy: "public",
    redistributionPolicy: "link_and_excerpt",
    createdAt: BASE,
    ...overrides,
  }
}

function blocks(text = "First paragraph"): ArticleBlock[] {
  return [
    { id: "b1", blockKey: "0", order: 0, type: "heading", text: "Title" },
    { id: "b2", blockKey: "1", order: 1, type: "paragraph", text },
  ]
}

async function tables(native: NativeDatabase): Promise<Set<string>> {
  const rows = native.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{ name: string }>
  return new Set(rows.map(row => row.name))
}

describe("article content migration and repository", () => {
  it("applies to a fresh database as schema v13 with the three article tables and is idempotent", async () => {
    const { database, native } = createNativeDatabase()
    await initShippingTables(database, "mock")
    expect((await readDatabaseMetadata(database)).schemaVersion).toBe(13)
    const names = await tables(native)
    expect(["feed_articles", "article_versions", "article_blocks"].every(name => names.has(name))).toBe(true)

    await initShippingTables(database, "mock")
    const applied = native.prepare("SELECT COUNT(*) AS c FROM schema_migrations WHERE version = 13").get() as { c: number }
    expect(applied.c).toBe(1)
    expect((await readDatabaseMetadata(database)).schemaVersion).toBe(13)
    native.close()
  })

  it("re-applies migration 13 to a v12-equivalent database without losing existing data", async () => {
    const { database, native } = createNativeDatabase()
    await initShippingTables(database, "mock")
    await new ShippingRepository(database, "mock").saveSettings({ ...(await new ShippingRepository(database, "mock").getSettings())!, refreshInterval: 42, retentionDays: 45 })
    // Simulate a v12 database: remove the v13 tables and the recorded migration row.
    native.exec("DROP TABLE article_blocks; DROP TABLE article_versions; DROP TABLE feed_articles;")
    native.prepare("DELETE FROM schema_migrations WHERE version = 13").run()
    native.prepare("UPDATE app_metadata SET schema_version = 12").run()

    await initShippingTables(database, "mock")
    expect((await readDatabaseMetadata(database)).schemaVersion).toBe(13)
    const settings = await new ShippingRepository(database, "mock").getSettings()
    expect(settings).toMatchObject({ refreshInterval: 42, retentionDays: 45 })
    const names = await tables(native)
    expect(["feed_articles", "article_versions", "article_blocks"].every(name => names.has(name))).toBe(true)
    native.close()
  })

  it("deduplicates identical content, keeps block order across restart, and versions on change", async () => {
    const dir = mkdtempSync(join(tmpdir(), "article-repo-"))
    const path = join(dir, "test.sqlite3")
    try {
      const first = createNativeDatabase(path)
      await initShippingTables(first.database, "mock")
      const repository = new ArticleRepository(first.database)
      await repository.saveFetchState({
        feedItemId: FEED_ITEM,
        sourceId: "shekou-official",
        originalUrl: "https://www.portshekou.com/ywgg/1",
        completenessStatus: "summary_only",
        lastAttemptAt: BASE,
        updatedAt: BASE,
      })
      expect(await repository.saveVersionWithBlocks(version(), blocks())).toEqual({ created: true, versionId: "version-1" })
      // Same content hash again: no duplicate version/blocks.
      expect(await repository.saveVersionWithBlocks(version(), blocks())).toEqual({ created: false, versionId: "version-1" })
      const detail = await repository.getArticle(FEED_ITEM)
      expect(detail?.currentVersion?.id).toBe("version-1")
      expect(detail?.blocks.map(block => block.blockKey)).toEqual(["0", "1"])
      first.native.close()

      // Restart: order/content stable; a changed body creates a new version and the old one stays readable.
      const second = createNativeDatabase(path)
      const restarted = new ArticleRepository(second.database)
      expect((await restarted.getArticle(FEED_ITEM))?.blocks.map(block => block.text)).toEqual(["Title", "First paragraph"])
      const v2 = version({ id: "version-2", contentHash: "hash-b", fetchedAt: "2026-09-12T01:00:00.000Z", createdAt: "2026-09-12T01:00:00.000Z" })
      expect(await restarted.saveVersionWithBlocks(v2, blocks("Updated paragraph"))).toEqual({ created: true, versionId: "version-2" })
      expect((await restarted.getArticle(FEED_ITEM))?.currentVersion?.id).toBe("version-2")
      expect((await restarted.getArticle(FEED_ITEM))?.blocks.map(block => block.text)).toEqual(["Title", "Updated paragraph"])
      expect(await restarted.listVersions(FEED_ITEM)).toHaveLength(2)
      expect((await restarted.listVersionBlocks("version-1")).map(block => block.text)).toEqual(["Title", "First paragraph"])
      second.native.close()
    } finally {
      try {
        rmSync(dir, { recursive: true, force: true })
      } catch {
        // Windows may briefly retain a handle; the OS temp directory is disposable.
      }
    }
  })
})
