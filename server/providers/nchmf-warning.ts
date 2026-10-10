import { createHash } from "node:crypto"
import { load } from "cheerio"
import type { DataProvenance, FeedItem, OfficialNoticeRaw, WeatherDetail } from "@shared/shipping"

/**
 * VN-W01 NCHMF (Vietnam) official warning notices, limited integration (dots review 2026-10-10 17:14).
 *
 * Structure (docs/evidence/nchmf-warning-2026-10-10.md): server-rendered HTML. The pinned list page carries a
 * "Tin canh bao thien tai" block plus a general hydro-met block, each `ul.list-news > li > a[href*=-postNNNNN.html]`
 * with a `<label>(dd/mm/yyyy[ hh:mm:ss])</label>`. Articles: title `.content-news h2.tt-content-news`, body
 * `.content-news .text-content-news`. A non-existent post answers HTTP 200 with an EMPTY article.
 *
 * Bounds enforced here (zero inference):
 * - Only the pinned HTTPS list page and `-post<digits>.html` articles on the same host and path prefix are fetched;
 *   credentials, query strings, fragments, other hosts/paths, PDFs/images/scripts are rejected; redirects refused.
 *   Links are deduplicated by postId and capped at NCHMF_MAX_ARTICLES per run (the rest is reported as truncated).
 * - Identity = postId. Same postId with changed content updates the record and keeps the first-received time;
 *   a new postId is a new record. No update/replace/cancel relationship is inferred between posts.
 * - List time, body publish time and next-issue time are kept as RAW TEXT; next-issue time is not validity; no
 *   timezone is assumed. Lifecycle and validity are unknown; alertState "unknown"; eventEligibility false.
 * - The original risk level line ("cap do rui ro thien tai ... cap N") is shown verbatim as the original level; it is
 *   never mapped to CAP or system severity (`standardizedSeverity: "unmapped"`). Absent -> "not provided".
 * - No region parsing, no port association, no impact inference. "VN" is the issuing country only.
 * - Lost list structure is a contract failure (thrown). An empty article (200) is a per-article failure.
 *   Valid structure with zero matching titles means "none matched this filter", meaning unconfirmed.
 * - Coverage is limited to what the list page shows (newest ~10 per block) and the title filter; never national.
 */

export const NCHMF_LIST_URL = "https://www.nchmf.gov.vn/kttv/vi-VN/1/index.html"
export const NCHMF_HOST = "www.nchmf.gov.vn"
export const NCHMF_PATH_PREFIX = "/kttv/vi-VN/1/"
export const NCHMF_MAX_ARTICLES = 12
export const NCHMF_BODY_MAX_CHARS = 8000
export const NCHMF_NO_MATCH_ZH = "本次未发现符合筛选的记录，含义未确认"

const ARTICLE_PATH = /^\/kttv\/vi-VN\/1\/[^/?#]+-post(\d{1,12})\.html$/

export interface NchmfSourceContext {
  id: string
  listUrl: string
  provenance: DataProvenance
}

export interface NchmfListEntry {
  postId: string
  url: string
  title: string
  listTimeText: string | null
  inWarningBlock: boolean
}

export interface NchmfArticle {
  title: string
  bodyText: string
  bodyTruncated: boolean
  bodyPublishText: string | null
  nextIssueText: string | null
  originalLevelText: string | null
  originalLevel: string | null
}

export interface NchmfRunReport {
  sourceId: string
  listStatus: "ok" | "failed" | "structure_lost"
  linksSeen: number
  linksRejected: number
  candidates: number
  excluded: number
  truncated: number
  requested: number
  received: number
  failed: { postId: string, reason: string }[]
  created: number
  updated: number
  unchanged: number
  noMatchZh?: string
}

/** Vietnamese case/diacritic-insensitive key: NFD, strip combining marks, d-bar -> d, lowercase, single spaces. */
export function vnFold(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036F]/g, "").replace(/\u0111/g, "d").replace(/\u0110/g, "d").toLowerCase().replace(/\s+/g, " ").trim()
}

export function isPinnedNchmfListUrl(value: string | undefined): boolean {
  if (!value) return false
  try {
    const url = new URL(value)
    return url.href === NCHMF_LIST_URL && !url.username && !url.password && !url.search && !url.hash
  } catch {
    return false
  }
}

/** Returns the postId for an approved article URL, otherwise undefined. */
export function nchmfArticlePostId(value: string | undefined): string | undefined {
  if (!value) return undefined
  try {
    const url = new URL(value)
    if (url.protocol !== "https:" || url.host !== NCHMF_HOST || url.port || url.username || url.password || url.search || url.hash) return undefined
    const match = ARTICLE_PATH.exec(url.pathname)
    return match?.[1]
  } catch {
    return undefined
  }
}

