import { createServer } from "node:http"
import { Buffer } from "node:buffer"
import { mkdirSync, mkdtempSync } from "node:fs"
import { join } from "node:path"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { createApp, createRouter, toNodeListener } from "h3"
import { CLIP_PROTOCOL, CLIP_UNIDENTIFIED_OPERATOR, MANUAL_CLIP_SOURCE_ID } from "@shared/manual-clip"
import { open } from "#/intel/__fixtures__/isolated-db"
import { initShippingTables } from "#/database/shipping"
import { manualSubmit } from "#/intel/manual"
import { manualClipDate } from "#/intel/manual-clip"
import { manualPersistenceFor, privateClipScopeFor, readClipAudit } from "#/intel/manual-license"
import { readIntelMaterial } from "#/intel/material-read"
import manualPost from "#/api/shipping/intel/manual.post"
import itemGet from "#/api/shipping/intel/items/[id].get"
import security from "#/middleware/security"
import { shippingMigrations } from "#/database/migrations"

const now = "2026-10-16T02:20:00.000Z"
const url = "https://example.org/article/?utm_source=synthetic#part-2"
const draft = { protocol: CLIP_PROTOCOL, actualUrl: url, title: "Synthetic clip", body: "Synthetic owned material", mode: "article", capturedAt: "2026-10-16T02:19:00.000Z", extractorVersion: "synthetic-v1", date: { raw: "2026-10-16", field: "time:datetime", role: "unknown" } }
const input = () => ({ requestId: "clip-request-0001", sourceId: MANUAL_CLIP_SOURCE_ID, operator: "Synthetic owner", action: "submit", clip: structuredClone(draft), rights: { basis: "own_work", scope: "full_text", evidence: "Synthetic authored acceptance fixture", applicableUrl: url } })
let state: ReturnType<typeof open>
beforeEach(async () => {
  state = open(":memory:")
  await initShippingTables(state.database, "real")
  vi.stubGlobal("fetch", () => {
    throw new Error("external network forbidden")
  })
})
afterEach(() => {
  state.native.close()
  vi.unstubAllGlobals()
})
it("stores private confirmed text without a declaration, and keeps generic licensed reads metadata-only", async () => {
  const { operator: _operator, rights: _rights, ...data } = input()
  data.clip.body = "Private synthetic text  \t\n\n".repeat(40)
  const saved = await manualSubmit(state.repository, data, now)
  const source = (await state.repository.getSource(MANUAL_CLIP_SOURCE_ID))!
  const item = (await state.repository.getItem(saved.itemId!))!
  const action = await state.repository.getManualVersionAction(MANUAL_CLIP_SOURCE_ID, saved.itemId!, saved.versionId!)
  const audit = readClipAudit(action)
  expect(audit).toMatchObject({ capture: "manual_user_capture", usage: "private_material", rightsStatus: "unknown", recordedBy: CLIP_UNIDENTIFIED_OPERATOR, recordedAt: now, verification: "manual_capture_unverified" })
  expect(audit).not.toHaveProperty("rights")
  expect(manualPersistenceFor(source, item.canonicalUrl, action)).toBe("disallowed")
  expect(privateClipScopeFor(source, item.canonicalUrl, "full_text", action)).toBe("full_text")
  expect(privateClipScopeFor({ ...source, kind: "rss" }, item.canonicalUrl, "full_text", action)).toBeNull()
  expect(privateClipScopeFor(source, "https://example.org/other", "full_text", action)).toBeNull()
  expect((await state.repository.readVersionBlocks(saved.versionId!)).filter(b => b.type !== "title").map(b => b.text).join("")).toBe(data.clip.body)
  expect(await manualSubmit(state.repository, data, now)).toMatchObject(saved)
  const generic = await readIntelMaterial(state.repository, saved.itemId!, saved.versionId!)
  expect(generic.ok && generic.material).toMatchObject({ contentScope: "metadata_only", bodyText: null })
  expect(source).toMatchObject({ enabled: false, persistence: "disallowed", status: "never_run" })
})
it("preserves legacy permission/version history when a private capture has identical text", async () => {
  const legacy = await manualSubmit(state.repository, input(), now)
  const oldAudit = await state.repository.getManualVersionAction(MANUAL_CLIP_SOURCE_ID, legacy.itemId!, legacy.versionId!)
  const { rights: _rights, ...data } = input()
  data.requestId = "private-same-text-1"
  const next = await manualSubmit(state.repository, data, now)
  expect(next).toMatchObject({ outcome: "revised", itemId: legacy.itemId })
  expect(next.versionId).not.toBe(legacy.versionId)
  expect(await state.repository.getManualVersionAction(MANUAL_CLIP_SOURCE_ID, legacy.itemId!, legacy.versionId!)).toEqual(oldAudit)
  const old = await readIntelMaterial(state.repository, legacy.itemId!, legacy.versionId!)
  expect(old.ok && old.material.bodyText).toBe(draft.body)
  expect(await manualSubmit(state.repository, { ...data, requestId: "private-same-text-2" }, now)).toMatchObject({ outcome: "unchanged", versionId: next.versionId })
})
it("defaults missing optional date fields to unknown without granting caller-derived facts", async () => {
  const { rights: _rights, ...data } = input()
  const { date: _date, ...withoutDate } = data.clip
  const saved = await manualSubmit(state.repository, { ...data, clip: withoutDate }, now)
  const version = await state.repository.getVersion(saved.itemId!, saved.versionId!)
  expect(version?.dateEvidence).toMatchObject({ role: "unknown", timezone: "missing", publishedAt: null, raw: null })
})
it.each(["x".repeat(100001), "<script>unsafe</script>"])("keeps private body size/plain-text restrictions", async (body) => {
  const { rights: _rights, ...data } = input()
  await expect(manualSubmit(state.repository, { ...data, clip: { ...data.clip, body } }, now)).rejects.toThrow()
  expect(await state.repository.listItems(MANUAL_CLIP_SOURCE_ID)).toHaveLength(0)
})
it("does not accept private capture markers or no-declaration body for an automatic source", async () => {
  const { rights: _rights, ...data } = input()
  await expect(manualSubmit(state.repository, { ...data, sourceId: "intel:th-w01" }, now)).rejects.toThrow()
  await expect(manualSubmit(state.repository, { ...data, authorized: true }, now)).rejects.toThrow()
  expect(await state.repository.listItems(MANUAL_CLIP_SOURCE_ID)).toHaveLength(0)
})
it.each([undefined, "", " \t\n"])("saves without a supplied clipping operator and records unverified server-time audit: %j", async (operator) => {
  const data = { ...input(), operator }
  const saved = await manualSubmit(state.repository, data, now)
  const action = await state.repository.getManualVersionAction(MANUAL_CLIP_SOURCE_ID, saved.itemId!, saved.versionId!)
  expect(action).toMatchObject({ operator: CLIP_UNIDENTIFIED_OPERATOR, entered_at: now })
  expect(JSON.parse(String(action?.metadata_json))).toMatchObject({ declaredBy: CLIP_UNIDENTIFIED_OPERATOR, declaredAt: now, verification: "user_declaration_unverified", actualUrl: url })
  expect(await manualSubmit(state.repository, data, now)).toMatchObject(saved)
  const read = await readIntelMaterial(state.repository, saved.itemId!, saved.versionId!)
  expect(read.ok && read.material.bodyText).toBe(draft.body)
})
it("keeps old supplied names and licensed historical versions after a name-free revision", async () => {
  const old = await manualSubmit(state.repository, input(), now)
  const before = await state.repository.getManualVersionAction(MANUAL_CLIP_SOURCE_ID, old.itemId!, old.versionId!)
  const next = input()
  const { operator: _operator, ...withoutName } = next
  withoutName.requestId = "clip-no-name-0002"
  withoutName.clip.body = "Synthetic name-free revision"
  const revised = await manualSubmit(state.repository, withoutName, now)
  expect(revised).toMatchObject({ outcome: "revised", itemId: old.itemId })
  expect(await state.repository.getManualVersionAction(MANUAL_CLIP_SOURCE_ID, old.itemId!, old.versionId!)).toEqual(before)
  expect(before?.operator).toBe("Synthetic owner")
  const oldRead = await readIntelMaterial(state.repository, old.itemId!, old.versionId!)
  expect(oldRead.ok && oldRead.material.bodyText).toBe(draft.body)
})
it.each([null, 123, {}, "<script>x</script>", "x".repeat(81)])("still rejects malformed supplied legacy operator: %j", async (operator) => {
  await expect(manualSubmit(state.repository, { ...input(), operator }, now)).rejects.toThrow()
  expect(await state.repository.listItems(MANUAL_CLIP_SOURCE_ID)).toHaveLength(0)
})
it("does not relax rights, source, URL or schema checks when the operator is omitted", async () => {
  const { operator: _operator, ...data } = input()
  for (const bad of [
    { ...data, rights: { ...data.rights, basis: "unknown" } },
    { ...data, rights: { ...data.rights, evidence: "" } },
    { ...data, rights: { ...data.rights, applicableUrl: "https://example.org/other" } },
    { ...data, sourceId: "intel:th-w01" },
    { ...data, clip: { ...data.clip, actualUrl: "http://127.0.0.1/private" } },
    { ...data, authenticated: true },
  ]) await expect(manualSubmit(state.repository, bad, now)).rejects.toThrow()
  expect(await state.repository.listItems(MANUAL_CLIP_SOURCE_ID)).toHaveLength(0)
})
it("stores authored text, original URL, canonical identity, raw unknown date and unverified audit in the existing versions", async () => {
  const saved = await manualSubmit(state.repository, input(), now)
  const item = await state.repository.getItem(saved.itemId!)
  expect(item?.canonicalUrl).toBe("https://example.org/article")
  expect(item?.publishedAt).toBeNull()
  const version = await state.repository.getVersion(saved.itemId!, saved.versionId!)
  expect(version?.dateEvidence).toMatchObject({ raw: draft.date.raw, precision: "day", timezone: "missing", role: "unknown", publishedAt: null })
  const action = await state.repository.getManualVersionAction(MANUAL_CLIP_SOURCE_ID, saved.itemId!, saved.versionId!)
  expect(JSON.parse(String(action?.metadata_json))).toMatchObject({ actualUrl: url, capturedAt: draft.capturedAt, declaredBy: "Synthetic owner", declaredAt: now, body: "", verification: "user_declaration_unverified" })
  state.native.exec("PRAGMA query_only=ON")
  const read = await readIntelMaterial(state.repository, saved.itemId!, saved.versionId!)
  expect(read.ok && read.material.bodyText).toBe(draft.body)
})
it("replays requests, rejects payload conflicts, retains old versions and restores A-B-A", async () => {
  const data = input()
  const a = await manualSubmit(state.repository, data, now)
  expect(await manualSubmit(state.repository, data, "2026-10-16T02:21:00Z")).toMatchObject(a)
  await expect(manualSubmit(state.repository, { ...data, operator: "Other" }, now)).rejects.toThrow("conflict")
  const b = input()
  b.requestId = "clip-request-0002"
  b.clip.body = "Synthetic revised body"
  expect(await manualSubmit(state.repository, b, now)).toMatchObject({ outcome: "revised" })
  const back = input()
  back.requestId = "clip-request-0003"
  expect(await manualSubmit(state.repository, back, now)).toMatchObject({ outcome: "restored", versionId: a.versionId })
  expect(await state.repository.listVersions(a.itemId!)).toHaveLength(2)
})
it("does not create revisions for capture/parser version alone, but date evidence changes do", async () => {
  const a = await manualSubmit(state.repository, input(), now)
  const b = input()
  b.requestId = "clip-request-0002"
  b.clip.extractorVersion = "synthetic-v2"
  b.clip.capturedAt = now
  expect(await manualSubmit(state.repository, b, now)).toMatchObject({ outcome: "unchanged", versionId: a.versionId })
  b.requestId = "clip-request-0003"
  b.clip.date.raw = "2026-10-17"
  expect(await manualSubmit(state.repository, b, now)).toMatchObject({ outcome: "revised" })
})
it("validates compatible legacy declarations and exact applicable URL without silently dropping body", async () => {
  const data = input()
  data.rights.basis = "unknown"
  await expect(manualSubmit(state.repository, data, now)).rejects.toThrow()
  data.rights.scope = "metadata_only"
  await expect(manualSubmit(state.repository, data, now)).rejects.toThrow()
  data.clip.body = ""
  data.clip.mode = "metadata"
  expect(await manualSubmit(state.repository, data, now)).toMatchObject({ outcome: "created" })
  const bad = input()
  bad.rights.applicableUrl = "https://example.org/other"
  await expect(manualSubmit(state.repository, bad, now)).rejects.toThrow()
  const excerpt = input()
  excerpt.requestId = "excerpt-request-1"
  excerpt.rights.basis = "permission"
  excerpt.rights.scope = "excerpt"
  excerpt.clip.body = "X".repeat(281)
  await expect(manualSubmit(state.repository, excerpt, now)).rejects.toThrow()
  excerpt.clip.body = "X".repeat(280)
  expect(await manualSubmit(state.repository, excerpt, now)).toMatchObject({ outcome: "revised" })
})
it.each(["https://user:pass@example.org/a", "https://example.org/a?access_token=secret", "https://example.org/a#access_token=secret", "http://example.org/a", "https://localhost/a", "https://127.0.0.1/a", "http://127.0.0.1:5174/synthetic-article.html", "http://localhost:5174/synthetic-article.html", "http://127.1:5174/synthetic-article.html", "http://127.0.0.1:5174/synthetic-article.html?x=1", "http://127.0.0.1:5174/synthetic-article.html#x"]) ("rejects sensitive/unsupported URL without fetching: %s", async (actualUrl) => {
  const data = input()
  data.clip.actualUrl = actualUrl
  data.rights.applicableUrl = actualUrl
  await expect(manualSubmit(state.repository, data, now)).rejects.toThrow()
  expect(await state.repository.listItems(MANUAL_CLIP_SOURCE_ID)).toHaveLength(0)
})
it("cannot grant rights to automatic sources or mark source health successful", async () => {
  const data = input()
  data.sourceId = "intel:th-w01"
  await expect(manualSubmit(state.repository, data, now)).rejects.toThrow()
  await manualSubmit(state.repository, input(), now)
  expect(await state.repository.getSource(MANUAL_CLIP_SOURCE_ID)).toMatchObject({ enabled: false, status: "never_run", persistence: "disallowed" })
  expect(state.native.prepare("SELECT count(*) AS n FROM intel_fetch_run").get()).toEqual({ n: 0 })
})
it("validates plain text and rejects caller-derived time facts", async () => {
  const bad = input()
  bad.clip.body = "<img src=https://example.org/track>"
  await expect(manualSubmit(state.repository, bad, now)).rejects.toThrow()
  await expect(manualSubmit(state.repository, { ...input(), clip: { ...draft, date: { ...draft.date, timezone: "verified" } } }, now)).rejects.toThrow()
})
it("persists the same material/immutable version and original audit across a native SQLite reopen", async () => {
  mkdirSync(".tmp", { recursive: true })
  const path = join(mkdtempSync(join(process.cwd(), ".tmp", "manual-clip-restart-")), "acceptance.sqlite3")
  const first = open(path)
  let saved: Awaited<ReturnType<typeof manualSubmit>>
  try {
    await initShippingTables(first.database, "real")
    saved = await manualSubmit(first.repository, input(), now)
  } finally {
    first.native.close()
  }
  const restarted = open(path)
  try {
    restarted.native.exec("PRAGMA query_only=ON")
    const read = await readIntelMaterial(restarted.repository, saved.itemId!, saved.versionId!)
    expect(read.ok && read.material.bodyText).toBe(draft.body)
    const audit = await restarted.repository.getManualVersionAction(MANUAL_CLIP_SOURCE_ID, saved.itemId!, saved.versionId!)
    expect(JSON.parse(String(audit?.metadata_json)).actualUrl).toBe(url)
    expect(restarted.native.prepare("SELECT count(*) AS n FROM intel_fetch_run").get()).toEqual({ n: 0 })
  } finally {
    restarted.native.close()
  }
})
it("appends migration29 atomically, preserving schema28 on failure and safely retrying", async () => {
  let fail = true
  const old = open(":memory:", (sql) => {
    if (fail && sql.startsWith("INSERT INTO intel_source (id,catalog_id,name,kind,url,persistence")) throw new Error("migration29 injected failure")
  })
  try {
    expect(shippingMigrations.at(-1)?.version).toBe(30)
    await expect(initShippingTables(old.database, "real")).rejects.toThrow("migration29")
    expect(old.native.prepare("SELECT MAX(version) AS n FROM schema_migrations").get()).toEqual({ n: 28 })
    expect(old.native.prepare("PRAGMA table_info(intel_manual_action)").all().some((row: any) => row.name === "metadata_json")).toBe(false)
    const before = old.native.prepare("SELECT * FROM intel_source ORDER BY id").all()
    fail = false
    await initShippingTables(old.database, "real")
    await initShippingTables(old.database, "real")
    expect(old.native.prepare("SELECT * FROM intel_source WHERE id <> ? ORDER BY id").all(MANUAL_CLIP_SOURCE_ID)).toEqual(before)
    expect(old.native.prepare("PRAGMA foreign_key_check").all()).toEqual([])
  } finally {
    old.native.close()
  }
})
it.each([
  ["2026-10-16", "publication", "day", "missing", null],
  ["2026-10-16T10:00:00", "publication", "second", "missing", null],
  ["2026-10-16T10:00:00-00:00", "publication", "second", "missing", null],
  ["2026-10-16T10:00:00+08:00", "publication", "second", "explicit", "2026-10-16T02:00:00.000Z"],
  ["2026-10-16T10:00:00+08:00", "unknown", "second", "explicit", null],
  ["2026-10-16T10:00:00Z", "effective", "second", "explicit", null],
  ["2026-02-30", "publication", "unknown", "missing", null],
  ["Fri, 16 Oct 2026 10:00:00 +0800", "publication", "unknown", "missing", null],
])("preserves raw date and derives only supported semantics: %s", (raw, role, precision, timezone, publishedAt) => {
  expect(manualClipDate({ raw: String(raw), field: "synthetic", role: role as "publication" })).toMatchObject({ raw, role, precision, timezone, publishedAt })
})
it.each(["legacy", "private"])("runs %s bridge-shaped payload through same-origin HTTP and reads stored text without write/egress", async (mode) => {
  vi.stubGlobal("useDatabase", () => state.database)
  const server = createServer(toNodeListener(createApp().use(security).use(createRouter().post("/api/shipping/intel/manual", manualPost).get("/api/shipping/intel/items/:id", itemGet))))
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve))
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  const net = (await import("node:http")).request
  async function request(path: string, body?: unknown, origin = base) {
    return await new Promise<{ status: number, data: Record<string, any> }>((resolve, reject) => {
      const req = net(`${base}${path}`, { method: body ? "POST" : "GET", headers: body ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(JSON.stringify(body)), "Origin": origin } : {} }, (res) => {
        let text = ""
        res.on("data", (chunk) => {
          text += chunk
        })
        res.on("end", () => resolve({ status: res.statusCode!, data: JSON.parse(text) }))
      })
      req.on("error", reject)
      req.end(body ? JSON.stringify(body) : undefined)
    })
  }
  try {
    const { operator: _operator, ...withoutName } = input()
    const { rights: _rights, ...privateInput } = withoutName
    if (mode === "private") privateInput.clip.body = "Private confirmed body  \t\n\n".repeat(40)
    expect((await request("/api/shipping/intel/manual", mode === "private" ? privateInput : withoutName, "https://evil.example")).status).toBe(403)
    expect(await state.repository.listItems(MANUAL_CLIP_SOURCE_ID)).toHaveLength(0)
    const saved = await request("/api/shipping/intel/manual", mode === "private" ? privateInput : withoutName)
    expect(saved.status).toBe(200)
    state.native.exec("PRAGMA query_only=ON")
    const read = await request(`/api/shipping/intel/items/${saved.data.itemId}`)
    expect(read.data.manualLabel).toContain("不是官方预警")
    expect(read.data.clip.actualUrl).toBe(url)
    expect(read.data.manualEntry).toMatchObject({ operator: CLIP_UNIDENTIFIED_OPERATOR })
    expect(read.data.selectedVersion.blocks.filter((b: { type: string }) => b.type !== "title").map((b: { text: string }) => b.text).join("")).toBe(mode === "private" ? privateInput.clip.body : draft.body)
    if (mode === "private") {
      expect(read.data.clip).toMatchObject({ usage: "private_material", rightsStatus: "unknown" })
      expect(read.data.clip).not.toHaveProperty("rights")
      const generic = await readIntelMaterial(state.repository, saved.data.itemId, saved.data.versionId)
      expect(generic.ok && generic.material.bodyText).toBeNull()
    }
  } finally {
    server.closeAllConnections()
    await new Promise<void>(resolve => server.close(() => resolve()))
  }
})
