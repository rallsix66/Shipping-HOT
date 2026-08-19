import { filterEventsForOperationalContext, sourceAllowedForOperationalContext, toVesselWatchTarget } from "@shared/shipping"
import type { FeedItem, Port, ProviderResult, ShippingSettings, ShippingSnapshot, Vessel, Voyage } from "@shared/shipping"
import { createMockSnapshot } from "@shared/shipping-fixtures"
import { type CalendarCountryCode, type CalendarEvent, type CalendarProviderResult, type CalendarQuery, calendarCountries, calendarEventKey, calendarEventLegacyId } from "@shared/calendar"
import { detectShippingEvents } from "@shared/shipping-engine"
import { mergeProviderVessel, mergeProviderVoyage } from "@shared/shipping-rules"
import { createMockCalendarEvents, filterCalendarCoverageForSourceIds, filterCalendarEventsForSourceIds, mergeCalendarSources } from "#/providers/calendar"
import { filterFeedLastKnownForMode } from "#/providers/feed"
import { ShippingRepository, initShippingTables } from "#/database/shipping"
import { disabledProviderData, fetchWeatherProviderResults, isOfficialWeatherAlertFeedItem, isWeatherFeedItem, operationalSourceContext, providerError, providerModes, providerProvenances, providerResult, providers, sanitizeAisVessel, toProviderResult } from "#/providers/shipping"

let repository: ShippingRepository | undefined
const mockCalendarYear = new Date().getUTCFullYear()
let fallbackSnapshot: ShippingSnapshot = { ...createMockSnapshot(), calendarEvents: createMockCalendarEvents(mockCalendarYear) }
let initialized: Promise<void> | undefined

function preserveWatchState<T extends Vessel | Port>(latest: T[], stored: T[]): T[] {
  const previous = new Map(stored.map(item => [item.id, item.isWatched]))
  return latest.map(item => previous.has(item.id) ? { ...item, isWatched: previous.get(item.id)! } : item)
}

function mergeVessels(providerVessels: Vessel[], storedVessels: Vessel[], now: string): Vessel[] {
  const previous = new Map(storedVessels.map(item => [item.id, item]))
  return providerVessels.map(item => mergeProviderVessel(previous.get(item.id), item, now))
}

function mergeVoyages(providerVoyages: Voyage[], storedVoyages: Voyage[]): Voyage[] {
  const previous = new Map(storedVoyages.map(item => [item.id, item]))
  return providerVoyages.map(item => mergeProviderVoyage(previous.get(item.id), item))
}

export function mergeWeatherFeedItems(existing: FeedItem[], weather: FeedItem[]): FeedItem[] {
  return [...existing.filter(item => !isWeatherFeedItem(item)), ...weather]
}

async function initialize() {
  if (initialized) return initialized
  initialized = (async () => {
    try {
      const db = useDatabase()
      await initShippingTables(db)
      repository = new ShippingRepository(db)
      if (await repository.isEmpty()) {
        const seeded = await fetchProviderSnapshot(fallbackSnapshot.settings)
        await repository.seed(seeded.vessels, seeded.ports, seeded.voyages, seeded.feedItems, seeded.events, seeded.settings, seeded.calendarEvents)
      }
    } catch (error) {
      repository = undefined
      logger.warn("Shipping SQLite unavailable; retaining last-known Mock data in memory", error)
    }
  })()
  return initialized
}

