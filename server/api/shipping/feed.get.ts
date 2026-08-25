import { getCurrentFeedItems } from "#/shipping-store"

export default defineEventHandler(async () => ({
  view: "current" as const,
  feedItems: await getCurrentFeedItems(),
}))
