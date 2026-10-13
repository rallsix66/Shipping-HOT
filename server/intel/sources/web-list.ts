// Adapted from AIHOT@44578fa packages/backend/src/sources/web-list.ts (MIT).
// Retains fromHtml's selector/seen/allowed flow; no Jina, MiMo, Markdown, detail fetch or second fetcher.
import { isIP } from "node:net"
import * as cheerio from "cheerio"
import type { ArticleSourcePolicy } from "@shared/article"
import { type WebListConfig, assertSupportedConfig } from "./config-keys"
import { type FeedEntry, canonicalizeFeedUrl } from "#/providers/feed"
import { isBlockedAddress } from "#/services/article-fetch-security"
import { articlePolicyHostResolves } from "#/services/source-policy"

export interface WebDate {
  raw: string | null
  rule: string
  basis: string
  calendar: "gregorian" | "buddhist"
  precision: "unknown" | "day" | "minute" | "second" | "millisecond"
  timezone: "missing" | "explicit" | "configured"
  utcOffset: string | null
  localDate: string | null
  publishedAt: string | null
}
export interface WebListEntry extends FeedEntry {
  dateEvidence: WebDate
}

/** Strict replacement for upstream's host-dependent Date.parse fallback and implicit +08:00. */
export function parseLooseDate(value: string | null | undefined, config: Pick<WebListConfig, "publishedAtUtcOffset" | "dateOrder" | "calendar" | "dateRuleBasis">): WebDate {
  const raw = value?.trim() || null
  const result: WebDate = { raw, rule: "missing", basis: config.dateRuleBasis, calendar: config.calendar ?? "gregorian", precision: "unknown", timezone: "missing", utcOffset: null, localDate: null, publishedAt: null }
  if (!raw) return result
  let v = raw.replace(/^\((.*)\)$/, "$1").trim()
  if (/^(?:พ\.ศ\.|B\.E\.)\s*/i.test(v)) {
    result.calendar = "buddhist"
    v = v.replace(/^(?:พ\.ศ\.|B\.E\.)\s*/i, "")
  }
  // Full-string patterns only: no date picked from nearby prose, no inferred D/M order.
  const m = /^(\d{4})([-/])(\d{1,2})\2(\d{1,2})(.*)$/.exec(v)
  const cn = /^(\d{4})年(\d{1,2})月(\d{1,2})日(.*)$/.exec(v)
  const dm = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(.*)$/.exec(v)
  let y: number, mo: number, d: number, tail: string
  if (m) {
    y = +m[1]
    mo = +m[3]
    d = +m[4]
    tail = m[5]
    result.rule = "ymd"
  } else if (cn) {
    y = +cn[1]
    mo = +cn[2]
    d = +cn[3]
    tail = cn[4]
    result.rule = "chinese_ymd"
  } else if (dm && config.dateOrder === "dmy") {
    y = +dm[3]
    mo = +dm[2]
    d = +dm[1]
    tail = dm[4]
    result.rule = "configured_dmy"
  } else {
    result.rule = dm ? "date_order_missing" : "unsupported_format"
    return result
  }
  if (result.calendar === "buddhist") {
    y -= 543
    result.rule += "_buddhist_minus_543"
  }
  const check = new Date(Date.UTC(y, mo - 1, d))
  if (y < 1900 || y > 2399 || check.getUTCFullYear() !== y || check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d) return { ...result, rule: "invalid_calendar_date" }
  const date = `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`
  if (!tail.trim()) return { ...result, precision: "day", localDate: date, utcOffset: config.publishedAtUtcOffset ?? null, timezone: config.publishedAtUtcOffset ? "configured" : "missing" }
  const t = /^(?:T|\s+)(\d{1,2}):(\d{2})(?::(\d{2})(\.\d{1,3})?)?\s*(Z|UTC|GMT|[+-]\d{2}:?\d{2})?$/.exec(tail)
  if (!t || +t[1] > 23 || +t[2] > 59 || +(t[3] ?? 0) > 59) return { ...result, rule: "invalid_time" }
  const zone = t[5] ? (/^(?:Z|UTC|GMT)$/.test(t[5]) ? "+00:00" : t[5].replace(/^([+-]\d{2})(\d{2})$/, "$1:$2")) : config.publishedAtUtcOffset
  const timed = { ...result, localDate: date, precision: t[4] ? "millisecond" as const : t[3] ? "second" as const : "minute" as const, timezone: t[5] ? "explicit" as const : zone ? "configured" as const : "missing" as const, utcOffset: zone ?? null }
  if (!zone) return timed
  if (!/^[+-](?:0\d|1[0-3]):[0-5]\d$|^[+-]14:00$/.test(zone)) return { ...result, rule: "invalid_offset" }
  const offset = (Number(zone.slice(1, 3)) * 60 + Number(zone.slice(4))) * (zone[0] === "-" ? -1 : 1)
  const instant = Date.UTC(y, mo - 1, d, +t[1], +t[2], +(t[3] ?? 0), Number((t[4] ?? ".0").slice(1).padEnd(3, "0"))) - offset * 60_000
  return { ...timed, publishedAt: new Date(instant).toISOString() }
}

