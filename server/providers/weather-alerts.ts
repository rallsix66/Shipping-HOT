import { createHash } from "node:crypto"
import { XMLParser } from "fast-xml-parser"
import { load } from "cheerio"
import type { DataProvenance, FeedItem, Port, WeatherDetail } from "@shared/shipping"
import { mockPorts } from "@shared/shipping-fixtures"

export interface WeatherAlertProvider {
  getFeedItems: (lastKnown?: FeedItem[], ports?: Port[]) => Promise<FeedItem[]>
}

export interface WeatherAlertResponse {
  ok: boolean
  status: number
  text: () => Promise<string>
}

export type WeatherAlertFetcher = (url: string) => Promise<WeatherAlertResponse>
export type WeatherAlertParser = "jma" | "tmd" | "bmkg"

export interface WeatherAlertSource {
  id: string
  name: string
  url: string
  sourceUrl: string
  format: "rss" | "html"
  parser: WeatherAlertParser
  relatedPortIds?: string[]
  enabled: boolean
  liveStatus?: "source_specific_contract" | "live_parser_pending"
}

export const officialWeatherAlertSources: WeatherAlertSource[] = [
  {
    id: "jma",
    name: "Japan Meteorological Agency",
    url: "https://www.jma.go.jp/bosai/information/typhoon.html",
    sourceUrl: "https://www.jma.go.jp/bosai/seawarning/",
    format: "html",
    parser: "jma",
    enabled: true,
    liveStatus: "source_specific_contract",
  },
  {
    id: "tmd",
    name: "Thai Meteorological Department",
    url: "https://www.tmd.go.th/warningpage",
    sourceUrl: "https://www.tmd.go.th/en/service/rss",
    format: "html",
    parser: "tmd",
    relatedPortIds: ["port-laem-chabang"],
    enabled: true,
    liveStatus: "source_specific_contract",
  },
  {
    id: "bmkg",
    name: "Indonesia Agency for Meteorology, Climatology and Geophysics",
    url: "https://www.bmkg.go.id/cuaca/peringatan-dini-cuaca",
    sourceUrl: "https://www.bmkg.go.id/cuaca/peringatan-dini-cuaca",
    format: "html",
    parser: "bmkg",
    relatedPortIds: ["port-jakarta"],
    enabled: true,
    liveStatus: "source_specific_contract",
  },
]

export function weatherAlertProvenance(source: WeatherAlertSource): DataProvenance {
  return { sourceType: "official", dataNature: "reported", sourceId: source.id, sourceUrl: source.sourceUrl, verified: true }
}

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_" })

function asArray<T>(value: T | T[] | undefined): T[] {
  return value === undefined ? [] : Array.isArray(value) ? value : [value]
}

function textValue(value: unknown): string | undefined {
  if (typeof value === "string" || typeof value === "number") return String(value).trim() || undefined
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>
    return textValue(record["#text"] ?? record.__cdata ?? record.value)
  }
  return undefined
}

function stripMarkup(value: string | undefined): string {
  return value ? load(`<div>${value}</div>`).text().replace(/\s+/g, " ").trim() : ""
}

function truncate(value: string, max = 320): string {
  return value.length <= max ? value : `${value.slice(0, max - 1).trimEnd()}…`
}

function canonicalUrl(value: string, base: string): string | undefined {
  try {
    const url = new URL(value, base)
    if (!/^https?:$/i.test(url.protocol)) return undefined
    url.hash = ""
    return url.toString()
  } catch {
    return undefined
  }
}

function timestamp(value: unknown): string | undefined {
  const parsed = typeof value === "string" || typeof value === "number" ? Date.parse(String(value)) : Number.NaN
  return Number.isNaN(parsed) ? undefined : new Date(parsed).toISOString()
}

function textDate(value: string): string | undefined {
  const match = value.match(/\b(?:\d{4}[-/]\d{1,2}[-/]\d{1,2}(?:[ T]\d{1,2}:\d{2}(?::\d{2})?(?:Z|[+-]\d{2}:?\d{2})?)?|\d{1,2}\s+[A-Za-z]{3,9}\s+\d{4})\b/)
  return match ? timestamp(match[0]) : undefined
}

function relatedPorts(text: string, source: WeatherAlertSource, ports: Port[]): string[] {
  const haystack = text.toLocaleLowerCase()
  const result = new Set(source.relatedPortIds ?? [])
  for (const port of ports) {
    if ([port.name, port.nameEn, port.unlocode].some(value => haystack.includes(value.toLocaleLowerCase()))) result.add(port.id)
  }
  return [...result]
}

function severityFor(title: string, summary: string, value?: string): FeedItem["severity"] {
  const explicit = value?.toLocaleLowerCase()
  if (explicit === "critical" || explicit === "extreme") return "critical"
  if (explicit === "warning" || explicit === "severe") return "warning"
  if (explicit === "watch" || explicit === "advisory") return "watch"
  const text = `${title} ${summary}`
  return /typhoon|cyclone|hurricane|storm|gale|red alert|extreme|台风|热带气旋|暴雨|强风|警报/i.test(text) ? "warning" : "watch"
}

