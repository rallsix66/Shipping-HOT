import { expect, it } from "vitest"
import { open } from "./__fixtures__/isolated-db"
import { collectIntelSource, sourcePolicy } from "./collect"
import { htmlIndexCandidates } from "./sources/html-index-candidates"
import { WEB_LIST_DUPLICATE_CONFLICT, fromHtml, parseLooseDate } from "./sources/web-list"
import { assertSupportedConfig } from "./sources/config-keys"
import { fixtures } from "./sources/__fixtures__/post-clash-synthetic"
import { initShippingTables } from "#/database/shipping"

const cases = Object.entries(fixtures).map(([id, html]) => ({ seed: htmlIndexCandidates.find(s => s.catalogId === id)!, html }))
const id = cases[2].seed
const now = new Date("2026-10-14T09:15:00Z")
const offline = (body: string) => ({ lookup: async () => [{ address: "93.184.216.34", family: 4 as const }], transport: async () => ({ status: 200, headers: { "content-type": "text/html; charset=utf-8" }, body: new TextEncoder().encode(body) }) })
it("explicit Indonesian enacted-date grammar is Gregorian day evidence, not a publication instant", () => {
  expect(parseLooseDate("Ditetapkan 30 September 2026", id.webList!)).toMatchObject({ raw: "Ditetapkan 30 September 2026", localDate: "2026-09-30", rule: "configured_indonesian_enactment_date", calendar: "gregorian", precision: "day", timezone: "missing", utcOffset: null, publishedAt: null })
  expect(parseLooseDate("Ditetapkan 29 Februari 2000", id.webList!).localDate).toBe("2000-02-29")
  expect(parseLooseDate("Ditetapkan 14 October 2026", id.webList!)).toMatchObject({ localDate: "2026-10-14", precision: "day", timezone: "missing", publishedAt: null })
  expect(parseLooseDate("Ditetapkan 30 September 2026", { ...id.webList!, dateFormat: undefined }).localDate).toBeNull()
  expect(() => assertSupportedConfig({ ...id.webList!, calendar: "buddhist" })).toThrow("Gregorian")
})
it.each(["Ditetapkan 29 Februari 1900", "Ditetapkan 29 Februari 2025", "Ditetapkan 31 April 2026", "Ditetapkan 0 Oktober 2026", "Ditetapkan 32 Oktober 2026", "Ditetapkan 14 Unknown 2026", "Ditetapkan 14 Okt 2026", "14 Oktober 2026", "Diundangkan 14 Oktober 2026", "Ditetapkan 14 Oktober 2026 10:30", "Ditetapkan 14 Oktober 2026 extra", "B.E. Ditetapkan 14 Oktober 2569", "2008 TAHUN 2026"])("rejects unsupported/invalid enacted-date %s", (raw) => {
  expect(parseLooseDate(raw, id.webList!).localDate).toBeNull()
})
it.each(cases)("synthetic $seed.catalogId uses only its title/date nodes and repeats metadata idempotently", async ({ seed, html }) => {
  const entries = fromHtml(html, seed.url, seed.webList!, sourcePolicy(seed))
  expect(entries).toHaveLength(2)
  expect(entries.every(e => e.title.startsWith("Synthetic") && e.dateEvidence.localDate && !e.publishedAt)).toBe(true)
  if (seed.catalogId === "ID-T01") {
    expect(entries[0].title).toBe("Synthetic regulation title…")
    expect(entries[0].dateEvidence.basis).toContain("enactment day")
  }
  if (seed.catalogId === "VN-T01") expect(entries[0].canonicalUrl).toBe("https://idea.gov.vn/default.aspx?do=detail&id=one&page=news")
  const state = open()
  try {
    await initShippingTables(state.database, "mock")
    await state.repository.upsertSource(seed, now.toISOString())
    expect(await collectIntelSource(state.repository, seed, offline(html), now)).toMatchObject({ status: "ok_items", itemsNew: 2 })
    const items = await state.repository.listItems(seed.id)
    for (const item of items) {
      const version = (await state.repository.listVersions(item.id))[0]
      expect(version.dateEvidence).toEqual(entries.find(e => e.canonicalUrl === item.canonicalUrl)!.dateEvidence)
      expect(version.contentScope).toBe("metadata_only")
      expect(await state.repository.readVersionBlocks(version.id)).toEqual([expect.objectContaining({ type: "title", text: item.title })])
    }
    expect(await collectIntelSource(state.repository, seed, offline(html), new Date(now.getTime() + 1000))).toMatchObject({ status: "ok_items", itemsNew: 0, itemsRevised: 0 })
    for (const item of items) expect(await state.repository.listVersions(item.id)).toHaveLength(1)
  } finally {
    state.native.close()
  }
})
it("synthetic enacted-date duplicate URL with conflicting date keeps the existing fail-closed rule", () => {
  const conflict = fixtures["ID-T01"].replace("/peraturan/two", "/peraturan/one").replace("Synthetic second regulation", "Synthetic regulation title…")
  expect(() => fromHtml(conflict, id.url, id.webList!, sourcePolicy(id))).toThrow(WEB_LIST_DUPLICATE_CONFLICT)
})
