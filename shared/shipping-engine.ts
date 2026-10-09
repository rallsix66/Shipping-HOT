import { deriveProvenance, provenanceEvidence, sourceScopedEventDedupeKey } from "./shipping"
import type { FeedItem, Freshness, Port, ProvenanceAware, ShippingEvent, ShippingSettings } from "./shipping"
import { type CalendarEvent, calendarCountries, calendarEventLegacyId, calendarLeadDays, calendarSeverity, daysUntilCalendarEvent } from "./calendar"
import { congestionLevelRank, isFeedItemCurrent, reconcileEvent } from "./shipping-rules"

function calendarCountriesLabel(event: CalendarEvent): string {
  return calendarCountries[event.countryCode]
}

export function isFreshEventEvidence(value: Pick<Freshness, "stale" | "sourceStatus">): boolean {
  return value.sourceStatus === "healthy" && !value.stale
}

export function isCalendarOperationallyRelevant(event: Pick<CalendarEvent, "type" | "scope">): boolean {
  if (event.type === "government_special") return true
  return event.scope === undefined || event.scope === "national"
}

function isCalendarificScopedLocal(event: CalendarEvent): boolean {
  return event.sourceId === "calendarific" && (event.scope === "subdivision" || event.scope === "unknown")
}

function eventTrust(source: Freshness & ProvenanceAware) {
  return {
    provenance: deriveProvenance(source.provenance),
    evidence: provenanceEvidence(source.provenance, source.sourceUpdatedAt ?? source.updatedAt),
    updatedAt: source.updatedAt,
    sourceUpdatedAt: source.sourceUpdatedAt,
    fetchedAt: source.fetchedAt,
    stale: source.stale,
    sourceStatus: source.sourceStatus,
    error: source.error,
  }
}

export function portCongestionEventKey(port: Pick<Port, "id" | "provenance">): string {
  return sourceScopedEventDedupeKey(`port_congestion:${port.id}`, port.provenance?.sourceId)
}

