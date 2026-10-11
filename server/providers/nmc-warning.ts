import { createHash } from "node:crypto"
import { load } from "cheerio"
import type { CnNoticeRaw, DataProvenance, FeedItem, WeatherDetail } from "@shared/shipping"

/**
 * CN-W01 / CN-W02 China Meteorological Administration NMC official products, limited integration
 * (dots approved 76b39fc, 2026-10-11). Evidence: docs/evidence/nmc-warning-2026-10-11.md.
 *
 * Bounds (zero inference):
 * - Only the six exact page URLs verified read-only are fetched, one plain GET each (<= 6 per run), redirects refused.
 *   No column wildcards, no link expansion, no `/f/rest/getContent`, no headless browser, images, scripts or PDFs.
 * - Body = `#text` > div.title / div.author | div.number + div.ctitle / div.writing, executable and media nodes stripped,
 *   kept as plain text. Raw colour level, typhoon intensity and centre position are kept separately as raw text and
 *   never converted to a system severity or port coverage.
 * - No keyword lifecycle rules. Publication does not prove a product is currently in effect. Only an explicit official
 *   main sentence ("中央气象台…解除…预警") records "this item is a lift notice" with its sentence and object; nothing
 *   else is revoked. A bulletin covering several typhoons keeps each typhoon's text with its own object.
 * - The page notice "此时段内暂无新产品更新，下列为过去时刻产品" is saved and shown as a historical-product notice.
 * - Identity = fixed column + normalized raw publish-time text (flash reports: column + full annual issue number).
 *   Content hash = version fingerprint: same identity with a changed body updates the record (first-received kept);
 *   new time/issue = new record; no supersede inference. Missing identity fails that page; fetch time never mints one.
 * - Issuing country CN only: no port association, no HOT / WR-O01 / WR-O02 impact, eventEligibility false.
 */

export const NMC_HOST = "www.nmc.cn"
export const NMC_HISTORICAL_NOTICE = "此时段内暂无新产品更新，下列为过去时刻产品"
export const NMC_BODY_MAX_CHARS = 6000

export interface NmcPage {
  column: string
  url: string
  productName: string
  identity: "issue_number" | "publish_time"
}

export const NMC_PAGES: readonly NmcPage[] = [
  { column: "typhoon_flash", url: "https://www.nmc.cn/publish/typhoon/typhoon_new.html", productName: "台风快讯", identity: "issue_number" },
  { column: "typhoon_bulletin", url: "https://www.nmc.cn/publish/typhoon/warning.html", productName: "台风公报", identity: "publish_time" },
  { column: "warning_index", url: "https://www.nmc.cn/publish/country/warning/index.html", productName: "气象灾害预警（首页栏目）", identity: "publish_time" },
  { column: "warning_typhoon", url: "https://www.nmc.cn/publish/country/warning/typhoon.html", productName: "台风预警", identity: "publish_time" },
  { column: "warning_downpour", url: "https://www.nmc.cn/publish/country/warning/downpour.html", productName: "暴雨预警", identity: "publish_time" },
  { column: "warning_strong_convection", url: "https://www.nmc.cn/publish/country/warning/strong_convection.html", productName: "强对流天气预警", identity: "publish_time" },
]
export const NMC_MAX_REQUESTS = NMC_PAGES.length

export interface NmcSourceContext {
  id: string
  provenance: DataProvenance
}

export interface NmcParsedPage {
  pageTitle: string
  authorText: string | null
  numberText: string | null
  ctitleText: string | null
  publishTimeText: string | null
  identityKey: string | null
  nextIssueText: string | null
  historicalProductNotice: string | null
  liftStatement: { sentence: string, object: string } | null
  rawColorLevel: string | null
  typhoonIntensityText: string | null
  centerPositionText: string | null
  typhoonObjects: { object: string, text: string }[]
  bodyText: string
  bodyTruncated: boolean
}

export interface NmcRunReport {
  sourceId: string
  requested: number
  received: number
  failed: { column: string, reason: string }[]
  created: number
  updated: number
  unchanged: number
  historical: number
}

export function isApprovedNmcUrl(value: string | undefined): NmcPage | undefined {
  if (!value) return undefined
  try {
    const url = new URL(value)
    if (url.protocol !== "https:" || url.host !== NMC_HOST || url.port || url.username || url.password || url.search || url.hash) return undefined
    return NMC_PAGES.find(page => page.url === url.href)
  } catch {
    return undefined
  }
}

