import process from "node:process"
import { filterEventsForOperationalContext, recordAllowedForDataMode, sourceAllowedForOperationalContext, toVesselWatchTarget } from "@shared/shipping"
import type { AisDerivedPortMetric } from "@shared/ais-area"
import type { DataEvidence, DatabasePersistenceStatus, FeedItem, Freshness, Port, ProvenanceAware, ProviderResult, ShippingProviderModes, ShippingSettings, ShippingSnapshot, Vessel, Voyage } from "@shared/shipping"
import { type CalendarCountryCode, type CalendarEvent, type CalendarProviderResult, type CalendarQuery, calendarCountries, calendarEventKey, calendarEventLegacyId } from "@shared/calendar"
import { detectShippingEvents } from "@shared/shipping-engine"
import { mergeProviderVessel, mergeProviderVoyage } from "@shared/shipping-rules"
import { filterCalendarCoverageForSourceIds, filterCalendarEventsForSourceIds, mergeCalendarSources } from "#/providers/calendar"
import { filterFeedLastKnownForMode } from "#/providers/feed"
import { ShippingRepository, initShippingTables } from "#/database/shipping"
import { defaultShippingSettings, healthyPersistenceStatus, persistenceUnavailableError } from "#/database/runtime"
import { disabledProviderData, fetchWeatherProviderResults, isOfficialWeatherAlertFeedItem, isWeatherFeedItem, operationalSourceContext, providerError, providerModes, providerProvenances, providerResult, providers, sanitizeAisVessel, toProviderResult } from "#/providers/shipping"

let repository: ShippingRepository | undefined
const mockCalendarYear = new Date().getUTCFullYear()
let initialized: Promise<void> | undefined
let persistenceStatus: DatabasePersistenceStatus = { status: "unavailable", schemaVersion: 0, errorCode: "persistence_unavailable" }

function emptySnapshot(): ShippingSnapshot {
  return {
    vessels: [],
    ports: [],
    voyages: [],
    events: [],
    feedItems: [],
    settings: structuredClone(defaultShippingSettings),
    calendarEvents: [],
    calendarCoverage: [],
    aisPortMetrics: [],
    database: structuredClone(persistenceStatus),
  }
}

function requireRepository(): ShippingRepository {
  if (!repository || persistenceStatus.status === "unavailable") throw persistenceUnavailableError()
  return repository
}

function markWriteFailure(error: unknown): never {
  persistenceStatus = { ...persistenceStatus, status: "read_only_degraded", errorCode: "persistence_write_failed" }
  throw persistenceUnavailableError(error)
}

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

function filterOperationalAisAreaMetrics(metrics: AisDerivedPortMetric[]): AisDerivedPortMetric[] {
  return providerModes.aisArea === "aisstream"
    ? metrics.filter(metric => sourceAllowedForOperationalContext(metric.provenance?.sourceId, operationalSourceContext))
    : []
}

export function isAisAreaProviderDisabled(providerEnabled: boolean, areaMode: ShippingProviderModes["aisArea"]): boolean {
  return !providerEnabled || areaMode !== "aisstream"
}

export function mergeWeatherFeedItems(existing: FeedItem[], weather: FeedItem[]): FeedItem[] {
  return [...existing.filter(item => !isWeatherFeedItem(item)), ...weather]
}

async function initialize() {
  if (initialized) return initialized
  initialized = (async () => {
    try {
      const db = useDatabase()
      const metadata = await initShippingTables(db, process.env.SHIPPING_DATA_MODE === "real" ? "real" : "mock")
      repository = new ShippingRepository(db, process.env.SHIPPING_DATA_MODE === "real" ? "real" : "mock")
      persistenceStatus = metadata
        ? healthyPersistenceStatus(metadata)
        : { status: "healthy", schemaVersion: 0 }
    } catch (error) {
      repository = undefined
      persistenceStatus = { status: "unavailable", schemaVersion: 0, errorCode: "persistence_unavailable" }
      logger.error("Shipping SQLite unavailable; no in-memory replacement will be used", error)
    }
  })()
  return initialized
}

