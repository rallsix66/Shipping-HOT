import { createHash } from "node:crypto"
import { MANUAL_CLIP_SOURCE_ID, clipOperator, clipText, exactKeys, parseClipDraft, parseClipRights } from "@shared/manual-clip"
import type { ClipAudit, ClipDateInput } from "@shared/manual-clip"
import type { IntelRepository } from "#/database/intel"
import type { WebDate } from "#/intel/sources/web-list"
import { licensedBlocks } from "#/intel/content-license"
import { ManualInputError } from "#/intel/manual-input"
import { canonicalizeFeedUrl } from "#/providers/feed"

export function manualClipDate(input: ClipDateInput): WebDate {
  const result: WebDate = { raw: input.raw || null, rule: "manual_raw", basis: `User supplied; unverified; field=${input.field || "unknown"}`, role: input.role, calendar: "unknown", precision: "unknown", timezone: "missing", utcOffset: null, localDate: null, publishedAt: null }
  const match = /^(\d{4}-\d{2}-\d{2})(?:T(\d{2}):(\d{2}):(\d{2})(\.\d{3})?(Z|[+-]\d{2}:\d{2})?)?$/.exec(input.raw)
  if (!match || !Number.isFinite(Date.parse(`${match[1]}T00:00:00Z`)) || new Date(`${match[1]}T00:00:00Z`).toISOString().slice(0, 10) !== match[1]) return result
  if (match[2] && (+match[2] > 23 || +match[3] > 59 || +match[4] > 59)) return result
  const zone = match[6]
  if (zone && zone !== "Z" && !/^[+-](?:(?:0\d|1[0-3]):[0-5]\d|14:00)$/.test(zone)) return result
  Object.assign(result, { calendar: "gregorian", localDate: match[1], precision: match[2] ? match[5] ? "millisecond" : "second" : "day", rule: "manual_iso_raw" })
  if (zone && zone !== "-00:00") {
    result.timezone = "explicit"
    result.utcOffset = zone === "Z" ? "+00:00" : zone
    if (input.role === "publication") result.publishedAt = new Date(input.raw).toISOString()
  }
  return result
}
export async function manualClipSubmit(repo: IntelRepository, data: Record<string, unknown>, now: string) {
  try {
    exactKeys(data, ["requestId", "sourceId", "operator", "action", "clip", "rights"])
    const requestId = clipText(data.requestId, 80)
    const operator = clipOperator(data.operator)
    if (!/^[\w-]{8,80}$/.test(requestId) || data.sourceId !== MANUAL_CLIP_SOURCE_ID || data.action !== "submit") throw new Error("invalid_clip_input")
    const draft = parseClipDraft(data.clip)
    const rights = parseClipRights(data.rights, draft.actualUrl)
    if ((rights.scope === "metadata_only" && draft.body) || (rights.scope === "excerpt" && draft.body.length > 280)) throw new Error("clip_body_exceeds_rights")
    const source = await repo.getSource(MANUAL_CLIP_SOURCE_ID)
    if (!source || source.kind !== "manual" || source.catalogId !== "MANUAL-CLIP" || source.enabled) throw new Error("invalid_clip_source")
    const canonicalUrl = canonicalizeFeedUrl(draft.actualUrl)!
    const dateEvidence = manualClipDate(draft.date)
    const blocks = licensedBlocks(rights.scope, draft.title, draft.body)
    const metadata: ClipAudit = { ...draft, body: "", rights, declaredBy: operator, declaredAt: now, verification: "user_declaration_unverified" }
    const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex")
    // Capture/software version is audit; only semantic date/content changes version.
    const contentHash = hash({ title: draft.title, dateEvidence, contentScope: rights.scope, blocks })
    return await repo.writeEntry({ sourceId: MANUAL_CLIP_SOURCE_ID, canonicalUrl, title: draft.title, publishedAt: dateEvidence.publishedAt ?? undefined, dateEvidence, contentHash, contentScope: rights.scope, blocks, fetchedAt: now, extractorVersion: "manual-clip-v1" }, { requestId, sourceId: MANUAL_CLIP_SOURCE_ID, operator, enteredAt: now, action: "submit", payloadHash: hash({ operator, metadata: { ...metadata, declaredAt: undefined }, contentHash }), metadata })
  } catch (error) {
    if (error instanceof Error && error.message === "manual_request_conflict") throw error
    if (error instanceof Error && /^(?:invalid_|sensitive_|clip_)/.test(error.message)) throw new ManualInputError(error.message)
    throw error
  }
}
