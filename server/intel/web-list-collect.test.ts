import { createHash } from "node:crypto"
import { mkdirSync, mkdtempSync, readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it, vi } from "vitest"
import { open } from "./__fixtures__/isolated-db"
import { shippingMigrations } from "#/database/migrations"
import { initializeShippingDatabase } from "#/database/runtime"
import { type IntelFetchDeps, collectIntelSource } from "#/intel/collect"
import { type IntelSourceSeed, intelSourceSeeds } from "#/intel/sources"
import { parseFeedEntries } from "#/providers/feed"

const NOW = new Date("2026-10-12T12:00:00Z")
const RSS = intelSourceSeeds[0]
const RSS_BYTES = readFileSync("server/providers/__fixtures__/tmd-cap-2026-10-10/index.xml")
const ARCHIVE = readFileSync("docs/evidence/nchmf-integration-2026-10-10/raw/index.html")
const WEB: IntelSourceSeed = {
  id: "test:web",
  catalogId: "VN-W01",
  name: "Offline archive",
  kind: "web_list",
  url: "https://www.nchmf.gov.vn/list",
  persistence: "excerpt_only",
  enabled: false,
  allowedHosts: ["www.nchmf.gov.vn"],
  allowedContentTypes: ["text/html"],
  intervalMs: 3600000,
  webList: {
    listSelector: "#left-col > .ct-news-nb-block > ul.list-news",
    itemSelector: "li",
    linkSelector: "a",
    titleAttribute: "alt",
    publishedAtSelector: "label",
    dateOrder: "dmy",
    publishedAtUtcOffset: "+07:00",
    dateRuleBasis: "Offline NCHMF 2026-10-10 archive: configured D/M/Y and UTC+07, timezone not present in list text",
  },
}
const SIMPLE: IntelSourceSeed = { ...WEB, webList: {
  listSelector: "#notices",
  itemSelector: "li",
  linkSelector: "a",
  publishedAtSelector: "time",
  emptySelector: ".empty",
  dateRuleBasis: "Synthetic offline date fixture",
} }
const html = (date: string) => `<ul id="notices"><li><a href="/detail?id=1">Notice</a><time>${date}</time></li></ul>`

function offline(body: Uint8Array | string, contentType = "text/html; charset=utf-8") {
  const transport = vi.fn(async () => ({ status: 200, headers: { "content-type": contentType }, body }))
  const lookup = vi.fn(async () => [{ address: "93.184.216.34", family: 4 as const }])
  return { transport, lookup } satisfies IntelFetchDeps
}