const flat = (value: string) => value.normalize("NFC").replace(/[\u00A0\u3000]/g, " ").replace(/\s+/g, " ").trim()
const PUBLISH_TIME = /(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日\s*(\d{1,2})\s*时(?:\s*(\d{1,2})\s*分)?/
const ISSUE_NUMBER = /(\d{4})\s*年\s*总\s*(\d{1,6})\s*期/
const pad = (v: string) => v.padStart(2, "0")

/** Normalized raw publish-time text "YYYY-MM-DDTHH[:mm]" (no timezone attached; the page declares none). */
export function normalizeNmcPublishTime(text: string | null): string | null {
  const m = text ? PUBLISH_TIME.exec(text) : null
  return m ? `${m[1]}-${pad(m[2])}-${pad(m[3])}T${pad(m[4])}${m[5] ? `:${pad(m[5])}` : ""}` : null
}

export function parseNmcPage(html: string, page: NmcPage): NmcParsedPage {
  const $ = load(html)
  const root = $("#text").first()
  if (!root.length) throw new Error("nmc_structure_lost: #text missing")
  const pageText = flat($("body").text()).replace(/\s/g, "")
  const historicalProductNotice = pageText.includes(NMC_HISTORICAL_NOTICE) ? NMC_HISTORICAL_NOTICE : null
  root.find("script, style, noscript, iframe, form, img, video, audio, object, embed, svg, link, meta, input, button").remove()
  const pick = (selector: string) => {
    const text = flat(root.find(selector).first().text())
    return text || null
  }
  const pageTitle = (pick("div.title") ?? "").replace(/\s/g, "")
  const writing = root.find("div.writing").first()
  if (!pageTitle || !writing.length) throw new Error("nmc_structure_lost: div.title or div.writing missing")
  const authorText = pick("div.author")
  const numberText = pick("div.number")
  const ctitleText = pick("div.ctitle")
  // Flash-report table: label cell -> value cell.
  const fields = new Map<string, string>()
  writing.find("tr").each((_, tr) => {
    const cells = $(tr).find("td")
    if (cells.length >= 2) fields.set(flat(cells.eq(0).text()).replace(/[\s：:]/g, ""), flat(cells.eq(1).text()))
  })
  writing.find("br").replaceWith("\n")
  writing.find("td").each((_, el) => {
    $(el).append(" ")
  })
  writing.find("p, div, tr, li, h1, h2, h3, h4, h5, h6").each((_, el) => {
    $(el).append("\n")
  })
  const lines = writing.text().normalize("NFC").replace(/[\u00A0\u3000]/g, " ").split("\n").map(l => l.replace(/[ \t]+/g, " ").trim()).filter(Boolean)
  let bodyText = lines.join("\n")
  if (!bodyText) throw new Error("nmc_body_empty: div.writing has no readable text")
  const bodyTruncated = bodyText.length > NMC_BODY_MAX_CHARS
  if (bodyTruncated) bodyText = bodyText.slice(0, NMC_BODY_MAX_CHARS)
  const publishSource = page.identity === "issue_number" ? `${numberText ?? ""} ${ctitleText ?? ""}` : authorText ?? ""
  const timeMatch = PUBLISH_TIME.exec(publishSource) ?? /\d{1,2}\s*月\s*\d{1,2}\s*日\s*\d{1,2}\s*时(?:\s*\d{1,2}\s*分)?/.exec(publishSource)
  const publishTimeText = timeMatch ? flat(timeMatch[0]) : null
  let identityKey: string | null = null
  if (page.identity === "issue_number") {
    const m = numberText ? ISSUE_NUMBER.exec(numberText) : null
    identityKey = m ? `${m[1]}-${m[2]}` : null
  } else {
    identityKey = normalizeNmcPublishTime(publishTimeText)
  }
  // Explicit official main sentence only (text before the first full-width colon of the first body line).
  const first = lines[0] ?? ""
  const colon = first.search(/[：:]/)
  const headline = colon > 0 && colon <= 80 ? first.slice(0, colon).trim() : null
  const lift = headline && headline.startsWith("中央气象台") ? /解除(.{1,30}?预警)$/.exec(headline) : null
  const liftStatement = lift ? { sentence: headline!, object: lift[1] } : null
  const color = headline && page.column.startsWith("warning_") ? /([蓝黄橙红])色预警/.exec(headline) : null
  const nextIssue = /下次更新时间为([^）)\n]+)/.exec(bodyText)
  const typhoonObjects: { object: string, text: string }[] = []
  if (page.identity === "issue_number") {
    const name = fields.get("命名")
    if (name) typhoonObjects.push({ object: name, text: bodyText.slice(0, 1000) })
  } else if (page.column === "typhoon_bulletin") {
    for (const section of bodyText.split(/\n(?=[一二三四五六七八九十]+、)/)) {
      const s = section.trim()
      const head = /^[一二三四五六七八九十]+、[^“]*“([^”]{1,20})”/.exec(s)
      if (head) typhoonObjects.push({ object: head[1], text: s.slice(0, 1000) })
    }
  }
  return {
    pageTitle,
    authorText,
    numberText,
    ctitleText,
    publishTimeText,
    identityKey,
    nextIssueText: nextIssue ? nextIssue[1].trim() : null,
    historicalProductNotice,
    liftStatement,
    rawColorLevel: color ? `${color[1]}色` : null,
    typhoonIntensityText: fields.get("强度等级") ?? null,
    centerPositionText: fields.get("中心位置") ?? null,
    typhoonObjects,
    bodyText,
    bodyTruncated,
  }
}

