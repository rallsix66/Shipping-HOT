import type { FeedItem, Port, ShippingEvent, ShippingSettings, ShippingSnapshot, Vessel, Voyage } from "./shipping"
import { calculateDelayMinutes } from "./shipping-rules"

const fixtureEpoch = Date.now()
const iso = (offsetMinutes: number) => new Date(fixtureEpoch + offsetMinutes * 60000).toISOString()

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

export const mockVessels: Vessel[] = [
  { id: "vessel-ever-glory", name: "EVER GLORY", imo: "9876543", mmsi: "477123400", carrier: "Evergreen", shipType: "Container ship", isWatched: true, latitude: 22.276, longitude: 114.122, speed: 0.2, course: 180, navigationStatus: "anchored", statusChangedAt: iso(-150), destination: "CNSHK", eta: iso(720), updatedAt: iso(-8), stale: false, sourceStatus: "healthy" },
  { id: "vessel-maersk-saltoro", name: "MAERSK SALTORO", imo: "9784561", mmsi: "219876500", carrier: "Maersk", shipType: "Container ship", isWatched: true, latitude: 14.58, longitude: 120.95, speed: 16.4, course: 42, navigationStatus: "under_way", statusChangedAt: iso(-45), destination: "PHMNL", eta: iso(480), updatedAt: iso(-4), stale: false, sourceStatus: "healthy" },
  { id: "vessel-cosco-harmony", name: "COSCO HARMONY", imo: "9712345", mmsi: "413456700", carrier: "COSCO", shipType: "Container ship", isWatched: false, latitude: 1.31, longitude: 103.82, speed: 0, course: 0, navigationStatus: "moored", statusChangedAt: iso(-120), destination: "SGSIN", eta: iso(120), updatedAt: iso(-46), stale: true, sourceStatus: "degraded" },
]

export const mockPorts: Port[] = [
  { id: "port-shekou", name: "蛇口", nameEn: "Shekou", country: "China", unlocode: "CNSHK", isWatched: true, congestionLevel: "high", waitingVessels: 18, containerWaitingVessels: 11, waitingHours: 31, operationalStatus: "disrupted", updatedAt: iso(-7), stale: false, sourceStatus: "healthy" },
  { id: "port-yantian", name: "盐田", nameEn: "Yantian", country: "China", unlocode: "CNYTN", isWatched: true, congestionLevel: "medium", waitingVessels: 9, containerWaitingVessels: 6, waitingHours: 14, operationalStatus: "normal", updatedAt: iso(-12), stale: false, sourceStatus: "healthy" },
  { id: "port-manila", name: "马尼拉", nameEn: "Manila", country: "Philippines", unlocode: "PHMNL", isWatched: false, congestionLevel: "low", waitingVessels: 4, containerWaitingVessels: 2, waitingHours: 6, operationalStatus: "normal", updatedAt: iso(-90), stale: true, sourceStatus: "degraded" },
  { id: "port-nansha", name: "南沙", nameEn: "Nansha", country: "China", unlocode: "CNSNA", isWatched: false, congestionLevel: "medium", waitingVessels: 8, containerWaitingVessels: 5, waitingHours: 12, operationalStatus: "normal", updatedAt: iso(-18), stale: false, sourceStatus: "healthy" },
  { id: "port-laem-chabang", name: "林查班", nameEn: "Laem Chabang", country: "Thailand", unlocode: "THLCH", isWatched: false, congestionLevel: "low", waitingVessels: 5, containerWaitingVessels: 3, waitingHours: 8, operationalStatus: "normal", updatedAt: iso(-24), stale: false, sourceStatus: "healthy" },
  { id: "port-klang", name: "巴生港", nameEn: "Port Klang", country: "Malaysia", unlocode: "MYPKG", isWatched: false, congestionLevel: "medium", waitingVessels: 11, containerWaitingVessels: 7, waitingHours: 16, operationalStatus: "normal", updatedAt: iso(-30), stale: false, sourceStatus: "healthy" },
  { id: "port-jakarta", name: "雅加达", nameEn: "Jakarta", country: "Indonesia", unlocode: "IDJKT", isWatched: false, congestionLevel: "low", waitingVessels: 6, containerWaitingVessels: 4, waitingHours: 9, operationalStatus: "normal", updatedAt: iso(-36), stale: false, sourceStatus: "healthy" },
  { id: "port-ho-chi-minh", name: "胡志明市", nameEn: "Ho Chi Minh City", country: "Vietnam", unlocode: "VNSGN", isWatched: false, congestionLevel: "medium", waitingVessels: 10, containerWaitingVessels: 6, waitingHours: 15, operationalStatus: "normal", updatedAt: iso(-42), stale: false, sourceStatus: "healthy" },
]

