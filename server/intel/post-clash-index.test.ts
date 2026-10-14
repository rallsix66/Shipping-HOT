import { expect, it } from "vitest"
import { open } from "./__fixtures__/isolated-db"
import { collectIntelSource, sourcePolicy } from "./collect"
import { htmlIndexCandidates } from "./sources/html-index-candidates"
import { WEB_LIST_DUPLICATE_CONFLICT, fromHtml, parseLooseDate } from "./sources/web-list"
import { assertSupportedConfig } from "./sources/config-keys"
import { initShippingTables } from "#/database/shipping"

// Authored synthetic structure/identity boundaries, not copied upstream pages.
const fixtures = {
  "VN-P03": `<div class="page-container"><div class="news"><div class="news-card"><a href="/tin-tuc/one.html">Image label</a><div class="info"><p class="news-label date">18/09/2026</p><h3 class="title"><a href="/tin-tuc/one.html">Synthetic terminal news</a></h3></div></div><div class="news-card"><div class="info"><p class="news-label date">29/02/2024</p><h3 class="title"><a href="/tin-tuc/two.html">Synthetic second news</a></h3></div></div></div></div>`,
  "VN-T01": `<ul id="newSlider"><li><a class="news012ndLink" href="./default.aspx?page=news&do=detail&id=one"><div><span class="news012ndLinkTime">02/10/2026</span><span class="news012ndLinkTit">Synthetic IDEA news</span></div></a></li><li><a class="news012ndLink" href="./default.aspx?do=detail&id=two&page=news"><span class="news012ndLinkTime">01/10/2026</span><span class="news012ndLinkTit">Synthetic second IDEA news</span></a></li></ul>`,
  "ID-T01": `<div id="terkini"><div class="slider-terkini"><div class="swiper-wrapper"><div class="swiper-slide"><a class="d-inline-block" href="/peraturan/one">100 TAHUN 2026</a><p class="mt-2 mb-0">Synthetic regulation title…</p><span class="badge bg-primary">Ditetapkan 30 September 2026</span><a href="/peraturan/one">Lihat Regulasi</a></div><div class="swiper-slide"><a class="d-inline-block" href="/peraturan/two">101 TAHUN 2026</a><p class="mt-2 mb-0">Synthetic second regulation</p><span class="badge bg-primary">Ditetapkan 29 Februari 2024</span></div></div></div></div><div id="populer"><a href="/peraturan/unrelated">Synthetic popular tab not selected</a></div>`,
}
const cases = Object.entries(fixtures).map(([id, html]) => ({ seed: htmlIndexCandidates.find(s => s.catalogId === id)!, html }))
const id = cases[2].seed
const now = new Date("2026-10-14T09:15:00Z")
const offline = (body: string) => ({ lookup: async () => [{ address: "93.184.216.34", family: 4 as const }], transport: async () => ({ status: 200, headers: { "content-type": "text/html; charset=utf-8" }, body: new TextEncoder().encode(body) }) })
it("explicit Indonesian enacted-date grammar is Gregorian day evidence, not a publication instant", () => {
  expect(parseLooseDate("Ditetapkan 30 September 2026", id.webList!)).toMatchObject({ raw: "Ditetapkan 30 September 2026", localDate: "2026-09-30", rule: "configured_indonesian_enactment_date", calendar: "gregorian", precision: "day", timezone: "missing", utcOffset: null, publishedAt: null })
  expect(parseLooseDate("Ditetapkan 29 Februari 2000", id.webList!).localDate).toBe("2000-02-29")
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
