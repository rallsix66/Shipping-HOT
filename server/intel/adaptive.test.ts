import { expect, it } from "vitest"
import { adaptiveIntervalMs, adaptiveWindow } from "#/intel/adaptive"
import { open } from "#/intel/__fixtures__/isolated-db"
import { initShippingTables } from "#/database/shipping"
import { collectIntelSource } from "#/intel/collect"
import { intelSourceSeeds } from "#/intel/sources"

it("uses the verified upstream 7-day/3 formula and source-specific min/max", () => {
  const bounds = { minMinutes: 15, maxMinutes: 60 }
  expect([0, 1, 70, 140, 700].map(n => adaptiveIntervalMs(n, bounds) / 60000)).toEqual([60, 60, 48, 24, 15])
  expect(adaptiveIntervalMs(0, { minMinutes: 60, maxMinutes: 180 })).toBe(180 * 60000)
  expect(adaptiveIntervalMs(700, { minMinutes: 60, maxMinutes: 180 })).toBe(60 * 60000)
  expect(() => adaptiveIntervalMs(-1, bounds)).toThrow("bounds_invalid")
  expect(() => adaptiveIntervalMs(1, { minMinutes: 1, maxMinutes: 60 })).toThrow("bounds_invalid")
  expect(() => adaptiveIntervalMs(700, { minMinutes: 15.2, maxMinutes: 60 })).toThrow("bounds_invalid")
  expect(adaptiveWindow(new Date("2026-10-20T12:00:00Z"))).toEqual({ from: "2026-10-13T00:00:00.000Z", until: "2026-10-20T00:00:00.000Z" })
})

it("excludes initial import/manual/today, adjusts successes and coordinates failure backoff", async () => {
  const state = open()
  const seed = { ...intelSourceSeeds[0], adaptive: { minMinutes: 15, maxMinutes: 60 } }
  const initial = "2026-10-14T00:00:00.000Z"
  const entry = async (id: string, at: string, extractor = "intel-feed-v1") => state.repository.writeEntry({ sourceId: seed.id, canonicalUrl: `https://www.tmd.go.th/synthetic/${id}`, title: "Synthetic adaptation test", contentHash: id, contentScope: "metadata_only", extractorVersion: extractor, blocks: [], fetchedAt: at })
  try {
    await initShippingTables(state.database, "real")
    await state.repository.upsertSource(seed, initial)
    const first = await state.repository.beginRun(seed.id, initial)
    await entry("initial", initial)
    await state.repository.completeRun(first!, { status: "ok_items", finishedAt: initial })
    for (let i = 0; i < 140; i++) await entry(`new-${i}`, "2026-10-15T12:00:00.000Z")
    await entry("manual", "2026-10-15T12:00:00.000Z", "manual-plain-v1")
    await entry("old", "2026-10-12T00:00:00.000Z")
    await entry("today", "2026-10-20T10:00:00.000Z")
    const window = adaptiveWindow(new Date("2026-10-20T12:00:00Z"))
    expect(await state.repository.countAdaptiveDiscoveries(seed.id, window.from, window.until)).toBe(140)
    let fail = false
    const transport = async () => fail ? { status: 503, headers: {}, body: "" } : { status: 200, headers: { "content-type": "application/rss+xml" }, body: "<rss><channel><title>Synthetic empty</title></channel></rss>" }
    const deps = { lookup: async () => [{ address: "93.184.216.34", family: 4 as const }], transport }
    await collectIntelSource(state.repository, seed, deps, new Date("2026-10-20T12:00:00Z"))
    expect((await state.repository.getSource(seed.id))?.nextSyncAt).toBe("2026-10-20T12:24:00.000Z")
    fail = true
    await collectIntelSource(state.repository, seed, deps, new Date("2026-10-20T13:00:00Z"))
    expect(await state.repository.getSource(seed.id)).toMatchObject({ status: "failing", nextSyncAt: "2026-10-20T13:15:00.000Z" })
    fail = false
    await collectIntelSource(state.repository, seed, deps, new Date("2026-10-20T14:00:00Z"))
    expect(await state.repository.getSource(seed.id)).toMatchObject({ status: "ok_empty", consecutiveFailures: 0, nextSyncAt: "2026-10-20T14:24:00.000Z" })
  } finally {
    state.native.close()
  }
})
