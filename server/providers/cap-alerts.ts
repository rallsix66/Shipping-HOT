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
 */

export interface CapSourceContext {
  id: string
  name: string
  sourceUrl: string
  /** ISO 3166-1 alpha-2 country of the issuing agency (from docs/intel-source-catalog.md). */
  countryCode: string
  provenance: DataProvenance
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
  documentUrl?: string
}

export interface CapParseResult {
  items: FeedItem[]
  /** Normalised keys of messages retired by Update/Cancel in this batch (sender|identifier). */
  retiredKeys: string[]
  ignored: { identifier: string, reason: string }[]
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
  const alertState: WeatherDetail["alertState"] = expired ? "expired" : sentAt && expiresAt ? "active" : "unknown"
  const eventEligibility = alertState === "active"
  const ownCodes = message.geocodes.filter(code => code.toUpperCase().startsWith(`${source.countryCode.toUpperCase()}-`))
  const relatedPortIds = [...new Set(ownCodes.flatMap(code => capSubdivisionPorts[code.toUpperCase()] ?? []))]
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
      alertRegion: ownCodes.length ? ownCodes.join(", ") : undefined,
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
    if (message.msgType === "Update" || message.msgType === "Cancel") {
      for (const key of message.references) retired.add(key)
    }
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

/** CAP document links from an RSS index (TMD `/en/api/xml/CAP`). */
export function capIndexLinks(xml: string, limit = 20): string[] {
  const parsed = capParser.parse(xml) as { rss?: { channel?: { item?: unknown } } }
  const channel = parsed.rss?.channel
  if (!channel) throw new Error("CAP index payload has no RSS channel")
  return asArray(channel.item as Record<string, unknown> | Record<string, unknown>[] | undefined)
    .map(item => text(item.link))
    .filter((link): link is string => Boolean(link && /^https:\/\//i.test(link)))
    .slice(0, limit)
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
