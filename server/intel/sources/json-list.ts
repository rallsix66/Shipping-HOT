// Adapted from AIHOT@44578fa packages/backend/src/sources/json-list.ts (MIT).
// Pure JSON mapping only; fetch/decoding/storage stay in the existing collector.
import { load } from "cheerio"
import type { ArticleSourcePolicy } from "@shared/article"
import { UnsupportedConfig, type WebListConfig, assertDateAndUrlConfig } from "./config-keys"
import { type WebListEntry, allowed, parseLooseDate } from "./web-list"
import { canonicalizeFeedUrl } from "#/providers/feed"

export interface JsonListConfig extends Pick<WebListConfig, "dateRuleBasis" | "dateOrder" | "calendar" | "publishedAtUtcOffset" | "allowUrlPrefixes" | "denyUrlPrefixes"> {
  itemsPath?: string
  titlePaths: string[]
  summaryPaths?: string[]
  urlPath?: string
  urlTemplate?: string
  publishedAtPath?: string
}

const KEYS = new Set(["itemsPath", "titlePaths", "summaryPaths", "urlPath", "urlTemplate", "publishedAtPath", "dateRuleBasis", "dateOrder", "calendar", "publishedAtUtcOffset", "allowUrlPrefixes", "denyUrlPrefixes"])
const FORBIDDEN_SEGMENTS = new Set(["__proto__", "prototype", "constructor"])

function assertPath(path: unknown): asserts path is string {
  if (typeof path !== "string" || path.length > 256 || !path.length) throw new UnsupportedConfig("json_list invalid path")
  const parts = path.split(".")
  if (parts.length > 8 || parts.some(p => FORBIDDEN_SEGMENTS.has(p) || !/^(?:[A-Z_][\w-]*|0|[1-9]\d{0,3})$/i.test(p))) throw new UnsupportedConfig("json_list invalid path")
}

export function assertJsonListConfig(input: unknown): asserts input is JsonListConfig {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new UnsupportedConfig("json_list config must be an object")
  const c = input as Record<string, unknown>
  for (const key of Object.keys(c)) {
    if (!KEYS.has(key)) throw new UnsupportedConfig(`Unsupported json_list config: ${key}`)
  }
  assertDateAndUrlConfig(c)
  for (const key of ["itemsPath", "urlPath", "publishedAtPath"]) {
    if (c[key] !== undefined) assertPath(c[key])
  }
  for (const key of ["titlePaths", "summaryPaths"]) {
    if (key === "summaryPaths" && c[key] === undefined) continue
    if (!Array.isArray(c[key]) || !(c[key] as unknown[]).length || (c[key] as unknown[]).length > 5) throw new UnsupportedConfig(`${key} invalid`)
    for (const path of c[key] as unknown[]) assertPath(path)
  }
  if (c.publishedAtPath && /^(?:valid|effective)[_-]?(?:from|to|start|end|at)$/i.test((c.publishedAtPath as string).split(".").at(-1)!)) throw new UnsupportedConfig("Validity is not a publication date")
  if ((c.urlPath !== undefined) === (c.urlTemplate !== undefined)) throw new UnsupportedConfig("Specify exactly one URL path or template")
  if (c.urlTemplate !== undefined) {
    if (typeof c.urlTemplate !== "string" || !c.urlTemplate || c.urlTemplate.length > 2048 || c.urlTemplate.trim() !== c.urlTemplate || /[\\\s]/.test(c.urlTemplate)) throw new UnsupportedConfig("urlTemplate invalid")
    const matches = [...c.urlTemplate.matchAll(/\{([^{}]+)\}/g)]
    if (!matches.length || matches.length > 8 || /[{}]/.test(c.urlTemplate.replace(/\{[^{}]+\}/g, "x"))) throw new UnsupportedConfig("urlTemplate placeholders invalid")
    for (const match of matches) assertPath(match[1])
    // Placeholders may encode a path/query value, never change the scheme or authority.
    if (/^(?:[a-z][\w+.-]*:)?\/\/[^/?#]*\{/i.test(c.urlTemplate)) throw new UnsupportedConfig("urlTemplate dynamic authority")
    const probe = new URL(c.urlTemplate.replace(/\{[^{}]+\}/g, "x"), "https://template.invalid/")
    if (probe.protocol !== "https:" || probe.username || probe.password) throw new UnsupportedConfig("urlTemplate invalid URL")
  }
}

/** Bounded dot paths with own-property access; no recursive discovery or prototype traversal. */
export function getPath(obj: unknown, path: string): unknown {
  assertPath(path)
  let cur = obj
  for (const part of path.split(".")) {
    if (!cur || typeof cur !== "object" || !Object.hasOwn(cur, part)) return undefined
    if (Array.isArray(cur) && !/^(?:0|[1-9]\d{0,3})$/.test(part)) return undefined
    cur = (cur as Record<string, unknown>)[part]
  }
  return cur
}

function firstString(item: unknown, paths: string[]): string | undefined {
  for (const path of paths) {
    const value = getPath(item, path)
    if (value == null) continue
    if (typeof value !== "string") throw new Error("json_list_field_type_changed")
    if (value.trim()) return value.trim()
  }
}

export function renderTemplate(template: string, item: unknown): string {
  return template.replace(/\{([^{}]+)\}/g, (_, path: string) => {
    const value = getPath(item, path)
    if ((typeof value !== "string" && typeof value !== "number") || (typeof value === "number" && !Number.isFinite(value)) || String(value).trim() === "") throw new Error("json_list_template_value_missing")
    return encodeURIComponent(String(value))
  })
}

function text(value: string): string {
  const $ = load(value, undefined, false)
  $("script,style").remove()
  return $.root().text().replace(/\s+/g, " ").trim()
}

/** Array-at-root or explicit path only; [] is legal, missing/wrong-shaped arrays fail closed. */
export function fromJson(body: string, base: string, config: JsonListConfig, policy: ArticleSourcePolicy): WebListEntry[] {
  assertJsonListConfig(config)
  let data: unknown
  try {
    data = JSON.parse(body)
  } catch {
    // Native SyntaxError may contain response fragments; run records must not retain them.
    throw new Error("json_list_invalid_json")
  }
  const items = config.itemsPath ? getPath(data, config.itemsPath) : data
  if (!Array.isArray(items)) throw new Error("json_list_items_not_array")
  if (items.length > 500) throw new Error("json_list_item_limit")
  const entries: WebListEntry[] = []
  const seen = new Set<string>()
  for (const item of items) {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error("json_list_item_shape_changed")
    const title = text(firstString(item, config.titlePaths) ?? "")
    if (!title) throw new Error("json_list_missing_title")
    const href = config.urlPath ? firstString(item, [config.urlPath]) : renderTemplate(config.urlTemplate!, item)
    const url = href ? canonicalizeFeedUrl(href, base) : undefined
    if (!url || !allowed(url, config, policy) || url === canonicalizeFeedUrl(base)) throw new Error("json_list_invalid_link")
    const rawDate = config.publishedAtPath ? getPath(item, config.publishedAtPath) : undefined
    if (rawDate != null && typeof rawDate !== "string" && typeof rawDate !== "number") throw new Error("json_list_date_type_changed")
    const dateEvidence = parseLooseDate(rawDate == null ? undefined : String(rawDate), config)
    const summary = text(firstString(item, config.summaryPaths ?? []) ?? "")
    if (seen.has(url)) continue
    seen.add(url)
    entries.push({ url, canonicalUrl: url, title, summary, bodyText: summary, publishedAt: dateEvidence.publishedAt ?? undefined, dateEvidence })
  }
  return entries
}