async function fetchProviderSnapshot(settings: ShippingSettings, lastKnown: Pick<ShippingSnapshot, "vessels" | "ports" | "voyages" | "feedItems" | "calendarEvents" | "calendarCoverage"> = fallbackSnapshot): Promise<ShippingSnapshot> {
  const existingNonWeatherFeed = lastKnown.feedItems.filter(item => !isWeatherFeedItem(item))
  const feedLastKnown = filterFeedLastKnownForMode(existingNonWeatherFeed, providerModes.feed)
  const weatherLastKnown = lastKnown.feedItems.filter(isWeatherFeedItem)
  const modelWeatherLastKnown = weatherLastKnown
    .filter(item => !isOfficialWeatherAlertFeedItem(item))
    .filter(item => providerModes.weather === "open-meteo" ? item.sourceId === "open-meteo-marine" : item.sourceId === "mock-weather")
  const officialWeatherLastKnown = weatherLastKnown.filter(isOfficialWeatherAlertFeedItem)
  const watchTargets = lastKnown.vessels.map(toVesselWatchTarget)
  const aisLastKnown = lastKnown.vessels
    .filter(item => item.provenance?.sourceId === "aisstream")
    .map(item => sanitizeAisVessel(item))
  const vesselLastKnown = providerModes.vessel === "aisstream" ? aisLastKnown : lastKnown.vessels
  const portLastKnown = providerModes.port === "portcast" ? lastKnown.ports.filter(item => item.provenance?.sourceId === "portcast-public") : lastKnown.ports
  const calendarEvents = filterCalendarEventsForSourceIds(lastKnown.calendarEvents ?? [], providerModes.calendarSourceIds ?? [])
  const calendarCoverage = filterCalendarCoverageForSourceIds(lastKnown.calendarCoverage ?? settings.calendarSync ?? [], providerModes.calendarSourceIds ?? [])
  const weatherResults = settings.sourceEnabled
    ? fetchWeatherProviderResults(providers.weather, providers.weatherAlerts, lastKnown.ports, modelWeatherLastKnown, officialWeatherLastKnown)
    : Promise.resolve<[PromiseSettledResult<FeedItem[]>, PromiseSettledResult<FeedItem[]>]>([
        { status: "fulfilled", value: disabledProviderData(modelWeatherLastKnown) },
        { status: "fulfilled", value: disabledProviderData(officialWeatherLastKnown) },
      ])
  const [vesselResult, portResult, voyageResult, shippingFeedResult] = await Promise.allSettled([
    settings.providerEnabled ? providers.vessel.getVessels(watchTargets, aisLastKnown) : Promise.resolve(disabledProviderData(vesselLastKnown)),
    settings.providerEnabled ? providers.port.getPorts(lastKnown.ports) : Promise.resolve(disabledProviderData(lastKnown.ports)),
    settings.providerEnabled ? providers.schedule.getVoyages() : Promise.resolve(disabledProviderData(lastKnown.voyages)),
    settings.sourceEnabled ? providers.feed.getFeedItems(feedLastKnown, lastKnown.ports) : Promise.resolve(disabledProviderData(feedLastKnown)),
  ])
  const [weatherResult, weatherAlertResult] = await weatherResults
  const read = <T extends Vessel | Port | Voyage | FeedItem>(result: PromiseSettledResult<T[]>, previous: T[], provenance: ProviderResult<T>["provenance"], disabled: boolean): ProviderResult<T> => {
    const data = disabled ? disabledProviderData(previous) : providerResult(result, previous)
    return toProviderResult(data, provenance, new Date().toISOString(), disabled ? "disabled" : undefined, disabled ? undefined : providerError(result))
  }
  const vessel = read(vesselResult, vesselLastKnown, providerModes.vessel === "aisstream" ? providerProvenances.aisstream : providerProvenances.mockVessel, !settings.providerEnabled)
  const port = read(portResult, portLastKnown, providerModes.port === "portcast" ? providerProvenances.portcastPublic : providerProvenances.mockPort, !settings.providerEnabled)
  const voyage = read(voyageResult, lastKnown.voyages, providerProvenances.mockSchedule, !settings.providerEnabled)
  const shippingFeed = read(shippingFeedResult, feedLastKnown, providerModes.feed === "public" ? providerProvenances.shippingFeed : providerProvenances.mockFeed, !settings.sourceEnabled)
  const weather = read(weatherResult, modelWeatherLastKnown, providerModes.weather === "open-meteo" ? providerProvenances.openMeteo : providerProvenances.mockWeather, !settings.sourceEnabled)
  const weatherAlerts = providerModes.weatherAlerts === "off" && settings.sourceEnabled
    ? toProviderResult([], providerProvenances.officialWeatherAlerts, new Date().toISOString(), "disabled")
    : read(weatherAlertResult, officialWeatherLastKnown, providerProvenances.officialWeatherAlerts, !settings.sourceEnabled)
  return {
    vessels: vessel.data,
    ports: port.data,
    voyages: voyage.data,
    feedItems: mergeWeatherFeedItems(shippingFeed.data, [...weather.data, ...weatherAlerts.data]),
    events: filterEventsForOperationalContext(fallbackSnapshot.events, operationalSourceContext),
    settings,
    calendarEvents,
    calendarCoverage,
    providerFreshness: { vessel: vessel.freshness, port: port.freshness, schedule: voyage.freshness, weather: weather.freshness, weatherAlerts: weatherAlerts.freshness, feed: shippingFeed.freshness },
  }
}

