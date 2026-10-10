import { createHash } from "node:crypto"
import { XMLParser } from "fast-xml-parser"
import type { DataProvenance, FeedItem, Severity, WeatherDetail } from "@shared/shipping"

/**
 * CAP 1.2 lifecycle for official weather alerts (TH-W01 TMD first).
 *
 * - only `status=Actual` is used (Test/Exercise/System/Draft are ignored);
 * - `msgType` Alert/Update/Cancel; Update and Cancel retire every message named in `references`;
 *   Ack/Error and unknown types are ignored;
 * - lifecycle comes from CAP fields: `sent` and a parseable `expires` are required for `active`,
 *   `expires <= now` => expired, missing/invalid `expires` => unknown (never event-eligible);
 * - severity: Extreme→critical, Severe→warning, Moderate→watch, Minor/Unknown/missing→info;
 * - coverage: only structured `<geocode>` ISO3166-2 values of the source's country become `alertRegion`;
 *   foreign or missing geocodes => no region and no port association (areaDesc text is not used).
 * - BMKG (ID) bodies carry no geocode; for sources configured with areaMatch "polygon" a port is associated only
 *   when its directory coordinate lies inside a CAP <polygon> of the message, and only for ports of the
 *   issuing country. <areaDesc> is shown as alertRegion but never used for association; description text never is.
 */

export interface CapSourceContext {
  id: string
  name: string
  sourceUrl: string
  /** ISO 3166-1 alpha-2 country of the issuing agency (from docs/intel-source-catalog.md). */
  countryCode: string
  provenance: DataProvenance
  /** How CAP areas associate ports: ISO 3166-2 geocodes (TMD, default) or polygon containment (BMKG). */
  areaMatch?: "geocode" | "polygon"
  /** Same-country port coordinates for polygon containment (from the port directory). */
  polygonPorts?: readonly { portId: string, latitude: number, longitude: number }[]
}

/** Structured subdivision → focus port. Only mappings checked against the port directory are listed. */
export const capSubdivisionPorts: Readonly<Record<string, readonly string[]>> = {
  // Laem Chabang port is in Chon Buri province (ISO 3166-2:TH-20)
  "TH-20": ["port-laem-chabang"],
}

export interface CapMessage {
  identifier: string
  sender: string
  sent?: string
  status: string
  msgType: string
  references: string[]
  event?: string
  headline?: string
  description?: string
  web?: string
  effective?: string
  onset?: string
  expires?: string
  severity?: string
  urgency?: string
  certainty?: string
  geocodes: string[]
  /** Structured CAP <area> blocks: areaDesc and polygons as [lat, lon] rings. */
  areas: { areaDesc?: string, polygons: [number, number][][] }[]
  documentUrl?: string
}

export interface CapParseResult {
  items: FeedItem[]
  /** Normalised keys of messages retired by Update/Cancel in this batch (sender|identifier). */
  retiredKeys: string[]
  ignored: { identifier: string, reason: string }[]
}

/** Clock-skew tolerance for "not obviously in the future". */
export const CAP_SENT_FUTURE_SKEW_MS = 5 * 60 * 1000

/** A control message (Update/Cancel) may revoke/supersede only when its `sent` parses and is not in the future. */
export function capSentUsable(sent: string | undefined, fetchedAt: string): boolean {
  const sentMs = sent ? Date.parse(sent) : Number.NaN
  return Number.isFinite(sentMs) && sentMs <= Date.parse(fetchedAt) + CAP_SENT_FUTURE_SKEW_MS
}

const capParser = new XMLParser({ ignoreAttributes: true, removeNSPrefix: true, parseTagValue: false, trimValues: true })

function asArray<T>(value: T | T[] | undefined): T[] {
  return value === undefined ? [] : Array.isArray(value) ? value : [value]
}

function text(value: unknown): string | undefined {
  if (typeof value === "string" || typeof value === "number") return String(value).trim() || undefined
  if (value && typeof value === "object") return text((value as Record<string, unknown>)["#text"])
  return undefined
}

