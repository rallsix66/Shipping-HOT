import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { sourcePolicy } from "../collect"
import { htmlIndexCandidates } from "./html-index-candidates"
import { WEB_LIST_DUPLICATE_CONFLICT, fromHtml } from "./web-list"
import { syntheticNorthportPair } from "./__fixtures__/web-list-conflict-synthetic"

const seed = htmlIndexCandidates[0]
const fact = JSON.parse(readFileSync("docs/evidence/r2-two-html-live-2026-10-13/MY-P03-duplicate-link-observation.json", "utf8"))
const groups: { url: string, listedDates: string[] }[] = fact.duplicateGroups
// Generated SYNTHETIC markup from retained URL/date facts. Never treated as archived original HTML.
const parse = (markup: string) => fromHtml(markup, seed.url, seed.webList!, sourcePolicy(seed))

describe("synthetic same-URL association conflicts from saved Northport facts", () => {
  it("merges truly identical title/date evidence after whitespace and canonical-URL normalization", () => {
    const url = groups[0].url
    const html = syntheticNorthportPair(url, [{ date: groups[0].listedDates[0], title: "Synthetic  notice", href: `${url}#first` }, { date: groups[0].listedDates[0], title: "Synthetic notice", href: `${url}?utm_source=synthetic#second` }])
    const entries = parse(html)
    expect(entries).toHaveLength(1)
    expect(entries[0].dateEvidence.raw).toBe(groups[0].listedDates[0])
    expect(entries[0].title).toBe("Synthetic notice")
  })
  it.each(groups)("rejects the retained differing date facts for $url in either order", ({ url, listedDates }) => {
    const rows = listedDates.map(date => ({ date, title: "Synthetic same title" }))
    for (const order of [rows, [...rows].reverse()]) expect(() => parse(syntheticNorthportPair(url, order))).toThrow(WEB_LIST_DUPLICATE_CONFLICT)
  })
  it("rejects title conflicts even with identical dates in either order", () => {
    const rows = [{ date: groups[0].listedDates[0], title: "Synthetic first title" }, { date: groups[0].listedDates[0], title: "Synthetic second title" }]
    for (const order of [rows, [...rows].reverse()]) expect(() => parse(syntheticNorthportPair(groups[0].url, order))).toThrow(WEB_LIST_DUPLICATE_CONFLICT)
  })
})

describe("synthetic date-evidence conflict boundaries", () => {
  const base = "https://www.northport.com.my/list"
  const config = { listSelector: "#items", itemSelector: "li", linkSelector: "a", publishedAtSelector: "time", dateOrder: "dmy" as const, dateRuleBasis: "Synthetic date-boundary regression, not real DOM replay" }
  const markup = (dates: (string | null)[]) => `<ul id="items">${dates.map(date => `<li><a href="/same">Synthetic notice</a>${date === null ? "" : `<time>${date}</time>`}</li>`).join("")}</ul>`
  it.each([[null, "9-6-2024"], ["10-2024", "9-6-2024"], [null, "10-2024"], ["10-2024", "11-2024"], ["9-6-2024", "09-06-2024"], ["9-6-2024", "9-6-2024 00:00Z"]] as (string | null)[][])("rejects differing provenance/precision %j in both orders", (first, second) => {
    for (const dates of [[first, second], [second, first]]) expect(() => fromHtml(markup(dates), base, config, sourcePolicy(seed))).toThrow(WEB_LIST_DUPLICATE_CONFLICT)
  })
  it.each([[null, null], ["10-2024", "10-2024"]] as (string | null)[][])("merges identical unknown evidence %j without inventing time", (first, second) => {
    const entries = fromHtml(markup([first, second]), base, config, sourcePolicy(seed))
    expect(entries).toHaveLength(1)
    expect(entries[0].publishedAt).toBeUndefined()
    expect(entries[0].dateEvidence.localDate).toBeNull()
  })
})
