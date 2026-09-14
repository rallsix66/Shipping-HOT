import type { ArticleBlock, ArticleVersion } from "@shared/article"
import { DEEPSEEK_PRICING_USD_PER_MILLION } from "#/providers/translation/deepseek-provider"
import { type PreparedTranslationSource, type TranslationSource, canonicalLanguage } from "#/services/translation-service"

/**
 * Optional output cap for the article path only; gives the projected budget
 * bound a real ceiling. Feed title/summary keeps its default request shape.
 */
export const ARTICLE_TRANSLATION_MAX_OUTPUT_TOKENS = 4096

/**
 * Local conservative pre-call budget upper bound (NOT provider actual usage).
 * Uses 1 token per input character and the higher peak rate, so it over-estimates
 * rather than under-budgets. Actual spend always comes from estimateDeepSeekCost()
 * on the Provider-returned usage.
 */
export function articleProjectedUpperBoundUsd(sourceText: string): number {
  const promptTokens = sourceText.length
  const rates = DEEPSEEK_PRICING_USD_PER_MILLION.peak
  return (promptTokens * rates.promptCacheMiss + ARTICLE_TRANSLATION_MAX_OUTPUT_TOKENS * rates.output) / 1_000_000
}

/**
 * Independent, stable contract for article-block translation. Bump this when
 * prompt semantics, structure-protection semantics or the terminology/protection
 * rules change, so historical FeedItem title/summary cache stays valid.
 */
export const ARTICLE_TRANSLATION_CONTRACT_VERSION = "article-faithful-v1"

export type ArticleTranslationIneligibility = "version_not_complete" | "no_blocks"

export interface ArticleTranslationPlan {
  versionId: string
  targetLanguage: string
  sourceLanguage: string
  sameLanguage: boolean
  total: number
  /** Blocks that still need a provider call (sourceHash comes from prepare()). */
  pending: PreparedTranslationSource[]
  /** Blocks already satisfied by the original text (same-language). */
  originalReuseBlockKeys: string[]
}

/**
 * The flat list/table representation is preserved by protecting the separators
 * the extractor emitted, so structure can be re-rendered from the metadata.
 */
export function articleBlockProtectedTerms(block: ArticleBlock): string[] | undefined {
  if (block.type === "list") return [" • "]
  if (block.type === "table") return [" | ", "\n"]
  return undefined
}

export function isArticleVersionTranslationComplete(version: Pick<ArticleVersion, "completenessStatus">, redistributionPolicy?: string | null): boolean {
  return version.completenessStatus === "complete" && redistributionPolicy !== "excerpt_only" && redistributionPolicy !== "disallowed"
}

/**
 * Builds the deterministic set of block translation sources for one article
 * version. Uses the caller-provided TranslationService.prepare() to derive the
 * sourceHash (never a locally-invented hash). Same-language blocks perform no
 * provider call and count as satisfied by the original text.
 */
export function planArticleTranslation(input: {
  version: ArticleVersion
  blocks: readonly ArticleBlock[]
  targetLanguage: string
  prepare: (source: TranslationSource) => PreparedTranslationSource
}): { eligible: false, reason: ArticleTranslationIneligibility } | ({ eligible: true } & ArticleTranslationPlan) {
  const { version, blocks, targetLanguage, prepare } = input
  if (!isArticleVersionTranslationComplete(version, version.redistributionPolicy)) return { eligible: false, reason: "version_not_complete" }
  const usable = blocks.filter(block => block.text.trim().length > 0)
  if (usable.length === 0) return { eligible: false, reason: "no_blocks" }
  const sourceLanguage = canonicalLanguage(version.language ?? undefined, "auto")
  const sameLanguage = sourceLanguage !== "auto" && canonicalLanguage(targetLanguage) === sourceLanguage
  const pending: PreparedTranslationSource[] = []
  const originalReuseBlockKeys: string[] = []
  for (const block of usable) {
    if (sameLanguage) {
      originalReuseBlockKeys.push(block.blockKey)
      continue
    }
    pending.push(prepare({
      entityType: "article_block",
      entityId: version.id,
      fieldName: block.blockKey,
      sourceText: block.text,
      sourceLanguage,
      targetLanguage,
      protectedTerms: articleBlockProtectedTerms(block),
      maxTokens: ARTICLE_TRANSLATION_MAX_OUTPUT_TOKENS,
    }))
  }
  return { eligible: true, versionId: version.id, targetLanguage, sourceLanguage, sameLanguage, total: usable.length, pending, originalReuseBlockKeys }
}
