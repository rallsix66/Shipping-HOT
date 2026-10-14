import { createHash } from "node:crypto"
import type { IntelRepository } from "#/database/intel"
import { contentScopeFor, licensedBlocks } from "#/intel/content-license"
import { manualCatalog } from "#/intel/manual-catalog"
import { intelSourceSeeds } from "#/intel/sources.ts"
import { canonicalizeFeedUrl } from "#/providers/feed"

export class ManualInputError extends Error {}
function invalid(): never {
  throw new ManualInputError("invalid_manual_input")
}
function text(value: unknown, max: number, required = true): string {
  if (typeof value !== "string" || value.length > max || [...value].some(char => char.charCodeAt(0) < 32 && !"\t\n\r".includes(char)) || /<\/?[a-z!]|&#?\w+;/i.test(value)) return invalid()
  const clean = value.trim()
  if (required && !clean) return invalid()
  return clean
}
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex")

/** No fetch, provider, extraction, or initialization dependency. */
export async function manualSubmit(repo: IntelRepository, input: unknown, now: string): Promise<{ outcome: string, itemId?: string, versionId?: string }> {
  if (!input || typeof input !== "object" || Array.isArray(input)) return invalid()
  const data = input as Record<string, unknown>
  if (Object.keys(data).some(key => !["requestId", "sourceId", "operator", "action", "url", "title", "body", "publishedAt"].includes(key))) return invalid()
  const requestId = text(data.requestId, 80)
  if (!/^[\w-]{8,80}$/.test(requestId)) return invalid()
  const sourceId = text(data.sourceId, 160)
  const operator = text(data.operator, 80)
  const manual = manualCatalog.find(row => row.id === sourceId)
  const seed = intelSourceSeeds.find(row => row.id === sourceId)
  if ((!manual && !seed) || manual?.historicalOnly) return invalid()
  const source = await repo.getSource(sourceId)
  if (!source || source.catalogId !== (manual ?? seed)?.catalogId) return invalid()
  if (data.action === "checked_empty") {
    if (["url", "title", "body", "publishedAt"].some(key => data[key] !== undefined)) return invalid()
    await repo.recordManualCheck({ requestId, sourceId, operator, enteredAt: now, action: "checked_empty", payloadHash: hash({ sourceId, operator, action: data.action }) })
    return { outcome: "checked_empty" }
  }
  if (data.action !== "submit") return invalid()
  let url: URL
  try {
    url = new URL(text(data.url, 2048))
  } catch {
    return invalid()
  }
  const hosts = manual ? manual.urls.map(value => new URL(value).hostname) : seed!.allowedHosts
  if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443") || !hosts.includes(url.hostname) || [...url.searchParams.keys()].some(key => /key|token|secret|password|auth|credential|signature|cookie|csrf|sig/i.test(key))) return invalid()
  const canonicalUrl = canonicalizeFeedUrl(url.toString())
  if (!canonicalUrl) return invalid()
  const title = text(data.title, 500)
  const body = text(data.body ?? "", 100000, false)
  // Refuse prohibited text instead of silently storing a hash of restricted full text.
  if (source.persistence === "disallowed" && body) return invalid()
  let publishedAt: string | undefined
  if (data.publishedAt !== undefined && data.publishedAt !== "") {
    const value = text(data.publishedAt, 40)
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(Date.parse(value))) return invalid()
    publishedAt = new Date(value).toISOString()
    const date = value.slice(0, 10)
    if (new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date) return invalid()
  }
  const contentScope = contentScopeFor(source.persistence)
  const blocks = licensedBlocks(contentScope, title, body)
  const contentHash = hash({ title, publishedAt: publishedAt ?? null, contentScope, blocks })
  return repo.writeEntry({ sourceId, canonicalUrl, title, publishedAt, contentHash, contentScope, blocks, fetchedAt: now, extractorVersion: "manual-plain-v1" }, { requestId, sourceId, operator, enteredAt: now, action: "submit", payloadHash: hash({ sourceId, operator, canonicalUrl, contentHash }) })
}
