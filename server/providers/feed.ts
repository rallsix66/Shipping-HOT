import { createHash } from "node:crypto"
import { XMLParser } from "fast-xml-parser"
import { load } from "cheerio"
import { type DataProvenance, type FeedCategory, type FeedFreshnessClass, type FeedItem, type Port, type SourceType, isMockProvenance } from "@shared/shipping"
import { mockFeedItems } from "@shared/shipping-fixtures"
import { applyFeedFreshnessPolicy } from "@shared/shipping-rules"
import { providerHttpError } from "#/providers/contracts"

export interface FeedProvider {
  getFeedItems: (lastKnown?: FeedItem[], ports?: Port[]) => Promise<FeedItem[]>
}

export interface FeedResponse {
  ok: boolean
  status: number
  text: () => Promise<string>
}

export type FeedFetcher = (url: string, init?: { signal?: AbortSignal }) => Promise<FeedResponse>

export interface ShippingFeedSource {
  id: string
  name: string
  url: string
  sourceUrl: string
  format: "rss" | "html"
  sourceKind: Extract<SourceType, "official" | "third_party">
  category: FeedCategory
  relatedPortIds?: string[]
  enabled: boolean
  freshnessPolicy?: FeedFreshnessClass
  status?: "enabled" | "registered_parser_pending" | "deferred" | "failed_live"
  description?: string
}

export const shippingFeedSources: ShippingFeedSource[] = [
  {
    id: "the-loadstar",
    name: "The Loadstar",
    url: "https://theloadstar.com/feed/",
    sourceUrl: "https://theloadstar.com/",
    format: "rss",
    sourceKind: "third_party",
    category: "shipping_news",
    freshnessPolicy: "ordinary",
    enabled: true,
  },
  {
    id: "maritime-executive",
    name: "The Maritime Executive",
    url: "https://maritime-executive.com/rss",
    sourceUrl: "https://maritime-executive.com/",
    format: "rss",
    sourceKind: "third_party",
    category: "shipping_news",
    freshnessPolicy: "ordinary",
    enabled: false,
    status: "failed_live",
    description: "Temporarily disabled after direct HTTPS connectivity failure; retain for future re-probe without slowing the public Feed.",
  },
  {
    id: "shekou-official",
    name: "Shekou Port operational notices",
    url: "https://www.portshekou.com/ywgg/",
    sourceUrl: "https://www.portshekou.com/ywgg/",
    format: "html",
    sourceKind: "official",
    category: "port_notice",
    freshnessPolicy: "official",
    relatedPortIds: ["port-shekou"],
    enabled: true,
    status: "enabled",
    description: "Official Shekou Port operational announcements; company news is excluded.",
  },
  {
    id: "laem-chabang-official",
    name: "Laem Chabang Port Authority",
    url: "https://www.port.co.th/",
    sourceUrl: "https://www.port.co.th/",
    format: "html",
    sourceKind: "official",
    category: "port_notice",
    freshnessPolicy: "official",
    relatedPortIds: ["port-laem-chabang"],
    enabled: false,
    status: "registered_parser_pending",
    description: "Registry entry; enable after the authority's announcement list format is confirmed.",
  },
  {
    id: "port-klang-official",
    name: "Port Klang Authority",
    url: "https://www.pka.gov.my/index.php/en/",
    sourceUrl: "https://www.pka.gov.my/index.php/en/",
    format: "html",
    sourceKind: "official",
    category: "port_notice",
    freshnessPolicy: "official",
    relatedPortIds: ["port-klang"],
    enabled: false,
    status: "registered_parser_pending",
    description: "Registry entry; enable after the authority's announcement list format is confirmed.",
  },
  {
    id: "yantian-official",
    name: "Yantian Port official notices",
    url: "https://www.yantian.gov.cn/",
    sourceUrl: "https://www.yantian.gov.cn/",
    format: "html",
    sourceKind: "official",
    category: "port_notice",
    freshnessPolicy: "official",
    relatedPortIds: ["port-yantian"],
    enabled: false,
    status: "deferred",
    description: "Deferred; no stable public announcement list source confirmed.",
  },
  {
    id: "nansha-official",
    name: "Nansha Port official notices",
    url: "https://www.gzns.gov.cn/",
    sourceUrl: "https://www.gzns.gov.cn/",
    format: "html",
    sourceKind: "official",
    category: "port_notice",
    freshnessPolicy: "official",
    relatedPortIds: ["port-nansha"],
    enabled: false,
    status: "deferred",
    description: "Deferred; no stable public announcement list source confirmed.",
  },
]