export const mockVoyages: Voyage[] = [
  { id: "voyage-eg-061", vesselId: "vessel-ever-glory", voyageNumber: "EG-061", originPortId: "port-yantian", destinationPortId: "port-shekou", baselineEtd: iso(-300), baselineEta: iso(500), baselineEtdSource: "mock-schedule", baselineEtaSource: "mock-schedule", latestEtd: iso(-270), latestEta: iso(620), latestEtdSource: "mock-schedule", latestEtaSource: "mock-schedule", latestEtaObservedAt: iso(-6), delayMinutes: calculateDelayMinutes(iso(500), iso(620)), status: "delayed", updatedAt: iso(-6), stale: false, sourceStatus: "healthy" },
  { id: "voyage-ms-204", vesselId: "vessel-maersk-saltoro", voyageNumber: "MS-204", originPortId: "port-shekou", destinationPortId: "port-manila", baselineEtd: iso(-180), baselineEta: iso(480), baselineEtdSource: "mock-schedule", baselineEtaSource: "mock-schedule", latestEtd: iso(-180), latestEta: iso(480), latestEtdSource: "mock-schedule", latestEtaSource: "mock-schedule", latestEtaObservedAt: iso(-4), delayMinutes: 0, status: "in_transit", updatedAt: iso(-4), stale: false, sourceStatus: "healthy" },
]

export const mockFeedItems: FeedItem[] = [
  { id: "feed-shekou-window", sourceId: "mock-port-notice", category: "port_notice", type: "port_disruption", title: "蛇口港发布高峰期作业窗口提醒", summary: "码头建议计划靠泊船舶预留额外缓冲时间。", sourceUrl: "https://example.com/mock/shekou", publishedAt: iso(-25), severity: "warning", relatedPortIds: ["port-shekou"], relatedVesselIds: [], relatedVoyageIds: [], updatedAt: iso(-25), stale: false, sourceStatus: "healthy" },
  { id: "feed-weather-south-china", sourceId: "mock-weather", category: "weather", type: "weather_warning", title: "南中国海未来 24 小时风浪关注", summary: "Mock 天气源提示航线可能出现短时延误。", sourceUrl: "https://example.com/mock/weather", publishedAt: iso(-50), severity: "watch", relatedPortIds: ["port-yantian"], relatedVesselIds: ["vessel-ever-glory"], relatedVoyageIds: ["voyage-eg-061"], updatedAt: iso(-50), stale: false, sourceStatus: "healthy" },
]

export const mockEvents: ShippingEvent[] = [
  { id: "event-vessel-ever-glory-anchored", type: "vessel_anchored", severity: "warning", status: "active", title: "EVER GLORY 锚泊时间过长", summary: "当前锚泊已超过设置阈值，建议关注靠泊窗口。", occurredAt: iso(-150), detectedAt: iso(-140), dedupeKey: "vessel_anchored:vessel-ever-glory", firstDetectedAt: iso(-140), lastDetectedAt: iso(-8), vesselId: "vessel-ever-glory", portId: "port-shekou", evidenceJson: { durationMinutes: 150, thresholdMinutes: 120 }, sourceStatus: "healthy" },
  { id: "event-voyage-eg-delay", type: "voyage_delay", severity: "critical", status: "active", title: "EG-061 ETA 延误 120 分钟", summary: "最新 ETA 晚于跟踪基准，延误已超过关注阈值。", occurredAt: iso(-6), detectedAt: iso(-6), dedupeKey: "voyage_delay:voyage-eg-061", firstDetectedAt: iso(-6), lastDetectedAt: iso(-6), voyageId: "voyage-eg-061", evidenceJson: { delayMinutes: 120 }, sourceStatus: "healthy" },
  { id: "event-port-shekou", type: "port_congestion", severity: "warning", status: "active", title: "蛇口港拥堵升级", summary: "等待船舶和等待时长处于高位。", occurredAt: iso(-7), detectedAt: iso(-7), dedupeKey: "port_congestion:port-shekou", firstDetectedAt: iso(-7), lastDetectedAt: iso(-7), portId: "port-shekou", evidenceJson: { congestionLevel: "high", waitingHours: 31 }, sourceStatus: "healthy" },
  { id: "event-resolved-demo", type: "destination_changed", severity: "info", status: "resolved", title: "COSCO HARMONY 目的港变更提醒", summary: "该提醒已恢复，不再出现在 HOT 活跃列表。", occurredAt: iso(-3000), detectedAt: iso(-2990), dedupeKey: "destination_changed:vessel-cosco-harmony", firstDetectedAt: iso(-2990), lastDetectedAt: iso(-120), resolvedAt: iso(-120), vesselId: "vessel-cosco-harmony", evidenceJson: { previous: "CNSHK", current: "SGSIN" }, sourceStatus: "degraded" },
]

export const mockSettings: ShippingSettings = {
  refreshInterval: 15,
  sourceEnabled: true,
  providerEnabled: true,
  eventThresholds: { anchoredHours: 2, delayMinutes: 60, congestionLevel: "high" },
  retentionDays: 30,
}

export function createMockSnapshot(): ShippingSnapshot {
  return rebaseSnapshot({
    vessels: structuredClone(mockVessels),
    ports: structuredClone(mockPorts),
    voyages: structuredClone(mockVoyages),
    events: structuredClone(mockEvents),
    feedItems: structuredClone(mockFeedItems),
    settings: structuredClone(mockSettings),
  })
}
