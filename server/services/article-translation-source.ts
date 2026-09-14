import type { ArticleBlock, ArticleVersion } from "@shared/article"
import { estimateConservativeDeepSeekProjectedCost } from "#/providers/translation/deepseek-provider"
import { protectTranslationText } from "#/services/translation-protection"
import { type PreparedTranslationSource, type TranslationSource, canonicalLanguage } from "#/services/translation-service"

/**
 * Optional output cap for the article path only; gives the projected budget
 * bound a real ceiling. Feed title/summary keeps its default request shape.
 */
export const ARTICLE_TRANSLATION_MAX_OUTPUT_TOKENS = 4096

/**
 * Local conservative pre-call cost estimate (NOT a proven bound and NOT provider
 * actual usage). It projects from the DeepSeek request payload that the job will
 * actually send — the placeholder-protected source, not the raw block text, since
 * `executePrepared` protects before calling the Provider — at the peak cache-miss
 * rate with the article max_tokens output cap and a safety margin. Actual spend
 * always comes from estimateDeepSeekCost() on the Provider-returned usage.
 */
export function articleConservativeProjectedCostUsd(sourceText: string, targetLanguage: string, maxTokens: number = ARTICLE_TRANSLATION_MAX_OUTPUT_TOKENS, protectedTerms: string[] = []): number {
  // Measuring the raw text under-estimated a marker-heavy table by ~3.8x, so the
  // estimate is taken on the same protected text the Provider receives.
  const { protectedText } = protectTranslationText(sourceText, protectedTerms)
  return estimateConservativeDeepSeekProjectedCost({ sourceText: protectedText, targetLanguage, maxTokens })
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

interface LanguageParts {
  language: string
  script?: string
  region?: string
  /**
   * Subtags that are neither script nor region (BCP-47 variants and extlangs,
   * e.g. the `yue`/`cmn` in `zh-yue`/`zh-cmn`). They must match exactly, because
   * `zh-yue` is Cantonese and must never be reused as if it were `zh-CN`.
   */
  extras: string[]
}

function isRegionSubtag(part: string): boolean {
  // UN M.49 numeric regions are three digits; alpha regions are exactly two
  // letters. A three-letter subtag is an extlang/variant, not a region: treating
  // it as one made `zh-yue` look like a Simplified-Chinese region tag.
  return /^[a-z]{2}$/.test(part) || /^\d{3}$/.test(part)
}

function languageParts(tag: string): LanguageParts | undefined {
  const candidate = tag.trim().toLowerCase()
  if (!candidate || candidate === "auto" || candidate === "unknown") return undefined
  const [language, ...rest] = candidate.split("-")
  if (!language) return undefined
  let script: string | undefined
  let region: string | undefined
  const extras: string[] = []
  for (const part of rest) {
    if (!part) continue
    if (/^[a-z]{4}$/.test(part)) script = part
    else if (isRegionSubtag(part)) region = part
    else extras.push(part)
  }
  return { language, script, region, extras: extras.sort() }
}

const TRADITIONAL_CHINESE_REGIONS = new Set(["tw", "hk", "mo"])

function chineseScript(parts: LanguageParts): "hans" | "hant" {
  if (parts.script) return parts.script === "hant" ? "hant" : "hans"
  return parts.region && TRADITIONAL_CHINESE_REGIONS.has(parts.region) ? "hant" : "hans"
}

/**
 * Language equivalence for translation reuse. Requiring the whole canonical tag
 * to match would treat the very common `zh` / `zh-Hans` source as a foreign
 * language of a `zh-CN` target and pay for a Chinese->Chinese Provider call, so
 * language + script are compared instead: region-only differences (en vs en-US)
 * are the same language, while Chinese script is compared explicitly so
 * `zh-TW` / `zh-Hant` never reuses Simplified text, and a variant/extlang
 * (`zh-yue`, `zh-cmn`, `en-GB-oxendict`) is never treated as the bare language.
 * `auto`/`unknown` never match.
 */
export function isSameTranslationLanguage(sourceLanguage: string, targetLanguage: string): boolean {
  const source = languageParts(sourceLanguage)
  const target = languageParts(targetLanguage)
  if (!source || !target) return false
  if (source.language !== target.language) return false
  // Do not reuse across a variant/extlang (zh-yue/zh-cmn are not zh-CN): an
  // unrecognised subtag means the tag describes something more specific than the
  // bare language, so reusing it would present untranslated text as translated.
  if (source.extras.join("-") !== target.extras.join("-")) return false
  if (source.language === "zh") return chineseScript(source) === chineseScript(target)
  if (source.script && target.script && source.script !== target.script) return false
  return true
}

/**
 * Structural skeleton of a list/table block, derived from the same flat
 * separators the extractor wrote and the reader splits on. A translated block
 * must keep this skeleton exactly; a mismatch means the restored text would
 * render a different number of items/rows/cells than the source.
 */
export function articleBlockShape(block: Pick<ArticleBlock, "type" | "text">): { items?: number, rows?: number, cells?: number[] } | undefined {
  if (block.type === "list") return { items: block.text.split(" • ").filter(Boolean).length }
  if (block.type === "table") {
    const rows = block.text.split("\n").filter(Boolean)
    return { rows: rows.length, cells: rows.map(row => row.split(" | ").length) }
  }
  return undefined
}

/** True when a translated block keeps the source block's list/table skeleton. */
export function preservesArticleBlockShape(block: Pick<ArticleBlock, "type" | "text">, translatedText: string): boolean {
  const expected = articleBlockShape(block)
  if (!expected) return true
  const actual = articleBlockShape({ type: block.type, text: translatedText })
  if (!actual) return false
  if (expected.items !== undefined) return actual.items === expected.items
  if (expected.rows !== actual.rows) return false
  return (expected.cells ?? []).every((count, index) => actual.cells?.[index] === count)
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
  const sameLanguage = isSameTranslationLanguage(sourceLanguage, canonicalLanguage(targetLanguage))
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
