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

export interface WeatherAlertSource {
  id: string
  name: string
  url: string
  sourceUrl: string
  format: "rss" | "html"
  relatedPortIds?: string[]
  enabled: boolean
}

export const officialWeatherAlertSources: WeatherAlertSource[] = [
  {
    id: "jma",
    name: "Japan Meteorological Agency",
    url: "https://www.jma.go.jp/bosai/information/typhoon.html",
    sourceUrl: "https://www.jma.go.jp/jma/indexe.html",
    format: "html",
    enabled: true,
  },
  {
    id: "tmd",
    name: "Thai Meteorological Department",
    url: "https://www.tmd.go.th/warningpage",
    sourceUrl: "https://tmd.go.th/warning-and-events",
    format: "html",
    relatedPortIds: ["port-laem-chabang"],
    enabled: true,
  },
  {
    id: "bmkg",
    name: "Indonesia Agency for Meteorology, Climatology and Geophysics",
    url: "https://www.bmkg.go.id/cuaca/peringatan-dini-cuaca",
    sourceUrl: "https://www.bmkg.go.id/cuaca/peringatan-dini-cuaca",
    format: "html",
    relatedPortIds: ["port-jakarta"],
    enabled: true,
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

function timestamp(value: unknown, fallback: string): string {
  const parsed = typeof value === "string" || typeof value === "number" ? Date.parse(String(value)) : Number.NaN
  return Number.isNaN(parsed) ? fallback : new Date(parsed).toISOString()
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
  const issuedAt = timestamp(raw.issuedAt ?? raw.pubDate ?? raw.published ?? raw.updated, fetchedAt)
  const expiresAtText = textValue(raw.expiresAt)
  const expiresAt = expiresAtText ? timestamp(expiresAtText, fetchedAt) : undefined
  const severity = severityFor(title, summary, textValue(raw.severity))
  const region = textValue(raw.region)
  const sourceId = `${source.id}:${sourceUrl ?? `${title}:${index}`}`
  const weather: WeatherDetail = {
    riskSource: "official",
    alertId: sourceId,
    alertRegion: region,
    alertIssuedAt: issuedAt,
    alertExpiresAt: expiresAt,
  }
  const provenance = weatherAlertProvenance(source)
  return {
    id: `weather-alert:${source.id}:${createHash("sha256").update(sourceId).digest("hex").slice(0, 16)}`,
    sourceId: source.id,
    category: "weather",
    type: "weather_warning_official",
    title,
    summary,
    sourceUrl,
    canonicalUrl: sourceUrl,
    publishedAt: issuedAt,
    severity,
    hotReason: severity === "warning" || severity === "critical" ? "官方天气预警" : undefined,
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

export function parseWeatherAlertHtml(html: string, source: WeatherAlertSource, ports: Port[] = mockPorts, fetchedAt = new Date().toISOString()): FeedItem[] {
  const $ = load(html)
  const items: FeedItem[] = []
  $("[data-weather-warning]").each((index, element) => {
    const node = $(element)
    const title = node.attr("data-title") ?? node.find("h1,h2,h3,a").first().text()
    const summary = node.attr("data-summary") ?? node.find("p,.summary").first().text()
    const item = normalizeAlert({
      title,
      summary,
      link: node.attr("data-url") ?? node.find("a[href]").first().attr("href"),
      issuedAt: node.attr("data-issued-at"),
      expiresAt: node.attr("data-expires-at"),
      severity: node.attr("data-severity"),
      region: node.attr("data-region"),
    }, source, ports, fetchedAt, index)
    if (item) items.push(item)
  })
  return items.slice(0, 20)
}

function markFailed(item: FeedItem, fetchedAt: string, error: string): FeedItem {
  return { ...item, stale: true, sourceStatus: "failed", error, fetchedAt }
}

function expiredAsInfo(item: FeedItem, fetchedAt: string): FeedItem {
  return {
    ...item,
    severity: "info",
    hotReason: undefined,
    summary: `${item.summary} 该官方预警已过期。`,
    updatedAt: fetchedAt,
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
          return [...parsed, ...previous.filter(item => item.weather?.alertExpiresAt && Date.parse(item.weather.alertExpiresAt) <= Date.parse(fetchedAt) && !activeIds.has(item.id)).map(item => expiredAsInfo(item, fetchedAt))]
        } catch (error) {
          return previous.map(item => markFailed(item, fetchedAt, error instanceof Error ? error.message : `${source.name} failed`))
        }
      }))
      const byId = new Map<string, FeedItem>()
      for (const item of results.flat()) byId.set(item.id, item)
      return [...byId.values()].sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt))
    },
  }
}
