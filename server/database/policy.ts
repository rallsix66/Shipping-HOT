import { randomUUID } from "node:crypto"
import type { Database } from "db0"
import { type PolicyChangeLogEntry, type PolicyDeclaredStatus, type PolicyDetail, type PolicyFields, type PolicyFilter, type PolicyInput, type PolicyRecordView, type PolicyTimezone, type PolicyVersionView, httpsUrl, policyDisplay, policyLocalDate, policyTimezones, validatePolicyInput } from "@shared/policy"

interface RecordRow {
  id: string
  category: string
  country_code: string
  platform: string | null
  title: string
  document_number: string | null
  publisher: string | null
  published_at: string | null
  effective_at: string | null
  expires_at: string | null
  status: string
  scope_text: string | null
  source_url: string
  entry_method: string
  entered_by: string
  current_version_id: string | null
  created_at: string
  updated_at: string
  source_type: string
  body_excerpt: string | null
  full_text: string | null
  basis_text: string | null
  stage: string | null
  is_fixture: number
  supersedes_policy_id: string | null
  superseded_by_policy_id: string | null
  supersedes_relation_kind: string | null
  superseded_by_relation_kind: string | null
  supersede_switch_at: string | null
  supersede_switch_tz: string | null
  applicable_timezone: string | null
}

interface VersionRow {
  id: string
  policy_id: string
  version_number: number
  title: string
  effective_at: string | null
  status: string
  change_summary: string | null
  source_url: string
  created_at: string
  superseded_by_version_id: string | null
  snapshot_json: string | null
  entered_by: string | null
}

export class PolicyError extends Error {
  constructor(public readonly code: string, public readonly statusCode: number) {
    super(code)
  }
}

const TERMINAL: PolicyDeclaredStatus[] = ["revised", "repealed"]
const relationKind = (v: string | null): "revised" | "repealed" | null => v === "revised" || v === "repealed" ? v : null
const relationKindOrUnknown = (v: string | null): "revised" | "repealed" | "unknown" | null => v === "unknown" ? "unknown" : relationKind(v)
const tzOf = (v: string | null): PolicyTimezone | null => v && Object.prototype.hasOwnProperty.call(policyTimezones, v) ? v as PolicyTimezone : null

function fieldsOf(row: RecordRow): PolicyFields {
  return {
    category: row.category as PolicyFields["category"],
    countryCode: row.country_code as PolicyFields["countryCode"],
    platform: (row.platform || null) as PolicyFields["platform"],
    title: row.title,
    documentNumber: row.document_number,
    publisher: row.publisher,
    publishedAt: row.published_at,
    effectiveAt: row.effective_at,
    expiresAt: row.expires_at,
    status: row.status as PolicyDeclaredStatus,
    applicableTimezone: tzOf(row.applicable_timezone),
    scopeText: row.scope_text,
    stage: row.stage,
    sourceType: row.source_type as PolicyFields["sourceType"],
    sourceUrl: row.source_url,
    bodyExcerpt: row.body_excerpt,
    fullText: row.full_text,
    basisText: row.basis_text ?? "",
    enteredBy: row.entered_by,
    isFixture: row.is_fixture === 1,
  }
}

/** A record is frozen once terminal or once it carries a (pending or switched) supersession. */
function frozen(row: RecordRow): string | null {
  if (TERMINAL.includes(row.status as PolicyDeclaredStatus)) return "policy_terminal"
  if (row.superseded_by_policy_id) return "policy_has_supersession"
  return null
}

/** Policy repository. Reads are query-only; every write is an explicit call that appends a version and/or change-log entry. */
export class PolicyRepository {
  constructor(private readonly db: Database) {}

  private async tx<T>(fn: () => Promise<T>): Promise<T> {
    await this.db.prepare("BEGIN").run()
    try {
      const result = await fn()
      await this.db.prepare("COMMIT").run()
      return result
    } catch (error) {
      await this.db.prepare("ROLLBACK").run()
      throw error
    }
  }