/** Prefix filters compare origin and path boundaries; they cannot widen the source policy. */
export function allowed(url: string, config: Pick<WebListConfig, "allowUrlPrefixes" | "denyUrlPrefixes">, policy: ArticleSourcePolicy): boolean {
  const target = new URL(url)
  if (target.protocol !== "https:" || target.username || target.password || (target.port && target.port !== "443") || !articlePolicyHostResolves(policy, target.hostname)) return false
  const host = target.hostname.replace(/^\[|\]$/g, "")
  const family = isIP(host)
  if ((family === 4 || family === 6) && isBlockedAddress({ address: host, family })) return false
  const matches = (prefix: string) => {
    const p = new URL(prefix)
    const path = p.pathname.replace(/\/$/, "")
    return target.origin === p.origin && (target.pathname === path || target.pathname.startsWith(`${path}/`))
  }
  return !(config.denyUrlPrefixes ?? []).some(matches) && (!config.allowUrlPrefixes?.length || config.allowUrlPrefixes.some(matches))
}

function listingItself(url: string, listing: string): boolean {
  // Business query parameters can identify a detail page on the same path.
  // Shared canonicalization removes fragments/tracking and sorts query keys.
  return canonicalizeFeedUrl(url) === canonicalizeFeedUrl(listing)
}

/** Pure HTML adapter. Fetch, decoding, retry, licensing and storage remain owned by existing services. */
export function fromHtml(html: string, base: string, config: WebListConfig, policy: ArticleSourcePolicy): WebListEntry[] {
  assertSupportedConfig(config)
  const c = config
  const $ = cheerio.load(html)
  const out: WebListEntry[] = []
  const seen = new Set<string>()
  const list = $(c.listSelector)
  if (list.length !== 1) throw new Error("web_list_structure_changed")
  const nodes = list.find(c.itemSelector).toArray()
  if (nodes.length === 0) {
    if (c.emptySelector && list.find(c.emptySelector).length === 1) return []
    throw new Error("web_list_empty_unconfirmed")
  }
  if (nodes.length > 500) throw new Error("web_list_item_limit")
  for (const node of nodes) {
    const el = $(node)
    const linkEl = c.linkSelector ? (el.is(c.linkSelector) ? el : el.find(c.linkSelector).first()) : el.is("a") ? el : el.find("a[href]").first()
    const href = linkEl.attr("href")
    const url = href ? canonicalizeFeedUrl(href, base) : undefined
    if (!url) throw new Error("web_list_invalid_link")
    if (seen.has(url) || !allowed(url, c, policy) || listingItself(url, base)) continue
    const titleEl = c.titleSelector ? (el.is(c.titleSelector) ? el : el.find(c.titleSelector).first()) : linkEl
    const title = (c.titleAttribute ? titleEl.attr(c.titleAttribute) ?? "" : titleEl.text() || linkEl.attr("title") || "").replace(/\s+/g, " ").trim()
    if (!title) throw new Error("web_list_missing_title")
    const dateEl = c.publishedAtSelector ? el.find(c.publishedAtSelector).first() : undefined
    const dateEvidence = parseLooseDate(dateEl?.attr("datetime") ?? dateEl?.attr("title") ?? dateEl?.text(), c)
    seen.add(url)
    out.push({ url, canonicalUrl: url, title, summary: title, bodyText: "", publishedAt: dateEvidence.publishedAt ?? undefined, dateEvidence })
  }
  if (!out.length) throw new Error("web_list_no_allowed_items")
  return out
}
