import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { open } from "#/intel/__fixtures__/isolated-db"
import { initShippingTables } from "#/database/shipping"
import { intelSourceSeeds } from "#/intel/sources"
import { manualSubmit } from "#/intel/manual"
import { manualChecklist } from "#/intel/manual-checklist"
import { intelSourceRunsMigration } from "#/database/migrations/021-intel-source-runs"
import { intelItemsMigration } from "#/database/migrations/022-intel-items"
import { intelExecutorCurrentMigration } from "#/database/migrations/023-intel-executor-current"
import { intelWebListMigration } from "#/database/migrations/026-intel-web-list"
import { intelJsonListMigration } from "#/database/migrations/027-intel-json-list"
import { intelManualMigration } from "#/database/migrations/028-intel-manual"
import { manualClipMigration } from "#/database/migrations/029-manual-clip"
import { shippingMigrations } from "#/database/migrations"

const NOW = "2026-10-14T05:00:00.000Z"
let state: ReturnType<typeof open>
let fail = false
const source = intelSourceSeeds[0]
const input = (extra = {}) => ({ requestId: "request-0001", sourceId: source.id, operator: "Local reviewer", action: "submit", url: source.url, title: "Offline synthetic notice", body: "Synthetic content only", ...extra })
beforeEach(async () => {
  state = open(":memory:", (sql) => {
    if (fail && sql.startsWith("INSERT INTO intel_manual_action")) throw new Error("injected audit fault")
  })
  await initShippingTables(state.database, "real")
  for (const seed of intelSourceSeeds) await state.repository.upsertSource(seed, NOW)
  vi.stubGlobal("fetch", () => {
    throw new Error("No network allowed")
  })
})
afterEach(() => {
  fail = false
  state.native.close()
  vi.unstubAllGlobals()
})