async function oldDatabase(state: ReturnType<typeof open>) {
  const { native, database } = state
  native.exec("CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)")
  for (const migration of shippingMigrations.filter(m => m.version <= 25)) {
    native.exec("BEGIN")
    await migration.up(database)
    native.prepare("INSERT INTO schema_migrations VALUES (?, ?, ?)").run(migration.version, migration.name, NOW.toISOString())
    native.exec("COMMIT")
  }
  await state.repository.upsertSource(RSS, NOW.toISOString())
  const entry = parseFeedEntries(RSS_BYTES.toString("utf8"), RSS.url).entries[0]
  const hash = createHash("sha256").update(`${entry.title}\n${entry.bodyText}`).digest("hex")
  native.prepare("INSERT INTO intel_item VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run("old-item", RSS.id, entry.canonicalUrl, entry.title, entry.publishedAt ?? null, NOW.toISOString(), NOW.toISOString(), "old-version")
  native.prepare("INSERT INTO intel_item_version VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").run("old-version", "old-item", hash, NOW.toISOString(), "intel-feed-v1", "full_text", entry.publishedAt ?? null, entry.sourceUpdatedAt ?? null, NOW.toISOString())
  native.prepare("INSERT INTO intel_fetch_run(id,source_id,started_at,finished_at,status,items_seen) VALUES ('old-run',?,?,?,'ok_items',1)").run(RSS.id, NOW.toISOString(), NOW.toISOString())
  native.prepare("UPDATE intel_source SET status='failing',consecutive_failures=3,last_error_code='old-error',next_sync_at=? WHERE id=?").run(NOW.toISOString(), RSS.id)
}

describe("026 isolated upgrade and web_list collection", () => {
  it("preserves populated v25 rows, IDs, health, FK cascades, indexes, triggers and RSS identity; initializes twice", async () => {
    const state = open()
    const { native, database, repository } = state
    try {
      await oldDatabase(state)
      native.exec("CREATE TABLE source_child(id TEXT PRIMARY KEY, source_id TEXT REFERENCES intel_source(id) ON DELETE CASCADE); CREATE INDEX source_custom ON intel_source(name); CREATE TRIGGER source_touch AFTER UPDATE OF name ON intel_source BEGIN UPDATE intel_source SET updated_at='trigger' WHERE id=NEW.id; END")
      native.prepare("INSERT INTO source_child VALUES ('child', ?)").run(RSS.id)
      native.exec("PRAGMA foreign_keys=ON")
      const source = native.prepare("SELECT * FROM intel_source WHERE id='intel:th-w01'").all()
      const item = native.prepare("SELECT * FROM intel_item").all()
      const version = native.prepare("SELECT * FROM intel_item_version").get() as Record<string, unknown>
      const run = native.prepare("SELECT * FROM intel_fetch_run").all()
      const objects = native.prepare("SELECT type,name,sql FROM sqlite_master WHERE type IN ('index','trigger') AND tbl_name='intel_source' ORDER BY name").all()
      const fk = native.prepare("PRAGMA foreign_key_list(source_child)").all()
      expect((await initializeShippingDatabase(database, "mock")).schemaVersion).toBe(28)
      await initializeShippingDatabase(database, "mock")
      expect(native.prepare("SELECT * FROM intel_source WHERE id='intel:th-w01'").all()).toEqual(source)
      expect(native.prepare("SELECT * FROM intel_item").all()).toEqual(item)
      expect(native.prepare("SELECT * FROM intel_item_version").get()).toEqual({ ...version, date_evidence: null })
      expect(native.prepare("SELECT * FROM intel_fetch_run").all()).toEqual(run)
      expect(native.prepare("SELECT type,name,sql FROM sqlite_master WHERE type IN ('index','trigger') AND tbl_name='intel_source' ORDER BY name").all()).toEqual(objects)
      expect(native.prepare("PRAGMA foreign_key_list(source_child)").all()).toEqual(fk)
      expect(native.prepare("SELECT * FROM source_child").all()).toEqual([{ id: "child", source_id: RSS.id }])
      expect(native.prepare("PRAGMA foreign_keys").get()).toEqual({ foreign_keys: 1 })
      expect(native.prepare("PRAGMA foreign_key_check").all()).toEqual([])
      expect(native.prepare("SELECT COUNT(*) AS n FROM schema_migrations WHERE version=26").get()).toEqual({ n: 1 })
      await collectIntelSource(repository, RSS, offline(RSS_BYTES, "application/rss+xml"), NOW)
      expect((await repository.listVersions("old-item"))).toHaveLength(1)
      expect((await repository.listVersions("old-item"))[0]).toMatchObject({ id: "old-version", contentHash: version.content_hash, dateEvidence: null })
      await repository.upsertSource(WEB, NOW.toISOString())
      expect((await repository.getSource(WEB.id))?.kind).toBe("web_list")
      native.prepare("UPDATE intel_source SET name='changed' WHERE id=?").run(RSS.id)
      expect(native.prepare("SELECT updated_at FROM intel_source WHERE id=?").get(RSS.id)).toEqual({ updated_at: "trigger" })
    } finally {
      native.close()
    }
  })

  it("rolls back a failed rebuild and restores foreign-key enforcement, then retries successfully", async () => {
    let fail = false
    const state = open(":memory:", (sql) => {
      if (fail && sql.includes("ADD COLUMN date_evidence")) throw new Error("injected migration I/O failure")
    })
    try {
      await oldDatabase(state)
      state.native.exec("PRAGMA foreign_keys=ON")
      const before = state.native.prepare("SELECT * FROM intel_source").all()
      fail = true
      await expect(initializeShippingDatabase(state.database, "mock")).rejects.toThrow("injected migration")
      expect(state.native.prepare("SELECT * FROM intel_source").all()).toEqual(before)
      expect(state.native.prepare("SELECT version FROM schema_migrations WHERE version=26").get()).toBeUndefined()
      expect(state.native.prepare("SELECT name FROM sqlite_master WHERE name='intel_source_web_list_026'").get()).toBeUndefined()
      expect(state.native.prepare("PRAGMA foreign_keys").get()).toEqual({ foreign_keys: 1 })
      fail = false
      await initializeShippingDatabase(state.database, "mock")
    } finally {
      state.native.close()
    }
  })

  it("refuses a foreign-key inconsistency before committing and preserves the original enforcement setting", async () => {
    const state = open()
    try {
      await oldDatabase(state)
      state.native.exec("PRAGMA foreign_keys=OFF; CREATE TABLE invalid_child(source_id TEXT REFERENCES intel_source(id)); INSERT INTO invalid_child VALUES ('missing')")
      await expect(initializeShippingDatabase(state.database, "mock")).rejects.toThrow("Foreign key violation")
      expect(state.native.prepare("SELECT version FROM schema_migrations WHERE version=26").get()).toBeUndefined()
      expect(state.native.prepare("PRAGMA foreign_keys").get()).toEqual({ foreign_keys: 0 })
      expect(state.native.prepare("SELECT id FROM intel_item_version").all()).toEqual([{ id: "old-version" }])
    } finally {
      state.native.close()
    }
  })

  it("passes archived HTML bytes through secure transport, decoding, parser and SQLite, then reads evidence after restart", async () => {
    mkdirSync(".tmp", { recursive: true })
    const path = resolve(mkdtempSync(".tmp/web-list-026-"), "isolated.sqlite3")
    const state = open(path)
    let itemId: string
    try {
      await initializeShippingDatabase(state.database, "mock")
      await state.repository.upsertSource(WEB, NOW.toISOString())
      const deps = offline(ARCHIVE)
      expect(await collectIntelSource(state.repository, WEB, deps, NOW)).toMatchObject({ status: "ok_items", itemsSeen: 5, itemsNew: 5 })
      expect(deps.lookup).toHaveBeenCalledWith("www.nchmf.gov.vn")
      expect(deps.transport).toHaveBeenCalledTimes(1)
      const items = await state.repository.listItems(WEB.id)
      const item = items.find(i => i.canonicalUrl.endsWith("post54549.html"))!
      expect(item.title).toContain("TIN CẢNH BÁO LŨ QUÉT")
      expect(item.publishedAt).toBe("2026-10-10T09:27:01.000Z")
      itemId = item.id
    } finally {
      state.native.close()
    }
    const reopened = open(path)
    try {
      await initializeShippingDatabase(reopened.database, "mock")
      const versions = await reopened.repository.listVersions(itemId!)
      expect(versions[0].dateEvidence).toMatchObject({ raw: "(10/10/2026 16:27:01)", timezone: "configured", utcOffset: "+07:00", precision: "second", publishedAt: "2026-10-10T09:27:01.000Z", basis: WEB.webList!.dateRuleBasis })
      expect(await collectIntelSource(reopened.repository, WEB, offline(ARCHIVE), NOW)).toMatchObject({ status: "ok_items", itemsNew: 0, itemsRevised: 0 })
      expect(await reopened.repository.listVersions(itemId!)).toHaveLength(1)
    } finally {
      reopened.native.close()
    }
  })

  it("versions date-only and timezone-basis corrections and restores A after B without rewriting either version", async () => {
    const { native, database, repository } = open()
    try {
      await initializeShippingDatabase(database, "mock")
      await repository.upsertSource(SIMPLE, NOW.toISOString())
      await collectIntelSource(repository, SIMPLE, offline(html("2026-10-12")), NOW)
      const [item] = await repository.listItems(SIMPLE.id)
      const [a] = await repository.listVersions(item.id)
      expect(a.dateEvidence).toMatchObject({ precision: "day", timezone: "missing", publishedAt: null })
      expect(await collectIntelSource(repository, SIMPLE, offline(html("2026-10-13")), NOW)).toMatchObject({ itemsRevised: 1 })
      const [b] = await repository.listVersions(item.id)
      expect(b.contentHash).not.toBe(a.contentHash)
      const changed = { ...SIMPLE, webList: { ...SIMPLE.webList!, dateRuleBasis: "Corrected source basis" } }
      expect(await collectIntelSource(repository, changed, offline(html("2026-10-13")), NOW)).toMatchObject({ itemsRevised: 1 })
      expect(await collectIntelSource(repository, SIMPLE, offline(html("2026-10-12")), NOW)).toMatchObject({ itemsRevised: 1 })
      expect((await repository.listItems(SIMPLE.id))[0].currentVersionId).toBe(a.id)
      const versions = await repository.listVersions(item.id)
      expect(versions).toHaveLength(3)
      expect(versions.find(v => v.id === a.id)).toEqual(a)
      expect(versions.find(v => v.id === b.id)).toEqual(b)
    } finally {
      native.close()
    }
  })

  it("accepts only explicit empty lists, retains prior data on parse/decode/security failures and rejects missing config before fetch", async () => {
    const { native, database, repository } = open()
    try {
      await initializeShippingDatabase(database, "mock")
      await repository.upsertSource(SIMPLE, NOW.toISOString())
      await collectIntelSource(repository, SIMPLE, offline(html("invalid")), NOW)
      const before = await repository.listItems(SIMPLE.id)
      expect(before[0].publishedAt).toBeNull()
      const versions = await repository.listVersions(before[0].id)
      for (const deps of [offline("<ul id=notices></ul>"), offline("<html>changed</html>"), offline(new Uint8Array([0xFF])), { ...offline(html("2026-10-12")), lookup: async () => [{ address: "127.0.0.1", family: 4 as const }] }]) {
        expect((await collectIntelSource(repository, SIMPLE, deps, NOW)).status).toBe("failed")
        expect(await repository.listItems(SIMPLE.id)).toEqual(before)
        expect(await repository.listVersions(before[0].id)).toEqual(versions)
      }
      expect(await collectIntelSource(repository, SIMPLE, offline("<ul id=notices><p class=empty>No notices</p></ul>"), NOW)).toMatchObject({ status: "ok_empty", itemsSeen: 0 })
      expect(await repository.listItems(SIMPLE.id)).toEqual(before)
      const deps = offline(ARCHIVE)
      expect(await collectIntelSource(repository, { ...WEB, webList: undefined }, deps, NOW)).toMatchObject({ status: "failed", errorCode: "config_invalid" })
      expect(deps.transport).not.toHaveBeenCalled()
      expect(deps.lookup).not.toHaveBeenCalled()
    } finally {
      native.close()
    }
  })

  it("retains old items, date evidence and versions after a failed version write", async () => {
    let fail = false
    const state = open(":memory:", (sql) => {
      if (fail && sql.includes("INSERT INTO intel_item_version")) throw new Error("injected version I/O failure")
    })
    try {
      await initializeShippingDatabase(state.database, "mock")
      await state.repository.upsertSource(SIMPLE, NOW.toISOString())
      await collectIntelSource(state.repository, SIMPLE, offline(html("2026-10-12T09:00:00+07:00")), NOW)
      const items = await state.repository.listItems(SIMPLE.id)
      const versions = await state.repository.listVersions(items[0].id)
      fail = true
      expect(await collectIntelSource(state.repository, SIMPLE, offline(html("2026-10-12T09:00:00+08:00")), NOW)).toMatchObject({ status: "failed", errorCode: "store_failed", itemsCommitted: 0 })
      expect(await state.repository.listItems(SIMPLE.id)).toEqual(items)
      expect(await state.repository.listVersions(items[0].id)).toEqual(versions)
      expect((await state.repository.getSource(SIMPLE.id))?.status).toBe("failing")
    } finally {
      state.native.close()
    }
  })
})