async function fetchProviderSnapshot(settings: ShippingSettings, lastKnown: Pick<ShippingSnapshot, "vessels" | "ports" | "voyages" | "feedItems" | "calendarEvents" | "calendarCoverage" | "aisPortMetrics"> = emptySnapshot()): Promise<ShippingSnapshot> {
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
  const areaLastKnown = filterOperationalAisAreaMetrics(lastKnown.aisPortMetrics ?? [])
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
  const areaProviderPorts = (portResult.status === "fulfilled" ? portResult.value : portLastKnown)
    .filter(item => item.isWatched && sourceAllowedForOperationalContext(item.provenance?.sourceId, operationalSourceContext))
  const aisAreaDisabled = isAisAreaProviderDisabled(settings.providerEnabled, providerModes.aisArea)
  const [aisAreaResult] = await Promise.allSettled([
    aisAreaDisabled ? Promise.resolve([] as AisDerivedPortMetric[]) : providers.aisArea.getPortMetrics(areaProviderPorts, areaLastKnown),
  ])
  const [weatherResult, weatherAlertResult] = await weatherResults
  const read = <T extends Freshness>(result: PromiseSettledResult<T[]>, previous: T[], provenance: ProviderResult<T>["provenance"], disabled: boolean): ProviderResult<T> => {
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
  const aisArea = read(aisAreaResult, areaLastKnown, providerProvenances.aisstreamAreaDerived, aisAreaDisabled)
  return {
    vessels: vessel.data,
    ports: port.data,
    voyages: voyage.data,
    feedItems: mergeWeatherFeedItems(shippingFeed.data, [...weather.data, ...weatherAlerts.data]),
    events: [],
    settings,
    calendarEvents,
    calendarCoverage,
    aisPortMetrics: providerModes.aisArea === "aisstream" ? aisArea.data : [],
    providerFreshness: { vessel: vessel.freshness, port: port.freshness, schedule: voyage.freshness, weather: weather.freshness, weatherAlerts: weatherAlerts.freshness, feed: shippingFeed.freshness, aisArea: aisArea.freshness },
  }
}

async function readStoredSnapshot(): Promise<ShippingSnapshot> {
  if (!repository) {
    return emptySnapshot()
  }
  const settings = await repository.getSettings() ?? structuredClone(defaultShippingSettings)
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
  const calendarEvents = storedCalendarEvents
  const calendarCoverage = filterCalendarCoverageForSourceIds(settings.calendarSync ?? [], providerModes.calendarSourceIds ?? [])
  const aisPortMetrics = providerModes.aisArea === "aisstream"
    ? filterOperationalAisAreaMetrics(await repository.listAisPortMetrics())
    : []
  return {
    vessels,
    ports,
    voyages,
    feedItems,
    events: filterEventsForOperationalContext(await repository.listEvents({ vessels, ports, voyages, feedItems }), operationalSourceContext),
    settings,
    calendarEvents,
    calendarCoverage,
    aisPortMetrics,
    database: structuredClone(persistenceStatus),
  }
}

function filterOperationalSnapshotInputs(snapshot: ShippingSnapshot): Pick<ShippingSnapshot, "vessels" | "ports" | "voyages" | "feedItems"> {
  const isOperational = (record: ProvenanceAware & { evidence?: DataEvidence[], sourceId?: string }, sourceIdOverride?: string) => {
    return recordAllowedForDataMode(record, operationalSourceContext.modes.dataMode ?? "mock")
      && sourceAllowedForOperationalContext(sourceIdOverride ?? record.provenance?.sourceId ?? record.sourceId, operationalSourceContext)
  }
  return {
    vessels: snapshot.vessels.filter(item => isOperational(item)),
    ports: snapshot.ports.filter(item => isOperational(item)),
    voyages: snapshot.voyages.filter(item => isOperational(item)),
    feedItems: snapshot.feedItems.filter(item => isOperational(item, item.provenance?.sourceId ?? item.sourceId)),
  }
}

async function saveSnapshot(snapshot: ShippingSnapshot) {
  if (!repository) throw persistenceUnavailableError()
  try {
    for (const vessel of snapshot.vessels) await repository.upsertVessel(vessel)
    for (const port of snapshot.ports) await repository.upsertPort(port)
    for (const voyage of snapshot.voyages) await repository.upsertVoyage(voyage)
    for (const item of snapshot.feedItems) await repository.upsertFeedItem(item)
    for (const event of snapshot.events) await repository.upsertEvent(event)
    for (const event of snapshot.calendarEvents ?? []) await repository.upsertCalendarEvent(event)
    for (const metric of snapshot.aisPortMetrics ?? []) await repository.upsertAisPortMetric(metric)
    await repository.saveSettings(snapshot.settings)
  } catch (error) {
    persistenceStatus = { ...persistenceStatus, status: "read_only_degraded", errorCode: "persistence_write_failed" }
    throw persistenceUnavailableError(error)
  }
}

export async function getShippingSnapshot(): Promise<ShippingSnapshot> {
  await initialize()
  if (!repository || persistenceStatus.status === "unavailable") return emptySnapshot()
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
    aisPortMetrics: providerSnapshot.aisPortMetrics,
    providerFreshness: providerSnapshot.providerFreshness,
  }
  current.events = detectShippingEvents(current.vessels, current.ports, current.voyages, current.feedItems, current.settings, filterEventsForOperationalContext(stored.events, operationalSourceContext), new Date().toISOString(), current.calendarEvents ?? [], current.aisPortMetrics ?? [])
  await saveSnapshot(current)
  await repository.pruneExpired(current.settings.retentionDays)
  return structuredClone(current)
}