const EXCLUDE = [/10 ngay/, /hang ngay/, /xu the/, /dac diem khi hau/]
const FAMILIES = [
  /^(ban )?tin canh bao/,
  /^tin du bao (gio manh|song lon|mua lon|bao|ap thap nhiet doi|trieu cuong|lu)/,
  /trieu cuong/,
]
const WARNING_BLOCK = /^tin canh bao thien tai$/

export function classifyNchmfTitle(title: string, inWarningBlock: boolean): "candidate" | "excluded" {
  const key = vnFold(title)
  if (!key || EXCLUDE.some(re => re.test(key))) return "excluded"
  if (inWarningBlock || FAMILIES.some(re => re.test(key))) return "candidate"
  return "excluded"
}

/** Headings whose blocks are read; anything else on the page (menus, sidebars, footer) is ignored. */
const LIST_BLOCKS = [WARNING_BLOCK, /^tin khi tuong thuy van$/]

function textOf(fragment: string): string {
  return load(`<div>${fragment}</div>`)("div").first().text().normalize("NFC").replace(/\s+/g, " ").trim()
}

export function parseNchmfList(html: string, listUrl = NCHMF_LIST_URL): { entries: NchmfListEntry[], linksSeen: number, linksRejected: number } {
  // The page markup is not well-formed enough for DOM nesting to be trusted, so blocks are cut at <h2>/<h3>/<h4>.
  const headingRe = /<h([234])\b[^>]*>([\s\S]*?)<\/h\1>/gi
  const heads: { key: string, start: number, end: number }[] = []
  for (let m = headingRe.exec(html); m; m = headingRe.exec(html)) heads.push({ key: vnFold(textOf(m[2])), start: m.index, end: m.index + m[0].length })
  const entries = new Map<string, NchmfListEntry>()
  let linksSeen = 0
  let linksRejected = 0
  let warningBlockLinks = 0
  heads.forEach((head, index) => {
    if (!LIST_BLOCKS.some(re => re.test(head.key))) return
    const inWarningBlock = WARNING_BLOCK.test(head.key)
    const segment = html.slice(head.end, heads[index + 1]?.start ?? html.length)
    if (!/class="[^"]*list-news/.test(segment)) return
    const anchorRe = /<a\s[^>]*href="([^"]*-post\d+\.html[^"]*)"[^>]*>([\s\S]*?)<\/a>/gi
    for (let a = anchorRe.exec(segment); a; a = anchorRe.exec(segment)) {
      linksSeen++
      if (inWarningBlock) warningBlockLinks++
      let absolute: string
      try {
        absolute = new URL(a[1].replace(/&amp;/g, "&"), listUrl).href
      } catch {
        linksRejected++
        continue
      }
      const postId = nchmfArticlePostId(absolute)
      if (!postId) {
        linksRejected++
        continue
      }
      const labelMatch = /<label\b[^>]*>([\s\S]*?)<\/label>/i.exec(a[2])
      const label = labelMatch ? textOf(labelMatch[1]) : ""
      const title = textOf(a[2].replace(/<label\b[\s\S]*?<\/label>/gi, ""))
      const existing = entries.get(postId)
      if (existing) {
        existing.inWarningBlock ||= inWarningBlock
        continue
      }
      entries.set(postId, { postId, url: absolute, title, listTimeText: label ? label.replace(/^\(|\)$/g, "").trim() : null, inWarningBlock })
    }
  })
  if (!warningBlockLinks) throw new Error("nchmf_contract: list structure lost (warning block / list-news links not found)")
  return { entries: [...entries.values()], linksSeen, linksRejected }
}

function cleanLine(line: string): string {
  return line.replace(/^[^\p{L}\p{N}]+/u, "").replace(/\s+/g, " ").trim()
}