export function activeShippingFeedSourceIds(sources: ShippingFeedSource[] = shippingFeedSources): Set<string> {
  return new Set(sources
    .filter(source => source.enabled && (source.status === undefined || source.status === "enabled"))
    .map(source => source.id))
}

export const feedProvenances = {
  mock: { sourceType: "mock", dataNature: "reported", sourceId: "mock-port-notice", sourceUrl: "https://example.com/mock/feed", verified: false },
} as const satisfies Record<string, DataProvenance>

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
  if (!value) return ""
  return load(`<div>${value}</div>`).text().replace(/\s+/g, " ").trim()
}

function truncate(value: string, max = 280): string {
  return value.length <= max ? value : `${value.slice(0, max - 1).trimEnd()}…`
}

export function canonicalizeFeedUrl(value: string, base?: string): string | undefined {
  try {
    const url = new URL(value, base)
    if (!/^https?:$/i.test(url.protocol)) return undefined
    url.hash = ""
    for (const key of [...url.searchParams.keys()]) {
      if (/^(?:utm_|fbclid$|gclid$|mc_cid$|mc_eid$)/i.test(key)) url.searchParams.delete(key)
    }
    url.searchParams.sort()
    if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/, "")
    return url.toString()
  } catch {
    return undefined
  }
}

export function normalizeFeedTitle(value: string): string {
  return value.toLocaleLowerCase().normalize("NFKC").replace(/[^\p{L}\p{N}]+/gu, " ").trim()
}

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 16)
}

function parsedDate(value: unknown): string | undefined {
  const timestamp = typeof value === "string" || typeof value === "number" ? Date.parse(String(value)) : Number.NaN
  return Number.isNaN(timestamp) ? undefined : new Date(timestamp).toISOString()
}

function linkValue(value: unknown, base: string): string | undefined {
  const candidate = typeof value === "object" && value !== null
    ? textValue((value as Record<string, unknown>)["@_href"] ?? (value as Record<string, unknown>)["#text"])
    : textValue(value)
  return candidate ? canonicalizeFeedUrl(candidate, base) : undefined
}

function portMatches(text: string, source: ShippingFeedSource, ports: Port[]): string[] {
  const haystack = text.toLocaleLowerCase()
  const matched = new Set(source.relatedPortIds ?? [])
  for (const port of ports) {
    if ([port.id, port.name, port.nameEn, port.unlocode].some(value => haystack.includes(value.toLocaleLowerCase()))) matched.add(port.id)
  }
  return [...matched]
}

export function classifyFeedItem(title: string, summary: string, source: ShippingFeedSource, ports: Port[]): Pick<FeedItem, "severity" | "hotReason" | "relatedPortIds"> {
  const text = `${title} ${summary}`.toLocaleLowerCase()
  const criticalEnglish = /\b(?:closure|closed|suspend(?:ed|s)?|strike|typhoon|cyclone|collision|fire|explosion)\b/i.test(text)
  const criticalChinese = /事故|火灾|爆炸|台风|封港|关闭|停航|罢工/.test(text)
  const warningEnglish = /\b(?:blank sailing|port omission|omission|disrupt(?:ion|ed)?|congestion|gate|delay(?:ed)?|closure|warning|advisory)\b/i.test(text)
  const warningChinese = /拥堵|延误|跳港|停闸|暂停作业|中断|警告|部分闸口/.test(text)
  const critical = criticalEnglish || criticalChinese
  const warning = warningEnglish || warningChinese
  const relatedPortIds = portMatches(text, source, ports)
  if (critical) return { severity: "critical", hotReason: source.sourceKind === "official" && relatedPortIds.length ? "官方港口高影响公告" : "高影响航运预警", relatedPortIds }
  if (warning && (source.sourceKind === "official" || relatedPortIds.length > 0)) return { severity: "warning", hotReason: source.sourceKind === "official" ? "官方运营公告" : "明确运营影响信号", relatedPortIds }
  if (warning) return { severity: "watch", hotReason: undefined, relatedPortIds }
  return { severity: "info", hotReason: undefined, relatedPortIds }
}

