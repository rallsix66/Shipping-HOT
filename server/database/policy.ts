import { randomUUID } from "node:crypto"
import type { Database } from "db0"
import { type PolicyChangeLogEntry, type PolicyDeclaredStatus, type PolicyDetail, type PolicyFields, type PolicyFilter, type PolicyInput, type PolicyRecordView, type PolicyVersionView, httpsUrl, policyDisplay, policyToday, validatePolicyInput } from "@shared/policy"

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
  relation_kind: string | null
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

/** Policy repository. Reads are query-only; every write is an explicit call that appends a version + change-log entry. */
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

  private async view(row: RecordRow, today: string): Promise<PolicyRecordView> {
    const fields = fieldsOf(row)
    return {
      ...fields,
      id: row.id,
      entryMethod: row.entry_method,
      currentVersionId: row.current_version_id,
      currentVersionNumber: await this.versionNumber(row.current_version_id),
      ...policyDisplay(fields, today),
      supersedesPolicyId: row.supersedes_policy_id,
      supersededByPolicyId: row.superseded_by_policy_id,
      relationKind: row.relation_kind,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }
  }

  private async writeRecord(id: string, f: PolicyFields, versionId: string, now: string, insert: boolean) {
    const values = [f.category, f.countryCode, f.platform, f.title, f.documentNumber, f.publisher, f.publishedAt, f.effectiveAt, f.expiresAt, f.status, f.scopeText, f.sourceUrl, f.enteredBy, versionId, now, f.sourceType, f.bodyExcerpt, f.fullText, f.basisText, f.stage, f.isFixture ? 1 : 0]
    if (insert) {
      await this.db.prepare(`INSERT INTO policy_record (category, country_code, platform, title, document_number, publisher, published_at, effective_at, expires_at, status, scope_text, source_url, entered_by, current_version_id, updated_at, source_type, body_excerpt, full_text, basis_text, stage, is_fixture, id, entry_method, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'manual', ?)`).run(...values, id, now)
    } else {
      await this.db.prepare(`UPDATE policy_record SET category = ?, country_code = ?, platform = ?, title = ?, document_number = ?, publisher = ?, published_at = ?, effective_at = ?, expires_at = ?, status = ?, scope_text = ?, source_url = ?, entered_by = ?, current_version_id = ?, updated_at = ?, source_type = ?, body_excerpt = ?, full_text = ?, basis_text = ?, stage = ?, is_fixture = ? WHERE id = ?`).run(...values, id)
    }
  }

  /** Appends a version (never updates an old version's content; only links superseded_by_version_id). */
  private async appendVersion(policyId: string, previousVersionId: string | null, f: PolicyFields, changeSummary: string, actor: string, now: string, action: string): Promise<string> {
    const number = (await this.versionNumber(previousVersionId)) + 1
    const versionId = `${policyId}:v${number}`
    await this.db.prepare(`INSERT INTO policy_version (id, policy_id, version_number, title, body_excerpt, effective_at, status, change_summary, source_url, created_at, superseded_by_version_id, snapshot_json, entered_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`).run(versionId, policyId, number, f.title, f.bodyExcerpt, f.effectiveAt, f.status, changeSummary, f.sourceUrl, now, JSON.stringify(f), actor)
    if (previousVersionId) await this.db.prepare("UPDATE policy_version SET superseded_by_version_id = ? WHERE id = ? AND superseded_by_version_id IS NULL").run(versionId, previousVersionId)
    await this.db.prepare("INSERT INTO policy_change_log (id, policy_id, version_id, action, actor, summary, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)").run(randomUUID(), policyId, versionId, action, actor, changeSummary, now)
    return versionId
  }

  async create(input: PolicyInput & { supersedesPolicyId?: unknown, relation?: unknown, changeSummary?: unknown }, now: Date): Promise<PolicyRecordView> {
    const today = policyToday(now)
    const result = validatePolicyInput(input, today)
    if (!result.ok) throw new PolicyError(result.error, 422)
    const f = result.fields
    const at = now.toISOString()
    let old: RecordRow | undefined
    if (input.supersedesPolicyId !== undefined && input.supersedesPolicyId !== null && input.supersedesPolicyId !== "") {
      if (typeof input.supersedesPolicyId !== "string") throw new PolicyError("invalid_supersedes", 422)
      if (input.relation !== "revised" && input.relation !== "repealed") throw new PolicyError("relation_required", 422)
      old = await this.row(input.supersedesPolicyId)
      if (!old) throw new PolicyError("superseded_policy_not_found", 404)
      if (TERMINAL.includes(old.status as PolicyDeclaredStatus)) throw new PolicyError("superseded_policy_already_terminal", 409)
      if (old.is_fixture === 1 && !f.isFixture) throw new PolicyError("fixture_cannot_be_superseded_by_real", 422)
    }
    const id = `policy:${randomUUID()}`
    return await this.tx(async () => {
      const summary = typeof input.changeSummary === "string" && input.changeSummary.trim() ? input.changeSummary.trim().slice(0, 1000) : "人工录入新建"
      const versionId = await this.appendVersion(id, null, f, summary, f.enteredBy, at, "create")
      await this.writeRecord(id, f, versionId, at, true)
      if (old) {
        const relation = input.relation as "revised" | "repealed"
        const oldFields: PolicyFields = { ...fieldsOf(old), status: relation }
        const oldVersion = await this.appendVersion(old.id, old.current_version_id, oldFields, `被 ${id} ${relation === "repealed" ? "废止" : "修订"}（原依据保留在旧版本）`, f.enteredBy, at, relation === "repealed" ? "repealed_by" : "revised_by")
        await this.db.prepare("UPDATE policy_record SET status = ?, current_version_id = ?, superseded_by_policy_id = ?, relation_kind = ?, updated_at = ? WHERE id = ?").run(relation, oldVersion, id, relation, at, old.id)
        await this.db.prepare("UPDATE policy_record SET supersedes_policy_id = ?, relation_kind = ? WHERE id = ?").run(old.id, relation, id)
      }
      return (await this.view((await this.row(id))!, today))
    })
  }

  /** New version with the complete new state. Terminal (revised/repealed) records cannot be revised. */
  async revise(id: string, input: PolicyInput & { changeSummary?: unknown }, now: Date): Promise<PolicyRecordView> {
    const today = policyToday(now)
    const row = await this.row(id)
    if (!row) throw new PolicyError("policy_not_found", 404)
    if (TERMINAL.includes(row.status as PolicyDeclaredStatus)) throw new PolicyError("policy_terminal", 409)
    const changeSummary = typeof input.changeSummary === "string" ? input.changeSummary.trim().slice(0, 1000) : ""
    if (!changeSummary) throw new PolicyError("change_summary_required", 422)
    const result = validatePolicyInput(input, today)
    if (!result.ok) throw new PolicyError(result.error, 422)
    const f = result.fields
    if (f.isFixture !== (row.is_fixture === 1)) throw new PolicyError("fixture_flag_immutable", 422)
    const at = now.toISOString()
    return await this.tx(async () => {
      const versionId = await this.appendVersion(id, row.current_version_id, f, changeSummary, f.enteredBy, at, "revise")
      await this.writeRecord(id, f, versionId, at, false)
      return await this.view((await this.row(id))!, today)
    })
  }

  /** Explicit repeal without replacement: requires actor, reason and an HTTPS source. */
  async repeal(id: string, input: { actor?: unknown, changeSummary?: unknown, sourceUrl?: unknown }, now: Date): Promise<PolicyRecordView> {
    const row = await this.row(id)
    if (!row) throw new PolicyError("policy_not_found", 404)
    if (TERMINAL.includes(row.status as PolicyDeclaredStatus)) throw new PolicyError("policy_terminal", 409)
    const actor = typeof input.actor === "string" ? input.actor.trim().slice(0, 100) : ""
    const reason = typeof input.changeSummary === "string" ? input.changeSummary.trim().slice(0, 1000) : ""
    const sourceUrl = httpsUrl(input.sourceUrl)
    if (!actor) throw new PolicyError("entered_by_required", 422)
    if (!reason) throw new PolicyError("change_summary_required", 422)
    if (!sourceUrl) throw new PolicyError("source_url_required", 422)
    const at = now.toISOString()
    return await this.tx(async () => {
      // The repeal source is recorded on the new version only; the record keeps its original source/basis.
      const f: PolicyFields = { ...fieldsOf(row), status: "repealed" }
      const versionId = await this.appendVersion(id, row.current_version_id, { ...f, sourceUrl }, `废止：${reason}`, actor, at, "repeal")
      await this.db.prepare("UPDATE policy_record SET status = 'repealed', current_version_id = ?, relation_kind = COALESCE(relation_kind, 'repealed'), updated_at = ? WHERE id = ?").run(versionId, at, id)
      return await this.view((await this.row(id))!, policyToday(now))
    })
  }

  async list(filter: PolicyFilter, now: Date): Promise<PolicyRecordView[]> {
    const today = policyToday(now)
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
      const view = await this.view(row, today)
      if (filter.status && view.displayStatus !== filter.status) continue
      out.push(view)
    }
    return out
  }

  async detail(id: string, now: Date): Promise<Omit<PolicyDetail, "clock"> | undefined> {
    const row = await this.row(id)
    if (!row) return undefined
    const today = policyToday(now)
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
    const changeLog = (await this.db.prepare("SELECT * FROM policy_change_log WHERE policy_id = ? ORDER BY created_at, id").all(id) as { id: string, version_id: string | null, action: string, actor: string, summary: string, created_at: string }[]).map((c): PolicyChangeLogEntry => ({ id: c.id, versionId: c.version_id, action: c.action, actor: c.actor, summary: c.summary, createdAt: c.created_at }))
    return { record: await this.view(row, today), versions, changeLog, today }
  }
}
