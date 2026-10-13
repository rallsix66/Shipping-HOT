// Adapted mapping/config cases from AIHOT@44578fa json-list.ts (MIT); strict boundary regressions are local.
import { describe, expect, it } from "vitest"
import type { ArticleSourcePolicy } from "@shared/article"
import { type JsonListConfig, assertJsonListConfig, fromJson, getPath, renderTemplate } from "./json-list"

const base = "https://api.data.gov.my/weather/warning"
const policy: ArticleSourcePolicy = { sourceId: "test", status: "allowed", fetchAllowed: true, persistence: "excerpt_only", allowedHosts: ["api.data.gov.my"], allowedContentTypes: ["application/json"] }
const config: JsonListConfig = { titlePaths: ["title"], urlTemplate: "/notices/{id}", publishedAtPath: "published", dateRuleBasis: "Synthetic published field", summaryPaths: ["summary"] }
const record = { id: "one", title: "<b>Notice</b>", published: "2026-10-13", summary: "Summary <script>bad()</script> text" }
const parse = (data: unknown, c = config) => fromJson(JSON.stringify(data), base, c, policy)

describe("json_list bounded pure adapter", () => {
  it("maps root/nested arrays, strips markup and preserves date-only precision", () => {
    expect(parse([record])[0]).toMatchObject({ title: "Notice", summary: "Summary text", bodyText: "Summary text", canonicalUrl: "https://api.data.gov.my/notices/one", publishedAt: undefined, dateEvidence: { raw: "2026-10-13", precision: "day", timezone: "missing", publishedAt: null } })
    expect(parse({ data: [{ items: [record] }] }, { ...config, itemsPath: "data.0.items" })).toEqual(parse([record]))
    expect(parse([])).toEqual([])
    expect(parse({ data: [] }, { ...config, itemsPath: "data" })).toEqual([])
  })

  it("keeps missing/invalid dates unknown and never reads validity as publication", () => {
    for (const published of [undefined, "2026-02-30", "ambiguous text", 1791850000]) {
      const [entry] = parse([{ ...record, published, valid_from: "2026-10-13T09:00:00Z", valid_to: "2026-10-14T09:00:00Z" }])
      expect(entry.publishedAt).toBeUndefined()
      expect(entry.dateEvidence.raw).toBe(published === undefined ? null : String(published))
    }
    expect(() => assertJsonListConfig({ ...config, publishedAtPath: "valid_from" })).toThrow("Validity")
    expect(() => assertJsonListConfig({ ...config, publishedAtPath: "nested.effectiveTo" })).toThrow("Validity")
  })

  it("uses explicit offset over configured offset and preserves configured/missing timezone evidence", () => {
    const c = { ...config, publishedAtUtcOffset: "+07:00" }
    expect(parse([{ ...record, published: "2026-10-13T09:00:00+08:00" }], c)[0]).toMatchObject({ publishedAt: "2026-10-13T01:00:00.000Z", dateEvidence: { timezone: "explicit", utcOffset: "+08:00" } })
    expect(parse([{ ...record, published: "2026-10-13 09:00" }], c)[0]).toMatchObject({ publishedAt: "2026-10-13T02:00:00.000Z", dateEvidence: { timezone: "configured" } })
    expect(parse([{ ...record, published: "2026-10-13 09:00" }])[0].dateEvidence.timezone).toBe("missing")
  })

  it("uses own bounded paths and encoded templates without raw interpolation", () => {
    expect(getPath(Object.create({ title: "inherited" }), "title")).toBeUndefined()
    expect(getPath({ array: ["yes"] }, "array.0")).toBe("yes")
    expect(getPath({ array: ["yes"] }, "array.length")).toBeUndefined()
    expect(renderTemplate("/notices/{id}?name={name}", { id: "a/b", name: "a&b" })).toBe("/notices/a%2Fb?name=a%26b")
    for (const path of ["__proto__.title", "a.constructor", "prototype", "a..b", "a.b.c.d.e.f.g.h.i", "items.*", "items[0]"]) expect(() => getPath({}, path)).toThrow()
  })

  it.each(["mode", "headers", "method", "bodyJson", "windowVar", "jsonKey", "itemsObjectValues", "nextPage", "detail", "credential", "publishedAtUnit", "requireBoolean", "minNumeric"])("rejects unimplemented %s config", (key) => {
    expect(() => assertJsonListConfig({ ...config, [key]: "unsupported" })).toThrow()
  })

  it.each(["https://{host}/x", "//{host}/x", " //{host}/x", "\\\\{host}/x", "http://example.com/{id}", "https://u:p@example.com/{id}", "/x/{raw:id}", "/x/{id", "/x/static"])("rejects unsafe/malformed template %s", (urlTemplate) => {
    expect(() => assertJsonListConfig({ ...config, urlTemplate })).toThrow()
  })

  it.each([null, {}, { items: [] }, "[]", 0, [null], [[]], [{ id: "x" }], [{ ...record, title: {} }], [{ ...record, id: null }], [{ ...record, published: {} }], [{ ...record, summary: {} }]])("fails closed on wrong shape %j", (data) => {
    expect(() => parse(data)).toThrow()
  })

  it("rejects JSONP/scripts, missing nested arrays and excessive items", () => {
    for (const body of ["callback([])", "window.data=[]", "<script>[]</script>", "[{]"]) expect(() => fromJson(body, base, config, policy)).toThrow()
    expect(() => parse({}, { ...config, itemsPath: "items" })).toThrow()
    expect(() => parse(Array.from({ length: 501 }, () => record))).toThrow("item_limit")
  })

  it("does not expose malformed response fragments in run error messages", () => {
    expect(() => fromJson("private-response-marker is not JSON", base, config, policy)).toThrow(/^json_list_invalid_json$/)
  })

  it("canonicalizes business query identity and rejects disallowed links even among valid items", () => {
    const c: JsonListConfig = { ...config, urlTemplate: undefined, urlPath: "url" }
    const records = ["/detail?id=1&utm_source=test#top", "/detail?id=1", "/detail?id=2"].map(url => ({ ...record, url }))
    expect(parse(records, c).map(e => e.canonicalUrl)).toEqual(["https://api.data.gov.my/detail?id=1", "https://api.data.gov.my/detail?id=2"])
    for (const url of ["http://api.data.gov.my/detail", "https://evil.invalid/detail", "https://127.0.0.1/detail", "https://u:p@api.data.gov.my/detail", "https://api.data.gov.my:444/detail", base, "javascript:alert(1)"]) expect(() => parse([records[0], { ...record, url }], c)).toThrow("invalid_link")
    expect(() => parse([record], { ...config, denyUrlPrefixes: ["https://api.data.gov.my/notices"] })).toThrow()
  })
})
