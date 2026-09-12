import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import NativeDatabase from "better-sqlite3"
import { type Database, createDatabase } from "db0"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import type { ArticleSourcePolicy } from "@shared/article"
import type { FeedItem } from "@shared/shipping"
import { ArticleService } from "./article-service"
import { ShippingRepository, initShippingTables } from "#/database/shipping"
import { createArticleFetchJob } from "#/runtime/article-fetch-job"

function feedItem(id: string, sourceId: string, sourceUrl: string): FeedItem {
  const now = "2026-09-12T00:00:00.000Z"
  return {
    id,
    sourceId,
    category: sourceId === "the-loadstar" ? "shipping_news" : "port_notice",
    type: sourceId === "the-loadstar" ? "shipping_news" : "port_notice",
    title: `${sourceId} notice`,
    summary: "Feed summary",
    sourceUrl,
    canonicalUrl: sourceUrl,
    publishedAt: now,
    publicationTimeKnown: true,
    eventEligibility: true,
    severity: "info",
    relatedPortIds: [],
    relatedVesselIds: [],
    relatedVoyageIds: [],
    tags: ["test"],
    updatedAt: now,
    sourceUpdatedAt: now,
    fetchedAt: now,
    stale: false,
    sourceStatus: "healthy",
    provenance: { sourceType: "mock", dataNature: "reported", sourceId, sourceUrl, verified: false },
  }
}

const articleHtml = `<div class="content"><h1>Notice</h1>${Array.from({ length: 4 }, (_, index) => `<p>Paragraph ${index + 1} body text for the operational notice page.</p>`).join("")}</div>`
const noContainerHtml = `<body>${Array.from({ length: 12 }, (_, index) => `<p>Paragraph ${index + 1} body text without the configured container.</p>`).join("")}</body>`

const fullPolicy: ArticleSourcePolicy = {
  sourceId: "shekou-official",
  status: "allowed",
  fetchAllowed: true,
  persistence: "full",
  allowedHosts: ["www.portshekou.com"],
  allowedContentTypes: ["text/html"],
  selectors: { container: ".content" },
  completeness: { minParagraphs: 2, minCharacters: 120 },
}

