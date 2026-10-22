import { mkdirSync, mkdtempSync } from "node:fs"
import { join } from "node:path"
import NativeDatabase from "better-sqlite3"
import { createDatabase } from "db0"
import { describe, expect, it, vi } from "vitest"
import { IntelRepository } from "#/database/intel"
import { initShippingTables } from "#/database/shipping"
import { type IntelFetchDeps, collectIntelSource, sourcePolicy } from "#/intel/collect"
import { type IntelSourceSeed, intelSourceSeeds } from "#/intel/sources"
import { htmlIndexCandidates } from "#/intel/sources/html-index-candidates"
import { assertSupportedConfig } from "#/intel/sources/config-keys"
import { fromHtml, parseLooseDate } from "#/intel/sources/web-list"
import { maerskHtml } from "#/intel/sources/__fixtures__/maersk-news-synthetic"
import { mofcomHtml } from "#/intel/sources/__fixtures__/mofcom-policy-synthetic"
import { createIntelCollectJob } from "#/runtime/intel-collect-job"
import { productionIntelOptions } from "#/runtime/intel-production"

const maersk = htmlIndexCandidates.find(seed => seed.catalogId === "XX-K01")!
const mofcom = htmlIndexCandidates.find(seed => seed.catalogId === "CN-T01")!
const now = new Date("2026-10-20T08:00:00.000Z")
const publicAddresses = [{ address: "93.184.216.34", family: 4 as const }]

// Original synthetic markup lives in __fixtures__ (moved verbatim). Complete recorded site HTML is private and replayed separately.

function openNative(file = ":memory:") {
  const native = new NativeDatabase(file)
  const database = createDatabase({
    name: "sqlite",
    dialect: "sqlite",
    getInstance: () => native,
    exec: (sql: string) => native.exec(sql),
    prepare: (sql: string) => {
      const stmt = native.prepare(sql)
      return {
        all: async (...params: (string | number | boolean | null | undefined)[]) => stmt.all(...params),
        get: async (...params: (string | number | boolean | null | undefined)[]) => stmt.get(...params),
        run: async (...params: (string | number | boolean | null | undefined)[]) => {
          const r = stmt.run(...params)
          return { success: r.changes > 0, changes: r.changes, lastInsertRowid: r.lastInsertRowid }
        },
      }
    },
    dispose: () => native.close(),
  } as never)
  return { native, database, repository: new IntelRepository(database) }
}

async function setup(seed: IntelSourceSeed, file?: string) {
  const db = openNative(file)
  await initShippingTables(db.database, "mock")
  await db.repository.upsertSource(seed, now.toISOString())
  return db
}

function offline(html: string, location?: string) {
  const lookup = vi.fn(async () => publicAddresses)
  const transport = vi.fn<IntelFetchDeps["transport"]>(async () => location
    ? { status: 302, headers: { location }, body: "" }
    : { status: 200, headers: { "content-type": "text/html; charset=utf-8" }, body: html })
  return { lookup, transport }
}

