import { rankHotItems } from "@shared/shipping-rules"
import { getShippingSnapshot } from "#/shipping-store"
import { mapFeedItemsForDisplay, mapHotItemsForDisplay } from "#/services/feed-translation-display"
import { operationalSourceContext, providerModes, realProviders } from "#/providers/shipping"
import { calendarAttribution } from "#/providers/calendar"

export default defineEventHandler(async () => {
  // LEGACY / DEFERRED MIGRATION: this endpoint still uses the historical
  // request-triggered Provider path. P2C adds no new request-triggered sync;
  // future workstreams must move each capability behind BackgroundRuntime.
  const snapshot = await getShippingSnapshot()
  const hot = rankHotItems(snapshot.events, snapshot.ports, snapshot.vessels, snapshot.voyages, snapshot.feedItems, new Date(), operationalSourceContext)
  const displayFeedItems = await mapFeedItemsForDisplay(useDatabase(), snapshot.feedItems, snapshot.settings.translation)
  return {
    ...snapshot,
    // HOT is deliberately ranked from original Feed facts; translation is
    // optional API enrichment only.
    feedItems: displayFeedItems,
    hot: mapHotItemsForDisplay(hot, displayFeedItems),
    provider: providerModes,
    realProviders,
    calendarAttribution: calendarAttribution({ provider: providerModes.calendar, events: snapshot.calendarEvents }),
  }
})