interface RawFeedItem {
  title?: unknown
  summary?: unknown
  description?: unknown
  content?: unknown
  link?: unknown
  guid?: unknown
  id?: unknown
  pubDate?: unknown
  published?: unknown
  updated?: unknown
  created?: unknown
  effective?: unknown
  effectiveAt?: unknown
  expires?: unknown
  expiresAt?: unknown
  expiration?: unknown
}

function rawFeedItem(raw: RawFeedItem, source: ShippingFeedSource, ports: Port[], fetchedAt: string, fallbackIndex: number): FeedItem | undefined {
  const title = stripMarkup(textValue(raw.title))
  if (!title) return undefined
  const summary = truncate(stripMarkup(textValue(raw.summary) ?? textValue(raw.description) ?? textValue(raw.content))) || title
  const articleUrl = linkValue(raw.link, source.url) ?? linkValue(raw.guid, source.url) ?? linkValue(raw.id, source.url)
  const canonicalUrl = articleUrl ?? `${source.url}#${digest(normalizeFeedTitle(title))}`
  const publishedAt = parsedDate(raw.pubDate ?? raw.published ?? raw.created)
  const sourceUpdatedAt = parsedDate(raw.updated ?? raw.pubDate ?? raw.published ?? raw.created)
  const publicationTimeKnown = publishedAt !== undefined
  const classification = classifyFeedItem(title, summary, source, ports)
  const provenance: DataProvenance = {
    sourceType: source.sourceKind,
    dataNature: "reported",
    sourceId: source.id,
    sourceUrl: source.sourceUrl,
    verified: source.sourceKind === "official",
  }
  const item: FeedItem = {
    id: `feed:${source.id}:${digest(canonicalUrl || `${normalizeFeedTitle(title)}:${fallbackIndex}`)}`,
    sourceId: source.id,
    category: source.category,
    freshnessPolicy: source.freshnessPolicy,
    type: source.category === "port_notice" ? "port_notice" : "shipping_news",
    title,
    summary,
    sourceUrl: articleUrl ?? source.sourceUrl,
    canonicalUrl,
    publishedAt: publishedAt ?? "",
    publicationTimeKnown,
    effectiveAt: parsedDate(raw.effectiveAt ?? raw.effective),
    expiresAt: parsedDate(raw.expiresAt ?? raw.expires ?? raw.expiration),
    eventEligibility: publicationTimeKnown,
    severity: classification.severity,
    hotReason: classification.hotReason,
    relatedPortIds: classification.relatedPortIds,
    relatedVesselIds: [],
    relatedVoyageIds: [],
    tags: [source.sourceKind, source.category],
    updatedAt: sourceUpdatedAt,
    sourceUpdatedAt,
    fetchedAt,
    stale: false,
    sourceStatus: "healthy",
    provenance,
  }
  return applyFeedFreshnessPolicy(item, new Date(fetchedAt))
}

export function parseFeedRss(xml: string, source: ShippingFeedSource, ports: Port[] = [], fetchedAt = new Date().toISOString()): FeedItem[] {
  const parsed = parser.parse(xml) as Record<string, unknown>
  const rss = parsed.rss as Record<string, unknown> | undefined
  const feed = parsed.feed as Record<string, unknown> | undefined
  const channel = (rss?.channel ?? feed) as Record<string, unknown> | undefined
  if (!channel) throw new Error("RSS payload has no channel")
  const rawItems = asArray<RawFeedItem>(channel.item as RawFeedItem | RawFeedItem[] | undefined ?? channel.entry as RawFeedItem | RawFeedItem[] | undefined)
  return rawItems.slice(0, 30).map((item, index) => rawFeedItem(item, source, ports, fetchedAt, index)).filter((item): item is FeedItem => item !== undefined)
}

