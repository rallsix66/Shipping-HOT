import process from "node:process"
import { defaultShippingSettings } from "#/database/runtime"
import { ShippingRepository, initShippingTables } from "#/database/shipping"
import { ArticleService } from "#/services/article-service"
import { readArticleTranslationView } from "#/services/article-translation-display"

export default defineEventHandler(async (event) => {
  const database = useDatabase()
  const dataMode = process.env.SHIPPING_DATA_MODE === "real" ? "real" : "mock"
  await initShippingTables(database, dataMode)
  const rawId = getRouterParam(event, "id") ?? ""
  let id = rawId
  try {
    id = decodeURIComponent(rawId)
  } catch {
    id = rawId
  }
  const query = getQuery(event)
  const versionId = typeof query.versionId === "string" && query.versionId ? query.versionId : undefined
  const repository = new ShippingRepository(database, dataMode)
  // history/all keeps already-stored articles readable after Feed freshness expires.
  const item = (await repository.listFeedItems({ now: new Date(), view: "all" })).find(candidate => candidate.id === id)
  if (!item) {
    setResponseStatus(event, 404)
    return { error: "feed_item_not_found" }
  }
  const article = await new ArticleService({ database, dataMode }).getDetail(id, versionId)
  if (versionId && !article?.versions.some(version => version.id === versionId)) {
    setResponseStatus(event, 404)
    return { error: "article_version_not_found" }
  }
  if (!article) return { feedItem: item, article: null }
  const settings = await repository.getSettings() ?? defaultShippingSettings
  const translation = await readArticleTranslationView(database, article, settings.translation)
  return {
    feedItem: item,
    article: { ...article, translation },
  }
})
