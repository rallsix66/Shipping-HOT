import { type Server, createServer } from "node:http"
import { readFileSync } from "node:fs"
import { createApp, createRouter, toNodeListener } from "h3"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import sourcesHandler from "./sources.get"
import itemsHandler from "./items.get"
import itemHandler from "./items/[id].get"
import manualHandler from "./manual.get"
import { manualSubmit } from "#/intel/manual"
import { open } from "#/intel/__fixtures__/isolated-db"
import { initShippingTables } from "#/database/shipping"
import { intelSourceSeeds } from "#/intel/sources"
import { parseLooseDate } from "#/intel/sources/web-list"

const NOW = "2026-10-13T02:00:00.000Z"
let state: ReturnType<typeof open>
let server: Server
let base: string
let itemId: string
let firstVersion: string
let otherVersion: string
let outbound: string[]
let before: string
const originalFetch = globalThis.fetch
const snapshot = () => JSON.stringify((state.native.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as { name: string }[]).map(({ name }) => [name, state.native.prepare(`SELECT * FROM "${name.replaceAll("\"", "\"\"")}" ORDER BY rowid`).all()]))

beforeEach(async () => {
  state = open()
  await initShippingTables(state.database, "mock")
  const source = { ...intelSourceSeeds[0], id: "test:read", name: "Read fixture", enabled: false, persistence: "full" as const, url: "https://www.tmd.go.th/?token=private-marker" }
  await state.repository.upsertSource(source, NOW)
  const evidence = parseLooseDate("2026-10-13 09:00", { dateRuleBasis: "Offline configured UTC+07", publishedAtUtcOffset: "+07:00" })
  const first = await state.repository.writeEntry({ sourceId: source.id, canonicalUrl: "https://www.tmd.go.th/story?token=private-marker", title: "Read headline", publishedAt: NOW, contentHash: "first", contentScope: "full_text", extractorVersion: "intel-web-list-v1", dateEvidence: evidence, blocks: [{ blockKey: "title", type: "title", order: 0, text: "Read headline" }, { blockKey: "p0", type: "paragraph", order: 1, text: "Article text ".repeat(100) }], fetchedAt: NOW })
  itemId = first.itemId
  firstVersion = first.versionId
  await state.repository.writeEntry({ sourceId: source.id, canonicalUrl: "https://www.tmd.go.th/story?token=private-marker", title: "Read headline", contentHash: "second", contentScope: "excerpt", extractorVersion: "intel-web-list-v1", dateEvidence: { ...evidence, raw: "Authorization: private-marker", basis: "Cookie: private-marker", certificatePem: "private-marker", headers: { authorization: "private-marker" } } as never, blocks: [{ blockKey: "title", type: "title", order: 0, text: "Read headline" }, { blockKey: "excerpt", type: "excerpt", order: 1, text: "Already licensed excerpt" }], fetchedAt: "2026-10-13T03:00:00.000Z" })
  const other = await state.repository.writeEntry({ sourceId: source.id, canonicalUrl: "https://www.tmd.go.th/other", title: "Other", contentHash: "other", contentScope: "metadata_only", extractorVersion: "intel-feed-v1", blocks: [], fetchedAt: NOW })
  otherVersion = other.versionId
  const runId = await state.repository.beginRun(source.id, NOW)
  await state.repository.completeRun(runId!, { status: "failed", finishedAt: NOW, errorCode: "private-marker", errorMessage: "Authorization: private-marker" })
  await state.repository.recordSourceFailure(source.id, { now: NOW, consecutiveFailures: 1, errorCode: "private-marker", nextSyncAt: NOW })
  vi.stubGlobal("useDatabase", () => state.database)
  const app = createApp({ debug: false })
  const router = createRouter().get("/api/shipping/intel/manual", manualHandler).get("/api/shipping/intel/sources", sourcesHandler).get("/api/shipping/intel/items", itemsHandler).get("/api/shipping/intel/items/:id", itemHandler)
  app.use(router)
  server = createServer(toNodeListener(app))
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve))
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  outbound = []
  vi.stubGlobal("fetch", (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    if (new URL(String(input)).origin !== base) {
      outbound.push(String(input))
      throw new Error("External fetch forbidden")
    }
    return originalFetch(input, init)
  })
  before = snapshot()
  state.native.exec("PRAGMA query_only=ON") // Any attempted write from an HTTP GET fails, independently of counters.
})
afterEach(async () => {
  server?.closeAllConnections()
  await new Promise<void>(resolve => server?.close(() => resolve()))
  expect(outbound).toEqual([])
  expect(snapshot()).toBe(before)
  state.native.close()
  vi.unstubAllGlobals()
})
async function get(path: string) {
  const response = await fetch(`${base}/api/shipping/intel/${path}`)
  return { status: response.status, body: await response.json() as Record<string, any>, cache: response.headers.get("cache-control") }
}

