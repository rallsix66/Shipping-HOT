import { isSyntheticClipUrl } from "./clip-build"

export const MANUAL_CLIP_SOURCE_ID = "intel:manual:clip"
export const CLIP_PROTOCOL = "shipping-hot-clip-v1"
export const CLIP_MAX_BYTES = 512 * 1024
export const CLIP_UNIDENTIFIED_OPERATOR = "未识别人工操作（未经身份认证）"
export type ClipScope = "metadata_only" | "excerpt" | "full_text"
export type ClipMode = "metadata" | "selection" | "article"
export type DateRole = "unknown" | "publication" | "effective" | "updated"
export interface ClipDateInput {
  raw: string
  field: string
  role: DateRole
}
export interface ClipDraft {
  protocol: typeof CLIP_PROTOCOL
  actualUrl: string
  title: string
  body: string
  mode: ClipMode
  date: ClipDateInput
  capturedAt: string
  extractorVersion: string
}
export interface ClipRights {
  basis: "unknown" | "own_work" | "permission"
  scope: ClipScope
  evidence: string
  applicableUrl: string
}
export interface LegacyClipAudit extends ClipDraft {
  rights: ClipRights
  declaredBy: string
  declaredAt: string
  verification: "user_declaration_unverified"
}
export interface PrivateClipAudit extends ClipDraft {
  capture: "manual_user_capture"
  usage: "private_material"
  rightsStatus: "unknown"
  recordedBy: string
  recordedAt: string
  verification: "manual_capture_unverified"
}
export type ClipAudit = LegacyClipAudit | PrivateClipAudit
export function clipText(value: unknown, max: number, required = true): string {
  if (typeof value !== "string" || value.length > max || [...value].some(char => char.charCodeAt(0) < 32 && !"\t\n\r".includes(char)) || /<\/?[a-z!]|&#?\w+;/i.test(value) || (required && !value.trim())) throw new Error("invalid_clip_input")
  return value
}
/** Legacy supplied names remain unverified; new clipping never requires a name. */
export function clipOperator(value: unknown): string {
  if (value === undefined) return CLIP_UNIDENTIFIED_OPERATOR
  const operator = clipText(value, 80, false)
  return operator.trim() ? operator : CLIP_UNIDENTIFIED_OPERATOR
}
export function exactKeys(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some(key => !keys.includes(key))) throw new Error("invalid_clip_input")
  return value as Record<string, unknown>
}
export function clipActualUrl(value: unknown): string {
  const raw = clipText(value, 2048)
  if (isSyntheticClipUrl(raw)) return raw
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new Error("invalid_clip_url")
  }
  // No resolution/fetch. Reject sensitive identities rather than silently cleaning them.
  if (raw !== raw.trim() || url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443") || !url.hostname.includes(".") || /^[\d.]+$/.test(url.hostname) || /[:[\]]/.test(url.hostname) || /(?:^|\.)(?:localhost|local|internal)$/.test(url.hostname)) throw new Error("invalid_clip_url")
  for (const part of [url.search.slice(1), url.hash.slice(1)]) {
    for (const key of new URLSearchParams(part).keys()) {
      if (/key|token|secret|password|auth|credential|signature|cookie|csrf|(?:^|[_-])sig(?:$|[_-])/i.test(key)) throw new Error("sensitive_clip_url")
    }
  }
  return raw
}
export function parseClipDraft(value: unknown): ClipDraft {
  const row = exactKeys(value, ["protocol", "actualUrl", "title", "body", "mode", "date", "capturedAt", "extractorVersion"])
  const date = exactKeys(row.date === undefined ? {} : row.date, ["raw", "field", "role"])
  const role = date.role === undefined ? "unknown" : date.role
  if (row.protocol !== CLIP_PROTOCOL || !["metadata", "selection", "article"].includes(String(row.mode)) || !["unknown", "publication", "effective", "updated"].includes(String(role))) throw new Error("invalid_clip_input")
  const draft: ClipDraft = { protocol: CLIP_PROTOCOL, actualUrl: clipActualUrl(row.actualUrl), title: clipText(row.title, 500), body: clipText(row.body, 100000, false), mode: row.mode as ClipMode, date: { raw: clipText(date.raw === undefined ? "" : date.raw, 400, false), field: clipText(date.field === undefined ? "" : date.field, 80, false), role: role as DateRole }, capturedAt: clipText(row.capturedAt, 40), extractorVersion: clipText(row.extractorVersion, 80) }
  if (!/^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(draft.capturedAt) || !Number.isFinite(Date.parse(draft.capturedAt)) || (draft.mode === "metadata" && draft.body) || new TextEncoder().encode(JSON.stringify(draft)).length > CLIP_MAX_BYTES) throw new Error("invalid_clip_input")
  return draft
}
export function parseClipRights(value: unknown, actualUrl: string): ClipRights {
  const row = exactKeys(value, ["basis", "scope", "evidence", "applicableUrl"])
  if (!["unknown", "own_work", "permission"].includes(String(row.basis)) || !["metadata_only", "excerpt", "full_text"].includes(String(row.scope))) throw new Error("invalid_clip_rights")
  const evidence = clipText(row.evidence, 1000, false)
  if (row.applicableUrl !== actualUrl || (row.scope !== "metadata_only" && (row.basis === "unknown" || !evidence.trim()))) throw new Error("clip_rights_required")
  return { basis: row.basis as ClipRights["basis"], scope: row.scope as ClipScope, evidence, applicableUrl: actualUrl }
}