describe("explicit abbreviated English Gregorian day", () => {
  it.each(["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"])("accepts %s only with an explicit rule, without a UTC instant", (month) => {
    const raw = `7 ${month} 2026`
    expect(parseLooseDate(raw, maersk.webList!)).toMatchObject({ raw, rule: "configured_english_month_abbr_day", role: "unknown", precision: "day", timezone: "missing", utcOffset: null, publishedAt: null })
    expect(parseLooseDate(raw, { ...maersk.webList!, dateFormat: undefined })).toMatchObject({ rule: "unsupported_format", precision: "unknown", publishedAt: null })
  })
  it.each([["29 Feb 2000", "2000-02-29"], ["29 Feb 2024", "2024-02-29"], ["07 Oct 2026", "2026-10-07"], ["31 Dec 2399", "2399-12-31"]])("validates legal day %s", (raw, localDate) => {
    expect(parseLooseDate(raw, maersk.webList!)).toMatchObject({ localDate, precision: "day", role: "unknown", publishedAt: null })
  })
  it.each(["29 Feb 1900", "29 Feb 2025", "31 Apr 2026", "0 Oct 2026", "32 Oct 2026", "20 Oct 1899", "20 Oct 2400", "7 October 2026", "7 Okt 2026", "7 oct 2026", "007 Oct 2026", "7  Oct 2026", "7 Oct 26", "(7 Oct 2026)", "Published 7 Oct 2026", "7 Oct 2026 trailing", "7 Oct 2026 00:00", "7 Oct 2026 UTC", "7 Oct 2026 +08:00"])("keeps invalid or unsupported %s raw and unknown", (raw) => {
    expect(parseLooseDate(raw, maersk.webList!)).toMatchObject({ raw, precision: "unknown", localDate: null, publishedAt: null, role: "unknown", timezone: "missing", utcOffset: null })
  })
  it("forbids calendar and timezone inference even if called directly", () => {
    for (const extra of [{ calendar: "buddhist" as const }, { publishedAtUtcOffset: "+08:00" }]) {
      expect(() => assertSupportedConfig({ ...maersk.webList, ...extra })).toThrow()
      expect(parseLooseDate("7 Oct 2026", { ...maersk.webList!, ...extra })).toMatchObject({ precision: "unknown", localDate: null, publishedAt: null })
    }
  })
})

