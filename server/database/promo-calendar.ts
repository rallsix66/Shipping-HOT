import { createHash } from "node:crypto"
import type { Database } from "db0"
import { type PromoCalendarEvent, type PromoCountry, type PromoPlatform, isCivilDate, promoCountries, promoEvidenceSources, promoPlatforms } from "@shared/promo-calendar"
import type { PromoCandidate } from "#/services/promo-calendar"

interface Row {
  id: string
  country_code: string
  title: string
  starts_at: string
  ends_at: string | null
  category: string
  basis_kind: string
  basis_ref: string | null
  confirmation_status: string
  rule_id: string | null
  notes: string | null
  platform: string | null
  entry_kind: string | null
  window_status: string | null
  generation_basis: string | null
  confirmation_source_id: string | null
  confirmation_evidence_ref: string | null
  confirmation_note: string | null
  confirmed_at: string | null
  manual_edited_at: string | null
}

export class PromoCalendarError extends Error {
  constructor(public readonly code: string, public readonly statusCode: number, message = code) {
    super(message)
  }
}

export interface PromoConfirmInput {
  id: unknown
  countryCode: unknown
  platform: unknown
  evidenceSourceId: unknown
  evidenceRef: unknown
  note?: unknown
}

export interface PromoManualInput {
  countryCode: string
  platform: string
  title: string
  startsAt: string
  endsAt: string
  notes?: string
}

const isPlatform = (v: unknown): v is PromoPlatform => typeof v === "string" && Object.prototype.hasOwnProperty.call(promoPlatforms, v)
const isCountry = (v: unknown): v is PromoCountry => typeof v === "string" && (promoCountries as readonly string[]).includes(v)

export function validatePromoFields(input: { countryCode: unknown, platform: unknown, startsAt: unknown, endsAt: unknown }): string | null {
  if (!isCountry(input.countryCode)) return "invalid_country"
  if (!isPlatform(input.platform)) return "invalid_platform"
  if (!isCivilDate(input.startsAt) || !isCivilDate(input.endsAt)) return "invalid_date"
  if (input.startsAt > input.endsAt) return "start_after_end"
  return null
}

function httpsUrl(value: unknown): URL | null {
  if (typeof value !== "string" || value.trim().length < 12) return null
  try {
    const url = new URL(value.trim())
    return url.protocol === "https:" && !url.username && !url.password ? url : null
  } catch {
    return null
  }
}

function toEvent(row: Row): PromoCalendarEvent {
  const platform: PromoPlatform = isPlatform(row.platform) ? row.platform : "unspecified"
  const endsAt = row.ends_at ?? row.starts_at
  let dataIssue: string | null = null
  if (!isCivilDate(row.starts_at) || !isCivilDate(endsAt)) dataIssue = "invalid_date"
  else if (row.starts_at > endsAt) dataIssue = "start_after_end"
  else if (!isCountry(row.country_code)) dataIssue = "invalid_country"
  else if (row.platform && !isPlatform(row.platform)) dataIssue = "invalid_platform"
  const storedConfirmed = row.confirmation_status === "confirmed"
  const evidenceOk = Boolean(row.confirmation_source_id && promoEvidenceSources[row.confirmation_source_id] && httpsUrl(row.confirmation_evidence_ref) && row.confirmed_at)
  if (storedConfirmed && !evidenceOk && !dataIssue) dataIssue = "confirmed_without_evidence"
  const confirmed = storedConfirmed && evidenceOk && !dataIssue
  const entryKind = row.entry_kind === "rule" || row.entry_kind === "manual" ? row.entry_kind : "legacy"
  return {
    id: row.id,
    countryCode: row.country_code,
    platform,
    title: row.title,
    startsAt: row.starts_at,
    endsAt,
    category: row.category,
    ruleId: row.rule_id,
    entryKind,
    windowStatus: row.window_status === "pending" ? "pending" : "determined",
    generationBasis: row.generation_basis,
    basisKind: row.basis_kind,
    basisRef: row.basis_ref,
    confirmationStatus: confirmed ? "confirmed" : "pending",
    confirmation: confirmed ? { sourceId: row.confirmation_source_id!, evidenceRef: row.confirmation_evidence_ref!, note: row.confirmation_note, confirmedAt: row.confirmed_at! } : null,
    previousConfirmation: !storedConfirmed && row.confirmation_source_id && row.confirmation_evidence_ref && row.confirmed_at ? { sourceId: row.confirmation_source_id, evidenceRef: row.confirmation_evidence_ref, note: row.confirmation_note, confirmedAt: row.confirmed_at } : null,
    manualEditedAt: row.manual_edited_at,
    notes: row.notes,
    dataIssue,
  }
}

