import { expect, it } from "vitest"
import { initShippingTables } from "../database/shipping"
import { open } from "./__fixtures__/isolated-db"
import { collectIntelSource, sourcePolicy } from "./collect"
import { htmlIndexCandidates } from "./sources/html-index-candidates"
import { assertSupportedConfig } from "./sources/config-keys"
import { fromHtml } from "./sources/web-list"

const seed = htmlIndexCandidates.find(s => s.catalogId === "VN-D01")!
const policy = sourcePolicy(seed)
const card = (href: string, title: string, visible: string) => `<li><div class="item"><div class="row"><div class="col-md-10 title_item"><p><a href="${href}" title="${title}">${visible}</a></p></div></div></div></li>`
const page = (content: string) => `<div class="boxtopnews"><ul class="news-headlines">${content}</ul></div>`
const synthetic = page(card("/Pages/one.aspx", "Synthetic full news title with its actual punctuation.", "Synthetic shortened... (14/10/2026)") + card("/Pages/two.aspx", "Synthetic second news", "Synthetic second news (29/2/2024)"))

it("maps only each synthetic anchor's full title attribute and terminal DMY day", () => {
  const result = fromHtml(synthetic, seed.url, seed.webList!, policy)
  expect(result).toHaveLength(2)
  expect(result[0]).toMatchObject({ title: "Synthetic full news title with its actual punctuation.", canonicalUrl: "https://phongchongthientai.mard.gov.vn/Pages/one.aspx", dateEvidence: { raw: "14/10/2026", localDate: "2026-10-14", precision: "day", timezone: "missing", publishedAt: null } })
  expect(result[1].dateEvidence.localDate).toBe("2024-02-29")
})
it.each(["Synthetic news (29/2/2025)", "Synthetic news (31/4/2026)", "Synthetic news (1/13/2026)", "Synthetic news (14-10-2026)", "Synthetic news (14/10/2026) trailing", "Synthetic news 14/10/2026", "Synthetic news (14/10/26)"])("keeps unsupported/invalid synthetic anchor date unknown: %s", (text) => {
  const [entry] = fromHtml(page(card("/Pages/one.aspx", "Synthetic full title", text)), seed.url, seed.webList!, policy)
  expect(entry.dateEvidence.localDate).toBeNull()
  expect(entry.publishedAt).toBeUndefined()
})
it.each(["14/10/2026", "2026-10-14", "(14/10/2026)", "   (14/10/2026)", "\u200B (14/10/2026)"])("rejects suffix mapping without a nonempty visible title and preserves raw unknown: %s", (text) => {
  const [entry] = fromHtml(page(card("/Pages/one.aspx", "Synthetic full title", text)), seed.url, seed.webList!, policy)
  expect(entry.dateEvidence).toMatchObject({ raw: text.trim(), rule: "title_dmy_date_mismatch", precision: "unknown", localDate: null, publishedAt: null, timezone: "missing", utcOffset: null })
  expect(entry.publishedAt).toBeUndefined()
})
it("does not take a neighboring synthetic date or substitute truncated text for a missing full title", () => {
  const neighboring = page(`${card("/Pages/one.aspx", "Synthetic title", "Synthetic text")}<span>14/10/2026</span>`)
  expect(fromHtml(neighboring, seed.url, seed.webList!, policy)[0].dateEvidence.localDate).toBeNull()
  expect(() => fromHtml(synthetic.replace("title=\"Synthetic full news title with its actual punctuation.\"", ""), seed.url, seed.webList!, policy)).toThrow("web_list_missing_title")
})
it("fails closed on synthetic duplicate identity/title/date conflicts", () => {
  const conflict = page(card("/Pages/one.aspx", "Synthetic title", "Synthetic title (14/10/2026)") + card("/Pages/one.aspx", "Synthetic title", "Synthetic title (13/10/2026)"))
  expect(() => fromHtml(conflict, seed.url, seed.webList!, policy)).toThrow("web_list_duplicate_conflict")
})
it.each([{ titleAttribute: undefined }, { titleAttribute: "alt" }, { publishedAtSelector: "span" }, { titleSelector: "h3" }, { dateOrder: undefined }, { dateFormat: "english_month_name" }])("rejects incompatible suffix mapping configuration %j", (extra) => {
  expect(() => assertSupportedConfig({ ...seed.webList, ...extra })).toThrow()
})
it("persists synthetic source metadata idempotently without body permission or inferred publication instant", async () => {
  const state = open()
  const now = new Date("2026-10-15T01:25:00Z")
  try {
    await initShippingTables(state.database, "mock")
    await state.repository.upsertSource(seed, now.toISOString())
    const deps = { lookup: async () => [{ address: "93.184.216.34", family: 4 as const }], transport: async () => ({ status: 200, headers: { "content-type": "text/html; charset=utf-8" }, body: new TextEncoder().encode(synthetic) }) }
    expect(await collectIntelSource(state.repository, seed, deps, now)).toMatchObject({ status: "ok_items", itemsNew: 2 })
    expect(await collectIntelSource(state.repository, seed, deps, new Date(now.getTime() + 1000))).toMatchObject({ status: "ok_items", itemsNew: 0, itemsRevised: 0 })
    const items = await state.repository.listItems(seed.id)
    for (const item of items) {
      const versions = await state.repository.listVersions(item.id)
      expect(versions).toHaveLength(1)
      expect(versions[0]).toMatchObject({ contentScope: "metadata_only", dateEvidence: { timezone: "missing", publishedAt: null } })
    }
  } finally {
    state.native.close()
  }
})
