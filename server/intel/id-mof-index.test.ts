import net from "node:net"
import dns from "node:dns/promises"
import { describe, expect, it, vi } from "vitest"
import { htmlIndexCandidates } from "./sources/html-index-candidates"
import { intelSourceSeeds } from "./sources"
import { assertSupportedConfig } from "./sources/config-keys"
import { fromHtml, parseLooseDate } from "./sources/web-list"
import { JDIH_MOF_SYNTHETIC } from "./sources/__fixtures__/public-index-synthetic"
import { collectIntelSource, sourcePolicy } from "./collect"
import { open } from "./__fixtures__/isolated-db"
import { initShippingTables } from "#/database/shipping"

const seed = htmlIndexCandidates.find(s => s.catalogId === "ID-T02")!
const config = seed.webList!
const target = "https://jdih.kemenkeu.go.id/home"
const policy = sourcePolicy(seed)
const NOW = new Date("2026-10-15T07:37:48.920Z")

describe("disabled JDIH MOF law-card metadata", () => {
  it("keeps the exact catalogue root, default-off source and metadata-only permission", () => {
    expect(seed).toMatchObject({ url: "https://jdih.kemenkeu.go.id/", enabled: false, persistence: "disallowed", allowedHosts: ["jdih.kemenkeu.go.id"] })
    expect(intelSourceSeeds.some(s => s.catalogId === "ID-T02")).toBe(false)
    expect(policy.allowHttp).toBeUndefined()
    assertSupportedConfig(config)
  })
  it("pairs each own link/descriptive title/card-tag day and dedupes equal repeated groups", () => {
    const entries = fromHtml(JDIH_MOF_SYNTHETIC, target, config, policy)
    expect(entries.map(e => [e.title, e.canonicalUrl, e.dateEvidence.raw, e.dateEvidence.localDate])).toEqual([
      ["Synthetic complete regulation one", "https://jdih.kemenkeu.go.id/dok/synthetic-one", "08 Okt 2026", "2026-10-08"],
      ["Synthetic complete leap regulation", "https://jdih.kemenkeu.go.id/dok/synthetic-two", "29 Feb 2000", "2000-02-29"],
      ["Synthetic historical regulation", "https://jdih.kemenkeu.go.id/dok/synthetic-old", "20 Mei 2025", "2025-05-20"],
    ])
    expect(entries.every(e => e.bodyText === "" && e.publishedAt === undefined && e.dateEvidence.timezone === "missing" && e.dateEvidence.utcOffset === null)).toBe(true)
    expect(entries[0].dateEvidence.basis).toContain("not certified publication/enactment/effectiveness")
  })
  it.each(["08 Okt 2026", "31 Jul 2026", "16 Agu 2007", "20 Mei 2025", "29 Feb 2000"])("keeps explicit raw Gregorian day and missing timezone for %s", (raw) => {
    expect(parseLooseDate(raw, config)).toMatchObject({ raw, precision: "day", calendar: "gregorian", timezone: "missing", utcOffset: null, publishedAt: null })
    expect(parseLooseDate(raw, { ...config, dateFormat: undefined }).localDate).toBeNull()
  })
  it.each(["29 Feb 1900", "29 Feb 2025", "31 Apr 2026", "00 Okt 2026", "32 Okt 2026", "8 Okt 2026", "08 Oktober 2026", "08 Oct 2026", "08 okt 2026", "08 Okt 2569", "2026-10-08", "08 Okt 2026 10:00", "(08 Okt 2026)", "Ditetapkan 08 Okt 2026", "prefix 08 Okt 2026"])("does not search, fall back or invent a date for %s", (raw) => {
    expect(parseLooseDate(raw, config)).toMatchObject({ raw, localDate: null, publishedAt: null, precision: "unknown", utcOffset: null })
  })
  it("rejects configured calendars/offsets and keeps direct calls day-only", () => {
    for (const extra of [{ calendar: "buddhist" }, { publishedAtUtcOffset: "+07:00" }, { dateFormat: "locale_auto" }]) expect(() => assertSupportedConfig({ ...config, ...extra })).toThrow()
    expect(parseLooseDate("08 Okt 2026", { ...config, publishedAtUtcOffset: "+07:00" })).toMatchObject({ localDate: "2026-10-08", timezone: "missing", utcOffset: null, publishedAt: null })
  })
  it("fails closed on conflicting repeated descriptive title or raw date", () => {
    for (const changed of [JDIH_MOF_SYNTHETIC.replace("Synthetic complete leap regulation", "Conflicting descriptive title"), JDIH_MOF_SYNTHETIC.replace("29 Feb 2000", "28 Feb 2000"), JDIH_MOF_SYNTHETIC.replace("29 Feb 2000", "unknown card day")]) expect(() => fromHtml(changed, target, config, policy)).toThrow("web_list_duplicate_conflict")
  })
  it.each(["http://jdih.kemenkeu.go.id/dok/one", "https://evil.test/dok/one", "https://user:pass@jdih.kemenkeu.go.id/dok/one", "https://jdih.kemenkeu.go.id:9443/dok/one", "https://jdih.kemenkeu.go.id/dokument/one", "https://jdih.kemenkeu.go.id/search"])("rejects non-policy or non-document identity %s", (href) => {
    expect(() => fromHtml(JDIH_MOF_SYNTHETIC.replaceAll(/href="\/dok\/[^"]+"/g, `href="${href}"`), target, config, policy)).toThrow("web_list_no_allowed_items")
  })
  it("collects the saved-shape redirect chain twice with zero network, scripts or detail calls", async () => {
    let tcp = 0
    let systemDns = 0
    let fetch = 0
    const tcpGuard = vi.spyOn(net.Socket.prototype, "connect").mockImplementation(() => {
      tcp++
      throw new Error("network forbidden")
    })
    const dnsGuard = vi.spyOn(dns, "lookup").mockImplementation(async () => {
      systemDns++
      throw new Error("DNS forbidden")
    })
    vi.stubGlobal("fetch", () => {
      fetch++
      throw new Error("fetch forbidden")
    })
    const state = open()
    const transport = vi.fn(async (url: URL) => {
      expect([seed.url, target]).toContain(url.href)
      return url.href === seed.url ? { status: 307, headers: { location: "/home" }, body: new TextEncoder().encode("/home") } : { status: 200, headers: { "content-type": "text/html; charset=utf-8" }, body: new TextEncoder().encode(JDIH_MOF_SYNTHETIC) }
    })
    try {
      await initShippingTables(state.database, "mock")
      await state.repository.upsertSource(seed, NOW.toISOString())
      const usage = state.native.prepare("SELECT * FROM provider_usage ORDER BY rowid").all()
      const deps = { lookup: async () => [{ address: "93.184.216.34", family: 4 as const }], transport }
      expect(await collectIntelSource(state.repository, seed, deps, NOW)).toMatchObject({ status: "ok_items", itemsSeen: 3, itemsNew: 3, itemsRevised: 0 })
      expect(await collectIntelSource(state.repository, seed, deps, new Date(NOW.getTime() + 1000))).toMatchObject({ status: "ok_items", itemsSeen: 3, itemsNew: 0, itemsRevised: 0 })
      expect(transport.mock.calls.map(([u]) => u.href)).toEqual([seed.url, target, seed.url, target])
      const items = await state.repository.listItems(seed.id)
      expect(items).toHaveLength(3)
      for (const item of items) {
        expect(item.publishedAt).toBeNull()
        const versions = await state.repository.listVersions(item.id)
        expect(versions).toHaveLength(1)
        expect(versions[0]).toMatchObject({ contentScope: "metadata_only", sourcePublishedAt: null, dateEvidence: { timezone: "missing", utcOffset: null, publishedAt: null, precision: "day" } })
        expect(await state.repository.readVersionBlocks(versions[0].id)).toEqual([expect.objectContaining({ type: "title", text: item.title })])
      }
      expect(state.native.prepare("SELECT * FROM provider_usage ORDER BY rowid").all()).toEqual(usage)
      expect(tcp + systemDns + fetch).toBe(0)
    } finally {
      state.native.close()
      tcpGuard.mockRestore()
      dnsGuard.mockRestore()
      vi.unstubAllGlobals()
    }
  })
})
