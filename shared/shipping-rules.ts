import { deriveProvenance, eventIsCompatibleWithOperationalContext, sourceAllowedForOperationalContext } from "./shipping"
import type { EventStatus, FeedItem, FreshnessState, HotItem, OperationalSourceContext, Port, Severity, ShippingEvent, ShippingSettings, SourceStatus, Vessel, Voyage } from "./shipping"

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
  const previousSource = previous.provenance?.sourceId
  const providerSource = provider.provenance?.sourceId
  const isSameSource = previousSource !== undefined && previousSource === providerSource
  if (providerSource === "aisstream") {
    return {
      ...provider,
      isWatched: previous.isWatched,
    }
  }
  if (!isSameSource) return { ...provider, isWatched: previous.isWatched }
  return updateVesselStatus(previous, provider, now)
}

export function mergeProviderVoyage(previous: Voyage | undefined, provider: Voyage): Voyage {
  const baselineEta = previous?.baselineEta ?? provider.baselineEta ?? provider.latestEta
  const baselineEtd = previous?.baselineEtd ?? provider.baselineEtd ?? provider.latestEtd
  const baselineEtaSource = previous?.baselineEta !== undefined
    ? previous.baselineEtaSource
    : provider.baselineEta !== undefined
      ? provider.baselineEtaSource
      : provider.latestEta !== undefined
        ? provider.latestEtaSource
        : undefined
  const baselineEtdSource = previous?.baselineEtd !== undefined
    ? previous.baselineEtdSource
    : provider.baselineEtd !== undefined
      ? provider.baselineEtdSource
      : provider.latestEtd !== undefined
        ? provider.latestEtdSource
        : undefined
  return {
    ...previous,
    ...provider,
    baselineEta,
    baselineEtd,
    baselineEtaSource,
    baselineEtdSource,
    delayMinutes: calculateDelayMinutes(baselineEta, provider.latestEta),
  }
}

export function statusDurationMinutes(vessel: Pick<Vessel, "statusChangedAt">, now = new Date()): number {
  if (!vessel.statusChangedAt) return 0
  const timestamp = Date.parse(vessel.statusChangedAt)
  return Number.isFinite(timestamp) ? Math.max(0, Math.round((now.getTime() - timestamp) / 60000)) : 0
}

export function reconcileEvent(existing: ShippingEvent | undefined, incoming: Omit<ShippingEvent, "id" | "firstDetectedAt" | "lastDetectedAt" | "resolvedAt">, now = new Date().toISOString()): ShippingEvent {
  if (!existing) {
    return { ...incoming, id: `event-${incoming.dedupeKey}`, firstDetectedAt: now, lastDetectedAt: now }
  }
  if (incoming.status === "resolved") {
    return { ...existing, ...incoming, status: "resolved", detectedAt: existing.detectedAt, lastDetectedAt: existing.lastDetectedAt, resolvedAt: now }
  }
  return {
    ...existing,
    ...incoming,
    id: existing.id,
    detectedAt: existing.status === "active" ? existing.detectedAt : incoming.detectedAt,
    status: "active",
    firstDetectedAt: existing.firstDetectedAt,
    lastDetectedAt: now,
    resolvedAt: undefined,
  }
}

