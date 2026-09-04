import type { Database } from "db0"
import type { FeedItem, FeedItemDisplay, FeedTranslationDisplayState, HotItem, ShippingSettings, TranslationSettings } from "@shared/shipping"
import { ShippingRepository } from "#/database/shipping"
import type { ShippingDataMode } from "#/database/runtime"
import { defaultShippingSettings } from "#/database/runtime"
import { TranslationRepository, translationLookupKey } from "#/database/translation"
import { TranslationService, feedTranslationSources } from "#/services/translation-service"
import { normalizeTranslationSettings } from "#/services/translation-settings"

function translatedValue(original: string, translated: string | undefined): string {
  return translated?.trim() ? translated : original
}

function displayState(
  original: string,
  translated: string | undefined,
  isHistorical: boolean,
  pending: boolean,
  failed: boolean,
): FeedTranslationDisplayState[keyof FeedTranslationDisplayState] {
  if (translatedValue(original, translated) !== original || Boolean(translated?.trim())) return isHistorical ? "historical" : "translated"
  if (pending) return "pending"
  if (failed) return "unavailable"
  return "original"
}

/**
 * Adds optional Feed display text at the API boundary. The stored FeedItem
 * remains untouched, and this path never constructs a provider or mutates
 * translation work state.
 */
export async function mapFeedItemsForDisplay(
  database: Database,
  items: readonly FeedItem[],
  settingsValue?: TranslationSettings | null,
  now = new Date(),
): Promise<FeedItemDisplay[]> {
  const settings = normalizeTranslationSettings(settingsValue)
  const repository = new TranslationRepository(database)
  const service = new TranslationService(repository, undefined, {
    targetLanguage: settings.targetLanguage,
    preference: { providerId: settings.providerId, model: settings.model },
  })
  const preparedByItem = new Map<string, Map<string, ReturnType<TranslationService["prepare"]>>>()
  const lookups = [] as Array<ReturnType<TranslationService["prepare"]>>

  for (const item of items) {
    const prepared = new Map<string, ReturnType<TranslationService["prepare"]>>()
    for (const source of feedTranslationSources(item, settings.targetLanguage, undefined, now)) {
      const value = service.prepare(source)
      prepared.set(value.fieldName, value)
      lookups.push(value)
    }
    preparedByItem.set(item.id, prepared)
  }

  const cacheResults = await repository.findSuccessfulBatch(lookups, { providerId: settings.providerId, model: settings.model })
  return items.map((item) => {
    const prepared = preparedByItem.get(item.id) ?? new Map()
    const valueFor = (fieldName: "title" | "summary") => {
      const source = prepared.get(fieldName)
      if (!source) return { value: item[fieldName], state: "original" as const }
      const result = cacheResults.get(translationLookupKey(source))
      const cache = result?.cache
      const historical = Boolean(cache && (cache.provider !== settings.providerId || cache.model !== settings.model))
      return {
        value: translatedValue(item[fieldName], cache?.translatedText),
        state: displayState(item[fieldName], cache?.translatedText, historical, result?.pending ?? false, result?.failed ?? false),
      }
    }
    const title = valueFor("title")
    const summary = valueFor("summary")
    // Keep this guard close to the mapper so a malformed cache row can never
    // replace an original fact with an empty display value.
    if (!hasDisplayText(title.value, item.title) || !hasDisplayText(summary.value, item.summary)) {
      return {
        ...item,
        displayTitle: hasDisplayText(title.value, item.title) ? title.value : item.title,
        displaySummary: hasDisplayText(summary.value, item.summary) ? summary.value : item.summary,
        translation: {
          title: hasDisplayText(title.value, item.title) ? title.state : "original",
          summary: hasDisplayText(summary.value, item.summary) ? summary.state : "original",
        },
      }
    }
    return {
      ...item,
      displayTitle: title.value,
      displaySummary: summary.value,
      translation: { title: title.state, summary: summary.state },
    }
  })
}

/**
 * Enriches only Feed-kind HOT presentation from an already materialized Feed
 * display batch. Ranking and every other HOT fact remain owned by the
 * original-fact HotItem returned from rankHotItems().
 */
export function mapHotItemsForDisplay(
  hotItems: readonly HotItem[],
  displayFeedItems: readonly FeedItemDisplay[],
): HotItem[] {
  const displayFeedById = new Map(displayFeedItems.map(item => [item.id, item]))
  return hotItems.map((item) => {
    if (item.kind !== "feed") return item
    const matchingFeed = item.feedItemId ? displayFeedById.get(item.feedItemId) : undefined
    return {
      ...item,
      title: matchingFeed?.displayTitle ?? item.title,
      summary: matchingFeed?.displaySummary ?? item.summary,
    }
  })
}

/** Formal provider-free current Feed read composition shared by API and acceptance. */
export async function readCurrentFeedItemsForDisplay(
  database: Database,
  dataMode: ShippingDataMode,
  settingsValue?: ShippingSettings | null,
  now = new Date(),
): Promise<FeedItemDisplay[]> {
  const shippingRepository = new ShippingRepository(database, dataMode)
  const settings = settingsValue ?? await shippingRepository.getSettings() ?? defaultShippingSettings
  const items = await shippingRepository.listFeedItems({ now, view: "current" })
  return mapFeedItemsForDisplay(database, items, settings.translation, now)
}

function hasDisplayText(value: string, original: string): boolean {
  return value.trim().length > 0 || original.trim().length === 0
}