  private async row(id: string): Promise<RecordRow | undefined> {
    return await this.db.prepare("SELECT * FROM policy_record WHERE id = ?").get(id) as RecordRow | undefined
  }

  private async versionNumber(id: string | null): Promise<number> {
    if (!id) return 0
    const v = await this.db.prepare("SELECT version_number FROM policy_version WHERE id = ?").get(id) as { version_number: number } | undefined
    return v?.version_number ?? 0
  }

  private async view(row: RecordRow, now: Date): Promise<PolicyRecordView> {
    const fields = fieldsOf(row)
    const byKind = relationKind(row.superseded_by_relation_kind)
    const supersession = row.superseded_by_policy_id && byKind ? { kind: byKind, switchAt: row.supersede_switch_at, switchTimezone: tzOf(row.supersede_switch_tz) } : null
    return {
      ...fields,
      id: row.id,
      entryMethod: row.entry_method,
      currentVersionId: row.current_version_id,
      currentVersionNumber: await this.versionNumber(row.current_version_id),
      ...policyDisplay(fields, now, supersession),
      supersedesPolicyId: row.supersedes_policy_id,
      supersedesRelationKind: relationKindOrUnknown(row.supersedes_relation_kind),
      supersededByPolicyId: row.superseded_by_policy_id,
      supersededByRelationKind: byKind ?? relationKindOrUnknown(row.superseded_by_relation_kind),
      supersedeSwitchAt: row.supersede_switch_at,
      supersedeSwitchTimezone: tzOf(row.supersede_switch_tz),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }
  }

  private async writeRecord(id: string, f: PolicyFields, versionId: string, now: string, insert: boolean) {
    const values = [f.category, f.countryCode, f.platform, f.title, f.documentNumber, f.publisher, f.publishedAt, f.effectiveAt, f.expiresAt, f.status, f.scopeText, f.sourceUrl, f.enteredBy, versionId, now, f.sourceType, f.bodyExcerpt, f.fullText, f.basisText, f.stage, f.isFixture ? 1 : 0, f.applicableTimezone]
    if (insert) {
      await this.db.prepare(`INSERT INTO policy_record (category, country_code, platform, title, document_number, publisher, published_at, effective_at, expires_at, status, scope_text, source_url, entered_by, current_version_id, updated_at, source_type, body_excerpt, full_text, basis_text, stage, is_fixture, applicable_timezone, id, entry_method, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'manual', ?)`).run(...values, id, now)
    } else {
      await this.db.prepare(`UPDATE policy_record SET category = ?, country_code = ?, platform = ?, title = ?, document_number = ?, publisher = ?, published_at = ?, effective_at = ?, expires_at = ?, status = ?, scope_text = ?, source_url = ?, entered_by = ?, current_version_id = ?, updated_at = ?, source_type = ?, body_excerpt = ?, full_text = ?, basis_text = ?, stage = ?, is_fixture = ?, applicable_timezone = ? WHERE id = ?`).run(...values, id)
    }
  }

  private async log(policyId: string, versionId: string | null, action: string, actor: string, summary: string, at: string) {
    await this.db.prepare("INSERT INTO policy_change_log (id, policy_id, version_id, action, actor, summary, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)").run(randomUUID(), policyId, versionId, action, actor, summary, at)
  }

  /** Appends a version (never updates an old version's content; only links superseded_by_version_id). */
  private async appendVersion(policyId: string, previousVersionId: string | null, f: PolicyFields, changeSummary: string, actor: string, now: string, action: string): Promise<string> {
    const number = (await this.versionNumber(previousVersionId)) + 1
    const versionId = `${policyId}:v${number}`
    await this.db.prepare(`INSERT INTO policy_version (id, policy_id, version_number, title, body_excerpt, effective_at, status, change_summary, source_url, created_at, superseded_by_version_id, snapshot_json, entered_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`).run(versionId, policyId, number, f.title, f.bodyExcerpt, f.effectiveAt, f.status, changeSummary, f.sourceUrl, now, JSON.stringify(f), actor)
    if (previousVersionId) await this.db.prepare("UPDATE policy_version SET superseded_by_version_id = ? WHERE id = ? AND superseded_by_version_id IS NULL").run(versionId, previousVersionId)
    await this.log(policyId, versionId, action, actor, changeSummary, now)
    return versionId
  }