export async function getShippingPersistenceStatus(): Promise<DatabasePersistenceStatus> {
  await initialize()
  return structuredClone(persistenceStatus)
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
  const persistence = requireRepository()
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
  snapshot.events = detectShippingEvents(operational.vessels, operational.ports, operational.voyages, operational.feedItems, snapshot.settings, filterEventsForOperationalContext(stored.events, operationalSourceContext), result.fetchedAt, snapshot.calendarEvents, filterOperationalAisAreaMetrics(stored.aisPortMetrics ?? []))
  try {
    if (reconciled.removedIds.length) await persistence.deleteCalendarEvents(reconciled.removedIds)
    for (const event of reconciled.events) await persistence.upsertCalendarEvent(event)
    for (const event of snapshot.events) await persistence.upsertEvent(event)
    await persistence.saveSettings(settings)
  } catch (error) {
    markWriteFailure(error)
  }
  return { ...result, events: reconciled.events, coverage }
}

export async function updateShippingSettings(settings: Partial<Omit<ShippingSettings, "eventThresholds">> & { eventThresholds?: Partial<ShippingSettings["eventThresholds"]> }) {
  await initialize()
  const persistence = requireRepository()
  const current = await getShippingSnapshot()
  const next: ShippingSettings = {
    ...current.settings,
    ...settings,
    eventThresholds: { ...current.settings.eventThresholds, ...settings.eventThresholds },
  }
  try {
    await persistence.saveSettings(next)
  } catch (error) {
    markWriteFailure(error)
  }
  return structuredClone(next)
}

export async function toggleWatch(kind: "vessel" | "port", id: string) {
  await initialize()
  const persistence = requireRepository()
  const current = await getShippingSnapshot()
  const collection = kind === "vessel" ? current.vessels : current.ports
  const item = collection.find(entry => entry.id === id)
  if (!item) throw createError({ statusCode: 404, message: `${kind} not found` })
  item.isWatched = !item.isWatched
  try {
    const updated = await persistence.updateWatch(kind, id, item.isWatched)
    if (!updated) throw createError({ statusCode: 404, message: `${kind} not found` })
  } catch (error) {
    if (typeof error === "object" && error && "statusCode" in error && (error as { statusCode?: number }).statusCode === 404) throw error
    markWriteFailure(error)
  }
  return { id, isWatched: item.isWatched }
}
