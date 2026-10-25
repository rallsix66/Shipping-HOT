// Adapted from AIHOT@44578fa packages/backend/src/sources/config-keys.ts (MIT).
// Only the implemented HTML subset is accepted; removed keys never silently fall back.
import { load } from "cheerio"

export interface WebListConfig {
  listSelector: string
  itemSelector: string
  linkSelector?: string
  titleSelector?: string
  titleAttribute?: "title" | "alt"
  publishedAtSelector?: string
  publishedAtUtcOffset?: string
  dateOrder?: "dmy"
  calendar?: "gregorian" | "buddhist"
  dateFormat?: "thai_month_name" | "english_month_name" | "english_month_abbr_12h" | "english_month_abbr_day" | "indonesian_enactment_date" | "indonesian_month_abbr" | "sitc_publication_day"
  /** Fixed SITC metadata identity exception; never grants permission to fetch HTTP bodies. */
  metadataLinkRule?: "sitc_show"
  /** Date and title share the observed anchor text; no prose/date searching. */
  linkTextFormat?: "dmy-date-title" | "title-dmy-date"
  dateRuleBasis: string
  emptySelector?: string
  allowUrlPrefixes?: string[]
  denyUrlPrefixes?: string[]
}

const KEYS = new Set([
  "listSelector",
  "itemSelector",
  "linkSelector",
  "titleSelector",
  "titleAttribute",
  "publishedAtSelector",
  "publishedAtUtcOffset",
  "dateOrder",
  "calendar",
  "dateFormat",
  "metadataLinkRule",
  "linkTextFormat",
  "dateRuleBasis",
  "emptySelector",
  "allowUrlPrefixes",
  "denyUrlPrefixes",
])
const VALUES: Record<string, string[]> = { titleAttribute: ["title", "alt"], dateOrder: ["dmy"], calendar: ["gregorian", "buddhist"], dateFormat: ["thai_month_name", "english_month_name", "english_month_abbr_12h", "english_month_abbr_day", "indonesian_enactment_date", "indonesian_month_abbr", "sitc_publication_day"], metadataLinkRule: ["sitc_show"], linkTextFormat: ["dmy-date-title", "title-dmy-date"] }
const SELECTORS = ["listSelector", "itemSelector", "linkSelector", "titleSelector", "publishedAtSelector", "emptySelector"]

export class UnsupportedConfig extends Error {}

export function unsupportedConfig(config: Record<string, unknown>): string[] {
  const out: string[] = []
  for (const [key, value] of Object.entries(config)) {
    if (!KEYS.has(key)) out.push(key)
    else if (VALUES[key] && (typeof value !== "string" || !VALUES[key].includes(value))) out.push(`${key}=${String(value)}`)
  }
  return out
}

export function assertSupportedConfig(input: unknown): asserts input is WebListConfig {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new UnsupportedConfig("web_list config must be an object")
  const config = input as Record<string, unknown>
  const bad = unsupportedConfig(config)
  if (bad.length) throw new UnsupportedConfig(`Unsupported web_list config: ${bad.join(", ")}`)
  for (const key of ["listSelector", "itemSelector", "dateRuleBasis"]) {
    if (typeof config[key] !== "string" || !(config[key] as string).trim()) throw new UnsupportedConfig(`${key} required`)
  }
  const $ = load("<html></html>")
  for (const key of SELECTORS) {
    if (config[key] === undefined) continue
    if (typeof config[key] !== "string" || !(config[key] as string).trim() || (config[key] as string).length > 256) throw new UnsupportedConfig(`${key} invalid`)
    try {
      $(config[key] as string)
    } catch {
      throw new UnsupportedConfig(`${key} invalid selector`)
    }
  }
  assertDateAndUrlConfig(config)
  if (config.dateFormat === "english_month_name" && config.calendar === "buddhist") throw new UnsupportedConfig("english_month_name requires Gregorian calendar")
  if (config.dateFormat === "english_month_abbr_12h" && (config.calendar === "buddhist" || config.publishedAtUtcOffset !== undefined)) throw new UnsupportedConfig("english_month_abbr_12h requires Gregorian local time without offset")
  if (config.dateFormat === "english_month_abbr_day" && (config.calendar === "buddhist" || config.publishedAtUtcOffset !== undefined)) throw new UnsupportedConfig("english_month_abbr_day requires Gregorian day without offset")
  if (config.dateFormat === "indonesian_enactment_date" && config.calendar === "buddhist") throw new UnsupportedConfig("indonesian_enactment_date requires Gregorian calendar")
  if (config.dateFormat === "sitc_publication_day" && (config.calendar === "buddhist" || config.publishedAtUtcOffset !== undefined)) throw new UnsupportedConfig("sitc_publication_day requires Gregorian day without offset")
  if (config.dateFormat === "indonesian_month_abbr" && (config.calendar === "buddhist" || config.publishedAtUtcOffset !== undefined)) throw new UnsupportedConfig("indonesian_month_abbr requires Gregorian day without offset")
  if (config.metadataLinkRule === "sitc_show" && (config.allowUrlPrefixes !== undefined || config.denyUrlPrefixes !== undefined)) throw new UnsupportedConfig("sitc_show uses its fixed metadata host/path rule, not prefix overrides")
  if (config.linkTextFormat && (config.dateOrder !== "dmy" || config.dateFormat || config.titleSelector || config.publishedAtSelector)) throw new UnsupportedConfig("linkTextFormat requires dmy and exclusive link text mapping")
  if (config.linkTextFormat === "dmy-date-title" && config.titleAttribute) throw new UnsupportedConfig("dmy-date-title cannot use a separate title attribute")
  if (config.linkTextFormat === "title-dmy-date" && config.titleAttribute !== "title") throw new UnsupportedConfig("title-dmy-date requires the same anchor's full title attribute")
}

/** Shared explicit date/URL contract; source adapters still validate their own key whitelist. */
export function assertDateAndUrlConfig(config: Record<string, unknown>): void {
  if (typeof config.dateRuleBasis !== "string" || !config.dateRuleBasis.trim()) throw new UnsupportedConfig("dateRuleBasis required")
  for (const key of ["dateOrder", "calendar"]) {
    if (config[key] !== undefined && (typeof config[key] !== "string" || !VALUES[key].includes(config[key] as string))) throw new UnsupportedConfig(`${key} invalid`)
  }
  if (config.publishedAtUtcOffset !== undefined && (typeof config.publishedAtUtcOffset !== "string" || !/^[+-](?:0\d|1[0-3]):[0-5]\d$|^[+-]14:00$/.test(config.publishedAtUtcOffset))) throw new UnsupportedConfig("publishedAtUtcOffset invalid")
  if ((config.dateRuleBasis as string).length > 500) throw new UnsupportedConfig("dateRuleBasis too long")
  for (const key of ["allowUrlPrefixes", "denyUrlPrefixes"]) {
    if (config[key] === undefined) continue
    if (!Array.isArray(config[key]) || (config[key] as unknown[]).length > 30) throw new UnsupportedConfig(`${key} invalid`)
    for (const prefix of config[key] as unknown[]) {
      if (typeof prefix !== "string") throw new UnsupportedConfig(`${key} invalid prefix`)
      try {
        const url = new URL(prefix)
        if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) throw new Error("invalid")
      } catch {
        throw new UnsupportedConfig(`${key} invalid prefix`)
      }
    }
  }
}
