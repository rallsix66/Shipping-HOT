import type { IntelBlock, IntelContentScope, IntelRepository, IntelSourceRecord, IntelVersionRecord } from "#/database/intel"
import { licensedBlocks, permittedContentScope } from "#/intel/content-license"
import { manualPersistenceFor } from "#/intel/manual-license"

type MaterialRepository = Pick<IntelRepository, "getItem" | "getSource" | "getVersion" | "readVersionBlocks" | "getManualVersionAction">

export interface IntelMaterial {
  itemId: string
  /** Stored canonical identity; not a claim that the original wire href survived. */
  canonicalUrl: string
  source: Pick<IntelSourceRecord, "id" | "catalogId" | "name" | "kind" | "url" | "persistence">
  version: Omit<IntelVersionRecord, "contentScope">
  storedContentScope: IntelContentScope
  contentScope: IntelContentScope
  title: string
  blocks: IntelBlock[]
  /** Licensed stored body only; null explicitly means no readable body. */
  bodyText: string | null
}

export type IntelMaterialReadResult = { ok: true, material: IntelMaterial } | {
  ok: false
  code: "invalid_identity" | "item_not_found" | "source_not_found" | "version_not_found" | "version_content_unavailable" | "storage_unavailable"
}

/**
 * Internal stored-material read, not an HTTP/model payload. Explicit version only:
 * no current-version fallback, FeedItem bridge, initialization, fetch or writes.
 * Provenance is returned as stored, including nullable/unknown source dates.
 */
export async function readIntelMaterial(repo: MaterialRepository, itemId: string, versionId: string): Promise<IntelMaterialReadResult> {
  if (![itemId, versionId].every(value => typeof value === "string" && /^[\w:.-]{1,160}$/.test(value))) return { ok: false, code: "invalid_identity" }
  try {
    const item = await repo.getItem(itemId)
    if (!item) return { ok: false, code: "item_not_found" }
    const source = await repo.getSource(item.sourceId)
    if (!source) return { ok: false, code: "source_not_found" }
    const version = await repo.getVersion(item.id, versionId)
    if (!version || version.id !== versionId || version.itemId !== item.id) return { ok: false, code: "version_not_found" }
    const blocks = await repo.readVersionBlocks(version.id)
    // A current item title cannot stand in for a missing historical title.
    const title = blocks.find(block => block.type === "title")?.text
    if (title === undefined) return { ok: false, code: "version_content_unavailable" }
    const manual = await repo.getManualVersionAction(source.id, item.id, version.id)
    const persistence = manual ? manualPersistenceFor(source, item.canonicalUrl, manual) : source.persistence
    const { contentScope: storedContentScope, ...identity } = version
    const contentScope = permittedContentScope(persistence, storedContentScope)
    const safeBlocks = contentScope === "full_text"
      ? blocks
      : licensedBlocks(contentScope, title, blocks.filter(block => block.type !== "title").map(block => block.text).join(""))
    const bodyText = safeBlocks.filter(block => block.type !== "title").map(block => block.text).join("") || null
    return {
      ok: true,
      material: {
        itemId: item.id,
        canonicalUrl: item.canonicalUrl,
        source: { id: source.id, catalogId: source.catalogId, name: source.name, kind: source.kind, url: source.url, persistence: source.persistence },
        version: identity,
        storedContentScope,
        contentScope,
        title,
        blocks: safeBlocks,
        bodyText,
      },
    }
  } catch {
    return { ok: false, code: "storage_unavailable" }
  }
}
