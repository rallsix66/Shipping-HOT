import { createHash } from "node:crypto"
import { Buffer } from "node:buffer"
import { mkdirSync, mkdtempSync, readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it, vi } from "vitest"
import { open } from "./__fixtures__/isolated-db"
import { shippingMigrations } from "#/database/migrations"
import { initializeShippingDatabase } from "#/database/runtime"
import { type IntelFetchDeps, collectIntelSource } from "#/intel/collect"
import { type IntelSourceSeed, intelSourceSeeds } from "#/intel/sources"
import { fromHtml } from "#/intel/sources/web-list"
import { sourcePolicy } from "#/intel/collect"
import { parseFeedEntries } from "#/providers/feed"

const NOW = new Date("2026-10-13T01:00:00Z")
const JSON_SOURCE: IntelSourceSeed = {
  id: "test:json",
  catalogId: "MY-W01",
  name: "Synthetic JSON fixture only",
  kind: "json_list",
  url: "https://api.data.gov.my/weather/warning",
  persistence: "excerpt_only",
  enabled: false,
  allowedHosts: ["api.data.gov.my"],
  allowedContentTypes: ["application/json"],
  intervalMs: 3600000,
  jsonList: { titlePaths: ["title"], summaryPaths: ["summary"], urlTemplate: "/notices/{id}", publishedAtPath: "published", dateRuleBasis: "Synthetic publication field; not a live MY-W01 response" },
}
const RECORD = { id: "one", title: "Thông báo 港口通知", summary: "Maklumat cuaca", published: "2026-10-13T09:00:00+08:00" }
const RSS = intelSourceSeeds[0]
const RSS_BODY = readFileSync("server/providers/__fixtures__/tmd-cap-2026-10-10/index.xml", "utf8")
const WEB: IntelSourceSeed = { ...RSS, id: "test:web", kind: "web_list", allowedContentTypes: ["text/html"], webList: { listSelector: "#list", itemSelector: "li", publishedAtSelector: "time", dateRuleBasis: "Synthetic date field" } }
const WEB_BODY = "<ul id=\"list\"><li><a href=\"/notice/one\">Notice</a><time>2026-10-13</time></li></ul>"

function offline(body: string | Uint8Array, type = "application/json; charset=utf-8") {
  const lookup = vi.fn(async () => [{ address: "93.184.216.34", family: 4 as const }])
  const transport = vi.fn(async () => ({ status: 200, headers: { "content-type": type }, body }))
  return { lookup, transport } satisfies IntelFetchDeps
}
const json = (records: unknown) => offline(Buffer.from(JSON.stringify(records), "utf8"))

async function v26(state: ReturnType<typeof open>) {
  state.native.exec("PRAGMA foreign_keys=OFF; CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY,name TEXT NOT NULL,applied_at TEXT NOT NULL)")
  for (const migration of shippingMigrations.filter(m => m.version <= 26)) {
    state.native.exec("BEGIN")
    await migration.up(state.database)
    state.native.prepare("INSERT INTO schema_migrations VALUES (?,?,?)").run(migration.version, migration.name, NOW.toISOString())
    state.native.exec("COMMIT")
  }
  state.native.exec("PRAGMA foreign_keys=ON")
  await state.repository.upsertSource(RSS, NOW.toISOString())
  await state.repository.upsertSource(WEB, NOW.toISOString())
  // Fixed prior contracts, independent of the current collector, to detect identity drift.
  for (const [seed, entries, version] of [[RSS, parseFeedEntries(RSS_BODY, RSS.url).entries, "intel-feed-v1"], [WEB, fromHtml(WEB_BODY, WEB.url, WEB.webList!, sourcePolicy(WEB)), "intel-web-list-v1"]] as const) {
    for (const entry of entries) {
      const evidence = "dateEvidence" in entry ? entry.dateEvidence : undefined
      const identity = version === "intel-feed-v1" ? `${entry.title}\n${entry.bodyText}` : JSON.stringify([version, entry.title, entry.bodyText, evidence])
      await state.repository.writeEntry({ sourceId: seed.id, canonicalUrl: entry.canonicalUrl, title: entry.title, publishedAt: entry.publishedAt, contentHash: createHash("sha256").update(identity).digest("hex"), contentScope: "metadata_only", extractorVersion: version, dateEvidence: evidence, blocks: [], fetchedAt: NOW.toISOString() })
    }
  }
  state.native.prepare("UPDATE intel_source SET status='failing',consecutive_failures=3,last_error_code='old-error',next_sync_at=?").run(NOW.toISOString())
  state.native.prepare("INSERT INTO intel_fetch_run(id,source_id,started_at,finished_at,status) VALUES ('old-run',?,?,?,'ok_empty')").run(RSS.id, NOW.toISOString(), NOW.toISOString())
}