interface RawAlert {
  title?: unknown
  summary?: unknown
  description?: unknown
  link?: unknown
  guid?: unknown
  pubDate?: unknown
  published?: unknown
  updated?: unknown
  issuedAt?: unknown
  expiresAt?: unknown
  severity?: unknown
  region?: unknown
  active?: boolean
}

function linkValue(value: unknown, base: string): string | undefined {
  const candidate = typeof value === "object" && value !== null
    ? textValue((value as Record<string, unknown>)["@_href"] ?? (value as Record<string, unknown>)["#text"])
    : textValue(value)
  return candidate ? canonicalUrl(candidate, base) : undefined
}

function normalizeAlert(raw: RawAlert, source: WeatherAlertSource, ports: Port[], fetchedAt: string, index: number): FeedItem | undefined {
  const title = stripMarkup(textValue(raw.title))
  if (!title) return undefined
  const summary = truncate(stripMarkup(textValue(raw.summary) ?? textValue(raw.description))) || title
  const sourceUrl = linkValue(raw.link, source.url) ?? linkValue(raw.guid, source.url) ?? source.sourceUrl
  const issuedAt = timestamp(raw.issuedAt ?? raw.pubDate ?? raw.published ?? raw.updated)
  const expiresAt = timestamp(raw.expiresAt)
  const isExpired = expiresAt !== undefined && Date.parse(expiresAt) <= Date.parse(fetchedAt)
  const alertState: WeatherDetail["alertState"] = isExpired ? "expired" : raw.active ? "active" : "unknown"
  const eventEligibility = Boolean(issuedAt || raw.active) && !isExpired
  const severity = isExpired ? "info" : severityFor(title, summary, textValue(raw.severity))
  const region = textValue(raw.region)
  const sourceId = `${source.id}:${sourceUrl ?? `${title}:${index}`}`
  const weather: WeatherDetail = { riskSource: "official", alertState, alertId: sourceId, alertRegion: region, alertIssuedAt: issuedAt, alertExpiresAt: expiresAt }
  const provenance = weatherAlertProvenance(source)
  return {
    id: `weather-alert:${source.id}:${createHash("sha256").update(sourceId).digest("hex").slice(0, 16)}`,
    sourceId: source.id,
    category: "weather",
    type: "weather_warning_official",
    title,
    summary: isExpired ? `${summary} 该官方预警已过期。` : summary,
    sourceUrl,
    canonicalUrl: sourceUrl,
    publishedAt: issuedAt ?? "",
    publicationTimeKnown: Boolean(issuedAt),
    eventEligibility,
    severity,
    hotReason: eventEligibility && (severity === "warning" || severity === "critical") ? "官方天气预警" : undefined,
    tags: ["official", "weather_warning"],
    weather,
    relatedPortIds: relatedPorts(`${title} ${summary} ${region ?? ""}`, source, ports),
    relatedVesselIds: [],
    relatedVoyageIds: [],
    updatedAt: issuedAt,
    sourceUpdatedAt: issuedAt,
    fetchedAt,
    stale: false,
    sourceStatus: "healthy",
    provenance,
  }
}

export function parseWeatherAlertRss(xml: string, source: WeatherAlertSource, ports: Port[] = mockPorts, fetchedAt = new Date().toISOString()): FeedItem[] {
  const parsed = parser.parse(xml) as Record<string, unknown>
  const rss = parsed.rss as Record<string, unknown> | undefined
  const feed = parsed.feed as Record<string, unknown> | undefined
  const channel = (rss?.channel ?? feed) as Record<string, unknown> | undefined
  if (!channel) throw new Error("Weather alert RSS payload has no channel")
  const rawItems = asArray<RawAlert>(channel.item as RawAlert | RawAlert[] | undefined ?? channel.entry as RawAlert | RawAlert[] | undefined)
  return rawItems.slice(0, 20).map((item, index) => normalizeAlert(item, source, ports, fetchedAt, index)).filter((item): item is FeedItem => item !== undefined)
}

function parseSourceSpecificNodes(html: string, source: WeatherAlertSource, selectors: string[], ports: Port[], fetchedAt: string): FeedItem[] {
  const $ = load(html)
  const seen = new Set<string>()
  const items: FeedItem[] = []
  $(selectors.join(",")).each((index, element) => {
    const node = $(element)
    const title = node.find("h1,h2,h3,h4,strong,a").first().text().replace(/\s+/g, " ").trim() || node.text().replace(/\s+/g, " ").trim()
    if (!title || title.length < 5 || seen.has(title)) return
    const summary = node.find("p,.summary,.description,td").first().text().replace(/\s+/g, " ").trim() || title
    const time = node.find("time").first()
    const times = node.find("time").toArray().map(item => timestamp($(item).attr("datetime")) ?? textDate($(item).text())).filter((value): value is string => value !== undefined)
    const item = normalizeAlert({
      title,
      summary,
      link: node.find("a[href]").first().attr("href"),
      issuedAt: timestamp(time.attr("datetime")) ?? textDate(time.text()) ?? textDate(node.text()),
      expiresAt: times[1],
      severity: node.attr("data-severity") ?? node.find("[data-severity]").first().attr("data-severity"),
      region: node.attr("data-region") ?? node.find(".region,.area,td").first().text(),
      active: true,
    }, source, ports, fetchedAt, index)
    if (item) {
      seen.add(title)
      items.push(item)
    }
  })
  return items.slice(0, 20)
}

