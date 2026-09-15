import { describe, expect, it } from "vitest"
import type { ArticleBlock, ArticleVersion } from "@shared/article"
import { ARTICLE_TRANSLATION_CONTRACT_VERSION, articleBlockShape, articleConservativeProjectedCostUsd, isSameTranslationLanguage, planArticleTranslation, preservesArticleBlockShape } from "./article-translation-source"
import { protectTranslationText, restoreAndValidateProtectedTranslation } from "#/services/translation-protection"
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
    expect(table?.protectedTerms).toEqual([" | ", "\n"])
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

  it("protects table newlines so multi-row boundaries survive translation", () => {
    const multiline = "Berth | Status\n1 | Closed"
    const protectedText = protectTranslationText(multiline, [" | ", "\n"])
    expect(protectedText.protectedText.includes("\n")).toBe(false)
    expect(restoreAndValidateProtectedTranslation(protectedText, protectedText.protectedText)).toBe(multiline)
  })

  it("treats region/script variants of the source language as same-language reuse", () => {
    // Full-tag equality would treat a Simplified-Chinese page declaring `zh` or
    // `zh-Hans` as a foreign language and pay for a Chinese->Chinese call.
    const cases: Array<[string, boolean]> = [
      ["zh", true],
      ["zh-Hans", true],
      ["zh-CN", true],
      ["zh-SG", true],
      ["zh-TW", false],
      ["zh-HK", false],
      ["zh-Hant", false],
      ["en", false],
      ["en-US", false],
      ["ja", false],
      ["auto", false],
    ]
    for (const [language, expected] of cases) {
      const { result } = plan("zh-CN", version({ language }))
      expect(result.eligible).toBe(true)
      if (!result.eligible) continue
      expect([language, result.sameLanguage, result.pending.length]).toEqual([language, expected, expected ? 0 : 4])
    }
  })

  it("treats region-only variants of a non-Chinese language as the same language", () => {
    expect(isSameTranslationLanguage("en", "en-US")).toBe(true)
    expect(isSameTranslationLanguage("en-GB", "en-US")).toBe(true)
    expect(isSameTranslationLanguage("en", "zh-CN")).toBe(false)
    expect(isSameTranslationLanguage("zh-Hant", "zh-Hant")).toBe(true)
    expect(isSameTranslationLanguage("de", "en")).toBe(false)
    expect(isSameTranslationLanguage("auto", "auto")).toBe(false)
    expect(isSameTranslationLanguage("unknown", "zh-CN")).toBe(false)
  })

  it("never reuses a variant or extlang tag as the bare language", () => {
    // `yue`/`cmn` are 3-letter extlangs, not regions: treating them as regions
    // made Cantonese look like Simplified Chinese, so the source was shown as
    // "already the target language" and never translated.
    expect(isSameTranslationLanguage("zh-yue", "zh-CN")).toBe(false)
    expect(isSameTranslationLanguage("zh-cmn", "zh-CN")).toBe(false)
    expect(isSameTranslationLanguage("zh-yue", "zh-Hant")).toBe(false)
    expect(isSameTranslationLanguage("en-GB-oxendict", "en-GB")).toBe(false)
    expect(isSameTranslationLanguage("en-GB-oxendict", "en-US-oxendict")).toBe(true)
    expect(isSameTranslationLanguage("de-CH-1901", "de-DE")).toBe(false)
    // A numeric UN M.49 region is still a region, not a variant.
    expect(isSameTranslationLanguage("es-419", "es-MX")).toBe(true)
    expect(isSameTranslationLanguage("zh-Hans-CN", "zh-CN")).toBe(true)
    expect(isSameTranslationLanguage("zh-Hant-CN", "zh-CN")).toBe(false)
  })

  it("detects a translated block whose rendered structure no longer matches the source", () => {
    const list = { type: "list" as const, text: "One • Two" }
    expect(preservesArticleBlockShape(list, "一 • 二")).toBe(true)
    // An extra model-inserted separator would render a third <li>.
    expect(preservesArticleBlockShape(list, "一 • 额外 • 二")).toBe(false)
    const table = { type: "table" as const, text: "Berth | Status\n1 | Closed" }
    expect(preservesArticleBlockShape(table, "泊位 | 状态\n1 | 关闭")).toBe(true)
    // Losing the row boundary collapses the table into a single row.
    expect(preservesArticleBlockShape(table, "泊位 | 状态 1 | 关闭")).toBe(false)
    // An extra model-inserted newline adds a phantom row.
    expect(preservesArticleBlockShape(table, "泊位 | 状态\n1 | 关闭\n2 | 开放")).toBe(false)
    // An extra model-inserted cell shifts every column.
    expect(preservesArticleBlockShape(table, "泊位 | 状态 | 备注\n1 | 关闭 | -")).toBe(false)
    expect(preservesArticleBlockShape({ type: "paragraph" as const, text: "Body" }, "正文")).toBe(true)
    expect(articleBlockShape(table)).toEqual({ rows: 2, cells: [2, 2] })
  })

  it("projects the article cost from the placeholder-protected payload, not the raw text", () => {
    // A marker-heavy table serializes far longer than its raw text, so projecting
    // from the raw source under-estimated the real request by ~3.8x. Protecting the
    // structural separators and the caller's terms only lengthens the payload, so the
    // projection must grow in that order.
    const table = "AE7 | Open | 16.5\nMD2 | Closed | 11.0"
    const terms = ["AE7", "MD2", "16.5", "11.0"]
    const raw = articleConservativeProjectedCostUsd(table, "zh-CN", 4096)
    const separatorsOnly = articleConservativeProjectedCostUsd(table, "zh-CN", 4096, [])
    const projected = articleConservativeProjectedCostUsd(table, "zh-CN", 4096, terms)
    // No terms means no placeholders, so the projection is unchanged...
    expect(separatorsOnly).toBe(raw)
    // ...while the article path's real terms lengthen the serialized payload.
    expect(projected).toBeGreaterThan(raw)
    // The provider is handed exactly protectTranslationText(...).protectedText, so the
    // guard is measured on the payload that is really serialized.
    const protectedText = protectTranslationText(table, terms).protectedText
    expect(protectedText.length).toBeGreaterThan(table.length)
  })
})