describe("intel actual HTTP read routes", () => {
  it("keeps early manual-version identity after 22 newer actions, distinct from automatic versions", async () => {
    state.native.exec("PRAGMA query_only=OFF")
    let earliest = ""
    let targetItem = ""
    for (let index = 0; index < 23; index++) {
      const result = await manualSubmit(state.repository, { requestId: `history-request-${index}`, sourceId: intelSourceSeeds[0].id, operator: `Reviewer ${index}`, action: "submit", url: intelSourceSeeds[0].url, title: "Synthetic CAP", body: `Synthetic version ${index}` }, NOW)
      targetItem = result.itemId!
      if (index === 0) earliest = result.versionId!
    }
    const auto = await state.repository.writeEntry({ sourceId: intelSourceSeeds[0].id, canonicalUrl: intelSourceSeeds[0].url, title: "Synthetic automatic", contentHash: "auto-new", contentScope: "full_text", extractorVersion: "intel-feed-v1", blocks: [], fetchedAt: NOW })
    before = snapshot()
    state.native.exec("PRAGMA query_only=ON")
    const early = await get(`items/${targetItem}?versionId=${earliest}`)
    expect(early.body.manualActions).toHaveLength(20)
    expect(early.body.manualLabel).toBe("官方通知（人工录入）")
    expect(early.body.manualEntry).toMatchObject({ operator: "Reviewer 0" })
    const current = await get(`items/${targetItem}?versionId=${auto.versionId}`)
    expect(current.body.manualLabel).toBeNull()
    expect(current.body.manualEntry).toBeNull()
    const items = await get(`items?sourceId=${intelSourceSeeds[0].id}`)
    expect(items.body.items[0].manualEntry).toBeNull()
  })
  it("clips legacy out-of-product manual body at read time without changing stored versions", async () => {
    state.native.exec("PRAGMA query_only=OFF")
    const saved = await state.repository.writeEntry({ sourceId: intelSourceSeeds[0].id, canonicalUrl: "https://www.tmd.go.th/story", title: "Synthetic legacy", contentHash: "legacy", contentScope: "full_text", extractorVersion: "manual-plain-v1", blocks: [{ blockKey: "title", type: "title", order: 0, text: "Synthetic legacy" }, { blockKey: "p0", type: "paragraph", order: 1, text: "Legacy out-of-product body" }], fetchedAt: NOW }, { requestId: "legacy-manual-action", sourceId: intelSourceSeeds[0].id, operator: "Legacy reviewer", action: "submit", enteredAt: NOW, payloadHash: "legacy" })
    before = snapshot()
    state.native.exec("PRAGMA query_only=ON")
    const response = await get(`items/${saved.itemId}`)
    expect(response.body.selectedVersion.contentScope).toBe("metadata_only")
    expect(response.body.selectedVersion.blocks).toHaveLength(1)
    expect(JSON.stringify(response.body)).not.toContain("Legacy out-of-product body")
    expect((await state.repository.getVersion(saved.itemId, saved.versionId))?.contentScope).toBe("full_text")
  })
  it("reads manual checklist with query_only and no external requests", async () => {
    const response = await get("manual")
    expect(response.status).toBe(200)
    expect(response.body.items).toHaveLength(42)
    expect(response.body.items.find((row: { catalogId: string }) => row.catalogId === "CN-P05")).toMatchObject({ persistence: "disallowed", recentActions: [] })
  })

  it("reads failed source health/recent runs and pages stored items without leaking config or error details", async () => {
    const sources = await get("sources?sourceId=test:read")
    expect(sources.status).toBe(200)
    expect(sources.cache).toBe("no-store")
    expect(sources.body.items[0]).toMatchObject({ status: "failing", consecutiveFailures: 1, recentRuns: [{ status: "failed" }] })
    expect(JSON.stringify(sources.body)).not.toContain("private-marker")
    expect(sources.body.items[0]).not.toHaveProperty("url")
    expect((await get("items?limit=1")).body).toMatchObject({ limit: 1, offset: 0, hasMore: true })
    expect((await get("items?limit=1&offset=1")).body).toMatchObject({ hasMore: false })
    expect((await get("items?offset=10000")).body.items).toEqual([])
    expect((await get("sources?offset=10000")).body.items).toEqual([])
  })
  it("reads selected historical body/date evidence and redacts sensitive current metadata", async () => {
    const old = await get(`items/${itemId}?versionId=${firstVersion}`)
    expect(old.status).toBe(200)
    expect(old.body.item.canonicalUrl).toBeNull()
    expect(old.body.selectedVersion).toMatchObject({ contentScope: "full_text", dateEvidence: { raw: "2026-10-13 09:00", timezone: "configured", utcOffset: "+07:00", publishedAt: NOW } })
    expect(old.body.selectedVersion.blocks[1].text.length).toBeGreaterThan(280)
    const current = await get(`items/${itemId}?limit=1`)
    expect(current.body.versions.hasMore).toBe(true)
    expect(current.body.selectedVersion.dateEvidence.raw).toBe("[redacted]")
    expect(JSON.stringify(current.body)).not.toContain("private-marker")
    expect(current.body.selectedVersion.dateEvidence).not.toHaveProperty("headers")
    expect(current.body.selectedVersion.dateEvidence).not.toHaveProperty("certificatePem")
  })
  it("caps historical full text at current excerpt/metadata policy without writing recovery or cache", async () => {
    state.native.exec("PRAGMA query_only=OFF")
    state.native.prepare("UPDATE intel_source SET persistence='excerpt_only'").run()
    before = snapshot()
    state.native.exec("PRAGMA query_only=ON")
    const excerpt = await get(`items/${itemId}?versionId=${firstVersion}`)
    expect(excerpt.body.selectedVersion.contentScope).toBe("excerpt")
    expect(excerpt.body.selectedVersion.blocks).toHaveLength(2)
    expect(excerpt.body.selectedVersion.blocks[1]).toMatchObject({ type: "excerpt" })
    expect(excerpt.body.selectedVersion.blocks[1].text.length).toBeLessThanOrEqual(280)
    state.native.exec("PRAGMA query_only=OFF")
    state.native.prepare("UPDATE intel_source SET persistence='disallowed'").run()
    before = snapshot()
    state.native.exec("PRAGMA query_only=ON")
    const metadata = await get(`items/${itemId}?versionId=${firstVersion}`)
    expect(metadata.body.selectedVersion.contentScope).toBe("metadata_only")
    expect(metadata.body.selectedVersion.blocks.map((b: { type: string }) => b.type)).toEqual(["title"])
  })
  it("returns coded unknown IDs and rejects cross-item versions or unsupported writes", async () => {
    expect((await get("sources?sourceId=missing")).status).toBe(404)
    expect((await get("items?sourceId=missing")).status).toBe(404)
    expect((await get("items/missing")).status).toBe(404)
    expect((await get(`items/${itemId}?versionId=${otherVersion}`)).status).toBe(404)
    expect([404, 405]).toContain((await fetch(`${base}/api/shipping/intel/items`, { method: "POST" })).status)
  })
  it.each(["limit=0", "limit=51", "limit=1.5", "limit=1&limit=2", "offset=-1", "offset=10001", "offset=9007199254740993", "sourceId=", "secret=x"])("rejects query boundary %s before any writes", async (q) => {
    expect((await get(`items?${q}`)).status).toBe(400)
  })
  it("repeated GETs remain SELECT-only; read dependency closure contains no network/LLM/runtime imports", async () => {
    for (let i = 0; i < 3; i++) {
      expect((await get("sources")).status).toBe(200)
      expect((await get("items")).status).toBe(200)
      expect((await get(`items/${itemId}`)).status).toBe(200)
    }
    for (const path of ["server/utils/intel-read.ts", "server/intel/content-license.ts", "server/api/shipping/intel/sources.get.ts", "server/api/shipping/intel/items.get.ts", "server/api/shipping/intel/items/[id].get.ts"]) {
      const code = readFileSync(path, "utf8")
      expect(code).not.toMatch(/(?:bootstrap|initShipping|recoverIntel|secureFetch|collectIntel|providers\/|runtime\/|paid|translation|fetch\()/)
      const imports = [...code.matchAll(/from\s+["']([^"']+)["']/g)].map(match => match[1])
      expect(imports.every(module => ["h3", "@shared/manual-clip", "#/database/intel", "#/intel/content-license", "#/intel/manual-catalog", "#/intel/manual-license", "#/utils/intel-read"].includes(module))).toBe(true)
      expect(code).not.toMatch(/\b(?:eval|require|import)\s*\(/)
    }
    // Repository has write APIs, but these named methods' bodies contain only bound SELECT statements.
    const repo = readFileSync("server/database/intel.ts", "utf8")
    for (const method of ["listSourcesPage", "listItemsPage", "getItem", "listVersionsPage", "getVersion", "listRecentRuns", "getSource", "readVersionBlocks", "getManualVersionAction"]) {
      const start = repo.indexOf(`async ${method}(`)
      const end = repo.indexOf("\n  }", start)
      const code = repo.slice(start, end)
      expect(code).toContain("SELECT")
      expect(code).not.toMatch(/\.(?:run|exec)\(|\b(?:INSERT|UPDATE|DELETE|BEGIN|PRAGMA)\b/)
    }
  })
  it("never returns CA PEM hidden in date evidence", async () => {
    state.native.exec("PRAGMA query_only=OFF")
    state.native.prepare("UPDATE intel_item_version SET date_evidence=? WHERE id=?").run(JSON.stringify({ raw: readFileSync("test/__fixtures__/source-ca-test.pem", "utf8"), basis: "Public fixture", rule: "unknown", headers: { cookie: "private-marker" } }), firstVersion)
    before = snapshot()
    state.native.exec("PRAGMA query_only=ON")
    const result = await get(`items/${itemId}?versionId=${firstVersion}`)
    expect(result.body.selectedVersion.dateEvidence.raw).toBe("[redacted]")
    expect(JSON.stringify(result.body)).not.toMatch(/BEGIN CERTIFICATE|private-marker/)
  })
  it("returns empty pages and generic 503 for unavailable data without initialization or error leakage", async () => {
    state.native.exec("PRAGMA query_only=OFF")
    for (const table of ["intel_item_block", "intel_item_current_change", "intel_item_version", "intel_item", "intel_fetch_run", "intel_source"]) state.native.exec(`DELETE FROM ${table}`)
    before = snapshot()
    state.native.exec("PRAGMA query_only=ON")
    expect((await get("sources")).body.items).toEqual([])
    expect((await get("items")).body.items).toEqual([])
    vi.stubGlobal("useDatabase", () => {
      throw new Error("Authorization: private-marker; SQL internal detail")
    })
    const failure = await get("sources")
    expect(failure.status).toBe(503)
    expect(JSON.stringify(failure.body)).not.toMatch(/private-marker|SQL internal/)
    const blank = open()
    try {
      vi.stubGlobal("useDatabase", () => blank.database)
      expect((await get("sources")).status).toBe(503)
      expect(blank.native.prepare("SELECT name FROM sqlite_master WHERE type='table'").all()).toEqual([])
    } finally {
      blank.native.close()
    }
  })
})
