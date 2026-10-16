import { createHash } from "node:crypto"
import dns from "node:dns"
import { readFileSync } from "node:fs"
import { Socket } from "node:net"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { IntelContentScope, IntelEntryWrite, IntelPersistence } from "#/database/intel"
import { initShippingTables } from "#/database/shipping"
import { open } from "#/intel/__fixtures__/isolated-db"
import { licensedBlocks } from "#/intel/content-license"
import { manualSubmit } from "#/intel/manual"
import { readIntelMaterial } from "#/intel/material-read"
import { intelSourceSeeds } from "#/intel/sources"

const NOW = "2026-10-15T00:00:00.000Z"
const source = intelSourceSeeds[0]
const url = "https://www.tmd.go.th/synthetic/story?id=5"
const body = "Synthetic licensed material for an immutable version. ".repeat(100)
const hash = (text: string) => createHash("sha256").update(text).digest("hex")
let state: ReturnType<typeof open>
// The project's narrow native declaration omits the installed serialize API.
function databaseHash() {
  const database = state.native as typeof state.native & { serialize: () => Uint8Array }
  return createHash("sha256").update(database.serialize()).digest("hex")
}
let before: string | undefined
let statements: string[]
let networkAttempts: string[]

beforeEach(async () => {
  state = open()
  await initShippingTables(state.database, "real")
  await state.repository.upsertSource(source, NOW)
  before = undefined
  statements = []
  networkAttempts = []
  const forbidden = (channel: string): never => {
    networkAttempts.push(channel)
    throw new Error("Network forbidden in stored-material reads")
  }
  vi.stubGlobal("fetch", () => forbidden("fetch"))
  vi.spyOn(Socket.prototype, "connect").mockImplementation(() => forbidden("tcp"))
  vi.spyOn(dns, "lookup").mockImplementation(() => forbidden("dns"))
})

