import { readFileSync } from "node:fs"
import { expect, it } from "vitest"
import { open } from "./__fixtures__/isolated-db"
import { type IntelFetchDeps, collectIntelSource } from "./collect"
import { htmlIndexCandidates } from "./sources/html-index-candidates"
import { syntheticNorthportPair } from "./sources/__fixtures__/web-list-conflict-synthetic"
import { WEB_LIST_DUPLICATE_CONFLICT } from "./sources/web-list"
import { initShippingTables } from "#/database/shipping"

const seed = htmlIndexCandidates[0]
const groups: { url: string, listedDates: string[] }[] = JSON.parse(readFileSync("docs/evidence/r2-two-html-live-2026-10-13/MY-P03-duplicate-link-observation.json", "utf8")).duplicateGroups
const now = new Date("2026-10-13T10:00:00Z")
const offline = (html: string): IntelFetchDeps => ({ lookup: async () => [{ address: "93.184.216.34", family: 4 }], transport: async () => ({ status: 200, headers: { "content-type": "text/html; charset=utf-8" }, body: new TextEncoder().encode(html) }) })

it.each(groups)("synthetic conflict $url fails with dedicated code and preserves prior rows/versions in either order", async ({ url, listedDates }) => {
  const state = open()
  try {
    await initShippingTables(state.database, "mock")
    await state.repository.upsertSource(seed, now.toISOString())
    const original = syntheticNorthportPair(url, [{ title: "Synthetic retained notice", date: listedDates[0] }])
    expect(await collectIntelSource(state.repository, seed, offline(original), now)).toMatchObject({ status: "ok_items", itemsNew: 1 })
    const before = await state.repository.listItems(seed.id)
    const versions = await state.repository.listVersions(before[0].id)
    const blocks = await state.repository.readVersionBlocks(versions[0].id)
    const conflict = listedDates.map(date => ({ title: "Synthetic conflicting update", date }))
    for (const order of [conflict, [...conflict].reverse()]) {
      expect(await collectIntelSource(state.repository, seed, offline(syntheticNorthportPair(url, order)), new Date(now.getTime() + 1000))).toMatchObject({ status: "failed", errorCode: WEB_LIST_DUPLICATE_CONFLICT, itemsCommitted: 0 })
      expect(await state.repository.listItems(seed.id)).toEqual(before)
      expect(await state.repository.listVersions(before[0].id)).toEqual(versions)
      expect(await state.repository.readVersionBlocks(versions[0].id)).toEqual(blocks)
      expect(await state.repository.getSource(seed.id)).toMatchObject({ status: "failing", lastErrorCode: WEB_LIST_DUPLICATE_CONFLICT, lastOkAt: now.toISOString() })
    }
  } finally {
    state.native.close()
  }
})

it("synthetic exact duplicates retain normal collection and one version on repeated runs", async () => {
  const state = open()
  try {
    await initShippingTables(state.database, "mock")
    await state.repository.upsertSource(seed, now.toISOString())
    const pair = { title: "Synthetic identical notice", date: groups[0].listedDates[0] }
    const html = syntheticNorthportPair(groups[0].url, [pair, pair])
    expect(await collectIntelSource(state.repository, seed, offline(html), now)).toMatchObject({ status: "ok_items", itemsSeen: 1, itemsNew: 1 })
    expect(await collectIntelSource(state.repository, seed, offline(html), new Date(now.getTime() + 1000))).toMatchObject({ status: "ok_items", itemsSeen: 1, itemsNew: 0, itemsRevised: 0 })
    const items = await state.repository.listItems(seed.id)
    expect(items).toHaveLength(1)
    expect(await state.repository.listVersions(items[0].id)).toHaveLength(1)
  } finally {
    state.native.close()
  }
})