export function nmcContentHash(parsed: NmcParsedPage): string {
  return createHash("sha256").update(JSON.stringify([parsed.pageTitle, parsed.authorText, parsed.numberText, parsed.ctitleText, parsed.bodyText, parsed.historicalProductNotice])).digest("hex").slice(0, 16)
}

function excerpt(value: string, max = 240): string {
  const text = value.replace(/\s+/g, " ").trim()
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`
}

export function nmcSummaryZh(page: NmcPage, parsed: NmcParsedPage): string {
  const parts = [`已接收中央气象台（中国）官方产品原文：${parsed.pageTitle}（栏目：${page.productName}）。`]
  if (parsed.historicalProductNotice) parts.push(`页面提示“${NMC_HISTORICAL_NOTICE}”：这是历史产品，不是新生效预警。`)
  if (parsed.liftStatement) parts.push(`官方主句“${parsed.liftStatement.sentence}”：本条记录为解除通知（对象：${parsed.liftStatement.object}），不撤销其他记录。`)
  parts.push("发布不代表当前生效；生命周期与有效期未知，时区未确认，原始等级未映射，未关联港口，无影响推断。")
  parts.push(`原文：${excerpt(parsed.bodyText)}`)
  return parts.join("")
}

export function nmcRecordId(sourceId: string, page: NmcPage, identityKey: string): string {
  return `weather-alert:${sourceId}:${page.column}:${identityKey}`
}

export function buildNmcFeedItem(page: NmcPage, parsed: NmcParsedPage, source: NmcSourceContext, fetchedAt: string, previous?: FeedItem): { item: FeedItem, change: "created" | "updated" | "unchanged" } {
  if (!parsed.identityKey) throw new Error("nmc_identity_missing")
  const contentHash = nmcContentHash(parsed)
  const prevRaw = previous?.weather?.cnNoticeRaw
  const firstReceivedAt = prevRaw?.firstReceivedAt ?? previous?.publishedAt ?? fetchedAt
  const change = !previous ? "created" : prevRaw?.contentHash === contentHash ? "unchanged" : "updated"
  const contentUpdatedAt = change === "updated" ? fetchedAt : prevRaw?.contentUpdatedAt
  const id = nmcRecordId(source.id, page, parsed.identityKey)
  const cnNoticeRaw: CnNoticeRaw = {
    column: page.column,
    productName: page.productName,
    pageTitle: parsed.pageTitle,
    identityKey: parsed.identityKey,
    identityBasis: page.identity,
    authorText: parsed.authorText,
    numberText: parsed.numberText,
    ctitleText: parsed.ctitleText,
    publishTimeText: parsed.publishTimeText,
    nextIssueText: parsed.nextIssueText,
    historicalProductNotice: parsed.historicalProductNotice,
    liftStatement: parsed.liftStatement,
    rawColorLevel: parsed.rawColorLevel,
    typhoonIntensityText: parsed.typhoonIntensityText,
    centerPositionText: parsed.centerPositionText,
    typhoonObjects: parsed.typhoonObjects,
    bodyText: parsed.bodyText,
    bodyTruncated: parsed.bodyTruncated,
    contentHash,
    sourceUrl: page.url,
    fetchedAt,
    firstReceivedAt,
    ...(contentUpdatedAt ? { contentUpdatedAt } : {}),
  }
  const weather: WeatherDetail = {
    riskSource: "official",
    alertState: "unknown",
    alertId: id,
    validityStatus: "unknown",
    timezoneStatus: "unconfirmed",
    lifecycleStatus: "unknown",
    timeBasis: "received_at",
    standardizedSeverity: "unmapped",
    cnNoticeRaw,
  }
  const tags = [
    "official",
    "issuing_country_CN",
    "lifecycle_unknown",
    "validity_pending_confirmation",
    "timezone_unconfirmed",
    "standardized_severity_unmapped",
    "no_port_association",
  ]
  if (parsed.historicalProductNotice) tags.push("historical_product_notice")
  if (parsed.liftStatement) tags.push("official_lift_statement")
  const item: FeedItem = {
    id,
    sourceId: source.id,
    category: "weather",
    freshnessPolicy: "official",
    type: "weather_warning_official",
    title: `${parsed.pageTitle}${parsed.publishTimeText ? `（${parsed.publishTimeText}）` : ""}`,
    summary: nmcSummaryZh(page, parsed),
    sourceUrl: page.url,
    canonicalUrl: page.url,
    publishedAt: firstReceivedAt,
    publicationTimeKnown: true,
    eventEligibility: false,
    severity: "info",
    tags,
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

export interface NmcResponse {
  ok: boolean
  status: number
  redirected?: boolean
  url?: string
  text: () => Promise<string>
}
export type NmcFetcher = (url: string, init?: { redirect?: "error" | "manual" | "follow" }) => Promise<NmcResponse>

const columnOf = (item: FeedItem) => item.weather?.cnNoticeRaw?.column

/**
 * Fetches the six pinned pages. Never clears previous records: records of a failed page are carried forward as
 * degraded with old values; older issues no longer on their page are kept (marked not on current page, no supersede).
 * All pages failing is a source failure (thrown with the report), never success-empty.
 */
export async function collectNmcNotices(fetcher: NmcFetcher, source: NmcSourceContext, fetchedAt: string, previous: FeedItem[] = [], pages: readonly NmcPage[] = NMC_PAGES): Promise<{ items: FeedItem[], report: NmcRunReport }> {
  const report: NmcRunReport = { sourceId: source.id, requested: 0, received: 0, failed: [], created: 0, updated: 0, unchanged: 0, historical: 0 }
  const previousById = new Map(previous.map(item => [item.id, item]))
  const out = new Map<string, FeedItem>()
  const failedColumns = new Set<string>()
  for (const page of pages.slice(0, NMC_MAX_REQUESTS)) {
    if (isApprovedNmcUrl(page.url) !== NMC_PAGES.find(p => p.column === page.column) || !isApprovedNmcUrl(page.url)) {
      report.failed.push({ column: page.column, reason: "url not on the approved list" })
      failedColumns.add(page.column)
      continue
    }
    report.requested++
    try {
      const response = await fetcher(page.url, { redirect: "error" })
      if (response.redirected || (response.url && response.url !== page.url)) throw new Error("redirect rejected")
      if (!response.ok) throw new Error(`http ${response.status}`)
      const parsed = parseNmcPage(await response.text(), page)
      if (!parsed.identityKey) throw new Error(`nmc_identity_missing: no reliable ${page.identity === "issue_number" ? "annual issue number" : "publish time"}`)
      const id = nmcRecordId(source.id, page, parsed.identityKey)
      const built = buildNmcFeedItem(page, parsed, source, fetchedAt, previousById.get(id))
      report.received++
      report[built.change]++
      if (parsed.historicalProductNotice) report.historical++
      out.set(id, built.item)
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      report.failed.push({ column: page.column, reason })
      failedColumns.add(page.column)
    }
  }
  if (report.received === 0) {
    const error = new Error(`nmc_pages_all_failed: received 0/${report.requested}; failed ${report.failed.map(f => `${f.column}(${f.reason})`).join(",")}`) as Error & { nmcReport?: NmcRunReport }
    error.nmcReport = report
    throw error
  }
  for (const item of previous) {
    if (out.has(item.id)) continue
    const column = columnOf(item)
    out.set(item.id, column && failedColumns.has(column)
      ? { ...item, stale: true, sourceStatus: "degraded", error: "nmc_page_fetch_failed", fetchedAt }
      : { ...item, stale: true, sourceStatus: "degraded", error: "nmc_not_on_current_page", fetchedAt })
  }
  return { items: [...out.values()], report }
}