describe("json_list 027 isolated persistence", () => {
  it("upgrades populated v26 twice without changing old rows, identities, FK children, indexes or triggers", async () => {
    const state = open()
    try {
      await v26(state)
      state.native.exec("CREATE TABLE json_child(source_id TEXT REFERENCES intel_source(id) ON DELETE CASCADE); CREATE INDEX json_custom ON intel_source(name); CREATE TRIGGER json_touch AFTER UPDATE OF name ON intel_source BEGIN UPDATE intel_source SET updated_at='trigger' WHERE id=NEW.id; END")
      state.native.prepare("INSERT INTO json_child VALUES (?)").run(RSS.id)
      const tables = ["intel_source", "intel_item", "intel_item_version", "intel_fetch_run", "intel_item_current_change"]
      const snapshots = tables.map(table => state.native.prepare(`SELECT * FROM ${table}`).all())
      const objects = state.native.prepare("SELECT type,name,sql FROM sqlite_master WHERE tbl_name='intel_source' AND type IN ('index','trigger') ORDER BY name").all()
      const columns = state.native.prepare("PRAGMA table_info(intel_item_version)").all()
      const fk = state.native.prepare("PRAGMA foreign_key_list(json_child)").all()
      expect((await initializeShippingDatabase(state.database, "mock")).schemaVersion).toBe(27)
      await initializeShippingDatabase(state.database, "mock")
      expect(tables.map(table => state.native.prepare(`SELECT * FROM ${table}`).all())).toEqual(snapshots)
      expect(state.native.prepare("SELECT type,name,sql FROM sqlite_master WHERE tbl_name='intel_source' AND type IN ('index','trigger') ORDER BY name").all()).toEqual(objects)
      expect(state.native.prepare("PRAGMA table_info(intel_item_version)").all()).toEqual(columns)
      expect(state.native.prepare("PRAGMA foreign_key_list(json_child)").all()).toEqual(fk)
      expect(state.native.prepare("PRAGMA foreign_key_check").all()).toEqual([])
      expect(state.native.prepare("PRAGMA foreign_keys").get()).toEqual({ foreign_keys: 1 })
      expect(state.native.prepare("SELECT * FROM json_child").all()).toEqual([{ source_id: RSS.id }])
      expect(state.native.prepare("SELECT COUNT(*) AS n FROM schema_migrations WHERE version=27").get()).toEqual({ n: 1 })
      expect(await collectIntelSource(state.repository, RSS, offline(RSS_BODY, "application/rss+xml"), NOW)).toMatchObject({ status: "ok_items", itemsNew: 0, itemsRevised: 0 })
      expect(await collectIntelSource(state.repository, WEB, offline(WEB_BODY, "text/html"), NOW)).toMatchObject({ status: "ok_items", itemsNew: 0, itemsRevised: 0 })
      expect(state.native.prepare("SELECT * FROM intel_item_version").all()).toEqual(snapshots[2])
      await state.repository.upsertSource(JSON_SOURCE, NOW.toISOString())
      expect((await state.repository.getSource(JSON_SOURCE.id))?.kind).toBe("json_list")
      state.native.prepare("UPDATE intel_source SET name='changed' WHERE id=?").run(RSS.id)
      expect(state.native.prepare("SELECT updated_at FROM intel_source WHERE id=?").get(RSS.id)).toEqual({ updated_at: "trigger" })
    } finally {
      state.native.close()
    }
  })

  it("rolls back after the old source table was dropped, restores FK setting and retries", async () => {
    let fail = false
    const state = open(":memory:", (sql) => {
      if (fail && sql.startsWith("ALTER TABLE intel_source_json_list_027")) throw new Error("injected rebuild failure")
    })
    try {
      await v26(state)
      const rows = state.native.prepare("SELECT * FROM intel_source").all()
      fail = true
      await expect(initializeShippingDatabase(state.database, "mock")).rejects.toThrow("injected rebuild")
      expect(state.native.prepare("SELECT * FROM intel_source").all()).toEqual(rows)
      expect(state.native.prepare("SELECT version FROM schema_migrations WHERE version=27").get()).toBeUndefined()
      expect(state.native.prepare("SELECT name FROM sqlite_master WHERE name='intel_source_json_list_027'").get()).toBeUndefined()
      expect(state.native.prepare("PRAGMA foreign_keys").get()).toEqual({ foreign_keys: 1 })
      fail = false
      await initializeShippingDatabase(state.database, "mock")
    } finally {
      state.native.close()
    }
  })

  it("rejects FK inconsistencies before committing 027", async () => {
    const state = open()
    try {
      await v26(state)
      state.native.exec("PRAGMA foreign_keys=OFF; CREATE TABLE invalid_json_child(source_id TEXT REFERENCES intel_source(id)); INSERT INTO invalid_json_child VALUES ('missing')")
      await expect(initializeShippingDatabase(state.database, "mock")).rejects.toThrow("Foreign key violation")
      expect(state.native.prepare("SELECT version FROM schema_migrations WHERE version=27").get()).toBeUndefined()
      expect(state.native.prepare("PRAGMA foreign_keys").get()).toEqual({ foreign_keys: 0 })
    } finally {
      state.native.close()
    }
  })

  it("decodes actual UTF-8 bytes to SQLite, deduplicates and reads date evidence after restart", async () => {
    mkdirSync(".tmp", { recursive: true })
    const path = resolve(mkdtempSync(".tmp/json-list-027-"), "isolated.sqlite3")
    const state = open(path)
    let itemId = ""
    try {
      await initializeShippingDatabase(state.database, "mock")
      await state.repository.upsertSource(JSON_SOURCE, NOW.toISOString())
      const deps = json([RECORD, RECORD])
      expect(await collectIntelSource(state.repository, JSON_SOURCE, deps, NOW)).toMatchObject({ status: "ok_items", itemsSeen: 1, itemsNew: 1 })
      expect(deps.lookup).toHaveBeenCalledWith("api.data.gov.my")
      expect(deps.transport).toHaveBeenCalledTimes(1)
      const [item] = await state.repository.listItems(JSON_SOURCE.id)
      itemId = item.id
      expect(item).toMatchObject({ title: RECORD.title, canonicalUrl: "https://api.data.gov.my/notices/one", publishedAt: "2026-10-13T01:00:00.000Z" })
      expect(await state.repository.readVersionBlocks(item.currentVersionId!)).toContainEqual({ blockKey: "excerpt", order: 1, type: "excerpt", text: RECORD.summary })
    } finally {
      state.native.close()
    }
    const reopened = open(path)
    try {
      await initializeShippingDatabase(reopened.database, "mock")
      const [version] = await reopened.repository.listVersions(itemId)
      expect(version.dateEvidence).toMatchObject({ raw: RECORD.published, precision: "second", timezone: "explicit", utcOffset: "+08:00", basis: JSON_SOURCE.jsonList!.dateRuleBasis })
      expect(await collectIntelSource(reopened.repository, JSON_SOURCE, json([RECORD]), NOW)).toMatchObject({ itemsNew: 0, itemsRevised: 0 })
      expect(await reopened.repository.listVersions(itemId)).toEqual([version])
      expect(await collectIntelSource(reopened.repository, JSON_SOURCE, json([{ ...RECORD, published: "2026-10-14" }]), NOW)).toMatchObject({ itemsRevised: 1 })
      expect((await reopened.repository.listItems(JSON_SOURCE.id))[0].publishedAt).toBeNull()
      expect(await collectIntelSource(reopened.repository, JSON_SOURCE, json([RECORD]), NOW)).toMatchObject({ itemsRevised: 1 })
      expect((await reopened.repository.listItems(JSON_SOURCE.id))[0].currentVersionId).toBe(version.id)
      expect(await reopened.repository.listVersions(itemId)).toHaveLength(2)
    } finally {
      reopened.native.close()
    }
  })

  it("accepts only resolved empty arrays and retains old data after path/structure/encoding/URL/network/storage failures", async () => {
    let fail = false
    const state = open(":memory:", (sql) => {
      if (fail && sql.includes("INSERT INTO intel_item_version")) throw new Error("injected version failure")
    })
    try {
      await initializeShippingDatabase(state.database, "mock")
      await state.repository.upsertSource(JSON_SOURCE, NOW.toISOString())
      await collectIntelSource(state.repository, JSON_SOURCE, json([RECORD]), NOW)
      const items = await state.repository.listItems(JSON_SOURCE.id)
      const versions = await state.repository.listVersions(items[0].id)
      const nested = { ...JSON_SOURCE, jsonList: { ...JSON_SOURCE.jsonList!, itemsPath: "data.items" } }
      const failures: Array<[IntelSourceSeed, IntelFetchDeps]> = [
        [nested, json({})],
        [JSON_SOURCE, json([null])],
        [JSON_SOURCE, offline("callback([])")],
        [JSON_SOURCE, offline(new Uint8Array([0xFF]))],
        [JSON_SOURCE, offline("[]", "application/json; charset=unknown")],
        [JSON_SOURCE, offline("[]", "text/html")],
        [{ ...JSON_SOURCE, jsonList: { ...JSON_SOURCE.jsonList!, urlTemplate: "https://evil.invalid/{id}" } }, json([RECORD])],
        [JSON_SOURCE, { ...json([RECORD]), lookup: async () => [{ address: "127.0.0.1", family: 4 }] }],
      ]
      for (const [source, deps] of failures) {
        expect((await collectIntelSource(state.repository, source, deps, NOW)).status).toBe("failed")
        expect(await state.repository.listItems(JSON_SOURCE.id)).toEqual(items)
        expect(await state.repository.listVersions(items[0].id)).toEqual(versions)
      }
      fail = true
      expect(await collectIntelSource(state.repository, JSON_SOURCE, json([{ ...RECORD, summary: "Changed" }]), NOW)).toMatchObject({ status: "failed", errorCode: "store_failed" })
      expect(await state.repository.listItems(JSON_SOURCE.id)).toEqual(items)
      expect(await state.repository.listVersions(items[0].id)).toEqual(versions)
      fail = false
      expect(await collectIntelSource(state.repository, nested, json({ data: { items: [] } }), NOW)).toMatchObject({ status: "ok_empty", itemsSeen: 0 })
      expect(await collectIntelSource(state.repository, JSON_SOURCE, json([]), NOW)).toMatchObject({ status: "ok_empty", itemsSeen: 0 })
      expect(await state.repository.listItems(JSON_SOURCE.id)).toEqual(items)
      const deps = json([])
      expect(await collectIntelSource(state.repository, { ...JSON_SOURCE, jsonList: undefined }, deps, NOW)).toMatchObject({ errorCode: "config_invalid" })
      expect(deps.transport).not.toHaveBeenCalled()
      expect(deps.lookup).not.toHaveBeenCalled()
    } finally {
      state.native.close()
    }
  })

  it("uses the shared strict legacy-byte decoder and license-scoped blocks", async () => {
    const state = open()
    try {
      await initializeShippingDatabase(state.database, "mock")
      const source = { ...JSON_SOURCE, persistence: "disallowed" as const }
      await state.repository.upsertSource(source, NOW.toISOString())
      // Genuine GBK bytes for 港口, surrounded by ASCII JSON. No UTF-8 bytes mislabeled as GBK.
      const bytes = Buffer.concat([Buffer.from("[{\"id\":\"gbk\",\"title\":\""), Buffer.from("b8dbbfda", "hex"), Buffer.from("\",\"summary\":\"Not licensed for body retention\",\"published\":\"2026-10-13\"}]")])
      expect(await collectIntelSource(state.repository, source, offline(bytes, "application/json; charset=gbk"), NOW)).toMatchObject({ status: "ok_items", itemsNew: 1 })
      const [item] = await state.repository.listItems(source.id)
      expect(item.title).toBe("港口")
      expect(item.publishedAt).toBeNull()
      expect(await state.repository.readVersionBlocks(item.currentVersionId!)).toEqual([{ blockKey: "title", order: 0, type: "title", text: "港口" }])
      expect((await state.repository.listVersions(item.id))[0].dateEvidence).toMatchObject({ raw: "2026-10-13", precision: "day" })
    } finally {
      state.native.close()
    }
  })
})
