import process from "node:process"
import { getCurrentFeedItems } from "#/shipping-store"
import { ShippingRepository, initShippingTables } from "#/database/shipping"
import { defaultShippingSettings } from "#/database/runtime"
import { mapFeedItemsForDisplay } from "#/services/feed-translation-display"

export default defineEventHandler(async () => {
  const database = useDatabase()
  const dataMode = process.env.SHIPPING_DATA_MODE === "real" ? "real" : "mock"
  await initShippingTables(database, dataMode)
  const settings = await new ShippingRepository(database, dataMode).getSettings() ?? defaultShippingSettings
  const feedItems = await getCurrentFeedItems()
  return {
    view: "current" as const,
    feedItems: await mapFeedItemsForDisplay(database, feedItems, settings.translation),
  }
})
