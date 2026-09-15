import type { ArticleBlock, ArticleCompletenessStatus, ArticleTranslationBlockView, ArticleTranslationView, ArticleTranslationViewStatus, ArticleVersion } from "@shared/article"
import { type TranslationCachePreference, type TranslationRepository, translationLookupKey } from "#/database/translation"
import { ARTICLE_TRANSLATION_CONTRACT_VERSION, planArticleTranslation, preservesArticleBlockShape } from "#/services/article-translation-source"
import { TranslationService, canonicalLanguage } from "#/services/translation-service"

export type { ArticleTranslationBlockSource, ArticleTranslationBlockView, ArticleTranslationView, ArticleTranslationViewStatus } from "@shared/article"

/**
 * Provider-free derivation of the translation state for one article version.
 * Reads only `translation_cache` and never prepares or claims work, so a GET can
 * never trigger a DeepSeek call or a usage write. Identity is version-scoped
 * (`entityId = ArticleVersion.id`), so an A version translation can never surface
 * for B.
 *
 * Two honesty rules are enforced here rather than in the UI:
 * - eligibility uses the mutable `state.completenessStatus` when the caller
 *   supplies it, so a version whose source is no longer complete can never be
 *   reported as fully translated on a page that simultaneously calls it incomplete;
 * - a successful cache row written by a different provider/model is surfaced as
 *   `historical` (never as the configured model's translation), and a cached
 *   string whose list/table skeleton differs from the source block is surfaced as
 *   `rejected` (counted in `failed`) so the reader keeps the original instead of a
 *   broken shape and the badge does not claim a Provider call failed.
 */
export async function buildArticleTranslationView(input: {
  version: ArticleVersion
  blocks: readonly ArticleBlock[]
  targetLanguage: string
  repository: TranslationRepository
  /** Mutable current completeness from `ArticleState`; falls back to the version row. */
  completenessStatus?: ArticleCompletenessStatus
  preference?: TranslationCachePreference
}): Promise<ArticleTranslationView> {
  const { version, blocks, targetLanguage, repository, completenessStatus, preference } = input
  const service = new TranslationService(repository, undefined, { targetLanguage, contractVersion: ARTICLE_TRANSLATION_CONTRACT_VERSION })
  const plan = planArticleTranslation({
    version: { ...version, completenessStatus: completenessStatus ?? version.completenessStatus },
    blocks,
    targetLanguage,
    prepare: service.prepare.bind(service),
  })
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
      historical: 0,
      originalSameLanguage: 0,
      pending: 0,
      failed: 0,
      rejected: 0,
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
  const batch = lookups.length > 0
    ? await repository.findSuccessfulBatch(lookups, preference)
    : new Map<string, { pending: boolean, failed: boolean, cache?: { translatedText?: string, provider?: string, model?: string } }>()
  const lookupByBlockKey = new Map(lookups.map(lookup => [lookup.fieldName, translationLookupKey(lookup)]))

  const blockViews: ArticleTranslationBlockView[] = []
  let translated = 0
  let historical = 0
  let originalSameLanguage = 0
  let pending = 0
  let failed = 0
  let rejected = 0
  let missing = 0

  for (const block of ordered) {
    if (reuse.has(block.blockKey)) {
      originalSameLanguage += 1
      blockViews.push({ blockKey: block.blockKey, order: block.order, type: block.type, text: block.text, translatedText: block.text, source: "original" })
      continue
    }
    const key = lookupByBlockKey.get(block.blockKey)
    const cached = key ? batch.get(key) : undefined
    const cachedText = cached?.cache?.translatedText
    const isHistorical = Boolean(preference && cached?.cache && (cached.cache.provider !== preference.providerId || cached.cache.model !== preference.model))
    if (cachedText && preservesArticleBlockShape(block, cachedText)) {
      if (isHistorical) historical += 1
      else translated += 1
      blockViews.push({ blockKey: block.blockKey, order: block.order, type: block.type, text: block.text, translatedText: cachedText, source: isHistorical ? "historical" : "translation" })
    } else if (cachedText) {
      // A cached string that would change the rendered structure is not shown, and
      // it is counted as `rejected` (not `failed`): no Provider call failed, the
      // stored translation simply does not match this block's skeleton.
      rejected += 1
      blockViews.push({ blockKey: block.blockKey, order: block.order, type: block.type, text: block.text, source: "rejected" })
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

  const completedCount = translated + historical + originalSameLanguage
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
    historical,
    originalSameLanguage,
    pending,
    failed,
    rejected,
    missing,
    completedCount,
    blocks: blockViews,
  }
}