export function parseNchmfArticle(html: string): NchmfArticle {
  const $ = load(html)
  const title = $(".content-news h2.tt-content-news").first().text().normalize("NFC").replace(/\s+/g, " ").trim()
  const body = $(".content-news .text-content-news").first()
  if (!title || !body.length) throw new Error("nchmf_article_empty: title or body container missing/empty")
  body.find("script, style, iframe, form, noscript, img, video, audio, object, embed").remove()
  body.find("br").replaceWith("\n")
  body.find("td, th").each((_, el) => {
    $(el).append(" | ")
  })
  body.find("p, div, h1, h2, h3, h4, h5, h6, li, tr, table").each((_, el) => {
    $(el).append("\n")
  })
  const lines = body.text().normalize("NFC").replace(/\u00A0/g, " ").split(/\n/).map(line => line.replace(/[ \t]+/g, " ").replace(/[\s|]+$/, "").trim()).filter(Boolean)
  const readable = lines.filter(line => !/^chi tiet tin$/.test(vnFold(line)) && vnFold(line) !== vnFold(title))
  if (!readable.length) throw new Error("nchmf_article_empty: body has no readable text")
  let bodyText = readable.join("\n")
  const bodyTruncated = bodyText.length > NCHMF_BODY_MAX_CHARS
  if (bodyTruncated) bodyText = bodyText.slice(0, NCHMF_BODY_MAX_CHARS)
  const find = (test: (key: string) => boolean) => {
    const line = readable.find(l => test(vnFold(l)))
    return line ? cleanLine(line) : null
  }
  const nextIssueText = find(key => /tin phat tiep theo|ban tin tiep theo|tin tiep theo/.test(key))
  const bodyPublishText = find(key => /tin phat luc/.test(key) && !/tiep theo/.test(key))
  const originalLevelText = find(key => /cap do rui ro thien tai/.test(key) && /cap \d/.test(key.replace(/cap do/g, "")))
  let originalLevel: string | null = null
  if (originalLevelText) {
    const idx = originalLevelText.lastIndexOf(":")
    originalLevel = (idx >= 0 ? originalLevelText.slice(idx + 1) : originalLevelText).replace(/[.\s]+$/, "").trim() || null
  }
  return { title, bodyText, bodyTruncated, bodyPublishText, nextIssueText, originalLevelText, originalLevel }
}

export function nchmfContentHash(article: NchmfArticle, listTimeText: string | null): string {
  return createHash("sha256").update(JSON.stringify([article.title, article.bodyText, listTimeText, article.bodyPublishText, article.nextIssueText, article.originalLevelText])).digest("hex").slice(0, 16)
}

function excerpt(value: string, max = 300): string {
  const flat = value.replace(/\s+/g, " ").trim()
  return flat.length <= max ? flat : `${flat.slice(0, max - 1).trimEnd()}…`
}

export function nchmfSummaryZh(article: NchmfArticle): string {
  const level = article.originalLevel
    ? `原文风险级别：${article.originalLevel}（原始级别，标准化严重度未映射）`
    : "原文风险级别：未提供"
  return `已接收 NCHMF（越南）官方预警原文记录：生命周期未知（不推断更新/取代/取消），时区未确认，未关联港口，无影响推断。${level}。原文：${excerpt(article.bodyText)}`
}

export function buildNchmfFeedItem(entry: NchmfListEntry, article: NchmfArticle, source: NchmfSourceContext, fetchedAt: string, previous?: FeedItem): { item: FeedItem, change: "created" | "updated" | "unchanged" } {
  const contentHash = nchmfContentHash(article, entry.listTimeText)
  const prevRaw = previous?.weather?.noticeRaw
  const firstReceivedAt = prevRaw?.firstReceivedAt ?? previous?.publishedAt ?? fetchedAt
  const change = !previous ? "created" : prevRaw?.contentHash === contentHash ? "unchanged" : "updated"
  const contentUpdatedAt = change === "updated" ? fetchedAt : prevRaw?.contentUpdatedAt
  const noticeRaw: OfficialNoticeRaw = {
    postId: entry.postId,
    title: article.title,
    listTitle: entry.title,
    listTimeText: entry.listTimeText,
    bodyPublishText: article.bodyPublishText,
    nextIssueText: article.nextIssueText,
    originalLevelText: article.originalLevelText,
    bodyText: article.bodyText,
    bodyTruncated: article.bodyTruncated,
    contentHash,
    sourceUrl: entry.url,
    listUrl: source.listUrl,
    fetchedAt,
    firstReceivedAt,
    ...(contentUpdatedAt ? { contentUpdatedAt } : {}),
  }
  const weather: WeatherDetail = {
    riskSource: "official",
    alertState: "unknown",
    alertId: `${source.id}:${entry.postId}`,
    validityStatus: "unknown",
    timezoneStatus: "unconfirmed",
    lifecycleStatus: "unknown",
    timeBasis: "received_at",
    standardizedSeverity: "unmapped",
    ...(article.originalLevel ? { originalRiskLevel: article.originalLevel } : { officialSeverity: "not_provided" as const }),
    noticeRaw,
  }
  const item: FeedItem = {
    id: `weather-alert:${source.id}:${entry.postId}`,
    sourceId: source.id,
    category: "weather",
    freshnessPolicy: "official",
    type: "weather_warning_official",
    title: article.title,
    summary: nchmfSummaryZh(article),
    sourceUrl: entry.url,
    canonicalUrl: entry.url,
    publishedAt: firstReceivedAt,
    publicationTimeKnown: true,
    eventEligibility: false,
    severity: "info",
    tags: [
      "official",
      "issuing_country_VN",
      "lifecycle_unknown",
      "validity_pending_confirmation",
      "timezone_unconfirmed",
      article.originalLevel ? "original_risk_level_present" : "official_severity_not_provided",
      "standardized_severity_unmapped",
      "no_port_association",
    ],
    weather,
    relatedPortIds: [],
    relatedVesselIds: [],
    updatedAt: fetchedAt,
    fetchedAt,
    stale: false,
    sourceStatus: "healthy",
    provenance: source.provenance,
  }
  return { item, change }
}