  /**
   * Manual entry; optionally supersedes an existing record. Supersession rules (dots 2026-10-12):
   * - only a published/effective new record can supersede (rumor/draft rejected);
   * - both sides must share the fixture flag;
   * - the old record is NOT terminated early: the relation is recorded with a switch date = the new record's effective
   *   date (in the new record's zone) and takes effect only from then (immediately if already reached).
   * All checks run before any write; on failure nothing changes.
   */
  async create(input: PolicyInput & { supersedesPolicyId?: unknown, relation?: unknown, changeSummary?: unknown }, now: Date): Promise<PolicyRecordView> {
    const result = validatePolicyInput(input, now)
    if (!result.ok) throw new PolicyError(result.error, 422)
    const f = result.fields
    const at = now.toISOString()
    let old: RecordRow | undefined
    let relation: "revised" | "repealed" | undefined
    if (input.supersedesPolicyId !== undefined && input.supersedesPolicyId !== null && input.supersedesPolicyId !== "") {
      if (typeof input.supersedesPolicyId !== "string") throw new PolicyError("invalid_supersedes", 422)
      if (input.relation !== "revised" && input.relation !== "repealed") throw new PolicyError("relation_required", 422)
      relation = input.relation
      if (f.status !== "published" && f.status !== "effective") throw new PolicyError("supersession_requires_published_or_effective", 422)
      old = await this.row(input.supersedesPolicyId)
      if (!old) throw new PolicyError("superseded_policy_not_found", 404)
      const blocked = frozen(old)
      if (blocked) throw new PolicyError(blocked === "policy_terminal" ? "superseded_policy_already_terminal" : "superseded_policy_has_supersession", 409)
      if ((old.is_fixture === 1) !== f.isFixture) throw new PolicyError("fixture_flag_mismatch", 422)
      // The target's own supersession of its predecessor must have switched first; otherwise the predecessor would
      // still switch later to a successor that has since been replaced (dots 2026-10-12 P2).
      if (old.supersedes_policy_id) {
        const predecessor = await this.row(old.supersedes_policy_id)
        if (predecessor && predecessor.superseded_by_policy_id === old.id && predecessor.supersede_switch_at) {
          const switched = predecessor.supersede_switch_tz && policyLocalDate(now, predecessor.supersede_switch_tz as PolicyTimezone) >= predecessor.supersede_switch_at
          if (!switched) throw new PolicyError("superseded_policy_supersession_pending", 409)
        }
      }
    }
    const id = `policy:${randomUUID()}`
    return await this.tx(async () => {
      const summary = typeof input.changeSummary === "string" && input.changeSummary.trim() ? input.changeSummary.trim().slice(0, 1000) : "人工录入新建"
      const versionId = await this.appendVersion(id, null, f, summary, f.enteredBy, at, "create")
      await this.writeRecord(id, f, versionId, at, true)
      if (old && relation) {
        const switchAt = f.effectiveAt ?? policyLocalDate(now, f.applicableTimezone!)
        const word = relation === "repealed" ? "废止" : "修订"
        await this.db.prepare("UPDATE policy_record SET superseded_by_policy_id = ?, superseded_by_relation_kind = ?, supersede_switch_at = ?, supersede_switch_tz = ?, updated_at = ? WHERE id = ?").run(id, relation, switchAt, f.applicableTimezone, at, old.id)
        await this.db.prepare("UPDATE policy_record SET supersedes_policy_id = ?, supersedes_relation_kind = ? WHERE id = ?").run(old.id, relation, id)
        await this.log(old.id, null, relation === "repealed" ? "repeal_scheduled" : "revise_scheduled", f.enteredBy, `将于 ${switchAt}（${f.applicableTimezone}）起被 ${id} ${word}；在此之前状态不变，原依据与版本保留`, at)
        await this.log(id, versionId, relation === "repealed" ? "repeals" : "revises", f.enteredBy, `自 ${switchAt} 起${word} ${old.id}`, at)
      }
      return await this.view((await this.row(id))!, now)
    })
  }