async function readStoredSnapshot(): Promise<ShippingSnapshot> {
  if (!repository) {
    return {
      ...structuredClone(fallbackSnapshot),
      events: filterEventsForOperationalContext(fallbackSnapshot.events, operationalSourceContext),
      calendarEvents: filterCalendarEventsForSourceIds(fallbackSnapshot.calendarEvents ?? [], providerModes.calendarSourceIds ?? []),
      calendarCoverage: filterCalendarCoverageForSourceIds(fallbackSnapshot.calendarCoverage ?? fallbackSnapshot.settings.calendarSync ?? [], providerModes.calendarSourceIds ?? []),
    }
  }
  const settings = await repository.getSettings() ?? fallbackSnapshot.settings
  const legacyDefaults = {
    vessel: providerModes.vessel === "mock" ? providerProvenances.mockVessel : undefined,
    port: providerModes.port === "mock" ? providerProvenances.mockPort : undefined,
    voyage: providerModes.schedule === "mock" ? providerProvenances.mockSchedule : undefined,
  }
  const vessels = await repository.listVessels(legacyDefaults)
  const ports = await repository.listPorts(legacyDefaults)
  const voyages = await repository.listVoyages(legacyDefaults)
  const feedItems = await repository.listFeedItems()
  const storedCalendarEvents = filterCalendarEventsForSourceIds(await repository.listCalendarEvents(), providerModes.calendarSourceIds ?? [])
  const fallbackCalendarEvents = filterCalendarEventsForSourceIds(fallbackSnapshot.calendarEvents ?? [], providerModes.calendarSourceIds ?? [])
  const calendarEvents = storedCalendarEvents.length ? storedCalendarEvents : fallbackCalendarEvents
  const calendarCoverage = filterCalendarCoverageForSourceIds(settings.calendarSync ?? fallbackSnapshot.calendarCoverage ?? [], providerModes.calendarSourceIds ?? [])
  return {
    vessels,
    ports,
    voyages,
    feedItems,
    events: filterEventsForOperationalContext(await repository.listEvents({ vessels, ports, voyages, feedItems }), operationalSourceContext),
    settings,
    calendarEvents,
    calendarCoverage,
  }
}

function filterOperationalSnapshotInputs(snapshot: ShippingSnapshot): Pick<ShippingSnapshot, "vessels" | "ports" | "voyages" | "feedItems"> {
  const isOperational = (sourceId: string | undefined) => sourceAllowedForOperationalContext(sourceId, operationalSourceContext)
  return {
    vessels: snapshot.vessels.filter(item => isOperational(item.provenance?.sourceId)),
    ports: snapshot.ports.filter(item => isOperational(item.provenance?.sourceId)),
    voyages: snapshot.voyages.filter(item => isOperational(item.provenance?.sourceId)),
    feedItems: snapshot.feedItems.filter(item => isOperational(item.provenance?.sourceId)),
  }
}

async function saveSnapshot(snapshot: ShippingSnapshot) {
  fallbackSnapshot = structuredClone(snapshot)
  if (!repository) return
  for (const vessel of snapshot.vessels) await repository.upsertVessel(vessel)
  for (const port of snapshot.ports) await repository.upsertPort(port)
  for (const voyage of snapshot.voyages) await repository.upsertVoyage(voyage)
  for (const item of snapshot.feedItems) await repository.upsertFeedItem(item)
  for (const event of snapshot.events) await repository.upsertEvent(event)
  for (const event of snapshot.calendarEvents ?? []) await repository.upsertCalendarEvent(event)
  await repository.saveSettings(snapshot.settings)
}

export async function getShippingSnapshot(): Promise<ShippingSnapshot> {
  await initialize()
  const stored = await readStoredSnapshot()
  const providerSnapshot = await fetchProviderSnapshot(stored.settings, stored)
  const current: ShippingSnapshot = {
    ...stored,
    vessels: preserveWatchState(mergeVessels(providerSnapshot.vessels, stored.vessels, new Date().toISOString()), stored.vessels),
    ports: preserveWatchState(providerSnapshot.ports, stored.ports),
    voyages: mergeVoyages(providerSnapshot.voyages, stored.voyages),
    feedItems: providerSnapshot.feedItems,
    calendarEvents: stored.calendarEvents,
    calendarCoverage: stored.calendarCoverage,
    providerFreshness: providerSnapshot.providerFreshness,
  }
  current.events = detectShippingEvents(current.vessels, current.ports, current.voyages, current.feedItems, current.settings, stored.events, new Date().toISOString(), current.calendarEvents ?? [])
  await saveSnapshot(current)
  await repository?.pruneExpired(current.settings.retentionDays)
  return structuredClone(current)
}

function calendarQuery(year: number, countries?: CalendarCountryCode[]): CalendarQuery {
  return { year, countries: countries?.length ? countries : Object.keys(calendarCountries) as CalendarCountryCode[] }
}

function calendarIdentity(event: CalendarEvent): string {
  return calendarEventKey(event)
}

function isCalendarificScopedLocal(event: CalendarEvent): boolean {
  return event.sourceId === "calendarific" && (event.scope === "subdivision" || event.scope === "unknown")
}

function calendarificLegacyIdentity(event: CalendarEvent): string {
  return calendarEventLegacyId(event, event.sourceId)
}

function coverageForEvent(event: CalendarEvent, coverage: CalendarProviderResult["coverage"], year: number) {
  return coverage.filter(item => item.countryCode === event.countryCode && item.year === year && item.sourceId === event.sourceId)
}

