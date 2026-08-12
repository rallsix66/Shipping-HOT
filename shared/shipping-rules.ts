import type { EventStatus, FeedItem, FreshnessState, HotItem, Port, Severity, ShippingEvent, Vessel, Voyage } from "./shipping"

const severityWeight: Record<Severity, number> = { info: 1, watch: 2, warning: 3, critical: 4 }

export function calculateDelayMinutes(baselineEta?: string, latestEta?: string): number | undefined {
  if (!baselineEta || !latestEta) return undefined
  return Math.round((Date.parse(latestEta) - Date.parse(baselineEta)) / 60000)
}

export function updateVesselStatus(previous: Vessel, next: Pick<Vessel, "navigationStatus"> & Partial<Vessel>, now = new Date().toISOString()): Vessel {
  const changed = previous.navigationStatus !== next.navigationStatus
  return {
    ...previous,
    ...next,
    statusChangedAt: changed ? now : previous.statusChangedAt,
  }
}

export function statusDurationMinutes(vessel: Pick<Vessel, "statusChangedAt">, now = new Date()): number {
  return Math.max(0, Math.round((now.getTime() - Date.parse(vessel.statusChangedAt)) / 60000))
}

export function reconcileEvent(existing: ShippingEvent | undefined, incoming: Omit<ShippingEvent, "id" | "firstDetectedAt" | "lastDetectedAt" | "resolvedAt">, now = new Date().toISOString()): ShippingEvent {
  if (!existing) {
    return { ...incoming, id: `event-${incoming.dedupeKey}`, firstDetectedAt: now, lastDetectedAt: now }
  }
  if (incoming.status === "resolved") {
    return { ...existing, ...incoming, status: "resolved", lastDetectedAt: now, resolvedAt: now }
  }
  return {
    ...existing,
    ...incoming,
    id: existing.id,
    status: "active",
    firstDetectedAt: existing.firstDetectedAt,
    lastDetectedAt: now,
    resolvedAt: undefined,
  }
}

export function freshnessState(item: { stale: boolean; sourceStatus: string }): FreshnessState {
  if (item.sourceStatus === "never_succeeded") return "unknown"
  return item.stale ? "stale" : "fresh"
}

export function rankHotItems(events: ShippingEvent[], ports: Port[], vessels: Vessel[], voyages: Voyage[], feedItems: FeedItem[] = [], now = new Date()): HotItem[] {
  const labels = new Map<string, string>()
  vessels.forEach(v => labels.set(v.id, v.name))
  ports.forEach(p => labels.set(p.id, p.name))
  voyages.forEach(v => labels.set(v.id, v.voyageNumber))

  const eventItems = events
    .filter(event => event.status === ("active" as EventStatus))
    .map(event => ({
      id: event.id,
      kind: "event" as const,
      title: event.title,
      summary: event.summary,
      severity: event.severity,
      freshness: freshnessState({ stale: Date.parse(event.lastDetectedAt) < now.getTime() - 6 * 60 * 60 * 1000, sourceStatus: event.sourceStatus }),
      sourceStatus: event.sourceStatus,
      occurredAt: event.occurredAt,
      relatedLabel: event.vesselId ? labels.get(event.vesselId) : event.portId ? labels.get(event.portId) : event.voyageId ? labels.get(event.voyageId) : undefined,
      eventId: event.id,
    }))
  const feedHotItems = feedItems.filter(item => item.severity === "warning" || item.severity === "critical").map(item => ({
    id: item.id,
    kind: "feed" as const,
    title: item.title,
    summary: item.summary,
    severity: item.severity,
    freshness: freshnessState(item),
    sourceStatus: item.sourceStatus,
    occurredAt: item.publishedAt,
    relatedLabel: item.relatedPortIds[0] ? labels.get(item.relatedPortIds[0]) : item.relatedVesselIds[0] ? labels.get(item.relatedVesselIds[0]) : undefined,
    feedItemId: item.id,
  }))
  return [...eventItems, ...feedHotItems]
    .sort((a, b) => severityWeight[b.severity] - severityWeight[a.severity] || Date.parse(b.occurredAt) - Date.parse(a.occurredAt))
}
