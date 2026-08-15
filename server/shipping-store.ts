import type { FeedItem, Port, ProviderResult, ShippingSettings, ShippingSnapshot, Vessel, Voyage } from "@shared/shipping"
import { createMockSnapshot } from "@shared/shipping-fixtures"
import { type CalendarCountryCode, type CalendarEvent, type CalendarProviderResult, type CalendarQuery, calendarCountries } from "@shared/calendar"
import { detectShippingEvents } from "@shared/shipping-engine"
import { mergeProviderVessel, mergeProviderVoyage } from "@shared/shipping-rules"
import { createMockCalendarEvents, mergeCalendarSources } from "#/providers/calendar"
import { ShippingRepository, initShippingTables } from "#/database/shipping"
import { disabledProviderData, isWeatherFeedItem, providerModes, providerProvenances, providerResult, providers, toProviderResult } from "#/providers/shipping"

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
  const weatherLastKnown = lastKnown.feedItems.filter(isWeatherFeedItem)
  const [vesselResult, portResult, voyageResult, shippingFeedResult, weatherResult] = await Promise.allSettled([
    settings.providerEnabled ? providers.vessel.getVessels(lastKnown.vessels) : Promise.resolve(disabledProviderData(lastKnown.vessels)),
    settings.providerEnabled ? providers.port.getPorts(lastKnown.ports) : Promise.resolve(disabledProviderData(lastKnown.ports)),
    settings.providerEnabled ? providers.schedule.getVoyages() : Promise.resolve(disabledProviderData(lastKnown.voyages)),
    settings.sourceEnabled ? providers.feed.getFeedItems(existingNonWeatherFeed, lastKnown.ports) : Promise.resolve(disabledProviderData(existingNonWeatherFeed)),
    settings.sourceEnabled ? providers.weather.getFeedItems(lastKnown.ports, weatherLastKnown) : Promise.resolve(disabledProviderData(weatherLastKnown)),
  ])
  const read = <T extends Vessel | Port | Voyage | FeedItem>(result: PromiseSettledResult<T[]>, previous: T[], provenance: ProviderResult<T>["provenance"], disabled: boolean): ProviderResult<T> => {
    const data = disabled ? disabledProviderData(previous) : providerResult(result, previous)
    return toProviderResult(data, provenance, new Date().toISOString(), disabled ? "disabled" : undefined)
  }
  const vessel = read(vesselResult, lastKnown.vessels, providerModes.vessel === "aisstream" ? providerProvenances.aisstream : providerProvenances.mockVessel, !settings.providerEnabled)
  const port = read(portResult, lastKnown.ports, providerModes.port === "portcast" ? providerProvenances.portcastPublic : providerProvenances.mockPort, !settings.providerEnabled)
  const voyage = read(voyageResult, lastKnown.voyages, providerProvenances.mockSchedule, !settings.providerEnabled)
  const shippingFeed = read(shippingFeedResult, existingNonWeatherFeed, providerModes.feed === "public" ? providerProvenances.shippingFeed : providerProvenances.mockFeed, !settings.sourceEnabled)
  const weather = read(weatherResult, weatherLastKnown, providerModes.weather === "open-meteo" ? providerProvenances.openMeteo : providerProvenances.mockWeather, !settings.sourceEnabled)
  return {
    vessels: vessel.data,
    ports: port.data,
    voyages: voyage.data,
    feedItems: mergeWeatherFeedItems(shippingFeed.data, weather.data),
    events: fallbackSnapshot.events,
    settings,
    calendarEvents: lastKnown.calendarEvents,
    calendarCoverage: lastKnown.calendarCoverage ?? settings.calendarSync,
    providerFreshness: { vessel: vessel.freshness, port: port.freshness, schedule: voyage.freshness, weather: weather.freshness, feed: shippingFeed.freshness },
  }
}

async function readStoredSnapshot(): Promise<ShippingSnapshot> {
  if (!repository) return structuredClone(fallbackSnapshot)
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
  const storedCalendarEvents = await repository.listCalendarEvents()
  return {
    vessels,
    ports,
    voyages,
    feedItems,
    events: await repository.listEvents({ vessels, ports, voyages, feedItems }),
    settings,
    calendarEvents: storedCalendarEvents.length ? storedCalendarEvents : fallbackSnapshot.calendarEvents,
    calendarCoverage: settings.calendarSync ?? fallbackSnapshot.calendarCoverage,
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

function calendarIdentity(event: Pick<CalendarEvent, "countryCode" | "name" | "type">): string {
  return `${event.countryCode}:${event.name.trim().toLocaleLowerCase().normalize("NFKC").replace(/\s+/g, " ")}:${event.type}`
}

function coverageForEvent(event: CalendarEvent, coverage: CalendarProviderResult["coverage"], year: number) {
  return coverage.filter(item => item.countryCode === event.countryCode && item.year === year && item.sourceId === event.sourceId)
}

export function reconcileCalendarEvents(existing: CalendarEvent[], incoming: CalendarEvent[], coverage: CalendarProviderResult["coverage"], year: number): { events: CalendarEvent[], removedIds: string[] } {
  const merged = mergeCalendarSources(incoming.filter(event => event.sourceKind === "third_party" || event.sourceKind === "mock"), incoming.filter(event => event.sourceKind === "official"), incoming.filter(event => event.sourceKind === "user"))
  const mergedIdentities = new Set(merged.map(calendarIdentity))
  const incomingIds = new Set(incoming.map(event => event.id))
  const removedIds: string[] = []
  const retained = existing.filter((event) => {
    if (!event.date.startsWith(String(year))) return true
    if (mergedIdentities.has(calendarIdentity(event))) return false
    const scoped = coverageForEvent(event, coverage, year)
    if (scoped.some(item => item.status === "complete")) {
      if (!incomingIds.has(event.id)) removedIds.push(event.id)
      return incomingIds.has(event.id)
    }
    return true
  })
  const byId = new Map([...retained, ...merged].map(event => [event.id, event]))
  return { events: [...byId.values()].sort((a, b) => a.date.localeCompare(b.date) || a.countryCode.localeCompare(b.countryCode) || a.name.localeCompare(b.name)), removedIds }
}

export async function syncCalendarEvents(year = mockCalendarYear, countries?: CalendarCountryCode[]): Promise<CalendarProviderResult> {
  await initialize()
  const query = calendarQuery(year, countries)
  const result = await providers.calendar.getEvents(query)
  const existing = fallbackSnapshot.calendarEvents ?? []
  const reconciled = reconcileCalendarEvents(existing, result.events, result.coverage, year)
  const previousCoverage = fallbackSnapshot.calendarCoverage ?? fallbackSnapshot.settings.calendarSync ?? []
  const coverage = [...previousCoverage.filter(item => !(query.countries.includes(item.countryCode) && item.year === year)), ...result.coverage]
  const settings = { ...fallbackSnapshot.settings, calendarSync: coverage }
  const snapshot = { ...fallbackSnapshot, settings, calendarEvents: reconciled.events, calendarCoverage: coverage }
  snapshot.events = detectShippingEvents(snapshot.vessels, snapshot.ports, snapshot.voyages, snapshot.feedItems, snapshot.settings, fallbackSnapshot.events, result.fetchedAt, snapshot.calendarEvents)
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