  /** New version with the complete new state. Frozen records cannot be revised. */
  async revise(id: string, input: PolicyInput & { changeSummary?: unknown }, now: Date): Promise<PolicyRecordView> {
    const row = await this.row(id)
    if (!row) throw new PolicyError("policy_not_found", 404)
    const blocked = frozen(row)
    if (blocked) throw new PolicyError(blocked, 409)
    const changeSummary = typeof input.changeSummary === "string" ? input.changeSummary.trim().slice(0, 1000) : ""
    if (!changeSummary) throw new PolicyError("change_summary_required", 422)
    const result = validatePolicyInput(input, now)
    if (!result.ok) throw new PolicyError(result.error, 422)
    const f = result.fields
    if (f.isFixture !== (row.is_fixture === 1)) throw new PolicyError("fixture_flag_immutable", 422)
    // A record that supersedes another must stay published/effective; a pending switch follows its new effective date.
    let target: RecordRow | undefined
    if (row.supersedes_policy_id) {
      if (f.status !== "published" && f.status !== "effective") throw new PolicyError("supersession_requires_published_or_effective", 422)
      target = await this.row(row.supersedes_policy_id)
      if (target?.supersede_switch_at && target.superseded_by_policy_id === id) {
        const switched = target.supersede_switch_tz && policyLocalDate(now, target.supersede_switch_tz as PolicyTimezone) >= target.supersede_switch_at
        const nextSwitch = f.effectiveAt ?? policyLocalDate(now, f.applicableTimezone!)
        if (switched && (nextSwitch !== target.supersede_switch_at || f.applicableTimezone !== target.supersede_switch_tz)) throw new PolicyError("supersession_already_switched", 409)
      }
    }
    const at = now.toISOString()
    return await this.tx(async () => {
      const versionId = await this.appendVersion(id, row.current_version_id, f, changeSummary, f.enteredBy, at, "revise")
      await this.writeRecord(id, f, versionId, at, false)
      if (target && target.superseded_by_policy_id === id) {
        const nextSwitch = f.effectiveAt ?? policyLocalDate(now, f.applicableTimezone!)
        if (nextSwitch !== target.supersede_switch_at || f.applicableTimezone !== target.supersede_switch_tz) {
          await this.db.prepare("UPDATE policy_record SET supersede_switch_at = ?, supersede_switch_tz = ?, updated_at = ? WHERE id = ?").run(nextSwitch, f.applicableTimezone, at, target.id)
          await this.log(target.id, null, "supersession_rescheduled", f.enteredBy, `替代生效日随 ${id} 调整为 ${nextSwitch}（${f.applicableTimezone}）`, at)
        }
      }
      return await this.view((await this.row(id))!, now)
    })
  }

