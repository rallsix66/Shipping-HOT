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

export const WEB_LIST_DUPLICATE_CONFLICT = "web_list_duplicate_conflict"

function unknownDateEvidence(value: string | null | undefined, config: Pick<WebListConfig, "calendar" | "dateRuleBasis">): WebDate {
  return { raw: value?.trim() || null, rule: "missing", basis: config.dateRuleBasis, calendar: config.calendar ?? "gregorian", precision: "unknown", timezone: "missing", utcOffset: null, localDate: null, publishedAt: null }
}

/** Strict replacement for upstream's host-dependent Date.parse fallback and implicit +08:00. */
export function parseLooseDate(value: string | null | undefined, config: Pick<WebListConfig, "publishedAtUtcOffset" | "dateOrder" | "calendar" | "dateRuleBasis" | "dateFormat">): WebDate {
  const result = unknownDateEvidence(value, config)
  const raw = result.raw
  if (!raw) return result
  let v = raw.replace(/^\((.*)\)$/, "$1").trim()
  if (/^(?:พ\.ศ\.|B\.E\.)\s*/i.test(v)) {
    result.calendar = "buddhist"
    v = v.replace(/^(?:พ\.ศ\.|B\.E\.)\s*/i, "")
  }
  // Full-string patterns only: no date picked from nearby prose, no inferred D/M order.
  const m = /^(\d{4})([-/])(\d{1,2})\2(\d{1,2})(.*)$/.exec(v)
  const cn = /^(\d{4})年(\d{1,2})月(\d{1,2})日(.*)$/.exec(v)
  const dm = /^(\d{1,2})([-/])(\d{1,2})\2(\d{4})(.*)$/.exec(v)
  const thaiMonths = ["มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน", "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม"]
  const thai = config.dateFormat === "thai_month_name" ? /^(\d{1,2})\s+(มกราคม|กุมภาพันธ์|มีนาคม|เมษายน|พฤษภาคม|มิถุนายน|กรกฎาคม|สิงหาคม|กันยายน|ตุลาคม|พฤศจิกายน|ธันวาคม)\s+(\d{4})$/.exec(v) : null
  let y: number, mo: number, d: number, tail: string
  if (config.dateFormat === "sitc_publication_day") {
    const published = /^发布日期: (\d{4})\.(\d{2})\.(\d{2})$/.exec(raw)
    if (!published || result.calendar !== "gregorian") return { ...result, rule: "unsupported_format" }
    y = +published[1]
    mo = +published[2]
    d = +published[3]
    tail = ""
    result.rule = "configured_sitc_publication_day"
  } else if (config.dateFormat === "indonesian_enactment_date") {
    const months = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"]
    // This index also renders the explicit English "October" token; no locale fallback.
    const enacted = /^Ditetapkan\s+(\d{1,2})\s+(Januari|Februari|Maret|April|Mei|Juni|Juli|Agustus|September|Oktober|October|November|Desember)\s+(\d{4})$/.exec(v)
    if (!enacted || result.calendar !== "gregorian") return { ...result, rule: "unsupported_format" }
    y = +enacted[3]
    mo = months.indexOf(enacted[2] === "October" ? "Oktober" : enacted[2]) + 1
    d = +enacted[1]
    tail = ""
    result.rule = "configured_indonesian_enactment_date"
  } else if (config.dateFormat === "english_month_name") {
    const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]
    const english = /^(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),\s+(\d{4})$/.exec(v)
    if (!english || result.calendar !== "gregorian") return { ...result, rule: "unsupported_format" }
    y = +english[3]
    mo = months.indexOf(english[1]) + 1
    d = +english[2]
    tail = ""
    result.rule = "configured_english_month_name"
  } else if (config.dateFormat === "thai_month_name") {
    if (!thai || !thaiMonths.includes(thai[2])) return { ...result, rule: "unsupported_format" }
    y = +thai[3]
    mo = thaiMonths.indexOf(thai[2]) + 1
    d = +thai[1]
    tail = ""
    result.rule = "configured_thai_month_name"
  } else if (m) {
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
    y = +dm[4]
    mo = +dm[3]
    d = +dm[1]
    tail = dm[5]
    result.rule = dm[2] === "-" ? "configured_dmy_dash" : "configured_dmy"
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
  if (config.dateFormat === "sitc_publication_day") return { ...result, precision: "day", localDate: date, timezone: "missing", utcOffset: null, publishedAt: null }
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
export function allowed(url: string, config: Pick<WebListConfig, "allowUrlPrefixes" | "denyUrlPrefixes" | "metadataLinkRule">, policy: ArticleSourcePolicy): boolean {
  const target = new URL(url)
  if (config.metadataLinkRule === "sitc_show") {
    // Only a stored identity. secureFetchArticle and its independent HTTP/redirect policy are unchanged.
    return policy.sourceId === "intel:xx-k03" && policy.persistence === "disallowed"
      && articlePolicyHostResolves(policy, target.hostname)
      && (target.protocol === "http:" || target.protocol === "https:")
      && !target.username && !target.password && !target.port
      && target.hostname === "www.sitc.com" && target.pathname === "/en/show.asp"
      && [...target.searchParams.keys()].length === 1 && /^\d+$/.test(target.searchParams.get("id") ?? "")
      && config.allowUrlPrefixes === undefined && config.denyUrlPrefixes === undefined
  }
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
  const seen = new Map<string, string>()
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
    if (c.metadataLinkRule && !allowed(new URL(href!, base).href, c, policy)) continue
    if (!allowed(url, c, policy) || listingItself(url, base)) continue
    const titleEl = c.titleSelector ? (el.is(c.titleSelector) ? el : el.find(c.titleSelector).first()) : linkEl
    let title = (c.titleAttribute ? titleEl.attr(c.titleAttribute) ?? "" : titleEl.text() || linkEl.attr("title") || "").replace(/\s+/g, " ").trim()
    if (!title) throw new Error("web_list_missing_title")
    const dateEl = c.publishedAtSelector ? el.find(c.publishedAtSelector).first() : undefined
    let rawDate = dateEl?.attr("datetime") ?? dateEl?.attr("title") ?? dateEl?.text()
    let unmatchedDate: WebDate | undefined
    if (c.linkTextFormat === "dmy-date-title") {
      const pair = /^(\d{1,2}-\d{1,2}-\d{4}) (\S.*)$/.exec(title)
      rawDate = pair?.[1]
      if (pair) title = pair[2]
    }
    if (c.linkTextFormat === "title-dmy-date") {
      // One observed anchor: its full title attribute and trailing parenthesized D/M/Y.
      // Preserve unsupported text as unknown evidence; never search neighboring prose.
      const originalText = linkEl.text()
      const visible = originalText.replace(/\s+/g, " ").trim()
      const pair = /\((\d{1,2}\/\d{1,2}\/\d{4})\)$/.exec(visible)
      const visibleTitle = pair ? visible.slice(0, pair.index).replace(/[\p{Cf}\p{Cc}\s]/gu, "") : ""
      if (pair && visibleTitle && visible[pair.index - 1] === " ") rawDate = pair[1]
      else unmatchedDate = { ...unknownDateEvidence(originalText, c), rule: "title_dmy_date_mismatch" }
    }
    const dateEvidence = unmatchedDate ?? parseLooseDate(rawDate, c)
    // A URL identifies one item, but does not prove that conflicting title/date associations are duplicates.
    // Keep the full normalized date evidence (including raw text/unknowns), without choosing an occurrence.
    const association = JSON.stringify([title, dateEvidence])
    const previous = seen.get(url)
    if (previous !== undefined) {
      if (previous !== association) throw new Error(WEB_LIST_DUPLICATE_CONFLICT)
      continue
    }
    seen.set(url, association)
    out.push({ url, canonicalUrl: url, title, summary: title, bodyText: "", publishedAt: dateEvidence.publishedAt ?? undefined, dateEvidence })
  }
  if (!out.length) throw new Error("web_list_no_allowed_items")
  return out
}
