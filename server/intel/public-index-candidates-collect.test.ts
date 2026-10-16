import { expect, it } from "vitest"
import { load } from "cheerio"
import { open } from "./__fixtures__/isolated-db"
import { collectIntelSource, sourcePolicy } from "./collect"
import { htmlIndexCandidates } from "./sources/html-index-candidates"
import { GD_SYNTHETIC, MOF_SYNTHETIC, PH_SYNTHETIC } from "./sources/__fixtures__/public-index-synthetic"
import { WEB_LIST_DUPLICATE_CONFLICT, fromHtml, parseLooseDate } from "./sources/web-list"
import { assertSupportedConfig } from "./sources/config-keys"
import { initShippingTables } from "#/database/shipping"

const cases = [
  { seed: htmlIndexCandidates.find(s => s.catalogId === "CN-T02")!, html: MOF_SYNTHETIC },
  { seed: htmlIndexCandidates.find(s => s.catalogId === "PH-C01")!, html: PH_SYNTHETIC },
  { seed: htmlIndexCandidates.find(s => s.catalogId === "CN-P01")!, html: GD_SYNTHETIC },
]
const ph = cases[1].seed
const NOW = new Date("2026-10-14T08:00:00Z")
const offline = (html: string) => ({ lookup: async () => [{ address: "93.184.216.34", family: 4 as const }], transport: async () => ({ status: 200, headers: { "content-type": "text/html; charset=utf-8" }, body: new TextEncoder().encode(html) }) })

it("explicit English month grammar retains Gregorian day evidence and no invented instant", () => {
  expect(parseLooseDate("October 14, 2026", ph.webList!)).toMatchObject({ raw: "October 14, 2026", calendar: "gregorian", rule: "configured_english_month_name", localDate: "2026-10-14", precision: "day", timezone: "missing", utcOffset: null, publishedAt: null })
  expect(parseLooseDate("February 29, 2000", ph.webList!).localDate).toBe("2000-02-29")
  expect(parseLooseDate("October 14, 2026", { ...ph.webList!, dateFormat: undefined }).localDate).toBeNull()
  expect(() => assertSupportedConfig({ ...ph.webList!, calendar: "buddhist" })).toThrow("Gregorian")
})
it.each(["February 29, 1900", "February 29, 2025", "April 31, 2026", "October 0, 2026", "October 32, 2026", "Unknown 14, 2026", "Oct 14, 2026", "october 14, 2026", "October 14th, 2026", "October 14 2026", "Published October 14, 2026", "October 14, 2026 trailing", "October 14, 2026 10:30", "2026-10-14", "B.E. October 14, 2569"])("rejects unsupported/invalid configured English date %s", (raw) => {
  expect(parseLooseDate(raw, ph.webList!).localDate).toBeNull()
})
it.each(cases)("synthetic $seed.catalogId maps only its own list and preserves metadata/day evidence on repeats", async ({ seed, html }) => {
  const entries = fromHtml(html, seed.url, seed.webList!, sourcePolicy(seed))
  expect(entries).toHaveLength(2)
  expect(entries.every(e => e.title.startsWith("Synthetic") && e.dateEvidence.localDate && !e.publishedAt)).toBe(true)
  const state = open()
  try {
    await initShippingTables(state.database, "mock")
    await state.repository.upsertSource(seed, NOW.toISOString())
    expect(await collectIntelSource(state.repository, seed, offline(html), NOW)).toMatchObject({ status: "ok_items", itemsNew: 2, itemsSeen: 2 })
    const items = await state.repository.listItems(seed.id)
    for (const item of items) {
      const versions = await state.repository.listVersions(item.id)
      expect(versions).toHaveLength(1)
      const entry = entries.find(e => e.canonicalUrl === item.canonicalUrl)!
      expect(versions[0].dateEvidence).toEqual(entry.dateEvidence)
      expect(versions[0].contentScope).toBe("metadata_only")
      expect(await state.repository.readVersionBlocks(versions[0].id)).toEqual([expect.objectContaining({ type: "title", text: item.title })])
    }
    expect(await collectIntelSource(state.repository, seed, offline(html), new Date(NOW.getTime() + 1000))).toMatchObject({ status: "ok_items", itemsNew: 0, itemsRevised: 0 })
    for (const item of items) expect(await state.repository.listVersions(item.id)).toHaveLength(1)
  } finally {
    state.native.close()
  }
})
it.each(["title", "date"])("synthetic PH duplicate URL with different %s fails closed without dropping retained rows", async (change) => {
  const state = open()
  try {
    await initShippingTables(state.database, "mock")
    await state.repository.upsertSource(ph, NOW.toISOString())
    await collectIntelSource(state.repository, ph, offline(PH_SYNTHETIC), NOW)
    const before = await state.repository.listItems(ph.id)
    const versions = await Promise.all(before.map(item => state.repository.listVersions(item.id)))
    const $ = load(PH_SYNTHETIC)
    const card = $(ph.webList!.itemSelector).first().clone()
    if (change === "title") card.find("h3.el-title > a").text("Synthetic conflicting release")
    else card.find(".el-meta").text("October 15, 2026")
    $(ph.webList!.listSelector).append(card)
    const conflict = $.html()
    expect(() => fromHtml(conflict, ph.url, ph.webList!, sourcePolicy(ph))).toThrow(WEB_LIST_DUPLICATE_CONFLICT)
    expect(await collectIntelSource(state.repository, ph, offline(conflict), new Date(NOW.getTime() + 1000))).toMatchObject({ status: "failed", errorCode: WEB_LIST_DUPLICATE_CONFLICT, itemsCommitted: 0 })
    expect(await state.repository.listItems(ph.id)).toEqual(before)
    expect(await Promise.all(before.map(item => state.repository.listVersions(item.id)))).toEqual(versions)
  } finally {
    state.native.close()
  }
})
it("synthetic PH exact duplicates dedupe and each distinct title link stays independent of Read more", () => {
  const $ = load(PH_SYNTHETIC)
  const first = $(ph.webList!.itemSelector).first().clone()
  $(ph.webList!.listSelector).append(first)
  const entries = fromHtml($.html(), ph.url, ph.webList!, sourcePolicy(ph))
  expect(entries).toHaveLength(2)
  expect(entries.map(e => e.title)).toEqual(["Synthetic customs release", "Synthetic leap release"])
  expect(entries[1].dateEvidence.localDate).toBe("2024-02-29")
})