describe("r2-7 manual entry offline SQLite", () => {
  it("binds body license to exact CAP/BMKG feed products, never the whole domain", async () => {
    for (const [sourceId, url] of [[source.id, "https://www.tmd.go.th/story"], [intelSourceSeeds[1].id, "https://www.bmkg.go.id/story"], [source.id, `${source.url}?other=product`]]) {
      await expect(manualSubmit(state.repository, input({ sourceId, url }), NOW)).rejects.toThrow("invalid")
    }
    const cap = await manualSubmit(state.repository, input(), NOW)
    expect((await state.repository.listVersions(cap.itemId!))[0].contentScope).toBe("full_text")
    const metadata = await manualSubmit(state.repository, input({ requestId: "metadata-outside", url: "https://www.tmd.go.th/story", body: "" }), NOW)
    expect((await state.repository.listVersions(metadata.itemId!))[0].contentScope).toBe("metadata_only")
    state.native.prepare("UPDATE intel_source SET persistence='full' WHERE id=?").run(intelSourceSeeds[1].id)
    const excerpt = await manualSubmit(state.repository, input({ requestId: "bmkg-product-01", sourceId: intelSourceSeeds[1].id, url: intelSourceSeeds[1].url, body: "X".repeat(1000) }), NOW)
    expect((await state.repository.listVersions(excerpt.itemId!))[0].contentScope).toBe("excerpt")
  })
  it("reuses Feed URL canonicalization for tracking parameters, fragments and trailing slash", async () => {
    const a = await manualSubmit(state.repository, input({ url: "https://www.tmd.go.th/en/api/xml/CAP/?utm_source=offline#part" }), NOW)
    const b = await manualSubmit(state.repository, input({ requestId: "request-0002" }), NOW)
    expect(b).toMatchObject({ itemId: a.itemId, outcome: "unchanged" })
    expect(await state.repository.listItems(source.id)).toHaveLength(1)
  })
  it("rolls back a failed schema28 rebuild, restores FK enforcement and safely retries", async () => {
    let fault = false
    const old = open(":memory:", (sql) => {
      if (fault && sql.includes("CREATE TABLE intel_manual_action")) throw new Error("migration fault")
    })
    try {
      old.native.exec("PRAGMA foreign_keys=OFF; CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY,name TEXT NOT NULL,applied_at TEXT NOT NULL)")
      for (const migration of shippingMigrations.filter(row => row.version <= 27)) {
        await migration.up(old.database)
        old.native.prepare("INSERT INTO schema_migrations VALUES (?,?,?)").run(migration.version, migration.name, NOW)
      }
      await old.repository.upsertSource(source, NOW)
      old.native.exec("CREATE TABLE manual_child(source_id TEXT REFERENCES intel_source(id) ON DELETE CASCADE); PRAGMA foreign_keys=ON")
      old.native.prepare("INSERT INTO manual_child VALUES (?)").run(source.id)
      const before = old.native.prepare("SELECT * FROM intel_source").all()
      fault = true
      await expect(initShippingTables(old.database, "real")).rejects.toThrow("migration fault")
      expect(old.native.prepare("SELECT * FROM intel_source").all()).toEqual(before)
      expect(old.native.prepare("SELECT * FROM manual_child").all()).toEqual([{ source_id: source.id }])
      expect(old.native.prepare("PRAGMA foreign_keys").get()).toEqual({ foreign_keys: 1 })
      expect(old.native.prepare("SELECT version FROM schema_migrations WHERE version=28").get()).toBeUndefined()
      fault = false
      await initShippingTables(old.database, "real")
      await initShippingTables(old.database, "real")
      expect(old.native.prepare("SELECT COUNT(*) AS n FROM intel_source WHERE kind='manual' AND enabled=0").get()).toEqual({ n: 40 })
      expect(old.native.prepare("PRAGMA foreign_key_check").all()).toEqual([])
    } finally {
      old.native.close()
    }
  })
  it("preserves schema27 rows and does not invent historical operators during upgrade", async () => {
    const old = open()
    try {
      for (const migration of [intelSourceRunsMigration, intelItemsMigration, intelExecutorCurrentMigration, intelWebListMigration, intelJsonListMigration]) await migration.up(old.database)
      await old.repository.upsertSource(source, NOW)
      const saved = await old.repository.writeEntry({ sourceId: source.id, canonicalUrl: "https://www.tmd.go.th/old", title: "Old", contentHash: "old", contentScope: "metadata_only", extractorVersion: "original", blocks: [], fetchedAt: NOW })
      const before = old.native.prepare("SELECT * FROM intel_item").all()
      await intelManualMigration.up(old.database)
      await manualClipMigration.up(old.database)
      expect(old.native.prepare("SELECT * FROM intel_item").all()).toEqual(before)
      expect(await old.repository.listManualActions(source.id, saved.itemId)).toEqual([])
      expect((await old.repository.getSource("intel:manual:cn-p05"))?.kind).toBe("manual")
    } finally {
      old.native.close()
    }
  })
  it("stores manual identity/time separately from unknown publication and licensed blocks", async () => {
    const result = await manualSubmit(state.repository, input(), NOW)
    expect(await state.repository.getItem(result.itemId!)).toMatchObject({ publishedAt: null, firstSeenAt: NOW })
    expect(await state.repository.listManualActions(source.id, result.itemId)).toMatchObject([{ operator: "Local reviewer", entered_at: NOW, action: "submit" }])
    expect(await state.repository.readVersionBlocks(result.versionId!)).toHaveLength(2)
  })
  it("replays identical requests and rejects same-key changes atomically", async () => {
    const first = await manualSubmit(state.repository, input(), NOW)
    expect(await manualSubmit(state.repository, input(), "2026-10-15T00:00:00.000Z")).toEqual(first)
    await expect(manualSubmit(state.repository, input({ title: "Changed" }), NOW)).rejects.toThrow("manual_request_conflict")
    expect(await state.repository.listManualActions(source.id)).toHaveLength(1)
    expect(await state.repository.listVersions(first.itemId!)).toHaveLength(1)
  })
  it("deduplicates content, revises, and restores A-B-A without deleting old versions", async () => {
    const a = await manualSubmit(state.repository, input(), NOW)
    expect(await manualSubmit(state.repository, input({ requestId: "request-0002" }), NOW)).toMatchObject({ outcome: "unchanged" })
    await manualSubmit(state.repository, input({ requestId: "request-0003", body: "Revision" }), NOW)
    expect(await manualSubmit(state.repository, input({ requestId: "request-0004" }), NOW)).toMatchObject({ outcome: "restored", versionId: a.versionId })
    expect(await state.repository.listVersions(a.itemId!)).toHaveLength(2)
    expect(await state.repository.listManualActions(source.id)).toHaveLength(4)
  })
  it("rolls back item/version/pointer and audit together on storage failure", async () => {
    const first = await manualSubmit(state.repository, input(), NOW)
    fail = true
    await expect(manualSubmit(state.repository, input({ requestId: "request-0002", body: "Revision" }), NOW)).rejects.toThrow("injected")
    expect((await state.repository.getItem(first.itemId!))?.currentVersionId).toBe(first.versionId)
    expect(await state.repository.listVersions(first.itemId!)).toHaveLength(1)
    expect(await state.repository.listManualActions(source.id)).toHaveLength(1)
  })
  it("records checked-empty separately, idempotently, without items or fetch-health success", async () => {
    const check = { requestId: "checked-0001", sourceId: "intel:manual:cn-p05", operator: "Reviewer", action: "checked_empty" }
    await manualSubmit(state.repository, check, NOW)
    await manualSubmit(state.repository, check, NOW)
    expect(await state.repository.listItems(check.sourceId)).toEqual([])
    expect((await state.repository.getSource(check.sourceId))?.status).toBe("never_run")
    expect(await state.repository.listManualActions(check.sourceId)).toMatchObject([{ action: "checked_empty", outcome: "checked_empty" }])
    expect((await manualChecklist(state.repository)).find(row => row.id === check.sourceId)?.recentActions).toHaveLength(1)
  })
  it("rejects unlicensed body; persists permitted excerpt only and metadata-only manual sources", async () => {
    const metadata = input({ sourceId: "intel:manual:cn-p05", url: "https://www.msa.gov.cn/story", body: "" })
    await expect(manualSubmit(state.repository, { ...metadata, body: "Restricted full text" }, NOW)).rejects.toThrow("invalid")
    const saved = await manualSubmit(state.repository, metadata, NOW)
    expect(await state.repository.readVersionBlocks(saved.versionId!)).toHaveLength(1)
    const excerpt = await manualSubmit(state.repository, input({ requestId: "excerpt-0001", sourceId: intelSourceSeeds[1].id, url: intelSourceSeeds[1].url, body: "X".repeat(1000) }), NOW)
    expect((await state.repository.readVersionBlocks(excerpt.versionId!))[1].text).toHaveLength(280)
  })
  it.each([
    { url: "javascript:alert(1)" },
    { url: "https://127.0.0.1/story" },
    { url: "https://www.tmd.go.th.evil.test/" },
    { url: "https://user:pass@www.tmd.go.th/" },
    { url: "https://www.tmd.go.th/?token=bad" },
    { title: "<img src=x onerror=alert(1)>" },
    { body: "<script>alert(1)</script>" },
    { operator: "" },
    { publishedAt: "2026-02-30T00:00:00Z" },
    { publishedAt: "2026-10-14" },
    { body: "x".repeat(100001) },
    { sourceId: "not-in-catalog" },
    { sourceId: "intel:manual:xx-w06" },
    { unexpected: "field" },
  ])("rejects unsafe or invalid input %j without changing stored data", async (extra) => {
    await expect(manualSubmit(state.repository, input(extra), NOW)).rejects.toThrow()
    expect(await state.repository.listItems(source.id)).toEqual([])
    expect(await state.repository.listManualActions(source.id)).toEqual([])
  })
  it("accepts explicit offset publication, never substitutes operator time", async () => {
    const saved = await manualSubmit(state.repository, input({ publishedAt: "2026-10-13T12:00:00+07:00" }), NOW)
    expect((await state.repository.getItem(saved.itemId!))?.publishedAt).toBe("2026-10-13T05:00:00.000Z")
  })
  it("manual sources never enter automatic due-source collection even if enabled", async () => {
    state.native.prepare("UPDATE intel_source SET enabled=1 WHERE kind='manual'").run()
    expect((await state.repository.listDueSources(NOW)).some(row => row.kind === "manual")).toBe(false)
  })
})
