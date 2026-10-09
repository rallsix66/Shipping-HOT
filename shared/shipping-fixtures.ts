import { type DataProvenance, type FeedItem, type Port, type ShippingEvent, type ShippingSettings, type ShippingSnapshot, defaultTranslationSettings } from "./shipping"
import { sourceScopedEventDedupeKey } from "./shipping"
import { calculateDelayMinutes } from "./shipping-rules"

const fixtureEpoch = Date.now()
const iso = (offsetMinutes: number) => new Date(fixtureEpoch + offsetMinutes * 60000).toISOString()

const mockProvenance = (sourceId: string, dataNature: DataProvenance["dataNature"]): DataProvenance => ({ sourceType: "mock", dataNature, sourceId, verified: false })

function stampMockProvenance<T extends { provenance?: DataProvenance }>(items: T[], sourceId: string, dataNature: DataProvenance["dataNature"]) {
  for (const item of items) {
    item.provenance = mockProvenance(sourceId, dataNature)
    ;(item as T & { source_type?: "mock" }).source_type = "mock"
  }
}

function mockEvidenceNature(sourceId: string): DataProvenance["dataNature"] {
  if (sourceId === "mock-weather") return "forecast"
  if (sourceId === "mock-port") return "derived"
  return "observed"
}

function stampMockEventTrust(events: ShippingEvent[]) {
  for (const event of events) {
    let sourceId = "mock-port"
    if (event.feedItemId === "feed-weather-south-china") sourceId = "mock-weather"
    else if (event.portId) sourceId = "mock-port"
    const sourceUpdatedAt = event.updatedAt ?? event.occurredAt
    const evidenceProvenance = mockProvenance(sourceId, mockEvidenceNature(sourceId))
    if (event.type === "port_congestion") {
      event.dedupeKey = sourceScopedEventDedupeKey(event.dedupeKey, sourceId)
      event.id = `event-${event.dedupeKey}`
    }
    event.provenance = mockProvenance(sourceId, "derived")
    event.source_type = "mock"
    event.evidence = [{ provenance: evidenceProvenance, sourceUpdatedAt }]
    event.updatedAt ??= sourceUpdatedAt
    event.stale ??= event.sourceStatus !== "healthy"
  }
}

function rebaseSnapshot(snapshot: ShippingSnapshot): ShippingSnapshot {
  const delta = Date.now() - fixtureEpoch
  if (delta === 0) return snapshot
  const shift = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(shift)
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, shift(entry)]))
    if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return new Date(Date.parse(value) + delta).toISOString()
    return value
  }
  return shift(structuredClone(snapshot)) as ShippingSnapshot
}

export const mockPorts: Port[] = [
  { id: "port-shekou", name: "蛇口", nameEn: "Shekou", country: "China", unlocode: "CNSHK", isWatched: true, congestionLevel: "high", waitingVessels: 18, containerWaitingVessels: 11, waitingHours: 31, operationalStatus: "disrupted", updatedAt: iso(-7), stale: false, sourceStatus: "healthy" },
  { id: "port-yantian", name: "盐田", nameEn: "Yantian", country: "China", unlocode: "CNYTN", isWatched: true, congestionLevel: "medium", waitingVessels: 9, containerWaitingVessels: 6, waitingHours: 14, operationalStatus: "normal", updatedAt: iso(-12), stale: false, sourceStatus: "healthy" },
  { id: "port-manila", name: "马尼拉", nameEn: "Manila", country: "Philippines", unlocode: "PHMNL", isWatched: false, congestionLevel: "low", waitingVessels: 4, containerWaitingVessels: 2, waitingHours: 6, operationalStatus: "normal", updatedAt: iso(-90), stale: true, sourceStatus: "degraded" },
  { id: "port-nansha", name: "南沙", nameEn: "Nansha", country: "China", unlocode: "CNNSA", isWatched: false, congestionLevel: "medium", waitingVessels: 8, containerWaitingVessels: 5, waitingHours: 12, operationalStatus: "normal", updatedAt: iso(-18), stale: false, sourceStatus: "healthy" },

  { id: "port-laem-chabang", name: "林查班", nameEn: "Laem Chabang", country: "Thailand", unlocode: "THLCH", isWatched: false, congestionLevel: "low", waitingVessels: 5, containerWaitingVessels: 3, waitingHours: 8, operationalStatus: "normal", updatedAt: iso(-24), stale: false, sourceStatus: "healthy" },
  { id: "port-klang", name: "巴生港", nameEn: "Port Klang", country: "Malaysia", unlocode: "MYPKG", isWatched: false, congestionLevel: "medium", waitingVessels: 11, containerWaitingVessels: 7, waitingHours: 16, operationalStatus: "normal", updatedAt: iso(-30), stale: false, sourceStatus: "healthy" },
  { id: "port-jakarta", name: "雅加达", nameEn: "Jakarta", country: "Indonesia", unlocode: "IDJKT", isWatched: false, congestionLevel: "low", waitingVessels: 6, containerWaitingVessels: 4, waitingHours: 9, operationalStatus: "normal", updatedAt: iso(-36), stale: false, sourceStatus: "healthy" },
  { id: "port-ho-chi-minh", name: "胡志明市", nameEn: "Ho Chi Minh City", country: "Vietnam", unlocode: "VNSGN", isWatched: false, congestionLevel: "medium", waitingVessels: 10, containerWaitingVessels: 6, waitingHours: 15, operationalStatus: "normal", updatedAt: iso(-42), stale: false, sourceStatus: "healthy" },
]