export function reconcileCalendarEvents(existing: CalendarEvent[], incoming: CalendarEvent[], coverage: CalendarProviderResult["coverage"], year: number): { events: CalendarEvent[], removedIds: string[] } {
  const merged = mergeCalendarSources(incoming.filter(event => event.sourceKind === "third_party" || event.sourceKind === "mock"), incoming.filter(event => event.sourceKind === "official"), incoming.filter(event => event.sourceKind === "user"))
  const mergedIdentities = new Set(merged.map(calendarIdentity))
  const incomingScopedLocalLegacyIdentities = new Set(incoming.filter(isCalendarificScopedLocal).map(calendarificLegacyIdentity))
  const removedIds: string[] = []
  const retained: CalendarEvent[] = []
  for (const event of existing) {
    if (!event.date.startsWith(String(year))) {
      retained.push(event)
      continue
    }
    if (event.sourceId === "calendarific" && event.scope === undefined && incomingScopedLocalLegacyIdentities.has(calendarificLegacyIdentity(event))) {
      removedIds.push(event.id)
      continue
    }
    if (mergedIdentities.has(calendarIdentity(event))) continue
    const scoped = coverageForEvent(event, coverage, year)
    if (scoped.some(item => item.status === "complete")) {
      removedIds.push(event.id)
      continue
    }
    const latestCoverage = scoped.at(-1)
    if (!latestCoverage) {
      retained.push(event)
      continue
    }
    retained.push({
      ...event,
      stale: true,
      sourceStatus: latestCoverage.error ? "failed" : "degraded",
      error: latestCoverage.error ?? (latestCoverage.status === "partial" ? "partial_coverage_last_known" : "unknown_coverage_last_known"),
      lastCheckedAt: latestCoverage.lastCheckedAt ?? event.lastCheckedAt,
      fetchedAt: latestCoverage.lastCheckedAt ?? event.fetchedAt,
    })
  }
  const byId = new Map([...retained, ...merged].map(event => [event.id, event]))
  return { events: [...byId.values()].sort((a, b) => a.date.localeCompare(b.date) || a.countryCode.localeCompare(b.countryCode) || a.name.localeCompare(b.name)), removedIds }
}

export async function syncCalendarEvents(year = mockCalendarYear, countries?: CalendarCountryCode[]): Promise<CalendarProviderResult> {
  await initialize()
  const stored = await readStoredSnapshot()
  const query = calendarQuery(year, countries)
  const result = await providers.calendar.getEvents(query)
  const existing = filterCalendarEventsForSourceIds(stored.calendarEvents ?? [], providerModes.calendarSourceIds ?? [])
  const reconciled = reconcileCalendarEvents(existing, result.events, result.coverage, year)
  const previousCoverage = filterCalendarCoverageForSourceIds(stored.calendarCoverage ?? stored.settings.calendarSync ?? [], providerModes.calendarSourceIds ?? [])
  const coverage = [...previousCoverage.filter(item => !(query.countries.includes(item.countryCode) && item.year === year)), ...result.coverage]
  const settings = { ...stored.settings, calendarSync: coverage }
  const snapshot = { ...stored, settings, calendarEvents: reconciled.events, calendarCoverage: coverage }
  const operational = filterOperationalSnapshotInputs(stored)
  snapshot.events = detectShippingEvents(operational.vessels, operational.ports, operational.voyages, operational.feedItems, snapshot.settings, stored.events, result.fetchedAt, snapshot.calendarEvents)
  fallbackSnapshot = structuredClone(snapshot)
  if (reconciled.removedIds.length) await repository?.deleteCalendarEvents(reconciled.removedIds)
  for (const event of reconciled.events) await repository?.upsertCalendarEvent(event)
  for (const event of snapshot.events) await repository?.upsertEvent(event)
  if (repository) await repository.saveSettings(settings)
  return { ...result, events: reconciled.events, coverage }
}

export async function updateShippingSettings(settings: Partial<Omit<ShippingSettings, "eventThresholds">> & { eventThresholds?: Partial<ShippingSettings["eventThresholds"]> }) {
  const current = await getShippingSnapshot()
  const next: ShippingSettings = {
    ...current.settings,
    ...settings,
    eventThresholds: { ...current.settings.eventThresholds, ...settings.eventThresholds },
  }
  if (repository) await repository.saveSettings(next)
  fallbackSnapshot.settings = next
  return structuredClone(next)
}

export async function toggleWatch(kind: "vessel" | "port", id: string) {
  const current = await getShippingSnapshot()
  const collection = kind === "vessel" ? current.vessels : current.ports
  const item = collection.find(entry => entry.id === id)
  if (!item) throw createError({ statusCode: 404, message: `${kind} not found` })
  item.isWatched = !item.isWatched
  if (repository) await repository.updateWatch(kind, id, item.isWatched)
  fallbackSnapshot = current
  return { id, isWatched: item.isWatched }
}
