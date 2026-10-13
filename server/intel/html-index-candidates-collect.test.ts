import { describe, expect, it } from "vitest"
import { open } from "./__fixtures__/isolated-db"
import { type IntelFetchDeps, collectIntelSource } from "./collect"
import { htmlIndexCandidates } from "./sources/html-index-candidates"
import { CUSTOMS_SYNTHETIC, NORTHPORT_SYNTHETIC } from "./sources/__fixtures__/html-index-synthetic"
import { initShippingTables } from "#/database/shipping"

const NOW = new Date("2026-10-13T08:00:00Z")
const cases = htmlIndexCandidates.map((seed, index) => ({ seed, html: [NORTHPORT_SYNTHETIC, CUSTOMS_SYNTHETIC][index], count: [3, 2][index] }))
const offline = (html: string): IntelFetchDeps => ({ lookup: async () => [{ address: "93.184.216.34", family: 4 }], transport: async () => ({ status: 200, headers: { "content-type": "text/html; charset=utf-8" }, body: new TextEncoder().encode(html) }) })

describe("disabled HTML candidates: synthetic collector to SQLite only", () => {
  it.each(cases)("stores $seed.catalogId title/link/date pairs idempotently without publication instants", async ({ seed, html, count }) => {
    const state = open()
    try {
      await initShippingTables(state.database, "mock")
      await state.repository.upsertSource(seed, NOW.toISOString())
      expect(await collectIntelSource(state.repository, seed, offline(html), NOW)).toMatchObject({ status: "ok_items", itemsNew: count, itemsSeen: count })
      const original = await state.repository.listItems(seed.id)
      expect(original).toHaveLength(count)
      for (const item of original) {
        expect(item.publishedAt).toBeNull()
        const versions = await state.repository.listVersions(item.id)
        expect(versions).toHaveLength(1)
        expect(versions[0].contentScope).toBe("metadata_only")
        expect(versions[0].dateEvidence?.timezone).toBe("missing")
        expect(versions[0].dateEvidence?.publishedAt).toBeNull()
        expect(await state.repository.readVersionBlocks(versions[0].id)).toEqual([expect.objectContaining({ type: "title", text: item.title })])
      }
      const first = original.find(item => item.canonicalUrl.includes(seed.catalogId === "MY-P03" ? "one.pdf" : "current_id=first"))!
      expect((await state.repository.listVersions(first.id))[0].dateEvidence).toMatchObject(seed.catalogId === "MY-P03" ? { raw: "6-10-2026", localDate: "2026-10-06", calendar: "gregorian" } : { raw: "13 ตุลาคม 2569", localDate: "2026-10-13", calendar: "buddhist" })
      expect(await collectIntelSource(state.repository, seed, offline(html), new Date(NOW.getTime() + 1000))).toMatchObject({ status: "ok_items", itemsNew: 0, itemsRevised: 0 })
      expect((await state.repository.listItems(seed.id)).map(item => item.id).sort()).toEqual(original.map(item => item.id).sort())
      for (const item of original) expect(await state.repository.listVersions(item.id)).toHaveLength(1)
    } finally {
      state.native.close()
    }
  })
  it.each(cases)("preserves $seed.catalogId records and versions on changed structure or invalid links", async ({ seed, html }) => {
    const state = open()
    try {
      await initShippingTables(state.database, "mock")
      await state.repository.upsertSource(seed, NOW.toISOString())
      await collectIntelSource(state.repository, seed, offline(html), NOW)
      const before = await state.repository.listItems(seed.id)
      const versions = await Promise.all(before.map(item => state.repository.listVersions(item.id)))
      for (const broken of ["<html>Authentication required</html>", html.replaceAll(/href="[^"]+"/g, "href=\"https://127.0.0.1/notice\"")]) {
        expect(await collectIntelSource(state.repository, seed, offline(broken), new Date(NOW.getTime() + 2000))).toMatchObject({ status: "failed", errorCode: "parse_failed", itemsCommitted: 0 })
        expect(await state.repository.listItems(seed.id)).toEqual(before)
        expect(await Promise.all(before.map(item => state.repository.listVersions(item.id)))).toEqual(versions)
      }
    } finally {
      state.native.close()
    }
  })
})