/** Repository for ops_calendar_event promo rows. Reads are query-only; writes happen only via explicit calls. */
export class PromoCalendarRepository {
  constructor(private readonly db: Database) {}

  async listForYear(year: number): Promise<PromoCalendarEvent[]> {
    const rows = await this.db.prepare(`SELECT * FROM ops_calendar_event WHERE starts_at <= ? AND COALESCE(ends_at, starts_at) >= ? ORDER BY starts_at, country_code, platform, id`).all(`${year}-12-31`, `${year}-01-01`) as Row[]
    return rows.map(toEvent)
  }

  async get(id: string): Promise<PromoCalendarEvent | undefined> {
    const row = await this.db.prepare("SELECT * FROM ops_calendar_event WHERE id = ?").get(id) as Row | undefined
    return row ? toEvent(row) : undefined
  }

  /** Idempotent regeneration. Never touches confirmation fields; rows that are confirmed, manual or manually edited are skipped. */
  async upsertGenerated(candidates: PromoCandidate[], now: string) {
    const result = { created: 0, updated: 0, unchanged: 0, protected: 0, rejected: 0 }
    for (const c of candidates) {
      if (validatePromoFields(c)) {
        result.rejected++
        continue
      }
      const existing = await this.db.prepare("SELECT * FROM ops_calendar_event WHERE id = ?").get(c.id) as Row | undefined
      if (!existing) {
        await this.db.prepare(`INSERT INTO ops_calendar_event (id, country_code, title, starts_at, ends_at, category, basis_kind, basis_ref, confirmation_status, rule_id, notes, created_at, updated_at, platform, entry_kind, window_status, generation_basis, rule_year, occurrence)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, NULL, ?, ?, ?, 'rule', ?, ?, ?, ?)`).run(c.id, c.countryCode, c.title, c.startsAt, c.endsAt, c.category, c.basisKind, c.basisRef, c.ruleId, now, now, c.platform, c.windowStatus, c.generationBasis, c.ruleYear, c.occurrence)
        result.created++
        continue
      }
      if (existing.confirmation_status === "confirmed" || existing.manual_edited_at || existing.entry_kind === "manual") {
        result.protected++
        continue
      }
      const same = existing.title === c.title && existing.starts_at === c.startsAt && existing.ends_at === c.endsAt && existing.generation_basis === c.generationBasis && existing.window_status === c.windowStatus && existing.basis_ref === c.basisRef
      if (same) {
        result.unchanged++
        continue
      }
      await this.db.prepare(`UPDATE ops_calendar_event SET title = ?, starts_at = ?, ends_at = ?, category = ?, basis_kind = ?, basis_ref = ?, window_status = ?, generation_basis = ?, updated_at = ? WHERE id = ? AND confirmation_status != 'confirmed' AND manual_edited_at IS NULL`).run(c.title, c.startsAt, c.endsAt, c.category, c.basisKind, c.basisRef, c.windowStatus, c.generationBasis, now, c.id)
      result.updated++
    }
    return result
  }

