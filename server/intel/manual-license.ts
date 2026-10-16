import { MANUAL_CLIP_SOURCE_ID, clipText, parseClipDraft, parseClipRights } from "@shared/manual-clip"
import type { ClipAudit } from "@shared/manual-clip"
import { canonicalizeFeedUrl } from "#/providers/feed"
import type { IntelPersistence, IntelSourceRecord } from "#/database/intel"
import { intelSourceSeeds } from "#/intel/sources.ts"

export function readClipAudit(action?: Record<string, unknown>): ClipAudit | null {
  try {
    if (!action || typeof action.metadata_json !== "string" || action.metadata_json.length > 16000) return null
    const row = JSON.parse(action.metadata_json) as ClipAudit
    const { rights, declaredBy, declaredAt, verification, ...draft } = row
    const parsed = parseClipDraft(draft)
    if (parsed.body || verification !== "user_declaration_unverified" || declaredBy !== action.operator || declaredAt !== action.entered_at) return null
    return { ...parsed, rights: parseClipRights(rights, parsed.actualUrl), declaredBy: clipText(declaredBy, 80), declaredAt: clipText(declaredAt, 40), verification }
  } catch {
    return null
  }
}

/** Existing evidence covers these exact feed products, never all pages on their hosts. */
export function manualPersistenceFor(source: Pick<IntelSourceRecord, "id" | "catalogId" | "persistence">, canonicalUrl: string, action?: Record<string, unknown>): IntelPersistence {
  if (source.id === MANUAL_CLIP_SOURCE_ID && source.catalogId === "MANUAL-CLIP") {
    const audit = readClipAudit(action)
    if (!audit || canonicalizeFeedUrl(audit.actualUrl) !== canonicalUrl) return "disallowed"
    return audit?.rights.scope === "full_text" ? "full" : audit?.rights.scope === "excerpt" ? "excerpt_only" : "disallowed"
  }
  const seed = intelSourceSeeds.find(row => row.id === source.id && row.catalogId === source.catalogId)
  if (!seed || canonicalUrl !== seed.url) return "disallowed"
  const rank = { disallowed: 0, excerpt_only: 1, full: 2 } as const
  return (["disallowed", "excerpt_only", "full"] as const)[Math.min(rank[source.persistence], rank[seed.persistence])]
}