export interface NchmfResponse {
  ok: boolean
  status: number
  redirected?: boolean
  url?: string
  text: () => Promise<string>
}
export type NchmfFetcher = (url: string, init?: { redirect?: "error" | "manual" | "follow" }) => Promise<NchmfResponse>

function markArticleFailed(item: FeedItem, fetchedAt: string, reason: string): FeedItem {
  return { ...item, stale: true, sourceStatus: "degraded", error: `nchmf_article_fetch_failed: ${reason}`, fetchedAt }
}

function markNotListed(item: FeedItem, fetchedAt: string): FeedItem {
  return { ...item, eventEligibility: false, stale: true, sourceStatus: "degraded", error: "warning_missing_from_current_index", fetchedAt }
}

/**
 * Article phase after the list page was fetched (list fetch errors are handled by the caller as a source failure).
 * Never clears previous records: not-listed or failed ones are carried forward as degraded.
 */
export async function collectNchmfNotices(listHtml: string, fetcher: NchmfFetcher, source: NchmfSourceContext, fetchedAt: string, previous: FeedItem[] = []): Promise<{ items: FeedItem[], report: NchmfRunReport }> {
  const report: NchmfRunReport = { sourceId: source.id, listStatus: "ok", linksSeen: 0, linksRejected: 0, candidates: 0, excluded: 0, truncated: 0, requested: 0, received: 0, failed: [], created: 0, updated: 0, unchanged: 0 }
  let list: ReturnType<typeof parseNchmfList>
  try {
    list = parseNchmfList(listHtml, source.listUrl)
  } catch (error) {
    report.listStatus = "structure_lost"
    const wrapped = error instanceof Error ? error : new Error(String(error))
    ;(wrapped as Error & { nchmfReport?: NchmfRunReport }).nchmfReport = report
    throw wrapped
  }
  report.linksSeen = list.linksSeen
  report.linksRejected = list.linksRejected
  const candidates = list.entries.filter(entry => classifyNchmfTitle(entry.title, entry.inWarningBlock) === "candidate")
  report.excluded = list.entries.length - candidates.length
  report.candidates = candidates.length
  const selected = candidates.slice(0, NCHMF_MAX_ARTICLES)
  report.truncated = candidates.length - selected.length
  const previousById = new Map(previous.map(item => [item.id, item]))
  const out = new Map<string, FeedItem>()
  for (const entry of selected) {
    const id = `weather-alert:${source.id}:${entry.postId}`
    const prior = previousById.get(id)
    report.requested++
    try {
      const response = await fetcher(entry.url, { redirect: "error" })
      if (response.redirected || (response.url && response.url !== entry.url)) throw new Error("redirect rejected")
      if (!response.ok) throw new Error(`http ${response.status}`)
      const article = parseNchmfArticle(await response.text())
      const built = buildNchmfFeedItem(entry, article, source, fetchedAt, prior)
      report.received++
      report[built.change]++
      out.set(id, built.item)
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      report.failed.push({ postId: entry.postId, reason })
      if (prior) out.set(id, markArticleFailed(prior, fetchedAt, reason))
    }
  }
  if (report.candidates === 0) report.noMatchZh = NCHMF_NO_MATCH_ZH
  if (report.requested > 0 && report.received === 0) {
    // Every selected article failed: a source failure, never "zero matches". The caller keeps prior records (failed).
    const error = new Error(`nchmf_articles_all_failed: received 0/${report.requested}; failed postIds ${report.failed.map(f => f.postId).join(",")}`) as Error & { nchmfReport?: NchmfRunReport }
    error.nchmfReport = report
    throw error
  }
  for (const item of previous) {
    if (!out.has(item.id)) out.set(item.id, markNotListed(item, fetchedAt))
  }
  return { items: [...out.values()], report }
}