export function congestionLevelRank(level: Port["congestionLevel"]): number {
  if (level === undefined) return -1
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

export function freshnessState(item: { stale: boolean, sourceStatus: string }): FreshnessState {
  if (item.sourceStatus === "never_succeeded") return "unknown"
  if (item.sourceStatus !== "healthy") return "stale"
  return item.stale ? "stale" : "fresh"
}

function relatedFreshness(event: ShippingEvent, ports: Port[], vessels: Vessel[], voyages: Voyage[], feedItems: FeedItem[]): { stale: boolean, sourceStatus: SourceStatus, provenance?: ShippingEvent["provenance"] } {
  if (event.provenance?.sourceId === "aisstream-area") return { stale: event.stale ?? true, sourceStatus: event.sourceStatus, provenance: event.provenance }
  if (event.feedItemId) {
    const feed = feedItems.find(item => item.id === event.feedItemId)
    if (feed) return { ...feed, provenance: event.provenance ?? deriveProvenance(feed.provenance) }
  }
  if (event.vesselId) {
    const vessel = vessels.find(item => item.id === event.vesselId)
    if (vessel) return { ...vessel, provenance: event.provenance ?? deriveProvenance(vessel.provenance) }
  }
  if (event.portId) {
    const port = ports.find(item => item.id === event.portId)
    if (port) return { ...port, provenance: event.provenance ?? deriveProvenance(port.provenance) }
  }
  if (event.voyageId) {
    const voyage = voyages.find(item => item.id === event.voyageId)
    if (voyage) return { ...voyage, provenance: event.provenance ?? deriveProvenance(voyage.provenance) }
  }
  return { stale: event.stale ?? true, sourceStatus: event.sourceStatus, provenance: event.provenance }
}

export function rankHotItems(events: ShippingEvent[], ports: Port[], vessels: Vessel[], voyages: Voyage[], feedItems: FeedItem[] = [], _now = new Date(), context?: OperationalSourceContext): HotItem[] {
  const operationalEvents = context ? events.filter(event => eventIsCompatibleWithOperationalContext(event, context)) : events
  const operationalFeedItems = context ? feedItems.filter(item => sourceAllowedForOperationalContext(item.provenance?.sourceId ?? item.sourceId, context)) : feedItems
  const labels = new Map<string, string>()
  vessels.forEach(v => labels.set(v.id, v.name))
  ports.forEach(p => labels.set(p.id, p.name))
  voyages.forEach(v => labels.set(v.id, v.voyageNumber))

  const eventItems = operationalEvents
    .filter(event => event.status === ("active" as EventStatus))
    .filter(event => event.provenance?.sourceId !== "aisstream-area" || Boolean(event.portId && ports.some(port => port.id === event.portId && port.isWatched)))
    .map((event) => {
      const source = relatedFreshness(event, ports, vessels, voyages, operationalFeedItems)
      return {
        id: event.id,
        kind: "event" as const,
        title: event.title,
        summary: event.summary,
        severity: event.severity,
        freshness: freshnessState(source),
        sourceStatus: source.sourceStatus,
        provenance: source.provenance,
        occurredAt: event.occurredAt,
        relatedLabel: event.vesselId ? labels.get(event.vesselId) : event.portId ? labels.get(event.portId) : event.voyageId ? labels.get(event.voyageId) : undefined,
        eventId: event.id,
      }
    })
  const activeEventKeys = new Set(operationalEvents.filter(event => event.status === "active").map(event => event.dedupeKey))
  const feedHotItems = operationalFeedItems.filter(item => freshnessState(item) === "fresh" && item.eventEligibility !== false && item.publicationTimeKnown !== false && (item.severity === "warning" || item.severity === "critical") && !activeEventKeys.has(`feed:${item.id}`)).map(item => ({
    id: item.id,
    kind: "feed" as const,
    title: item.title,
    summary: item.summary,
    severity: item.severity,
    freshness: freshnessState(item),
    sourceStatus: item.sourceStatus,
    provenance: item.provenance,
    occurredAt: item.publishedAt || "1970-01-01T00:00:00.000Z",
    relatedLabel: item.relatedPortIds[0] ? labels.get(item.relatedPortIds[0]) : item.relatedVesselIds[0] ? labels.get(item.relatedVesselIds[0]) : undefined,
    feedItemId: item.id,
    hotReason: item.hotReason,
  }))
  const watchedIds = new Set([
    ...vessels.filter(v => v.isWatched).map(v => v.id),
    ...ports.filter(p => p.isWatched).map(p => p.id),
  ])
  const watchedVoyageIds = new Set(voyages.filter(voyage => watchedIds.has(voyage.vesselId) || watchedIds.has(voyage.originPortId) || watchedIds.has(voyage.destinationPortId)).map(voyage => voyage.id))
  const relevance = (item: HotItem) => {
    const event = item.eventId ? operationalEvents.find(candidate => candidate.id === item.eventId) : undefined
    const feed = item.feedItemId ? operationalFeedItems.find(candidate => candidate.id === item.feedItemId) : undefined
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
