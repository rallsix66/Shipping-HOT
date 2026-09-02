import process from "node:process"
import { filterEventsForOperationalContext, recordAllowedForDataMode, sourceAllowedForOperationalContext } from "@shared/shipping"
import type { AisDerivedPortMetric } from "@shared/ais-area"
import type { DataEvidence, DatabasePersistenceStatus, FeedItem, ProvenanceAware, ShippingProviderModes, ShippingSettings, ShippingSnapshot, TranslationSettings } from "@shared/shipping"
import { createMockSnapshot } from "@shared/shipping-fixtures"
import { type CalendarCountryCode, type CalendarEvent, type CalendarProviderResult, type CalendarQuery, calendarCountries, calendarEventKey, calendarEventLegacyId } from "@shared/calendar"
import { detectShippingEvents } from "@shared/shipping-engine"
import { filterCalendarCoverageForSourceIds, filterCalendarEventsForSourceIds, mergeCalendarSources } from "#/providers/calendar"
import { ShippingRepository, initShippingTables } from "#/database/shipping"
import { defaultShippingSettings, healthyPersistenceStatus, persistenceUnavailableError } from "#/database/runtime"
import { normalizeTranslationSettings } from "#/services/translation-settings"
import { isWeatherFeedItem, operationalSourceContext, providerModes, providerProvenances, providers } from "#/providers/shipping"

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
      const dataMode = process.env.SHIPPING_DATA_MODE === "real" ? "real" : "mock"
      const metadata = await initShippingTables(db, dataMode)
      repository = new ShippingRepository(db, dataMode)
      if (dataMode === "mock" && await repository.isEmpty()) {
        const fixture = createMockSnapshot()
        await repository.seed(fixture.vessels, fixture.ports, fixture.voyages, fixture.feedItems, fixture.events, fixture.settings, fixture.calendarEvents ?? [], fixture.aisPortMetrics ?? [])
      }
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

async function readStoredSnapshot(): Promise<ShippingSnapshot> {
  if (!repository) {
    return emptySnapshot()
  }
  const storedSettings = await repository.getSettings() ?? structuredClone(defaultShippingSettings)
  const settings = { ...storedSettings, translation: normalizeTranslationSettings(storedSettings.translation) }
  const legacyDefaults = {
    vessel: providerModes.vessel === "mock" ? providerProvenances.mockVessel : undefined,
    port: providerModes.port === "mock" ? providerProvenances.mockPort : undefined,
    voyage: providerModes.schedule === "mock" ? providerProvenances.mockSchedule : undefined,
  }
  const vessels = await repository.listVessels(legacyDefaults)
  const ports = await repository.listPorts(legacyDefaults)
  const voyages = await repository.listVoyages(legacyDefaults)
  const feedItems = await repository.listFeedItems({ now: new Date() })
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

export async function getShippingSnapshot(): Promise<ShippingSnapshot> {
  await initialize()
  if (!repository || persistenceStatus.status === "unavailable") return emptySnapshot()
  const stored = await readStoredSnapshot()
  const operational = filterOperationalSnapshotInputs(stored)
  return {
    ...stored,
    events: detectShippingEvents(
      operational.vessels,
      operational.ports,
      operational.voyages,
      operational.feedItems,
      stored.settings,
      filterEventsForOperationalContext(stored.events, operationalSourceContext),
      new Date().toISOString(),
      stored.calendarEvents ?? [],
      filterOperationalAisAreaMetrics(stored.aisPortMetrics ?? []),
    ),
  }
}

export async function getShippingPersistenceStatus(): Promise<DatabasePersistenceStatus> {
  await initialize()
  return structuredClone(persistenceStatus)
}

export async function getCurrentFeedItems(now = new Date()): Promise<FeedItem[]> {
  await initialize()
  return repository ? repository.listFeedItems({ now }) : []
}

export async function getFeedHistory(options: { query?: string, sourceId?: string, limit?: number } = {}) {
  await initialize()
  return repository ? repository.listFeedHistory({ ...options, now: new Date() }) : []
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

export async function updateShippingSettings(settings: Partial<Omit<ShippingSettings, "eventThresholds" | "translation">> & { eventThresholds?: Partial<ShippingSettings["eventThresholds"]>, translation?: Partial<TranslationSettings> }) {
  await initialize()
  const persistence = requireRepository()
  const current = await getShippingSnapshot()
  const next: ShippingSettings = {
    ...current.settings,
    ...settings,
    eventThresholds: { ...current.settings.eventThresholds, ...settings.eventThresholds },
    translation: settings.translation === undefined
      ? normalizeTranslationSettings(current.settings.translation)
      : normalizeTranslationSettings({ ...current.settings.translation, ...settings.translation }),
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
