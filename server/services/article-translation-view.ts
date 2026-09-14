import type { ArticleBlock, ArticleBlockType, ArticleVersion } from "@shared/article"
import type { TranslationRepository } from "#/database/translation"
import { ARTICLE_TRANSLATION_CONTRACT_VERSION, planArticleTranslation } from "#/services/article-translation-source"
import { TranslationService, canonicalLanguage } from "#/services/translation-service"

export type ArticleTranslationViewStatus = "complete" | "partial" | "untranslated" | "ineligible"
export type ArticleTranslationBlockSource = "translation" | "original" | "pending" | "failed" | "missing"

export interface ArticleTranslationBlockView {
  blockKey: string
  order: number
  type: ArticleBlockType
  text: string
  translatedText?: string
  /** `original` for same-language reuse; never disguised as a model translation. */
  source: ArticleTranslationBlockSource
}

export interface ArticleTranslationView {
  versionId: string
  targetLanguage: string
  sourceLanguage: string
  eligible: boolean
  status: ArticleTranslationViewStatus
  total: number
  translated: number
  originalSameLanguage: number
  pending: number
  failed: number
  missing: number
  completedCount: number
  blocks: ArticleTranslationBlockView[]
}

interface CachedTranslation {
  translatedText?: string
  pending: boolean
  failed: boolean
}

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
  const pendingByKey = new Map(plan.pending.map(source => [source.fieldName, source]))
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
    const source = pendingByKey.get(block.blockKey)
    const cached = source ? await lookup(repository, source) : undefined
    if (cached?.translatedText) {
      translated += 1
      blockViews.push({ blockKey: block.blockKey, order: block.order, type: block.type, text: block.text, translatedText: cached.translatedText, source: "translation" })
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

async function lookup(repository: TranslationRepository, source: { entityType: string, entityId: string, fieldName: string, sourceHash: string, targetLanguage: string }): Promise<CachedTranslation | undefined> {
  const batch = await repository.findSuccessfulBatch([{
    entityType: source.entityType,
    entityId: source.entityId,
    fieldName: source.fieldName,
    sourceHash: source.sourceHash,
    targetLanguage: source.targetLanguage,
  }])
  const entry = [...batch.values()][0]
  if (!entry) return undefined
  return { translatedText: entry.cache?.translatedText, pending: entry.pending, failed: entry.failed }
}