describe("articleService orchestration", () => {
  let dir: string
  let native: NativeDatabase
  let database: Database

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "shipping-article-"))
    native = new NativeDatabase(join(dir, "test.sqlite3"))
    database = createDatabase({ name: "sqlite", dialect: "sqlite", getInstance: () => native, exec: (sql: string) => native.exec(sql), prepare: (sql: string) => {
      const statement = native.prepare(sql)
      return {
        all: async (...params: unknown[]) => statement.all(...(params as never[])),
        get: async (...params: unknown[]) => statement.get(...(params as never[])),
        run: async (...params: unknown[]) => {
          const result = statement.run(...(params as never[]))
          return { success: result.changes > 0, changes: result.changes, lastInsertRowid: result.lastInsertRowid }
        },
      }
    } } as never)
    await initShippingTables(database, "mock")
    const repository = new ShippingRepository(database, "mock")
    await repository.upsertFeedItem(feedItem("feed:shekou-official:1", "shekou-official", "https://www.portshekou.com/ywgg/1"))
    await repository.upsertFeedItem(feedItem("feed:the-loadstar:1", "the-loadstar", "https://theloadstar.com/story-1/"))
  })

  afterEach(() => {
    native.close()
    try {
      rmSync(dir, { recursive: true, force: true })
    } catch {
      // disposable temp dir
    }
  })

  it("fetches, extracts, hashes and persists a full-text official article idempotently", async () => {
    const service = new ArticleService({
      database,
      dataMode: "mock",
      resolvePolicy: () => fullPolicy,
      fetchOptions: {
        lookup: async () => [{ address: "93.184.216.34", family: 4 }],
        transport: async () => ({ status: 200, headers: { "content-type": "text/html; charset=utf-8" }, body: articleHtml }),
      },
    })
    const first = await service.process("feed:shekou-official:1")
    expect(first).toMatchObject({ status: "complete", created: true, fetched: true })
    const second = await service.process("feed:shekou-official:1")
    expect(second.created).toBe(false)
    const detail = await service.getDetail("feed:shekou-official:1")
    expect(detail?.blocks.length).toBe(5)
    expect(detail?.versions).toHaveLength(1)
    expect(detail?.currentVersion?.contentHash).toMatch(/^[0-9a-f]{64}$/)
  })

  it("never sends a body HTTP request for a policy_disallowed source", async () => {
    let calls = 0
    const service = new ArticleService({
      database,
      dataMode: "mock",
      fetchOptions: {
        lookup: async () => [{ address: "93.184.216.34", family: 4 }],
        transport: async () => {
          calls += 1
          throw new Error("should not be called")
        },
      },
    })
    const result = await service.process("feed:the-loadstar:1")
    expect(result).toMatchObject({ status: "policy_disallowed", fetched: false })
    expect(calls).toBe(0)
  })

  it("skips disallowed sources and processes allowed ones in the bounded runtime job", async () => {
    let calls = 0
    const service = new ArticleService({
      database,
      dataMode: "mock",
      fetchOptions: {
        lookup: async () => [{ address: "93.184.216.34", family: 4 }],
        transport: async () => {
          calls += 1
          return { status: 200, headers: { "content-type": "text/html" }, body: articleHtml }
        },
      },
    })
    const job = createArticleFetchJob({ database, dataMode: "mock", intervalMs: 60_000, batchSize: 5, service })
    const result = await job.run()
    expect(result.status).toBe("success")
    expect(calls).toBe(1)
  })

  it("rotates through all allowed articles across bounded batches", async () => {
    const repository = new ShippingRepository(database, "mock")
    for (let index = 0; index < 8; index += 1) {
      await repository.upsertFeedItem(feedItem(`feed:shekou-official:r${index}`, "shekou-official", `https://www.portshekou.com/ywgg/${index}`))
    }
    let clock = Date.parse("2026-09-12T00:00:00.000Z")
    const service = new ArticleService({
      database,
      dataMode: "mock",
      now: () => new Date(clock),
      fetchOptions: {
        lookup: async () => [{ address: "93.184.216.34", family: 4 }],
        transport: async () => ({ status: 200, headers: { "content-type": "text/html" }, body: articleHtml }),
      },
    })
    const job = createArticleFetchJob({ database, dataMode: "mock", intervalMs: 60_000, batchSize: 3, service, now: () => new Date(clock) })
    for (let run = 0; run < 4; run += 1) {
      clock += 60_000
      await job.run()
    }
    const attempted = native.prepare("SELECT COUNT(*) AS c FROM feed_articles").get() as { c: number }
    expect(attempted.c).toBeGreaterThanOrEqual(8)
  })

  it("maps unsupported content types to unsupported without creating a version", async () => {
    const service = new ArticleService({
      database,
      dataMode: "mock",
      resolvePolicy: () => fullPolicy,
      fetchOptions: {
        lookup: async () => [{ address: "93.184.216.34", family: 4 }],
        transport: async () => ({ status: 200, headers: { "content-type": "application/pdf" }, body: "%PDF-1.7" }),
      },
    })
    const result = await service.process("feed:shekou-official:1")
    expect(result).toMatchObject({ status: "unsupported", fetched: true })
    expect((await service.getDetail("feed:shekou-official:1"))?.versions).toHaveLength(0)
  })

  it("keeps the last complete version when a later extraction structure fails", async () => {
    let body = articleHtml
    const service = new ArticleService({
      database,
      dataMode: "mock",
      resolvePolicy: () => fullPolicy,
      fetchOptions: {
        lookup: async () => [{ address: "93.184.216.34", family: 4 }],
        transport: async () => ({ status: 200, headers: { "content-type": "text/html" }, body }),
      },
    })
    expect((await service.process("feed:shekou-official:1")).created).toBe(true)
    const currentId = (await service.getDetail("feed:shekou-official:1"))?.currentVersion?.id
    body = noContainerHtml
    const second = await service.process("feed:shekou-official:1")
    expect(second.status).toBe("source_unavailable")
    const after = await service.getDetail("feed:shekou-official:1")
    expect(after?.versions).toHaveLength(1)
    expect(after?.currentVersion?.id).toBe(currentId)
    expect(after?.state.completenessStatus).toBe("source_unavailable")
  })
})