  /** Explicit repeal without replacement. If this record has a not-yet-switched supersession of another, that is cancelled. */
  async repeal(id: string, input: { actor?: unknown, changeSummary?: unknown, sourceUrl?: unknown }, now: Date): Promise<PolicyRecordView> {
    const row = await this.row(id)
    if (!row) throw new PolicyError("policy_not_found", 404)
    const blocked = frozen(row)
    if (blocked) throw new PolicyError(blocked, 409)
    const actor = typeof input.actor === "string" ? input.actor.trim().slice(0, 100) : ""
    const reason = typeof input.changeSummary === "string" ? input.changeSummary.trim().slice(0, 1000) : ""
    const sourceUrl = httpsUrl(input.sourceUrl)
    if (!actor) throw new PolicyError("entered_by_required", 422)
    if (!reason) throw new PolicyError("change_summary_required", 422)
    if (!sourceUrl) throw new PolicyError("source_url_required", 422)
    const at = now.toISOString()
    return await this.tx(async () => {
      const f: PolicyFields = { ...fieldsOf(row), status: "repealed" }
      const versionId = await this.appendVersion(id, row.current_version_id, { ...f, sourceUrl }, `废止：${reason}`, actor, at, "repeal")
      await this.db.prepare("UPDATE policy_record SET status = 'repealed', current_version_id = ?, updated_at = ? WHERE id = ?").run(versionId, at, id)
      if (row.supersedes_policy_id) {
        const target = await this.row(row.supersedes_policy_id)
        const switched = !target?.supersede_switch_at || (target.supersede_switch_tz && policyLocalDate(now, target.supersede_switch_tz as PolicyTimezone) >= target.supersede_switch_at)
        if (target && target.superseded_by_policy_id === id && !switched) {
          await this.db.prepare("UPDATE policy_record SET superseded_by_policy_id = NULL, superseded_by_relation_kind = NULL, supersede_switch_at = NULL, supersede_switch_tz = NULL, updated_at = ? WHERE id = ?").run(at, target.id)
          await this.log(target.id, null, "supersession_cancelled", actor, `${id} 在替代生效前被废止，原定替代取消`, at)
        }
      }
      return await this.view((await this.row(id))!, now)
    })
  }

  async list(filter: PolicyFilter, now: Date): Promise<PolicyRecordView[]> {
    const rows = await this.db.prepare("SELECT * FROM policy_record ORDER BY COALESCE(effective_at, '9999-12-31'), created_at, id").all() as RecordRow[]
    const q = filter.q?.trim().toLowerCase()
    const out: PolicyRecordView[] = []
    for (const row of rows) {
      if (filter.countryCode && row.country_code !== filter.countryCode) continue
      if (filter.platform && (row.platform ?? "") !== filter.platform) continue
      if (filter.category && row.category !== filter.category) continue
      if (filter.effectiveFrom && (!row.effective_at || row.effective_at < filter.effectiveFrom)) continue
      if (filter.effectiveTo && (!row.effective_at || row.effective_at > filter.effectiveTo)) continue
      if (q && ![row.title, row.document_number, row.publisher, row.scope_text, row.basis_text].some(v => v?.toLowerCase().includes(q))) continue
      const view = await this.view(row, now)
      if (filter.status && view.displayStatus !== filter.status) continue
      out.push(view)
    }
    return out
  }

  async detail(id: string, now: Date): Promise<Omit<PolicyDetail, "clock" | "today"> | undefined> {
    const row = await this.row(id)
    if (!row) return undefined
    const versions = (await this.db.prepare("SELECT * FROM policy_version WHERE policy_id = ? ORDER BY version_number").all(id) as VersionRow[]).map((v): PolicyVersionView => ({
      id: v.id,
      versionNumber: v.version_number,
      status: v.status as PolicyDeclaredStatus,
      title: v.title,
      effectiveAt: v.effective_at,
      changeSummary: v.change_summary,
      sourceUrl: v.source_url,
      createdAt: v.created_at,
      supersededByVersionId: v.superseded_by_version_id,
      enteredBy: v.entered_by,
      snapshot: v.snapshot_json ? JSON.parse(v.snapshot_json) as PolicyFields : null,
    }))
    const changeLog = (await this.db.prepare("SELECT * FROM policy_change_log WHERE policy_id = ? ORDER BY created_at, rowid").all(id) as { id: string, version_id: string | null, action: string, actor: string, summary: string, created_at: string }[]).map((c): PolicyChangeLogEntry => ({ id: c.id, versionId: c.version_id, action: c.action, actor: c.actor, summary: c.summary, createdAt: c.created_at }))
    return { record: await this.view(row, now), versions, changeLog }
  }
}
