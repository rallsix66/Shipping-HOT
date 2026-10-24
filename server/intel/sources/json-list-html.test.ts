import { Buffer } from "node:buffer"
import { describe, expect, it } from "vitest"
import type { ArticleSourcePolicy } from "@shared/article"
import { JSON_LIST_HTML_MAX_BYTES, type JsonListConfig, assertJsonListConfig, fromJson } from "./json-list"

const base = "https://source.example.test/newsroom"
const policy: ArticleSourcePolicy = { sourceId: "synthetic", status: "allowed", fetchAllowed: true, persistence: "disallowed", allowedHosts: ["source.example.test"], allowedContentTypes: ["text/html"] }
const config: JsonListConfig = {
  htmlScriptSelector: "script#payload",
  itemsPaths: ["page.pin", "page.items"],
  titlePaths: ["title"],
  urlPath: "aliasUrl",
  publishedAtPath: "releaseDate",
  calendar: "gregorian",
  dateRuleBasis: "Synthetic releaseDate local datetime, no source timezone or publication instant",
}
const pin = { title: "Synthetic pinned title", aliasUrl: "/newsroom/pinned", releaseDate: "2026-10-05T11:31:17" }
const item = { title: "Synthetic listed title", aliasUrl: "/newsroom/listed", releaseDate: "2026-09-30T15:06:44" }
const html = (value: unknown, attributes = "type=\"application/json\"") => `<html><script id="payload" ${attributes}>${JSON.stringify(value)}</script><script>throw new Error("must not execute")</script></html>`
const parse = (value: unknown, c = config) => fromJson(html(value), base, c, policy)

describe("explicit inert JSON data script mapping", () => {
  it("maps a pinned object and the main array with full original local timestamps", () => {
    const entries = parse({ page: { pin, items: [item] } })
    expect(entries.map(e => [e.title, e.url, e.dateEvidence.raw])).toEqual([
      [pin.title, `${base}/pinned`, pin.releaseDate],
      [item.title, `${base}/listed`, item.releaseDate],
    ])
    for (const entry of entries) expect(entry).toMatchObject({ publishedAt: undefined, dateEvidence: { precision: "second", timezone: "missing", utcOffset: null, publishedAt: null, basis: config.dateRuleBasis } })
    expect(parse({ page: { pin: [], items: [] } })).toEqual([])
  })

  it("requires exactly one inline application/json script, with no executable fallback", () => {
    const data = { page: { pin, items: [item] } }
    for (const body of ["<html></html>", html(data) + html(data), html(data, "type=\"text/javascript\""), html(data, "type=\"application/json\" src=\"/external.json\""), "<div id=\"payload\" type=\"application/json\">{}</div>"]) {
      expect(() => fromJson(body, base, config, policy)).toThrow("json_list_html_script_shape")
    }
    expect(() => fromJson("<script id=\"payload\" type=\"application/json\">private-marker is not JSON</script>", base, config, policy)).toThrow(/^json_list_invalid_json$/)
    expect(() => fromJson(html(data), base, { ...config, htmlScriptSelector: undefined }, policy)).toThrow("json_list_invalid_json")
  })

  it("rejects unknown/missing groups and ambiguous, excessive or unsafe configuration", () => {
    for (const groups of [{}, { pin, items: null }, { pin: null, items: [] }, { pin, items: 0 }, { pin, items: [null] }]) expect(() => parse({ page: groups })).toThrow()
    for (const extra of [
      { itemsPath: "page.items" },
      { itemsPaths: [] },
      { itemsPaths: ["page.pin", "page.pin"] },
      { itemsPaths: ["a", "b", "c", "d", "e"] },
      { itemsPaths: ["page.__proto__"] },
      { htmlScriptSelector: "[" },
      { htmlScriptSelector: " " },
      { htmlScriptSelector: "a".repeat(257) },
    ]) expect(() => assertJsonListConfig({ ...config, ...extra })).toThrow()
    expect(() => parse({ page: { pin, items: Array.from({ length: 500 }, () => item) } })).toThrow("json_list_item_limit")
  })

  it("deduplicates identical merged entries but rejects title/date conflicts before collection", () => {
    expect(parse({ page: { pin, items: [pin, item] } })).toHaveLength(2)
    for (const conflict of [{ ...pin, title: "Conflicting title" }, { ...pin, releaseDate: "2026-10-06T11:31:17" }]) {
      expect(() => parse({ page: { pin, items: [item, conflict] } })).toThrow("json_list_duplicate_conflict")
    }
  })

  it("bounds decoded HTML and keeps existing source URL restrictions", () => {
    const body = html({ page: { pin, items: [item] } })
    const oversized = body + " ".repeat(JSON_LIST_HTML_MAX_BYTES)
    expect(Buffer.byteLength(oversized)).toBeGreaterThan(JSON_LIST_HTML_MAX_BYTES)
    expect(() => fromJson(oversized, base, config, policy)).toThrow("json_list_html_body_limit")
    for (const aliasUrl of ["http://source.example.test/news", "https://outside.invalid/news", "https://127.0.0.1/news", base]) {
      expect(() => parse({ page: { pin, items: [{ ...item, aliasUrl }] } })).toThrow("json_list_invalid_link")
    }
  })
})