  /** Explicit confirmation: matching country/platform and a concrete, applicable HTTPS evidence reference are required. */
  async confirm(input: PromoConfirmInput, now: string): Promise<PromoCalendarEvent> {
    if (typeof input.id !== "string" || !input.id) throw new PromoCalendarError("id_required", 400)
    const row = await this.db.prepare("SELECT * FROM ops_calendar_event WHERE id = ?").get(input.id) as Row | undefined
    if (!row) throw new PromoCalendarError("promo_not_found", 404)
    const current = toEvent(row)
    if (current.dataIssue && current.dataIssue !== "confirmed_without_evidence") throw new PromoCalendarError(`stored_${current.dataIssue}`, 409)
    if (input.countryCode !== row.country_code || input.platform !== current.platform) throw new PromoCalendarError("country_platform_mismatch", 422)
    if (current.windowStatus === "pending") throw new PromoCalendarError("window_pending_not_confirmable", 409)
    const sourceId = typeof input.evidenceSourceId === "string" ? input.evidenceSourceId : ""
    const source = promoEvidenceSources[sourceId]
    if (!source) throw new PromoCalendarError("evidence_source_required", 422)
    const url = httpsUrl(input.evidenceRef)
    if (!url) throw new PromoCalendarError("evidence_ref_required", 422)
    const expectedHost = source.hostsByCountry ? source.hostsByCountry[row.country_code as PromoCountry] : source.host
    if (source.hostsByCountry && !expectedHost) throw new PromoCalendarError("evidence_not_applicable", 422)
    // Exact host, or a subdomain on a full label boundary only.
    if (expectedHost && !(url.hostname === expectedHost || url.hostname.endsWith(`.${expectedHost}`))) throw new PromoCalendarError("evidence_host_mismatch", 422)
    if (source.platforms && !source.platforms.includes(current.platform)) throw new PromoCalendarError("evidence_not_applicable", 422)
    if (source.countries && !source.countries.includes(row.country_code as PromoCountry)) throw new PromoCalendarError("evidence_not_applicable", 422)
    if (source.ruleIds && !source.ruleIds.includes(row.rule_id as never)) throw new PromoCalendarError("evidence_not_applicable", 422)
    const note = typeof input.note === "string" && input.note.trim() ? input.note.trim().slice(0, 500) : null
    await this.db.prepare(`UPDATE ops_calendar_event SET confirmation_status = 'confirmed', confirmation_source_id = ?, confirmation_evidence_ref = ?, confirmation_note = ?, confirmed_at = ?, updated_at = ? WHERE id = ?`).run(sourceId, url.href, note, now, now, row.id)
    return (await this.get(row.id))!
  }

  /** Manual entry (distinguishable entry_kind 'manual', pending until confirmed). */
  async insertManual(input: PromoManualInput, now: string): Promise<PromoCalendarEvent> {
    const issue = validatePromoFields(input)
    if (issue) throw new PromoCalendarError(issue, 422)
    if (!input.title.trim()) throw new PromoCalendarError("title_required", 422)
    const id = `promo:manual:${input.countryCode}:${input.platform}:${input.startsAt}:${createHash("sha256").update(input.title).digest("hex").slice(0, 12)}`
    await this.db.prepare(`INSERT INTO ops_calendar_event (id, country_code, title, starts_at, ends_at, category, basis_kind, basis_ref, confirmation_status, rule_id, notes, created_at, updated_at, platform, entry_kind, window_status)
      VALUES (?, ?, ?, ?, ?, 'promo', 'manual', NULL, 'pending', NULL, ?, ?, ?, ?, 'manual', 'determined')`).run(id, input.countryCode, input.title.trim(), input.startsAt, input.endsAt, input.notes ?? null, now, now, input.platform)
    return (await this.get(id))!
  }

  /** Records a manual edit to a generated row; regeneration will no longer overwrite it. */
  async editManually(id: string, patch: { title?: string, startsAt?: string, endsAt?: string }, now: string): Promise<PromoCalendarEvent> {
    const current = await this.get(id)
    if (!current) throw new PromoCalendarError("promo_not_found", 404)
    const next = { countryCode: current.countryCode, platform: current.platform, startsAt: patch.startsAt ?? current.startsAt, endsAt: patch.endsAt ?? current.endsAt }
    const issue = validatePromoFields(next)
    if (issue) throw new PromoCalendarError(issue, 422)
    const title = patch.title ?? current.title
    const substantive = title !== current.title || next.startsAt !== current.startsAt || next.endsAt !== current.endsAt
    if (!substantive) return current
    // A substantive edit invalidates any confirmation: status reverts to pending; old evidence columns stay as history only.
    await this.db.prepare("UPDATE ops_calendar_event SET title = ?, starts_at = ?, ends_at = ?, manual_edited_at = ?, updated_at = ?, confirmation_status = 'pending' WHERE id = ?").run(title, next.startsAt, next.endsAt, now, now, id)
    return (await this.get(id))!
  }
}
