import { createMockSnapshot } from "@shared/shipping-fixtures"
import type { ShippingSettings, ShippingSnapshot } from "@shared/shipping"
import { initShippingTables } from "#/database/shipping"
import { detectShippingEvents } from "@shared/shipping-engine"

let snapshot = createMockSnapshot()
let initialized = false

export async function getShippingSnapshot(): Promise<ShippingSnapshot> {
  if (!initialized) {
    initialized = true
    try {
      await initShippingTables(useDatabase())
    } catch (error) {
      logger.warn("Shipping SQLite initialization unavailable; using in-memory Mock store", error)
    }
  }
  snapshot.events = [...snapshot.events, ...detectShippingEvents(snapshot.vessels, snapshot.ports, snapshot.voyages, snapshot.feedItems, snapshot.settings, snapshot.events).filter(event => !snapshot.events.some(existing => existing.dedupeKey === event.dedupeKey))]
  return structuredClone(snapshot)
}

export async function updateShippingSettings(settings: Partial<ShippingSettings>) {
  snapshot.settings = { ...snapshot.settings, ...settings, eventThresholds: { ...snapshot.settings.eventThresholds, ...settings.eventThresholds } }
  return structuredClone(snapshot.settings)
}

export async function toggleWatch(kind: "vessel" | "port", id: string) {
  const collection = kind === "vessel" ? snapshot.vessels : snapshot.ports
  const item = collection.find(entry => entry.id === id)
  if (!item) throw createError({ statusCode: 404, message: `${kind} not found` })
  item.isWatched = !item.isWatched
  return { id, isWatched: item.isWatched }
}