export const portWeatherConfig = {
  "port-shekou": { latitude: 22.48, longitude: 113.91 },
  "port-yantian": { latitude: 22.58, longitude: 114.27 },
  "port-nansha": { latitude: 22.64, longitude: 113.66 },
  "port-laem-chabang": { latitude: 13.08, longitude: 100.88 },
  "port-klang": { latitude: 3, longitude: 101.4 },
  "port-manila": { latitude: 14.6, longitude: 120.95 },
  "port-jakarta": { latitude: -6.1, longitude: 106.88 },
  "port-ho-chi-minh": { latitude: 10.77, longitude: 106.75 },
} as const

export const mockFeedItems: FeedItem[] = [
  { id: "feed-shekou-window", sourceId: "mock-port-notice", category: "port_notice", type: "port_disruption", title: "蛇口港发布高峰期作业窗口提醒", summary: "码头建议计划靠泊船舶预留额外缓冲时间。", sourceUrl: "https://example.com/mock/shekou", publishedAt: iso(-25), severity: "warning", relatedPortIds: ["port-shekou"], relatedVesselIds: [], updatedAt: iso(-25), stale: false, sourceStatus: "healthy" },
  { id: "feed-weather-south-china", sourceId: "mock-weather", category: "weather", type: "weather_warning", title: "南中国海未来 24 小时风浪关注", summary: "Mock 天气源提示航线可能出现短时延误。", sourceUrl: "https://example.com/mock/weather", publishedAt: iso(-50), severity: "watch", relatedPortIds: ["port-yantian"], relatedVesselIds: [], updatedAt: iso(-50), stale: false, sourceStatus: "healthy" },
]

export const mockEvents: ShippingEvent[] = [
  { id: "event-port-shekou", type: "port_congestion", severity: "warning", status: "active", title: "蛇口港拥堵升级", summary: "等待船舶和等待时长处于高位。", occurredAt: iso(-7), detectedAt: iso(-7), dedupeKey: "port_congestion:port-shekou", firstDetectedAt: iso(-7), lastDetectedAt: iso(-7), portId: "port-shekou", evidenceJson: { congestionLevel: "high", waitingHours: 31 }, sourceStatus: "healthy" },
  { id: "event-resolved-demo", type: "destination_changed", severity: "info", status: "resolved", title: "港口作业提醒已恢复", summary: "该提醒已恢复，不再出现在 HOT 活跃列表。", occurredAt: iso(-3000), detectedAt: iso(-2990), dedupeKey: "destination_changed:port-manila", firstDetectedAt: iso(-2990), lastDetectedAt: iso(-120), resolvedAt: iso(-120), portId: "port-manila", evidenceJson: { previous: "normal", current: "disrupted" }, sourceStatus: "degraded" },
]

stampMockProvenance(mockPorts, "mock-port", "derived")
stampMockProvenance(mockFeedItems.filter(item => item.sourceId === "mock-weather"), "mock-weather", "forecast")
stampMockProvenance(mockFeedItems.filter(item => item.sourceId !== "mock-weather"), "mock-port-notice", "reported")
stampMockEventTrust(mockEvents)

export const mockSettings: ShippingSettings = {
  refreshInterval: 15,
  sourceEnabled: true,
  providerEnabled: true,
  eventThresholds: { anchoredHours: 2, delayMinutes: 60, congestionLevel: "high" },
  retentionDays: 30,
  translation: structuredClone(defaultTranslationSettings),
}

/** @deprecated retained for delay-threshold unit tests only */
export function fixtureDelayMinutes(baselineEta: string, latestEta: string): number | undefined {
  return calculateDelayMinutes(baselineEta, latestEta)
}

export function createMockSnapshot(): ShippingSnapshot {
  return rebaseSnapshot({
    ports: structuredClone(mockPorts),
    events: structuredClone(mockEvents),
    feedItems: structuredClone(mockFeedItems),
    settings: structuredClone(mockSettings),
  })
}