function htmlDate(text: string): string | undefined {
  const match = text.match(/\d{4}[-/]\d{1,2}[-/]\d{1,2}|\d{1,2}[-/]\d{1,2}[-/]\d{4}|\d{1,2}\s+[a-z]{3,9}\s+\d{4}/i)
  if (!match) return undefined
  const timestamp = Date.parse(match[0])
  return Number.isNaN(timestamp) ? undefined : new Date(timestamp).toISOString()
}

export function parseFeedHtml(html: string, source: ShippingFeedSource, ports: Port[] = [], fetchedAt = new Date().toISOString()): FeedItem[] {
  const $ = load(html)
  const items: FeedItem[] = []
  const anchors = source.id === "shekou-official" ? $("a[href*='/ywgg/']") : $("a[href]")
  anchors.each((index, element) => {
    const anchor = $(element)
    const title = anchor.text().replace(/\s+/g, " ").trim()
    const articleUrl = canonicalizeFeedUrl(anchor.attr("href") ?? "", source.url)
    if (!articleUrl || !title || title.length < 12 || title.length > 220 || articleUrl === canonicalizeFeedUrl(source.url)) return
    if (source.id === "shekou-official" && !new URL(articleUrl).pathname.includes("/ywgg/")) return
    const container = anchor.closest("article, li, .item, .news, .list")
    const context = container.text().replace(/\s+/g, " ").trim() || anchor.parent().text().replace(/\s+/g, " ").trim()
    const time = container.find("time").first()
    const dateValue = time.attr("datetime") ?? htmlDate(context)
    const item = rawFeedItem({ title, summary: context, link: articleUrl, pubDate: dateValue }, source, ports, fetchedAt, index)
    if (item) items.push(item)
  })
  return items.slice(0, 30)
}

function sourcePriority(item: FeedItem): number {
  return item.provenance?.sourceType === "official" ? 2 : item.provenance?.sourceType === "third_party" ? 1 : 0
}

function newer(a: FeedItem, b: FeedItem): FeedItem {
  const priorityDelta = sourcePriority(a) - sourcePriority(b)
  if (priorityDelta !== 0) return priorityDelta > 0 ? a : b
  const aTime = a.publicationTimeKnown === false || !a.publishedAt ? Number.NEGATIVE_INFINITY : Date.parse(a.publishedAt)
  const bTime = b.publicationTimeKnown === false || !b.publishedAt ? Number.NEGATIVE_INFINITY : Date.parse(b.publishedAt)
  return aTime >= bTime ? a : b
}

function publishedTime(item: FeedItem): number {
  if (item.publicationTimeKnown === false || !item.publishedAt) return Number.NEGATIVE_INFINITY
  const value = Date.parse(item.publishedAt)
  return Number.isNaN(value) ? Number.NEGATIVE_INFINITY : value
}

export function dedupeFeedItems(items: FeedItem[]): FeedItem[] {
  const byKey = new Map<string, FeedItem>()
  for (const item of items) {
    const urlKey = canonicalizeFeedUrl(item.canonicalUrl ?? item.sourceUrl)
    const keys = [urlKey ? `url:${urlKey}` : undefined, `title:${normalizeFeedTitle(item.title)}`].filter((key): key is string => Boolean(key))
    const existing = keys.map(key => byKey.get(key)).find((value): value is FeedItem => value !== undefined)
    const winner = existing ? newer(item, existing) : item
    if (existing && winner !== existing) {
      for (const [key, value] of byKey) {
        if (value === existing) byKey.delete(key)
      }
    }
    for (const key of keys) byKey.set(key, winner)
  }
  return [...new Set(byKey.values())].sort((a, b) => publishedTime(b) - publishedTime(a))
}

function markSourceFailed(item: FeedItem, fetchedAt: string, error: string): FeedItem {
  return applyFeedFreshnessPolicy({ ...item, stale: true, sourceStatus: "failed", error, fetchedAt }, new Date(fetchedAt))
}

export interface PublicFeedProviderOptions {
  fetcher?: FeedFetcher
  now?: () => Date
  sources?: ShippingFeedSource[]
  timeoutMs?: number
  throwOnSourceFailureWithoutLastKnown?: boolean
}

