import { deriveProvenance, eventIsCompatibleWithOperationalContext, recordAllowedForDataMode, sourceAllowedForOperationalContext } from "./shipping"
import type { EventStatus, FeedFreshnessClass, FeedItem, FeedVisibility, FreshnessState, HotItem, OperationalSourceContext, Port, Severity, ShippingEvent, ShippingSettings, SourceStatus, Vessel, Voyage } from "./shipping"

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

export interface FeedFreshnessPolicy {
  class: FeedFreshnessClass
  maxAgeDays: 7 | 14
  maxAgeMs: number
}

export interface FeedFreshnessDecision {
  currentUntil?: string
  visibility: FeedVisibility
  eventEligibility: boolean
  reason?: "publication_time_unknown" | "publication_time_invalid" | "publication_time_future" | "effective_time_invalid" | "effective_time_future" | "expiry_time_invalid" | "expired" | "stale_source"
}

export function feedFreshnessPolicyFor(item: Pick<FeedItem, "category" | "severity" | "freshnessPolicy" | "provenance">): FeedFreshnessPolicy {
  const policyClass: FeedFreshnessClass = item.freshnessPolicy
    ?? (item.provenance?.sourceType === "official" || item.category === "port_notice" ? "official" : item.category === "carrier_notice" || item.severity === "warning" || item.severity === "critical" ? "operational" : "ordinary")
  const maxAgeDays = policyClass === "ordinary" ? 7 : 14
  return { class: policyClass, maxAgeDays, maxAgeMs: maxAgeDays * 24 * 60 * 60 * 1000 }
}

interface TimestampObservation {
  provided: boolean
  value?: number
}

function inspectTimestamp(value: unknown): TimestampObservation {
  if (value === undefined || value === null) return { provided: false }
  if (typeof value !== "string") return { provided: true }
  if (value.trim() === "") return { provided: false }
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? { provided: true, value: parsed } : { provided: true }
}

export function applyFeedFreshnessPolicy(item: FeedItem, now = new Date()): FeedItem {
  const publication = inspectTimestamp(item.publishedAt)
  const effective = inspectTimestamp(item.effectiveAt)
  const explicitExpiry = inspectTimestamp(item.expiresAt)
  const weatherExpiry: TimestampObservation = explicitExpiry.provided ? { provided: false } : inspectTimestamp(item.weather?.alertExpiresAt)
  const expiry = explicitExpiry.provided ? explicitExpiry : weatherExpiry
  const policy = feedFreshnessPolicyFor(item)
  const publicationKnown = item.publicationTimeKnown !== false && publication.value !== undefined
  const base = { ...item, freshnessPolicy: policy.class, publicationTimeKnown: publicationKnown }
  const quarantine = (reason: FeedFreshnessDecision["reason"]): FeedItem => ({
    ...base,
    currentUntil: undefined,
    visibility: "quarantine",
    eventEligibility: false,
    stale: true,
    sourceStatus: base.sourceStatus === "healthy" ? "degraded" : base.sourceStatus,
    error: base.error ?? reason,
  })
  if (!publication.provided) return quarantine("publication_time_unknown")
  if (publication.value === undefined) return quarantine("publication_time_invalid")
  if (!publicationKnown) return quarantine("publication_time_unknown")
  if (!effective.provided) {
    // No effective time is a valid absence; only a supplied invalid value quarantines.
  } else if (effective.value === undefined) {
    return quarantine("effective_time_invalid")
  } else if (effective.value > now.getTime()) {
    return quarantine("effective_time_future")
  }
  if (expiry.provided && expiry.value === undefined) return quarantine("expiry_time_invalid")
  if (publication.value > now.getTime()) return quarantine("publication_time_future")

  const ageUntil = publication.value + policy.maxAgeMs
  const currentUntilMs = expiry.value === undefined ? ageUntil : Math.min(ageUntil, expiry.value)
  const currentUntil = new Date(currentUntilMs).toISOString()
  if (currentUntilMs <= now.getTime()) {
    return {
      ...base,
      currentUntil,
      visibility: "history",
      eventEligibility: false,
      stale: true,
      error: base.error ?? "expired",
    }
  }
  const sourceFresh = base.sourceStatus === "healthy" && !base.stale
  return {
    ...base,
    currentUntil,
    visibility: "current",
    eventEligibility: base.eventEligibility !== false && sourceFresh,
    error: sourceFresh ? base.error : base.error ?? "stale_source",
  }
}

export function isFeedItemCurrent(item: FeedItem, now = new Date()): boolean {
  const normalized = item.visibility === undefined ? applyFeedFreshnessPolicy(item, now) : item
  if (normalized.visibility !== "current") return false
  const currentUntil = inspectTimestamp(normalized.currentUntil).value
  return currentUntil !== undefined && currentUntil > now.getTime()
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

export function rankHotItems(events: ShippingEvent[], ports: Port[], vessels: Vessel[], voyages: Voyage[], feedItems: FeedItem[] = [], now = new Date(), context?: OperationalSourceContext): HotItem[] {
  const operationalEvents = context ? events.filter(event => eventIsCompatibleWithOperationalContext(event, context)) : events
  const operationalFeedItems = context
    ? feedItems.filter(item => recordAllowedForDataMode(item, context.modes.dataMode ?? "mock") && sourceAllowedForOperationalContext(item.provenance?.sourceId ?? item.sourceId, context))
    : feedItems
  const labels = new Map<string, string>()
  vessels.forEach(v => labels.set(v.id, v.name))
  ports.forEach(p => labels.set(p.id, p.name))
  voyages.forEach(v => labels.set(v.id, v.voyageNumber ?? "未知航次"))

  const eventItems = operationalEvents
    .filter(event => event.status === ("active" as EventStatus))
    .filter((event) => {
      if (!event.feedItemId) return true
      const feed = operationalFeedItems.find(item => item.id === event.feedItemId)
      return Boolean(feed && isFeedItemCurrent(feed, now) && freshnessState(feed) === "fresh" && (!event.expiresAt || Date.parse(event.expiresAt) > now.getTime()))
    })
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
  const activeEventKeys = new Set(operationalEvents
    .filter(event => event.status === "active")
    .filter(event => !event.feedItemId || eventItems.some(item => item.eventId === event.id))
    .map(event => event.dedupeKey))
  const feedHotItems = operationalFeedItems.filter(item => isFeedItemCurrent(item, now) && freshnessState(item) === "fresh" && item.eventEligibility !== false && item.publicationTimeKnown !== false && (item.severity === "warning" || item.severity === "critical") && !activeEventKeys.has(`feed:${item.id}`)).map(item => ({
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
  const watchedVoyageIds = new Set(voyages.filter(voyage => watchedIds.has(voyage.vesselId) || (voyage.originPortId !== undefined && watchedIds.has(voyage.originPortId)) || (voyage.destinationPortId !== undefined && watchedIds.has(voyage.destinationPortId))).map(voyage => voyage.id))
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
