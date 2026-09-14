import type { ArticleBlock, ArticleTranslationBlockView, ArticleTranslationView, ArticleTranslationViewStatus, ArticleVersion } from "@shared/article"
import { type TranslationRepository, translationLookupKey } from "#/database/translation"
import { ARTICLE_TRANSLATION_CONTRACT_VERSION, planArticleTranslation } from "#/services/article-translation-source"
import { TranslationService, canonicalLanguage } from "#/services/translation-service"

export type { ArticleTranslationBlockSource, ArticleTranslationBlockView, ArticleTranslationView, ArticleTranslationViewStatus } from "@shared/article"

/**
 * Provider-free derivation of the translation state for one article version.
 * Reads only `translation_cache` and never prepares or claims work, so a GET can
 * never trigger a DeepSeek call or a usage write. Identity is version-scoped
 * (`entityId = ArticleVersion.id`), so an A version translation can never surface
 * for B.
 */
export async function buildArticleTranslationView(input: {
  version: ArticleVersion
  blocks: readonly ArticleBlock[]
  targetLanguage: string
  repository: TranslationRepository
}): Promise<ArticleTranslationView> {
  const { version, blocks, targetLanguage, repository } = input
  const service = new TranslationService(repository, undefined, { targetLanguage, contractVersion: ARTICLE_TRANSLATION_CONTRACT_VERSION })
  const plan = planArticleTranslation({ version, blocks, targetLanguage, prepare: service.prepare.bind(service) })
  const ordered = [...blocks].filter(block => block.text.trim().length > 0).sort((a, b) => a.order - b.order)

  if (!plan.eligible) {
    return {
      versionId: version.id,
      targetLanguage,
      sourceLanguage: canonicalLanguage(version.language ?? undefined, "auto"),
      eligible: false,
      status: "ineligible",
      total: ordered.length,
      translated: 0,
      originalSameLanguage: 0,
      pending: 0,
      failed: 0,
      missing: ordered.length,
      completedCount: 0,
      blocks: ordered.map(block => ({ blockKey: block.blockKey, order: block.order, type: block.type, text: block.text, source: "missing" as const })),
    }
  }

  const reuse = new Set(plan.originalReuseBlockKeys)
  // One batch cache read for every block still needing translation (no N+1).
  const lookups = plan.pending.map(source => ({
    entityType: source.entityType,
    entityId: source.entityId,
    fieldName: source.fieldName,
    sourceHash: source.sourceHash,
    targetLanguage: source.targetLanguage,
  }))
  const batch = lookups.length > 0 ? await repository.findSuccessfulBatch(lookups) : new Map<string, { pending: boolean, failed: boolean, cache?: { translatedText?: string } }>()
  const lookupByBlockKey = new Map(lookups.map(lookup => [lookup.fieldName, translationLookupKey(lookup)]))

  const blockViews: ArticleTranslationBlockView[] = []
  let translated = 0
  let originalSameLanguage = 0
  let pending = 0
  let failed = 0
  let missing = 0

  for (const block of ordered) {
    if (reuse.has(block.blockKey)) {
      originalSameLanguage += 1
      blockViews.push({ blockKey: block.blockKey, order: block.order, type: block.type, text: block.text, translatedText: block.text, source: "original" })
      continue
    }
    const key = lookupByBlockKey.get(block.blockKey)
    const cached = key ? batch.get(key) : undefined
    if (cached?.cache?.translatedText) {
      translated += 1
      blockViews.push({ blockKey: block.blockKey, order: block.order, type: block.type, text: block.text, translatedText: cached.cache.translatedText, source: "translation" })
    } else if (cached?.pending) {
      pending += 1
      blockViews.push({ blockKey: block.blockKey, order: block.order, type: block.type, text: block.text, source: "pending" })
    } else if (cached?.failed) {
      failed += 1
      blockViews.push({ blockKey: block.blockKey, order: block.order, type: block.type, text: block.text, source: "failed" })
    } else {
      missing += 1
      blockViews.push({ blockKey: block.blockKey, order: block.order, type: block.type, text: block.text, source: "missing" })
    }
  }

  const completedCount = translated + originalSameLanguage
  const status: ArticleTranslationViewStatus = completedCount === 0
    ? "untranslated"
    : completedCount >= plan.total ? "complete" : "partial"

  return {
    versionId: version.id,
    targetLanguage,
    sourceLanguage: plan.sourceLanguage,
    eligible: true,
    status,
    total: plan.total,
    translated,
    originalSameLanguage,
    pending,
    failed,
    missing,
    completedCount,
    blocks: blockViews,
  }
}
