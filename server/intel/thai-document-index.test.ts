import { expect, it } from "vitest"
import { open } from "./__fixtures__/isolated-db"
import { collectIntelSource, sourcePolicy } from "./collect"
import { htmlIndexCandidates } from "./sources/html-index-candidates"
import { WEB_LIST_DUPLICATE_CONFLICT, fromHtml } from "./sources/web-list"
import { initShippingTables } from "#/database/shipping"

const seed = htmlIndexCandidates.find(s => s.catalogId === "TH-C02")!
// Authored synthetic rows; not copied from the unknown-permission raw page.
function markup(secondId = "second", date = "8 ตุลาคม 2569", secondTitle = "Synthetic same document title") {
  return `<table class="table table-hover"><tbody>
<tr><td>1</td><td>120/2569</td><td><a href="cont_strc_download_with_docno_date.php?lang=th&current_id=first">Synthetic same document title</a></td><td>9 ตุลาคม 2569</td><td>120</td></tr>
<tr><td>2</td><td>124/2569</td><td><a href="cont_strc_download_with_docno_date.php?lang=th&current_id=${secondId}">${secondTitle}</a></td><td>${date}</td><td>137</td></tr>
</tbody></table>`
}
const now = new Date("2026-10-14T08:40:00Z")
const offline = (body: string) => ({ lookup: async () => [{ address: "93.184.216.34", family: 4 as const }], transport: async () => ({ status: 200, headers: { "content-type": "text/html; charset=utf-8" }, body: new TextEncoder().encode(body) }) })
it("synthetic Thai document rows keep document numbers/counters apart from actual local document dates", () => {
  const entries = fromHtml(markup(), seed.url, seed.webList!, sourcePolicy(seed))
  expect(entries).toHaveLength(2)
  expect(entries.map(e => e.dateEvidence.localDate)).toEqual(["2026-10-09", "2026-10-08"])
  expect(entries.every(e => e.title === "Synthetic same document title" && !e.publishedAt && e.dateEvidence.timezone === "missing")).toBe(true)
  expect(entries[0].dateEvidence).toMatchObject({ raw: "9 ตุลาคม 2569", precision: "day", calendar: "buddhist", publishedAt: null })
  expect(entries[0].dateEvidence.basis).toContain("document date")
  expect(entries.map(e => e.canonicalUrl)).toEqual(["https://www.customs.go.th/cont_strc_download_with_docno_date.php?current_id=first&lang=th", "https://www.customs.go.th/cont_strc_download_with_docno_date.php?current_id=second&lang=th"])
})
it("synthetic Thai document collector persists metadata only and repeated rows produce no new versions", async () => {
  const state = open()
  try {
    await initShippingTables(state.database, "mock")
    await state.repository.upsertSource(seed, now.toISOString())
    expect(await collectIntelSource(state.repository, seed, offline(markup()), now)).toMatchObject({ status: "ok_items", itemsNew: 2 })
    const items = await state.repository.listItems(seed.id)
    for (const item of items) {
      const versions = await state.repository.listVersions(item.id)
      expect(versions).toHaveLength(1)
      expect(versions[0]).toMatchObject({ contentScope: "metadata_only", dateEvidence: { precision: "day", timezone: "missing", publishedAt: null } })
      expect(await state.repository.readVersionBlocks(versions[0].id)).toEqual([expect.objectContaining({ type: "title", text: item.title })])
    }
    expect(await collectIntelSource(state.repository, seed, offline(markup()), new Date(now.getTime() + 1000))).toMatchObject({ status: "ok_items", itemsNew: 0, itemsRevised: 0 })
    for (const item of items) expect(await state.repository.listVersions(item.id)).toHaveLength(1)
  } finally {
    state.native.close()
  }
})
it.each([markup("first"), markup("first", "9 ตุลาคม 2569", "Synthetic conflicting title")])("synthetic same document URL with a conflicting title/date remains fail-closed", (html) => {
  expect(() => fromHtml(html, seed.url, seed.webList!, sourcePolicy(seed))).toThrow(WEB_LIST_DUPLICATE_CONFLICT)
})