function iso(value: string | undefined): string | undefined {
  if (!value) return undefined
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : undefined
}

/** Language-suffix-insensitive key: TMD identifiers carry "-en" while references omit it. */
export function capMessageKey(sender: string, identifier: string): string {
  return `${sender.trim().toUpperCase()}|${identifier.trim().replace(/-[a-z]{2}$/i, "")}`
}

/** CAP references: whitespace-separated "sender,identifier,sent" triplets. */
export function parseCapReferences(value: string | undefined): string[] {
  if (!value) return []
  return value.split(/\s+/).map(triplet => triplet.split(",")).filter(parts => parts.length >= 2 && parts[0] && parts[1]).map(([sender, identifier]) => capMessageKey(sender, identifier))
}

/** CAP polygon: whitespace-separated "lat,lon" pairs. Invalid pairs make the whole ring unusable. */
export function parseCapPolygon(value: string | undefined): [number, number][] {
  if (!value) return []
  const ring: [number, number][] = []
  for (const pair of value.trim().split(/\s+/)) {
    const [lat, lon] = pair.split(",").map(Number)
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return []
    ring.push([lat, lon])
  }
  return ring
}

/** Ray casting on [lat, lon] rings (adequate for the small CAP nowcast polygons). */
export function pointInCapPolygon(latitude: number, longitude: number, ring: readonly [number, number][]): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [yi, xi] = ring[i]
    const [yj, xj] = ring[j]
    if ((yi > latitude) !== (yj > latitude) && longitude < (xj - xi) * (latitude - yi) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

export function parseCapMessage(xml: string, documentUrl?: string): CapMessage {
  const parsed = capParser.parse(xml) as { alert?: Record<string, unknown> }
  const alert = parsed.alert
  if (!alert || typeof alert !== "object") throw new Error("CAP payload has no alert root")
  const infos = asArray(alert.info as Record<string, unknown> | Record<string, unknown>[] | undefined)
  const info = infos.find(entry => /^en/i.test(text(entry.language) ?? "")) ?? infos[0] ?? {}
  const areas = asArray(info.area as Record<string, unknown> | Record<string, unknown>[] | undefined)
  const geocodes = areas.flatMap(area => asArray(area.geocode as Record<string, unknown> | Record<string, unknown>[] | undefined))
    .filter(code => text(code.valueName) === "ISO3166-2")
    .map(code => text(code.value))
    .filter((value): value is string => Boolean(value))
  const identifier = text(alert.identifier)
  const sender = text(alert.sender)
  if (!identifier || !sender) throw new Error("CAP payload lacks identifier or sender")
  return {
    identifier,
    sender,
    sent: text(alert.sent),
    status: text(alert.status) ?? "",
    msgType: text(alert.msgType) ?? "",
    references: parseCapReferences(text(alert.references)),
    event: text(info.event),
    headline: text(info.headline),
    description: text(info.description),
    web: text(info.web),
    effective: text(info.effective),
    onset: text(info.onset),
    expires: text(info.expires),
    severity: text(info.severity),
    urgency: text(info.urgency),
    certainty: text(info.certainty),
    geocodes: [...new Set(geocodes)],
    areas: areas.map(area => ({
      areaDesc: text(area.areaDesc),
      polygons: asArray(area.polygon as unknown).map(ring => parseCapPolygon(text(ring))).filter(ring => ring.length >= 3),
    })),
    documentUrl,
  }
}

export function capSeverity(value: string | undefined): Severity {
  switch (value?.toLowerCase()) {
    case "extreme": return "critical"
    case "severe": return "warning"
    case "moderate": return "watch"
    default: return "info"
  }
}

function truncate(value: string, max = 320): string {
  return value.length <= max ? value : `${value.slice(0, max - 1).trimEnd()}…`
}

export function capMessageToFeedItem(message: CapMessage, source: CapSourceContext, fetchedAt: string): FeedItem {
  const sentAt = iso(message.sent)
  const expiresAt = iso(message.expires)
  const effectiveAt = iso(message.effective) ?? iso(message.onset)
  const fetchedMs = Date.parse(fetchedAt)
  const expired = expiresAt !== undefined && Date.parse(expiresAt) <= fetchedMs
  const sentUsable = capSentUsable(message.sent, fetchedAt)
  const alertState: WeatherDetail["alertState"] = expired ? "expired" : sentAt && sentUsable && expiresAt ? "active" : "unknown"
  const eventEligibility = alertState === "active"
  const ownCodes = source.areaMatch === "polygon" ? [] : message.geocodes.filter(code => code.toUpperCase().startsWith(`${source.countryCode.toUpperCase()}-`))
  const polygonRegions = source.areaMatch === "polygon"
    ? [...new Set(message.areas.filter(area => area.polygons.length > 0).map(area => area.areaDesc).filter((value): value is string => Boolean(value)))]
    : []
  const relatedPortIds = source.areaMatch === "polygon"
    ? (source.polygonPorts ?? []).filter(port => message.areas.some(area => area.polygons.some(ring => pointInCapPolygon(port.latitude, port.longitude, ring)))).map(port => port.portId)
    : [...new Set(ownCodes.flatMap(code => capSubdivisionPorts[code.toUpperCase()] ?? []))]
  const regionLabel = source.areaMatch === "polygon" ? polygonRegions : ownCodes
  const severity = expired ? "info" : capSeverity(message.severity)
  const alertId = `${source.id}:${message.identifier}`
  const title = message.headline ?? message.event ?? message.identifier
  const summary = truncate((message.description ?? title).replace(/\s+/g, " ").trim())
  const sourceUrl = message.documentUrl ?? message.web ?? source.sourceUrl
  return {
    id: `weather-alert:${source.id}:${createHash("sha256").update(alertId).digest("hex").slice(0, 16)}`,
    sourceId: source.id,
    category: "weather",
    type: "weather_warning_official",
    title,
    summary: expired ? `${summary} 该官方预警已过期。` : summary,
    sourceUrl,
    canonicalUrl: sourceUrl,
    publishedAt: sentAt ?? "",
    publicationTimeKnown: Boolean(sentAt),
    effectiveAt,
    expiresAt,
    eventEligibility,
    severity,
    hotReason: eventEligibility && (severity === "warning" || severity === "critical") ? "官方天气预警" : undefined,
    tags: ["official", "weather_warning", "cap"],
    weather: {
      riskSource: "official",
      alertState,
      alertId,
      alertRegion: regionLabel.length ? regionLabel.join(", ") : undefined,
      alertIssuedAt: sentAt,
      alertEffectiveAt: effectiveAt,
      alertExpiresAt: expiresAt,
      alertUrgency: message.urgency,
      alertCertainty: message.certainty,
    },
    relatedPortIds,
    relatedVesselIds: [],
    updatedAt: sentAt,
    sourceUpdatedAt: sentAt,
    fetchedAt,
    stale: false,
    sourceStatus: "healthy",
    provenance: source.provenance,
  }
}

/** Resolve a batch of CAP messages (e.g. every document linked from the TMD index) into current feed items. */
export function resolveCapBatch(messages: readonly CapMessage[], source: CapSourceContext, fetchedAt: string): CapParseResult {
  const ignored: CapParseResult["ignored"] = []
  const actual = messages.filter((message) => {
    if (message.status !== "Actual") {
      ignored.push({ identifier: message.identifier, reason: `status_${message.status || "missing"}` })
      return false
    }
    if (!["Alert", "Update", "Cancel"].includes(message.msgType)) {
      ignored.push({ identifier: message.identifier, reason: `msgType_${message.msgType || "missing"}` })
      return false
    }
    return true
  })
  const retired = new Set<string>()
  for (const message of actual) {
    if (message.msgType !== "Update" && message.msgType !== "Cancel") continue
    if (!capSentUsable(message.sent, fetchedAt)) {
      ignored.push({ identifier: message.identifier, reason: "control_sent_missing_invalid_or_future" })
      continue
    }
    for (const key of message.references) retired.add(key)
  }
  const items: FeedItem[] = []
  for (const message of actual) {
    if (message.msgType === "Cancel") {
      ignored.push({ identifier: message.identifier, reason: "cancel_message" })
      continue
    }
    if (retired.has(capMessageKey(message.sender, message.identifier))) {
      ignored.push({ identifier: message.identifier, reason: "superseded_or_cancelled" })
      continue
    }
    items.push(capMessageToFeedItem(message, source, fetchedAt))
  }
  return { items, retiredKeys: [...retired], ignored }
}

/** The only place TMD CAP bodies may be fetched from (TH-W01). */
export const TMD_CAP_BODY_ORIGIN = "https://www.tmd.go.th"
export const TMD_CAP_BODY_PATH_PREFIX = "/uploads/CAP/en/"

/** Per-source CAP body allow-list (verified official host + path), same checks for every source. */
export const CAP_BODY_RULES: Readonly<Record<string, { origin: string, pathPattern: RegExp }>> = {
  tmd: { origin: TMD_CAP_BODY_ORIGIN, pathPattern: /^\/uploads\/CAP\/en\/[\w-]+\.xml$/ },
  // BMKG nowcast CAP bodies linked from https://www.bmkg.go.id/alerts/nowcast/en (verified 2026-10-10)
  bmkg: { origin: "https://www.bmkg.go.id", pathPattern: /^\/alerts\/nowcast\/en\/[A-Za-z0-9]+_alert\.xml$/ },
}

/** Why a CAP body URL is not allowed; undefined when allowed. Checked on the raw string before URL normalisation. */
export function capBodyUrlRejection(raw: string, sourceId = "tmd"): string | undefined {
  const rule = CAP_BODY_RULES[sourceId]
  if (!rule) return "no_body_rule"
  if (/\\|%2e|%2f|%5c|%00|\/\.{1,2}(?:\/|$)/i.test(raw)) return "path_disguise"
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return "unparseable"
  }
  if (url.protocol !== "https:") return "scheme"
  if (url.username || url.password) return "credentials"
  if (url.port !== "") return "port"
  if (url.origin !== rule.origin) return "host"
  if (url.search || url.hash) return "query_or_fragment"
  if (!rule.pathPattern.test(url.pathname)) return "path"
  if (url.href !== raw) return "non_canonical"
  return undefined
}