export function detectShippingEvents(
  ports: Port[],
  feedItems: FeedItem[],
  settings: ShippingSettings,
  previous: ShippingEvent[] = [],
  now = new Date().toISOString(),
  calendarEvents: CalendarEvent[] = [],
): ShippingEvent[] {
  const candidates: Omit<ShippingEvent, "id" | "firstDetectedAt" | "lastDetectedAt" | "resolvedAt">[] = []
  const calendarById = new Map(calendarEvents.map(event => [event.id, event]))
  const supersededLegacyCalendarEventIds = new Set(calendarEvents.filter(isCalendarificScopedLocal).map(event => calendarEventLegacyId(event, event.sourceId)))
  const operationalPrevious = previous.filter((event) => {
    if (event.calendarEventId && supersededLegacyCalendarEventIds.has(event.calendarEventId)) return false
    return !event.calendarEventId || !calendarById.has(event.calendarEventId) || isCalendarOperationallyRelevant(calendarById.get(event.calendarEventId)!)
  })
  const sourceTrust = new Map<string, Freshness>()
  ports.forEach(port => sourceTrust.set(portCongestionEventKey(port), port))
  feedItems.forEach(feed => sourceTrust.set(`feed:${feed.id}`, feed))
  const today = now.slice(0, 10)
  for (const event of calendarEvents.filter(isCalendarOperationallyRelevant)) {
    if (event.type === "government_special") {
      sourceTrust.set(`calendar:${event.id}:announced`, event)
    } else {
      for (const lead of calendarLeadDays(event)) sourceTrust.set(`calendar:${event.id}:${lead}`, event)
    }
  }

  for (const port of ports.filter(isFreshEventEvidence)) {
    if (port.congestionLevel !== undefined && congestionLevelRank(port.congestionLevel) >= congestionLevelRank(settings.eventThresholds.congestionLevel)) {
      const detail = [
        port.waitingVessels === undefined ? "等待船舶暂无数据" : `等待 ${port.waitingVessels} 艘船`,
        port.waitingHours === undefined ? "等待时长暂无数据" : `预计等待 ${port.waitingHours} 小时`,
      ].join("，")
      candidates.push({ ...eventTrust(port), type: "port_congestion", severity: port.congestionLevel === "critical" ? "critical" : "warning", status: "active", title: `${port.nameEn} 拥堵升级`, summary: detail, occurredAt: port.updatedAt ?? now, detectedAt: now, dedupeKey: portCongestionEventKey(port), portId: port.id, evidenceJson: { congestionLevel: port.congestionLevel, waitingHours: port.waitingHours } })
    }
  }
  for (const feed of feedItems.filter(item => isFeedItemCurrent(item, new Date(now)) && isFreshEventEvidence(item) && item.eventEligibility !== false && item.publicationTimeKnown !== false && (item.severity === "warning" || item.severity === "critical"))) {
    candidates.push({ ...eventTrust(feed), expiresAt: feed.expiresAt ?? feed.currentUntil, type: feed.type, severity: feed.severity, status: "active", title: feed.title, summary: feed.summary, occurredAt: feed.publishedAt || feed.sourceUpdatedAt || now, detectedAt: now, dedupeKey: `feed:${feed.id}`, feedItemId: feed.id, evidenceJson: { category: feed.category, hotReason: feed.hotReason, relatedPortIds: feed.relatedPortIds, relatedVesselIds: feed.relatedVesselIds } })
  }
  for (const calendarEvent of calendarEvents.filter(event => isCalendarOperationallyRelevant(event) && isFreshEventEvidence(event))) {
    const daysUntil = daysUntilCalendarEvent(calendarEvent.date, today)
    if (calendarEvent.type === "government_special") {
      if (daysUntil < 0) continue
      const dedupeKey = `calendar:${calendarEvent.id}:announced`
      candidates.push({ ...eventTrust(calendarEvent), type: "calendar_announcement", severity: calendarSeverity(calendarEvent.businessImpact), status: "active", title: `${calendarCountriesLabel(calendarEvent)}：新增政府临时假日`, summary: `${calendarEvent.name} 已于本次同步发现，日期为 ${calendarEvent.date}，请立即检查船期、清关和港口作业。`, occurredAt: calendarEvent.sourceUpdatedAt ?? calendarEvent.updatedAt ?? now, detectedAt: now, dedupeKey, calendarEventId: calendarEvent.id, evidenceJson: { calendarEventId: calendarEvent.id, announcement: true, daysUntil, isPublicHoliday: calendarEvent.isPublicHoliday } })
      continue
    }
    for (const lead of calendarLeadDays(calendarEvent)) {
      if (daysUntil < 0 || daysUntil > lead) continue
      const dedupeKey = `calendar:${calendarEvent.id}:${lead}`
      candidates.push({ ...eventTrust(calendarEvent), type: "calendar_reminder", severity: calendarSeverity(calendarEvent.businessImpact), status: "active", title: `${calendarCountriesLabel(calendarEvent)}：${calendarEvent.name}`, summary: daysUntil === 0 ? "今天进入运营日历提醒窗口。" : `距离日期还有 ${daysUntil} 天，提前安排船期、清关和港口作业。`, occurredAt: `${calendarEvent.date}T00:00:00.000Z`, detectedAt: now, dedupeKey, calendarEventId: calendarEvent.id, evidenceJson: { calendarEventId: calendarEvent.id, leadDays: lead, daysUntil, isPublicHoliday: calendarEvent.isPublicHoliday } })
    }
  }
  const byKey = new Map(operationalPrevious.map(event => [event.dedupeKey, event]))
  const activeKeys = new Set(candidates.map(candidate => candidate.dedupeKey))
  const reconciled = candidates.map(candidate => reconcileEvent(byKey.get(candidate.dedupeKey), candidate, now))
  for (const existing of operationalPrevious) {
    if (existing.status === "active" && !activeKeys.has(existing.dedupeKey)) {
      const trust = sourceTrust.get(existing.dedupeKey)
      const { id: _id, firstDetectedAt: _first, lastDetectedAt: _last, resolvedAt: _resolved, ...incoming } = existing
      if (!trust) {
        if (existing.feedItemId) {
          reconciled.push(reconcileEvent(existing, {
            ...incoming,
            status: "resolved",
            stale: true,
            sourceStatus: "degraded",
            error: "feed_item_expired",
            fetchedAt: now,
          }, now))
        } else {
          reconciled.push(existing)
        }
        continue
      }
      if (existing.feedItemId && !isFeedItemCurrent(trust as FeedItem, new Date(now))) {
        reconciled.push(reconcileEvent(existing, {
          ...incoming,
          status: "resolved",
          stale: true,
          sourceStatus: trust.sourceStatus,
          error: "feed_item_expired",
          fetchedAt: trust.fetchedAt,
        }, now))
        continue
      }
      if (!isFreshEventEvidence(trust)) {
        reconciled.push({
          ...existing,
          stale: true,
          sourceStatus: trust.sourceStatus,
          error: trust.error,
          fetchedAt: trust.fetchedAt,
        })
        continue
      }
      reconciled.push(reconcileEvent(existing, {
        ...incoming,
        status: "resolved",
        stale: false,
        sourceStatus: trust.sourceStatus,
        error: undefined,
        fetchedAt: trust.fetchedAt,
      }, now))
    } else if (existing.status === "resolved" && !activeKeys.has(existing.dedupeKey)) {
      reconciled.push(existing)
    }
  }
  return reconciled
}
