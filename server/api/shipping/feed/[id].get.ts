import process from "node:process"
import { ShippingRepository, initShippingTables } from "#/database/shipping"
import { ArticleService } from "#/services/article-service"

export default defineEventHandler(async (event) => {
  const database = useDatabase()
  const dataMode = process.env.SHIPPING_DATA_MODE === "real" ? "real" : "mock"
  await initShippingTables(database, dataMode)
  const id = getRouterParam(event, "id") ?? ""
  const query = getQuery(event)
  const versionId = typeof query.versionId === "string" && query.versionId ? query.versionId : undefined
  const repository = new ShippingRepository(database, dataMode)
  const item = (await repository.listFeedItems({ now: new Date(), view: "current" })).find(candidate => candidate.id === id)
  if (!item) {
    setResponseStatus(event, 404)
    return { error: "feed_item_not_found" }
  }
  const article = await new ArticleService({ database, dataMode }).getDetail(id, versionId)
  return {
    feedItem: item,
    article: article ?? null,
  }
})