export const PUBLIC_FEED_TIMEOUT_MS = 10_000

async function withFeedSourceTimeout<T>(operation: (signal: AbortSignal) => Promise<T>, timeoutMs: number, sourceName: string): Promise<T> {
  const controller = new AbortController()
  let timedOut = false
  let timer: ReturnType<typeof setTimeout> | undefined
  let rejectTimeout: ((reason?: unknown) => void) | undefined
  try {
    return await Promise.race([
      operation(controller.signal),
      new Promise<T>((_, reject) => {
        rejectTimeout = reject
        timer = setTimeout(() => {
          timedOut = true
          controller.abort()
          rejectTimeout?.(new Error(`${sourceName} request timed out after ${timeoutMs}ms`))
        }, timeoutMs)
      }),
    ])
  } catch (error) {
    if (timedOut || controller.signal.aborted) throw new Error(`${sourceName} request timed out after ${timeoutMs}ms`)
    throw error
  } finally {
    if (timer) clearTimeout(timer)
  }
}

function publicFeedFetcher(): FeedFetcher {
  const fetchImplementation = globalThis.fetch
  if (!fetchImplementation) throw new Error("Fetch runtime is unavailable")
  return (url, init) => fetchImplementation(url, init)
}

export function createPublicFeedProvider(options: PublicFeedProviderOptions = {}): FeedProvider {
  const fetcher = options.fetcher ?? publicFeedFetcher()
  const now = options.now ?? (() => new Date())
  const sources = options.sources ?? shippingFeedSources
  const timeoutMs = Math.max(1, options.timeoutMs ?? PUBLIC_FEED_TIMEOUT_MS)
  return {
    async getFeedItems(lastKnown = [], ports: Port[] = []) {
      const fetchedAt = now().toISOString()
      const activeSourceIds = activeShippingFeedSourceIds(sources)
      const results = await Promise.all(sources.filter(source => activeSourceIds.has(source.id)).map(async (source) => {
        const previous = lastKnown.filter(item => item.sourceId === source.id)
        try {
          const parsed = await withFeedSourceTimeout(async (signal) => {
            const response = await fetcher(source.url, { signal })
            if (!response.ok) throw providerHttpError(source.name, response.status, `${source.name} request failed (${response.status})`)
            const body = await response.text()
            return source.format === "rss" ? parseFeedRss(body, source, ports, fetchedAt) : parseFeedHtml(body, source, ports, fetchedAt)
          }, timeoutMs, source.name)
          return parsed
        } catch (error) {
          const message = error instanceof Error ? error.message : `${source.name} feed failed`
          if (options.throwOnSourceFailureWithoutLastKnown && previous.length === 0) throw error
          return previous.map(item => markSourceFailed(item, fetchedAt, message))
        }
      }))
      return dedupeFeedItems(results.flat())
    },
  }
}

export const MockFeedProvider: FeedProvider = {
  async getFeedItems() {
    return mockFeedItems.filter(item => item.sourceId !== "mock-weather").map(item => applyFeedFreshnessPolicy(structuredClone(item), new Date()))
  },
}

export function createUnavailableFeedProvider(error: string): FeedProvider {
  return {
    async getFeedItems() {
      throw new Error(error)
    },
  }
}

export function filterFeedLastKnownForMode(items: FeedItem[], mode: string): FeedItem[] {
  return mode === "public"
    ? items.filter(item => activeShippingFeedSourceIds().has(item.sourceId) && !isMockProvenance(item.provenance))
    : mode === "mock" ? items.filter(item => item.sourceId === "mock-port-notice") : []
}

export function configureFeedProviders(environment: { SHIPPING_DATA_MODE?: string, SHIPPING_FEED_PROVIDER?: string } = {}) {
  const dataMode = environment.SHIPPING_DATA_MODE === "real" ? "real" : "mock"
  const mode = environment.SHIPPING_FEED_PROVIDER === "public" ? "public" : dataMode === "real" ? "unavailable" : "mock"
  return {
    provider: mode === "public" ? createPublicFeedProvider() : mode === "mock" ? MockFeedProvider : createUnavailableFeedProvider("Real Feed provider not configured"),
    modes: { feed: mode },
  }
}