describe("disabled metadata candidates and collector forwarding", () => {
  it("keeps both sources outside active and production selections", async () => {
    for (const seed of [maersk, mofcom]) {
      expect(seed).toMatchObject({ enabled: false, persistence: "disallowed" })
      expect(intelSourceSeeds.some(active => active.id === seed.id)).toBe(false)
      expect(() => productionIntelOptions({ env: { SHIPPING_INTEL_ENABLED: "true", SHIPPING_INTEL_SOURCE_IDS: seed.catalogId } })).toThrow("intel_source_selection_invalid")
      const db = await setup(seed)
      const deps = offline(seed === maersk ? maerskHtml : mofcomHtml)
      const job = createIntelCollectJob({ db: db.database, seeds: [seed], fetch: deps, now: () => now })
      try {
        expect(job.enabled).toBe(false)
        expect(await job.run()).toMatchObject({ status: "success", recordsRead: 0, recordsWritten: 0 })
        expect(deps.lookup).not.toHaveBeenCalled()
        expect(deps.transport).not.toHaveBeenCalled()
        expect(await db.repository.listItems(seed.id)).toEqual([])
      } finally {
        await job.end()
        db.native.close()
      }
    }
  })
  it("pairs each own title/date, excludes image duplicates and leaves HTTP policy identities out", () => {
    const m = fromHtml(maerskHtml, maersk.url, maersk.webList!, sourcePolicy(maersk))
    expect(m.map(row => [row.title, row.dateEvidence.raw, row.dateEvidence.localDate])).toEqual([["Synthetic latest news", "7 Oct 2026", "2026-10-07"], ["Synthetic advisory", "20 Oct 2026", "2026-10-20"]])
    const c = fromHtml(mofcomHtml, mofcom.url, mofcom.webList!, sourcePolicy(mofcom))
    expect(c.map(row => row.title)).toEqual(["Synthetic policy one", "Synthetic policy two"])
    expect(c.map(row => row.dateEvidence.localDate)).toEqual(["2026-10-19", "2026-10-14"])
    expect(c.every(row => row.canonicalUrl.startsWith("https:") && row.publishedAt === undefined && !row.bodyText)).toBe(true)
  })
  it.each([maersk, mofcom])("retains $catalogId metadata/date versions across repeat collection and a native SQLite reopen", async (seed) => {
    mkdirSync(".tmp", { recursive: true })
    const file = join(mkdtempSync(".tmp/intel-two-source-"), "replay.sqlite3")
    const db = await setup(seed, file)
    const deps = offline(seed === maersk ? maerskHtml : mofcomHtml)
    let before: Awaited<ReturnType<IntelRepository["listItems"]>>
    let versions: unknown[]
    try {
      expect(await collectIntelSource(db.repository, seed, deps, now)).toMatchObject({ status: "ok_items", itemsSeen: 2, itemsNew: 2, itemsRevised: 0 })
      before = await db.repository.listItems(seed.id)
      versions = []
      for (const item of before) {
        const saved = await db.repository.listVersions(item.id)
        expect(saved).toHaveLength(1)
        expect(saved[0]).toMatchObject({ contentScope: "metadata_only", sourcePublishedAt: null, dateEvidence: { precision: "day", timezone: "missing", utcOffset: null, publishedAt: null } })
        expect(saved[0].dateEvidence?.role ?? "unknown").toBe("unknown")
        expect(await db.repository.readVersionBlocks(saved[0].id)).toEqual([{ blockKey: "title", order: 0, type: "title", text: item.title }])
        versions.push(saved)
      }
      expect(await collectIntelSource(db.repository, seed, deps, now)).toMatchObject({ status: "ok_items", itemsSeen: 2, itemsNew: 0, itemsRevised: 0 })
      expect(await db.repository.listItems(seed.id)).toEqual(before)
      expect(deps.transport).toHaveBeenCalledTimes(2)
      for (const call of deps.transport.mock.calls) {
        expect(call[0].href).toBe(seed.url)
        expect(call[2]).toMatchObject({ maxBytes: 524288, timeoutMs: 10000 })
        expect(call[2].maxHeaderSize).toBe(seed === maersk ? 32768 : undefined)
        expect(call[2].caPem).toBeUndefined()
      }
    } finally {
      db.native.close()
    }
    const reopened = openNative(file)
    try {
      expect(await reopened.repository.listItems(seed.id)).toEqual(before!)
      for (let i = 0; i < before!.length; i++) expect(await reopened.repository.listVersions(before![i].id)).toEqual(versions![i])
      expect(await reopened.repository.listRuns(seed.id)).toHaveLength(2)
    } finally {
      reopened.native.close()
    }
  })
  it.each([
    { id: "other", sourceHeaderLimit: maersk.sourceHeaderLimit },
    { url: `${maersk.url}/` },
    { url: `${maersk.url}?x=1` },
    { sourceHeaderLimit: { ...maersk.sourceHeaderLimit!, sourceId: "other" } },
    { sourceHeaderLimit: { ...maersk.sourceHeaderLimit!, url: `${maersk.url}/other` } },
    { sourceHeaderLimit: { ...maersk.sourceHeaderLimit!, maxHeaderSize: 65536 } },
  ])("rejects mismatched source/header binding before DNS: %j", async (patch) => {
    const seed = { ...maersk, ...patch }
    const db = await setup(seed)
    const deps = offline(maerskHtml)
    try {
      expect(await collectIntelSource(db.repository, seed, deps, now)).toMatchObject({ status: "failed", errorCode: "source_header_limit_invalid" })
      expect(deps.lookup).not.toHaveBeenCalled()
      expect(deps.transport).not.toHaveBeenCalled()
      expect(await db.repository.listItems(seed.id)).toEqual([])
    } finally {
      db.native.close()
    }
  })
  it.each(["https://www.maersk.com/other", "https://other.example.com/news", "http://www.maersk.com/news"])("never forwards the header opt-in to redirect %s", async (location) => {
    const db = await setup(maersk)
    const deps = offline("", location)
    try {
      expect(await collectIntelSource(db.repository, maersk, deps, now)).toMatchObject({ status: "failed" })
      expect(deps.transport).toHaveBeenCalledTimes(1)
      expect(deps.lookup).toHaveBeenCalledTimes(1)
      expect(await db.repository.listItems(maersk.id)).toEqual([])
    } finally {
      db.native.close()
    }
  })
  it("leaves the transport budget untouched when the explicit opt-in is absent", async () => {
    const seed = { ...maersk, sourceHeaderLimit: undefined }
    const db = await setup(seed)
    const deps = offline(maerskHtml)
    try {
      expect(await collectIntelSource(db.repository, seed, deps, now)).toMatchObject({ status: "ok_items", itemsNew: 2 })
      expect(deps.transport.mock.calls[0][2].maxHeaderSize).toBeUndefined()
    } finally {
      db.native.close()
    }
  })
})
