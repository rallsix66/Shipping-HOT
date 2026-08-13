import type { EventStatus, FeedItem, FreshnessState, HotItem, Port, Severity, ShippingEvent, ShippingSettings, Vessel, Voyage } from "./shipping"

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

export function mergeProviderVessel(previous: Vessel | undefined, provider: Vessel, now = new Date().toISOString()): Vessel {
  if (!previous) return { ...provider }
  return updateVesselStatus(previous, provider, now)
}

export function mergeProviderVoyage(previous: Voyage | undefined, provider: Voyage): Voyage {
  if (!previous) {
    return { ...provider, delayMinutes: calculateDelayMinutes(provider.baselineEta, provider.latestEta) }
  }
  const baselineEta = previous.baselineEta ?? provider.baselineEta
  const baselineEtd = previous.baselineEtd ?? provider.baselineEtd
  return {
    ...previous,
    ...provider,
    baselineEta,
    baselineEtd,
    baselineEtaSource: previous.baselineEta ? previous.baselineEtaSource : provider.baselineEtaSource,
    baselineEtdSource: previous.baselineEtd ? previous.baselineEtdSource : provider.baselineEtdSource,
    delayMinutes: calculateDelayMinutes(baselineEta, provider.latestEta),
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

export function congestionLevelRank(level: Port["congestionLevel"]): number {
  return { low: 0, medium: 1, high: 2, critical: 3 }[level]
}

export function validateShippingSettings(settings: ShippingSettings): string[] {
  const errors: string[] = []
  if (!Number.isInteger(settings.refreshInterval) || settings.refreshInterval < 1 || settings.refreshInterval > 1440) errors.push("refreshInterval")
  if (!Number.isInteger(settings.retentionDays) || settings.retentionDays < 1 || settings.retentionDays > 3650) errors.push("retentionDays")
  if (!Number.isInteger(settings.eventThresholds.anchoredHours) || settings.eventThresholds.anchoredHours < 1 || settings.eventThresholds.anchoredHours > 720) errors.push("eventThresholds.anchoredHours")
  if (!Number.isInteger(settings.eventThresholds.delayMinutes) || settings.eventThresholds.delayMinutes < 1 || settings.eventThresholds.delayMinutes > 525600) errors.push("eventThresholds.delayMinutes")
  if (!Object.prototype.hasOwnProperty.call({ low: 1, medium: 1, high: 1, critical: 1 }, settings.eventThresholds.congestionLevel)) errors.push("eventThresholds.congestionLevel")
  return errors
}

export function freshnessState(item: { stale: boolean; sourceStatus: string }): FreshnessState {
  if (item.sourceStatus === "never_succeeded") return "unknown"
  if (item.sourceStatus !== "healthy") return "stale"
  return item.stale ? "stale" : "fresh"
}

function relatedFreshness(event: ShippingEvent, ports: Port[], vessels: Vessel[], voyages: Voyage[], feedItems: FeedItem[]): { stale: boolean, sourceStatus: string } {
  if (event.feedItemId) {
    const feed = feedItems.find(item => item.id === event.feedItemId)
    if (feed) return feed
  }
  if (event.vesselId) {
    const vessel = vessels.find(item => item.id === event.vesselId)
    if (vessel) return vessel
  }
  if (event.portId) {
    const port = ports.find(item => item.id === event.portId)
    if (port) return port
  }
  if (event.voyageId) {
    const voyage = voyages.find(item => item.id === event.voyageId)
    if (voyage) return voyage
  }
  return { stale: true, sourceStatus: event.sourceStatus }
}

export function rankHotItems(events: ShippingEvent[], ports: Port[], vessels: Vessel[], voyages: Voyage[], feedItems: FeedItem[] = [], now = new Date()): HotItem[] {
  const labels = new Map<string, string>()
  vessels.forEach(v => labels.set(v.id, v.name))
  ports.forEach(p => labels.set(p.id, p.name))
  voyages.forEach(v => labels.set(v.id, v.voyageNumber))

  const eventItems = events
    .filter(event => event.status === ("active" as EventStatus))
    .map(event => {
      const source = relatedFreshness(event, ports, vessels, voyages, feedItems)
      return {
        id: event.id,
        kind: "event" as const,
        title: event.title,
        summary: event.summary,
        severity: event.severity,
        freshness: freshnessState(source),
        sourceStatus: source.sourceStatus,
        occurredAt: event.occurredAt,
        relatedLabel: event.vesselId ? labels.get(event.vesselId) : event.portId ? labels.get(event.portId) : event.voyageId ? labels.get(event.voyageId) : undefined,
        eventId: event.id,
      }
    })
  const activeEventKeys = new Set(events.filter(event => event.status === "active").map(event => event.dedupeKey))
  const feedHotItems = feedItems.filter(item => (item.severity === "warning" || item.severity === "critical") && !activeEventKeys.has(`feed:${item.id}`)).map(item => ({
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
  const watchedIds = new Set([
    ...vessels.filter(v => v.isWatched).map(v => v.id),
    ...ports.filter(p => p.isWatched).map(p => p.id),
  ])
  const watchedVoyageIds = new Set(voyages.filter(voyage => watchedIds.has(voyage.vesselId) || watchedIds.has(voyage.originPortId) || watchedIds.has(voyage.destinationPortId)).map(voyage => voyage.id))
  const relevance = (item: HotItem) => {
    const event = item.eventId ? events.find(candidate => candidate.id === item.eventId) : undefined
    const feed = item.feedItemId ? feedItems.find(candidate => candidate.id === item.feedItemId) : undefined
    const relatedIds = event
      ? [event.vesselId, event.portId, event.voyageId]
      : [...(feed?.relatedVesselIds ?? []), ...(feed?.relatedPortIds ?? []), ...(feed?.relatedVoyageIds ?? [])]
    return relatedIds.some(id => id !== undefined && (watchedIds.has(id) || watchedVoyageIds.has(id))) ? 1 : 0
  }
  const freshness = (value: FreshnessState) => ({ unknown: 0, stale: 1, fresh: 2 }[value])
  return [...eventItems, ...feedHotItems]
    .sort((a, b) => severityWeight[b.severity] - severityWeight[a.severity]
      || relevance(b) - relevance(a)
      || freshness(b.freshness) - freshness(a.freshness)
      || Date.parse(b.occurredAt) - Date.parse(a.occurredAt))
}
