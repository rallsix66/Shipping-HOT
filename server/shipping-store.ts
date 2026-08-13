import type { FeedItem, Port, ShippingSettings, ShippingSnapshot, Vessel, Voyage } from "@shared/shipping"
import { createMockSnapshot } from "@shared/shipping-fixtures"
import { detectShippingEvents } from "@shared/shipping-engine"
import { mergeProviderVessel, mergeProviderVoyage } from "@shared/shipping-rules"
import { initShippingTables, ShippingRepository } from "#/database/shipping"
import { disabledProviderData, MockPortProvider, MockScheduleProvider, MockVesselProvider, MockWeatherProvider, providerResult, type PortProvider, type ScheduleProvider, type VesselProvider, type WeatherProvider } from "#/providers/shipping"

let repository: ShippingRepository | undefined
let fallbackSnapshot = createMockSnapshot()
let initialized: Promise<void> | undefined

const providers: { vessel: VesselProvider, port: PortProvider, schedule: ScheduleProvider, weather: WeatherProvider } = {
  vessel: MockVesselProvider,
  port: MockPortProvider,
  schedule: MockScheduleProvider,
  weather: MockWeatherProvider,
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

async function initialize() {
  if (initialized) return initialized
  initialized = (async () => {
    try {
      const db = useDatabase()
      await initShippingTables(db)
      repository = new ShippingRepository(db)
      if (await repository.isEmpty()) {
        const seeded = await fetchProviderSnapshot(fallbackSnapshot.settings)
        await repository.seed(seeded.vessels, seeded.ports, seeded.voyages, seeded.feedItems, seeded.events, seeded.settings)
      }
    } catch (error) {
      repository = undefined
      logger.warn("Shipping SQLite unavailable; retaining last-known Mock data in memory", error)
    }
  })()
  return initialized
}

async function fetchProviderSnapshot(settings: ShippingSettings, lastKnown: Pick<ShippingSnapshot, "vessels" | "ports" | "voyages" | "feedItems"> = fallbackSnapshot): Promise<ShippingSnapshot> {
  const [vesselResult, portResult, voyageResult, feedResult] = await Promise.allSettled([
    settings.providerEnabled ? providers.vessel.getVessels() : Promise.resolve(disabledProviderData(lastKnown.vessels)),
    settings.providerEnabled ? providers.port.getPorts() : Promise.resolve(disabledProviderData(lastKnown.ports)),
    settings.providerEnabled ? providers.schedule.getVoyages() : Promise.resolve(disabledProviderData(lastKnown.voyages)),
    settings.sourceEnabled ? providers.weather.getFeedItems() : Promise.resolve(disabledProviderData(lastKnown.feedItems)),
  ])
  const read = <T extends Vessel | Port | Voyage | FeedItem>(result: PromiseSettledResult<T[]>, previous: T[]) => providerResult(result, previous)
  return {
    vessels: read(vesselResult, lastKnown.vessels),
    ports: read(portResult, lastKnown.ports),
    voyages: read(voyageResult, lastKnown.voyages),
    feedItems: read(feedResult, lastKnown.feedItems),
    events: fallbackSnapshot.events,
    settings,
  }
}

async function readStoredSnapshot(): Promise<ShippingSnapshot> {
  if (!repository) return structuredClone(fallbackSnapshot)
  const settings = await repository.getSettings() ?? fallbackSnapshot.settings
  return {
    vessels: await repository.listVessels(),
    ports: await repository.listPorts(),
    voyages: await repository.listVoyages(),
    feedItems: await repository.listFeedItems(),
    events: await repository.listEvents(),
    settings,
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
  }
  current.events = detectShippingEvents(current.vessels, current.ports, current.voyages, current.feedItems, current.settings, stored.events)
  await saveSnapshot(current)
  await repository?.pruneExpired(current.settings.retentionDays)
  return structuredClone(current)
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
