import { describe, expect, it } from "vitest"
import type { ArticleBlock, ArticleVersion } from "@shared/article"
import { ARTICLE_TRANSLATION_CONTRACT_VERSION, planArticleTranslation } from "./article-translation-source"
import { TranslationService } from "#/services/translation-service"

function version(overrides: Partial<ArticleVersion> = {}): ArticleVersion {
  return {
    id: "version-1",
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
  return [
    { id: "b0", blockKey: "0", order: 0, type: "heading", text: "Title", metadata: { level: 2 } },
    { id: "b1", blockKey: "1", order: 1, type: "paragraph", text: "Body paragraph" },
    { id: "b2", blockKey: "2", order: 2, type: "list", text: "One • Two", metadata: { ordered: false } },
    { id: "b3", blockKey: "3", order: 3, type: "table", text: "Berth | Status", metadata: { header: true } },
  ]
}

function plan(targetLanguage: string, v: ArticleVersion = version()) {
  // prepare() is pure and does not touch the repository/provider.
  const service = new TranslationService({} as never, undefined, { targetLanguage, contractVersion: ARTICLE_TRANSLATION_CONTRACT_VERSION })
  return { service, result: planArticleTranslation({ version: v, blocks: blocks(), targetLanguage, prepare: service.prepare.bind(service) }) }
}

describe("article translation source planner", () => {
  it("sources each block through TranslationService.prepare with stable identity and structure protection", () => {
    const { service, result } = plan("zh-CN")
    expect(result.eligible).toBe(true)
    if (!result.eligible) return
    expect(result.total).toBe(4)
    expect(result.pending).toHaveLength(4)
    const list = result.pending.find(source => source.fieldName === "2")
    const table = result.pending.find(source => source.fieldName === "3")
    expect(list?.protectedTerms).toEqual([" • "])
    expect(table?.protectedTerms).toEqual([" | "])
    expect(result.pending.every(source => source.entityType === "article_block" && source.entityId === "version-1")).toBe(true)
    const expected = service.prepare({ entityType: "article_block", entityId: "version-1", fieldName: "1", sourceText: "Body paragraph", sourceLanguage: "en", targetLanguage: "zh-CN" })
    expect(result.pending.find(source => source.fieldName === "1")?.sourceHash).toBe(expected.sourceHash)
    expect(result.sameLanguage).toBe(false)
  })

  it("performs no provider sources for a same-language version and reuses the original", () => {
    const { result } = plan("zh-CN", version({ language: "zh-CN" }))
    expect(result.eligible).toBe(true)
    if (!result.eligible) return
    expect(result.sameLanguage).toBe(true)
    expect(result.pending).toHaveLength(0)
    expect(result.originalReuseBlockKeys).toHaveLength(4)
  })

  it("keeps an unknown language as auto (never guesses same-language)", () => {
    const { result } = plan("zh-CN", version({ language: null }))
    expect(result.eligible).toBe(true)
    if (!result.eligible) return
    expect(result.sourceLanguage).toBe("auto")
    expect(result.sameLanguage).toBe(false)
    expect(result.pending).toHaveLength(4)
  })

  it("only plans complete, non-restricted versions with real text", () => {
    expect(plan("zh-CN", version({ completenessStatus: "summary_only" })).result).toMatchObject({ eligible: false, reason: "version_not_complete" })
    expect(plan("zh-CN", version({ redistributionPolicy: "excerpt_only" })).result).toMatchObject({ eligible: false, reason: "version_not_complete" })
    const empty = planArticleTranslation({
      version: version(),
      blocks: [{ id: "e", blockKey: "0", order: 0, type: "paragraph", text: "   " }],
      targetLanguage: "zh-CN",
      prepare: ({ entityType, entityId, fieldName, sourceText, sourceLanguage, targetLanguage }) => ({ entityType, entityId, fieldName, sourceText, sourceLanguage: sourceLanguage ?? "auto", targetLanguage: targetLanguage ?? "zh-CN", sourceHash: "h" }),
    })
    expect(empty).toMatchObject({ eligible: false, reason: "no_blocks" })
  })
})
