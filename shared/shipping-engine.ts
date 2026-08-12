import type { FeedItem, Port, ShippingEvent, ShippingSettings, Vessel, Voyage } from "./shipping"
import { calculateDelayMinutes, reconcileEvent, statusDurationMinutes } from "./shipping-rules"

export function detectShippingEvents(vessels: Vessel[], ports: Port[], voyages: Voyage[], feedItems: FeedItem[], settings: ShippingSettings, previous: ShippingEvent[] = [], now = new Date().toISOString()): ShippingEvent[] {
  const candidates: Omit<ShippingEvent, "id" | "firstDetectedAt" | "lastDetectedAt" | "resolvedAt">[] = []
  for (const vessel of vessels) {
    const durationMinutes = statusDurationMinutes(vessel, new Date(now))
    if (vessel.navigationStatus === "anchored" && durationMinutes >= settings.eventThresholds.anchoredHours * 60) {
      candidates.push({ type: "vessel_anchored", severity: durationMinutes >= settings.eventThresholds.anchoredHours * 120 ? "critical" : "warning", status: "active", title: `${vessel.name} 锚泊时间过长`, summary: `当前锚泊已持续 ${Math.round(durationMinutes / 60)} 小时。`, occurredAt: vessel.statusChangedAt, detectedAt: now, dedupeKey: `vessel_anchored:${vessel.id}`, vesselId: vessel.id, evidenceJson: { durationMinutes, thresholdMinutes: settings.eventThresholds.anchoredHours * 60 }, sourceStatus: vessel.sourceStatus })
    }
  }
  for (const voyage of voyages) {
    const delayMinutes = calculateDelayMinutes(voyage.baselineEta, voyage.latestEta)
    if (delayMinutes !== undefined && delayMinutes >= settings.eventThresholds.delayMinutes) {
      candidates.push({ type: "voyage_delay", severity: delayMinutes >= settings.eventThresholds.delayMinutes * 2 ? "critical" : "warning", status: "active", title: `${voyage.voyageNumber} ETA 延误 ${delayMinutes} 分钟`, summary: "最新 ETA 晚于跟踪基准，延误已超过关注阈值。", occurredAt: voyage.latestEtaObservedAt ?? now, detectedAt: now, dedupeKey: `voyage_delay:${voyage.id}`, voyageId: voyage.id, evidenceJson: { delayMinutes, thresholdMinutes: settings.eventThresholds.delayMinutes }, sourceStatus: voyage.sourceStatus })
    }
  }
  for (const port of ports) {
    if (["high", "critical"].includes(port.congestionLevel) && port.congestionLevel === settings.eventThresholds.congestionLevel) {
      candidates.push({ type: "port_congestion", severity: port.congestionLevel === "critical" ? "critical" : "warning", status: "active", title: `${port.nameEn} 拥堵升级`, summary: `等待 ${port.waitingVessels} 艘船，预计等待 ${port.waitingHours} 小时。`, occurredAt: port.updatedAt ?? now, detectedAt: now, dedupeKey: `port_congestion:${port.id}`, portId: port.id, evidenceJson: { congestionLevel: port.congestionLevel, waitingHours: port.waitingHours }, sourceStatus: port.sourceStatus })
    }
  }
  for (const feed of feedItems.filter(item => item.severity === "warning" || item.severity === "critical")) {
    candidates.push({ type: feed.type, severity: feed.severity, status: "active", title: feed.title, summary: feed.summary, occurredAt: feed.publishedAt, detectedAt: now, dedupeKey: `feed:${feed.id}`, feedItemId: feed.id, evidenceJson: { category: feed.category }, sourceStatus: feed.sourceStatus })
  }
  const byKey = new Map(previous.map(event => [event.dedupeKey, event]))
  return candidates.map(candidate => reconcileEvent(byKey.get(candidate.dedupeKey), candidate, now))
}
