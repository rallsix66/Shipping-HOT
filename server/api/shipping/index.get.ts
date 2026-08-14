import { getShippingSnapshot } from "#/shipping-store"
import { providerModes, realProviders } from "#/providers/shipping"
import { rankHotItems } from "@shared/shipping-rules"

export default defineEventHandler(async () => {
  const snapshot = await getShippingSnapshot()
  return {
    ...snapshot,
    hot: rankHotItems(snapshot.events, snapshot.ports, snapshot.vessels, snapshot.voyages, snapshot.feedItems),
    provider: providerModes,
    realProviders,
  }
})