afterEach(() => {
  if (before) {
    expect(databaseHash()).toBe(before)
    expect(statements.every(sql => /^\s*SELECT\b/i.test(sql))).toBe(true)
  }
  expect(networkAttempts).toEqual([])
  state.native.close()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function readOnly() {
  state.native.exec("PRAGMA query_only=ON")
  before = databaseHash()
  const prepare = state.database.prepare.bind(state.database)
  vi.spyOn(state.database, "prepare").mockImplementation((sql) => {
    statements.push(sql)
    if (!/^\s*SELECT\b/i.test(sql)) throw new Error("Non-SELECT material read")
    return prepare(sql)
  })
}

async function save(overrides: Partial<IntelEntryWrite> = {}) {
  return state.repository.writeEntry({ sourceId: source.id, canonicalUrl: url, title: "Historical title", contentHash: hash("old body"), contentScope: "full_text", extractorVersion: "synthetic-material-v1", blocks: licensedBlocks("full_text", "Historical title", body), fetchedAt: NOW, ...overrides })
}

describe("stored intel material read", () => {
  it("reads the exact old version title, body, source and identity instead of mutable current metadata", async () => {
    const old = await save({ publishedAt: "2026-10-13T01:00:00.000Z", sourceUpdatedAt: "2026-10-13T02:00:00.000Z" })
    await save({ title: "Current title", publishedAt: "2026-10-14T00:00:00.000Z", contentHash: hash("new body"), blocks: licensedBlocks("full_text", "Current title", "Current body") })
    readOnly()
    const result = await readIntelMaterial(state.repository, old.itemId, old.versionId)
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(result.code)
    expect(result.material).toMatchObject({ itemId: old.itemId, canonicalUrl: url, title: "Historical title", bodyText: body, contentScope: "full_text", storedContentScope: "full_text" })
    expect(result.material.source).toEqual({ id: source.id, catalogId: source.catalogId, name: source.name, kind: source.kind, url: source.url, persistence: source.persistence })
    expect(result.material.version).toMatchObject({ id: old.versionId, itemId: old.itemId, contentHash: hash("old body"), extractorVersion: "synthetic-material-v1", sourcePublishedAt: "2026-10-13T01:00:00.000Z", sourceUpdatedAt: "2026-10-13T02:00:00.000Z", dateEvidence: null, fetchedAt: NOW, createdAt: NOW })
    expect(result.material.blocks).toEqual(await state.repository.readVersionBlocks(old.versionId))
    expect(JSON.stringify(result)).not.toContain("Current title")
  })

  it.each([
    ["full", "full_text", "full_text"],
    ["full", "excerpt", "excerpt"],
    ["full", "metadata_only", "metadata_only"],
    ["excerpt_only", "full_text", "excerpt"],
    ["excerpt_only", "excerpt", "excerpt"],
    ["excerpt_only", "metadata_only", "metadata_only"],
    ["disallowed", "full_text", "metadata_only"],
    ["disallowed", "excerpt", "metadata_only"],
    ["disallowed", "metadata_only", "metadata_only"],
  ] as const)("intersects current %s with stored %s to return only %s", async (persistence: IntelPersistence, stored: IntelContentScope, expected: IntelContentScope) => {
    await state.repository.upsertSource({ ...source, persistence }, NOW)
    const saved = await save({ contentScope: stored })
    readOnly()
    const result = await readIntelMaterial(state.repository, saved.itemId, saved.versionId)
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(result.code)
    expect(result.material.contentScope).toBe(expected)
    expect(result.material.storedContentScope).toBe(stored)
    expect(result.material.version.contentHash).toBe(hash("old body"))
    if (expected === "full_text") {
      expect(result.material.bodyText).toBe(body)
    } else if (expected === "excerpt") {
      expect(result.material.bodyText!.length).toBeLessThanOrEqual(280)
      expect(result.material.blocks.map(block => block.type)).toEqual(["title", "excerpt"])
      expect(result.material.bodyText).not.toBe(body)
    } else {
      expect(result.material.bodyText).toBeNull()
      expect(result.material.blocks.map(block => block.type)).toEqual(["title"])
      expect(JSON.stringify(result)).not.toContain(body.slice(0, 100))
    }
  })

  it("keeps unknown dates null and exposes title-only material without fetching a missing body", async () => {
    const saved = await save({ blocks: licensedBlocks("full_text", "Title only", "") })
    readOnly()
    const result = await readIntelMaterial(state.repository, saved.itemId, saved.versionId)
    expect(result).toMatchObject({ ok: true, material: { title: "Title only", bodyText: null, version: { sourcePublishedAt: null, sourceUpdatedAt: null, dateEvidence: null } } })
    expect((await state.repository.getItem(saved.itemId))?.publishedAt).toBeNull()
  })

  it("uses exact old manual-version attribution beyond the audit display limit", async () => {
    let first: Awaited<ReturnType<typeof manualSubmit>> | undefined
    for (let i = 0; i < 25; i++) {
      const saved = await manualSubmit(state.repository, { requestId: `material-manual-${i}`, sourceId: source.id, operator: "Synthetic operator", action: "submit", url: source.url, title: `Manual title ${i}`, body: `Manual body ${i}` }, NOW)
      first ??= saved
    }
    readOnly()
    expect(await state.repository.listManualActions(source.id, first!.itemId)).toHaveLength(20)
    expect(await readIntelMaterial(state.repository, first!.itemId!, first!.versionId!)).toMatchObject({ ok: true, material: { title: "Manual title 0", bodyText: "Manual body 0", canonicalUrl: source.url, contentScope: "full_text" } })
  })

  it("narrows a legacy manual full body outside the exact verified feed product to metadata", async () => {
    const saved = await state.repository.writeEntry({ sourceId: source.id, canonicalUrl: url, title: "Legacy title", contentHash: "legacy-original", contentScope: "full_text", extractorVersion: "manual-plain-v1", blocks: licensedBlocks("full_text", "Legacy title", body), fetchedAt: NOW }, { requestId: "material-legacy-01", payloadHash: "legacy-payload", sourceId: source.id, action: "submit", operator: "Synthetic", enteredAt: NOW })
    readOnly()
    const result = await readIntelMaterial(state.repository, saved.itemId, saved.versionId)
    expect(result).toMatchObject({ ok: true, material: { contentScope: "metadata_only", storedContentScope: "full_text", bodyText: null, version: { contentHash: "legacy-original" } } })
    expect(JSON.stringify(result)).not.toContain(body.slice(0, 100))
    expect((await state.repository.getVersion(saved.itemId, saved.versionId))?.contentScope).toBe("full_text")
  })

  it("rejects missing and cross-item versions without a current-version or FeedItem fallback", async () => {
    const first = await save()
    const other = await save({ canonicalUrl: "https://www.tmd.go.th/synthetic/other", contentHash: "other" })
    readOnly()
    expect(await readIntelMaterial(state.repository, "feed:existing-feed-identity", first.versionId)).toEqual({ ok: false, code: "item_not_found" })
    expect(await readIntelMaterial(state.repository, first.itemId, "missing")).toEqual({ ok: false, code: "version_not_found" })
    expect(await readIntelMaterial(state.repository, first.itemId, other.versionId)).toEqual({ ok: false, code: "version_not_found" })
  })

  it("identifies a missing source or historical title without borrowing current content", async () => {
    const saved = await save({ blocks: [] })
    readOnly()
    expect(await readIntelMaterial(state.repository, saved.itemId, saved.versionId)).toEqual({ ok: false, code: "version_content_unavailable" })
    vi.spyOn(state.repository, "getSource").mockResolvedValueOnce(undefined)
    expect(await readIntelMaterial(state.repository, saved.itemId, saved.versionId)).toEqual({ ok: false, code: "source_not_found" })
  })

  it.each(["getItem", "getSource", "getVersion", "readVersionBlocks", "getManualVersionAction"] as const)("returns a recognizable storage failure from %s without leaking its error", async (method) => {
    const saved = await save()
    readOnly()
    vi.spyOn(state.repository, method).mockRejectedValueOnce(new Error("Synthetic sensitive database failure"))
    expect(await readIntelMaterial(state.repository, saved.itemId, saved.versionId)).toEqual({ ok: false, code: "storage_unavailable" })
  })

  it.each([["", "version"], ["item", ""], ["item", "version with spaces"]])("requires explicit valid identity %s / %s before reading", async (itemId, versionId) => {
    readOnly()
    expect(await readIntelMaterial(state.repository, itemId, versionId)).toEqual({ ok: false, code: "invalid_identity" })
    expect(statements).toEqual([])
  })

  it("has no HTTP, provider, write service or model dependency", () => {
    const code = readFileSync("server/intel/material-read.ts", "utf8")
    const imports = [...code.matchAll(/from\s+["']([^"']+)["']/g)].map(match => match[1])
    expect(imports.sort()).toEqual(["#/database/intel", "#/intel/content-license", "#/intel/manual-license"].sort())
    expect(code).not.toMatch(/\b(?:fetch|eval|require|import)\s*\(/)
  })
})