export function parseJmaWarning(html: string, source: WeatherAlertSource, ports: Port[] = mockPorts, fetchedAt = new Date().toISOString()): FeedItem[] {
  return parseSourceSpecificNodes(html, source, ["#contents table tbody tr", "main table tbody tr", ".jma-information-list li"], ports, fetchedAt)
}

export function parseTmdWarning(html: string, source: WeatherAlertSource, ports: Port[] = mockPorts, fetchedAt = new Date().toISOString()): FeedItem[] {
  return parseSourceSpecificNodes(html, source, [".warning-list .warning-item", ".warning-list article", ".warning-card", "main table tbody tr"], ports, fetchedAt)
}

export function parseBmkgWarning(html: string, source: WeatherAlertSource, ports: Port[] = mockPorts, fetchedAt = new Date().toISOString()): FeedItem[] {
  return parseSourceSpecificNodes(html, source, [".table-responsive table tbody tr", ".warning-table tbody tr", ".warning-card"], ports, fetchedAt)
}

export function parseWeatherAlertHtml(html: string, source: WeatherAlertSource, ports: Port[] = mockPorts, fetchedAt = new Date().toISOString()): FeedItem[] {
  if (source.parser === "jma") return parseJmaWarning(html, source, ports, fetchedAt)
  if (source.parser === "tmd") return parseTmdWarning(html, source, ports, fetchedAt)
  return parseBmkgWarning(html, source, ports, fetchedAt)
}

function markFailed(item: FeedItem, fetchedAt: string, error: string): FeedItem {
  return { ...item, stale: true, sourceStatus: "failed", error, fetchedAt }
}

function expiredAsInfo(item: FeedItem, fetchedAt: string): FeedItem {
  return {
    ...item,
    severity: "info",
    hotReason: undefined,
    summary: `${item.summary} 官方来源已不再列出该预警。`,
    weather: item.weather ? { ...item.weather, alertState: "expired" } : item.weather,
    eventEligibility: false,
    fetchedAt,
    stale: false,
    sourceStatus: "healthy",
    error: undefined,
  }
}

export interface OfficialWeatherAlertProviderOptions {
  fetcher?: WeatherAlertFetcher
  now?: () => Date
  sources?: WeatherAlertSource[]
}

function defaultFetcher(): WeatherAlertFetcher {
  const fetchImplementation = (globalThis as typeof globalThis & { fetch?: WeatherAlertFetcher }).fetch
  if (!fetchImplementation) throw new Error("Fetch runtime is unavailable")
  return fetchImplementation
}

function publishedTime(item: FeedItem): number {
  if (item.publicationTimeKnown === false || !item.publishedAt) return Number.NEGATIVE_INFINITY
  const value = Date.parse(item.publishedAt)
  return Number.isNaN(value) ? Number.NEGATIVE_INFINITY : value
}

export function createOfficialWeatherAlertProvider(options: OfficialWeatherAlertProviderOptions = {}): WeatherAlertProvider {
  const fetcher = options.fetcher ?? defaultFetcher()
  const now = options.now ?? (() => new Date())
  const sources = options.sources ?? officialWeatherAlertSources
  return {
    async getFeedItems(lastKnown = [], ports = mockPorts) {
      const fetchedAt = now().toISOString()
      const results = await Promise.all(sources.filter(source => source.enabled).map(async (source) => {
        const previous = lastKnown.filter(item => item.sourceId === source.id)
        try {
          const response = await fetcher(source.url)
          if (!response.ok) throw new Error(`${source.name} request failed (${response.status})`)
          const body = await response.text()
          const parsed = source.format === "rss" ? parseWeatherAlertRss(body, source, ports, fetchedAt) : parseWeatherAlertHtml(body, source, ports, fetchedAt)
          const activeIds = new Set(parsed.map(item => item.id))
          const cleared = previous.filter(item => (item.severity === "warning" || item.severity === "critical") && !activeIds.has(item.id)).map(item => expiredAsInfo(item, fetchedAt))
          return [...parsed, ...cleared]
        } catch (error) {
          return previous.map(item => markFailed(item, fetchedAt, error instanceof Error ? error.message : `${source.name} failed`))
        }
      }))
      const byId = new Map<string, FeedItem>()
      for (const item of results.flat()) byId.set(item.id, item)
      return [...byId.values()].sort((a, b) => publishedTime(b) - publishedTime(a))
    },
  }
}
