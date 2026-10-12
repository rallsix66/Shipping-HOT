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
  "dateRuleBasis",
  "emptySelector",
  "allowUrlPrefixes",
  "denyUrlPrefixes",
])
const VALUES: Record<string, string[]> = { titleAttribute: ["title", "alt"], dateOrder: ["dmy"], calendar: ["gregorian", "buddhist"] }
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