/**
 * CAP document links from the TMD RSS index (`/en/api/xml/CAP`). Any item without a link or with a link outside
 * https://www.tmd.go.th/uploads/CAP/en/ is a structural anomaly and throws — it is never filtered into "no alerts".
 */
export function capIndexLinks(xml: string, limit = 20, sourceId = "tmd", overflow: "truncate" | "anomaly" = "truncate"): string[] {
  const parsed = capParser.parse(xml) as { rss?: { channel?: { item?: unknown } } }
  const channel = parsed.rss?.channel
  if (!channel) throw new Error("cap_index_structural_anomaly: no RSS channel")
  const items = asArray(channel.item as Record<string, unknown> | Record<string, unknown>[] | undefined)
  if (overflow === "anomaly" && items.length > limit) throw new Error(`cap_index_structural_anomaly: ${items.length} items exceed limit ${limit}`)
  return items.slice(0, limit).map((item, index) => {
    const link = text(item.link)
    if (!link) throw new Error(`cap_index_structural_anomaly: item ${index} has no link`)
    const rejection = capBodyUrlRejection(link, sourceId)
    if (rejection) throw new Error(`cap_index_structural_anomaly: item ${index} body link rejected (${rejection})`)
    return link
  })
}

/** Previously stored item retired by an Update/Cancel in the current batch (identifier from `weather.alertId`). */
export function isRetiredBy(item: FeedItem, sourceId: string, retiredKeys: Iterable<string>): boolean {
  const alertId = item.weather?.alertId
  if (!alertId?.startsWith(`${sourceId}:`)) return false
  const identifier = capMessageKey("", alertId.slice(sourceId.length + 1)).slice(1)
  for (const key of retiredKeys) {
    if (key.slice(key.indexOf("|") + 1) === identifier) return true
  }
  return false
}
