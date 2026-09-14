import type { Database } from "db0"
import type { ArticleTranslationView, FeedArticleDetail } from "@shared/article"
import type { TranslationSettings } from "@shared/shipping"
import { TranslationRepository } from "#/database/translation"
import { normalizeTranslationSettings } from "#/services/translation-settings"
import { buildArticleTranslationView } from "#/services/article-translation-view"

/**
 * Provider-free translation view for the article version a GET actually
 * displays. Reads `translation_cache` only: no claim, no Provider call, no
 * `provider_usage` write, no Runtime execution. A missing/disabled secret or
 * disabled translation setting therefore never removes an already-cached view.
 */
export async function readArticleTranslationView(
  database: Database,
  detail: FeedArticleDetail,
  settingsValue?: TranslationSettings | null,
): Promise<ArticleTranslationView | null> {
  if (!detail.currentVersion) return null
  const settings = normalizeTranslationSettings(settingsValue)
  return buildArticleTranslationView({
    version: detail.currentVersion,
    blocks: detail.blocks,
    targetLanguage: settings.targetLanguage,
    repository: new TranslationRepository(database),
  })
}
