/**
 * R3-8 policy library auto create/update (offline only, §4.11).
 * Reuses PolicyRepository create/revise + validatePolicyInput.
 * Exact match: country + publisher + documentNumber. No doc# / ambiguity → human pending.
 * Idempotent: identical fingerprint → unchanged (no new version).
 * TikTok Shop platform pages may use dated-paragraph fingerprints; Shopee/Lazada out of auto scope.
 */
import { createHash, randomUUID } from "node:crypto"
import type { Database } from "db0"
import type {
  PolicyCategory,
  PolicyCountry,
  PolicyDeclaredStatus,
  PolicyInput,
  PolicyPlatform,
  PolicyRecordView,
  PolicySourceType,
} from "@shared/policy"
import type { PolicyRepository } from "#/database/policy"
import { PolicyError } from "#/database/policy"
import { type DatedParagraph, pageContentFingerprint } from "#/intel/policy-page-diff"

export type PolicyAutoEventType = "customs_rule" | "trade_policy" | "platform_rule"

export interface PolicyAutoCandidate {
  eventType: PolicyAutoEventType
  countryCode: PolicyCountry
  publisher: string | null
  documentNumber: string | null
  title: string
  sourceUrl: string
  sourceType: PolicySourceType
  /** Only when text evidence supports it; never model-guessed. */
  status: PolicyDeclaredStatus | null
  publishedAt?: string | null
  effectiveAt?: string | null
  expiresAt?: string | null
  bodyExcerpt?: string | null
  fullText?: string | null
  platform?: PolicyPlatform | null
  scopeText?: string | null
  stage?: string | null
  basisText: string
  applicableTimezone?: string | null
  /** Optional TikTok whole-page dated-paragraph fingerprint for idempotent platform updates. */
  pageParagraphs?: DatedParagraph[]
  analysisIds: string[]
  modelId?: string | null
  modelName?: string | null
  promptHash?: string | null
  intelItemId?: string | null
  intelVersionId?: string | null
  contentHash?: string | null
  isFixture?: boolean
  enteredBy?: string
}

export type PolicyAutoOutcome =
  | "created"
  | "updated"
  | "unchanged"
  | "needs_human_confirm"
  | "rejected"

export interface PolicyAutoResult {
  outcome: PolicyAutoOutcome
  reason?: string
  policyId?: string
  versionId?: string
  pendingId?: string
  record?: PolicyRecordView
}

const EVENT_CATEGORY: Record<PolicyAutoEventType, PolicyCategory> = {
  customs_rule: "customs_tax",
  trade_policy: "trade_export",
  platform_rule: "ecommerce_platform",
}

function trimOrNull(v: string | null | undefined): string | null {
  if (v == null) return null
  const t = String(v).trim()
  return t || null
}

function fingerprintFields(input: {
  category: string
  countryCode: string
  platform: string | null
  title: string
  documentNumber: string | null
  publisher: string | null
  publishedAt: string | null
  effectiveAt: string | null
  expiresAt: string | null
  status: string
  sourceType: string
  sourceUrl: string
  bodyExcerpt: string | null
  fullText: string | null
  basisText: string
  scopeText: string | null
  stage: string | null
  pageFingerprint?: string | null
}): string {
  const payload = JSON.stringify(input)
  return createHash("sha256").update(payload, "utf8").digest("hex")
}

export class PolicyAutoService {
  constructor(
    private readonly db: Database,
    private readonly policies: PolicyRepository,
  ) {}

  async apply(candidate: PolicyAutoCandidate, now: Date): Promise<PolicyAutoResult> {
    const gate = this.precheck(candidate)
    if (gate) {
      if (gate.outcome === "needs_human_confirm") {
        const pendingId = await this.enqueuePending(candidate, gate.reason || "needs_human_confirm", now)
        await this.writeAudit({
          outcome: gate.outcome,
          reason: gate.reason,
          pendingId,
          candidate,
          now,
        })
        return { ...gate, pendingId }
      }
      await this.writeAudit({ outcome: gate.outcome, reason: gate.reason, candidate, now })
      return gate
    }

    const publisher = trimOrNull(candidate.publisher)!
    const documentNumber = trimOrNull(candidate.documentNumber)!
    const matches = await this.policies.findExactIdentity(candidate.countryCode, publisher, documentNumber)
    if (matches.length > 1) {
      const pendingId = await this.enqueuePending(candidate, "ambiguous_identity", now)
      await this.writeAudit({
        outcome: "needs_human_confirm",
        reason: "ambiguous_identity",
        pendingId,
        candidate,
        now,
        detail: { matchIds: matches.map(m => m.id) },
      })
      return { outcome: "needs_human_confirm", reason: "ambiguous_identity", pendingId }
    }

    const pageFp = candidate.pageParagraphs?.length
      ? pageContentFingerprint(candidate.pageParagraphs)
      : null

    const input = this.toPolicyInput(candidate)
    if (matches.length === 1) {
      const existing = matches[0]!
      const prospective = {
        category: EVENT_CATEGORY[candidate.eventType],
        countryCode: candidate.countryCode,
        platform: (candidate.platform ?? null) as string | null,
        title: candidate.title.trim(),
        documentNumber,
        publisher,
        publishedAt: trimOrNull(candidate.publishedAt ?? null),
        effectiveAt: trimOrNull(candidate.effectiveAt ?? null),
        expiresAt: trimOrNull(candidate.expiresAt ?? null),
        status: candidate.status as string,
        sourceType: candidate.sourceType,
        sourceUrl: candidate.sourceUrl.trim(),
        bodyExcerpt: trimOrNull(candidate.bodyExcerpt ?? null),
        fullText: typeof candidate.fullText === "string" && candidate.fullText.trim() ? candidate.fullText.trim() : null,
        basisText: candidate.basisText.trim(),
        scopeText: trimOrNull(candidate.scopeText ?? null),
        stage: trimOrNull(candidate.stage ?? null),
        pageFingerprint: pageFp,
      }
      const candidateFp = fingerprintFields(prospective)
      const audits = await this.listAudit(existing.id)
      const seenFps = new Set<string>()
      let latestFp: string | null = null
      for (let i = audits.length - 1; i >= 0; i -= 1) {
        const row = audits[i]!
        const outcome = String(row.outcome || "")
        if (outcome !== "created" && outcome !== "updated" && outcome !== "unchanged") continue
        try {
          const detail = row.detail_json ? JSON.parse(String(row.detail_json)) as { candidateFp?: string | null } : {}
          if (detail.candidateFp) {
            const fp = String(detail.candidateFp)
            seenFps.add(fp)
            if (latestFp == null) latestFp = fp
          }
        } catch {
          /* ignore */
        }
      }
      // Any prior created/updated/unchanged audit with the same fingerprint ⇒ idempotent
      // (do not rely on "latest only": same created_at + UUID id order is non-monotonic).
      if (seenFps.has(candidateFp) || (latestFp == null && this.sameMeaningful(existing, prospective) && !pageFp)) {
        const detail = await this.policies.detail(existing.id, now)
        const versionId = detail?.record.currentVersionId ?? existing.currentVersionId
        await this.writeAudit({
          outcome: "unchanged",
          reason: "idempotent_fingerprint_match",
          candidate,
          now,
          policyId: existing.id,
          versionId,
          detail: { pageFingerprint: pageFp, candidateFp },
        })
        return {
          outcome: "unchanged",
          reason: "idempotent_fingerprint_match",
          policyId: existing.id,
          versionId: versionId ?? undefined,
          record: existing,
        }
      }

      try {
        const updated = await this.policies.revise(
          existing.id,
          {
            ...input,
            changeSummary: `auto update from intel (${candidate.eventType}); source=${candidate.sourceType}`,
          },
          now,
        )
        const updatedFp = fingerprintFields({ ...prospective, pageFingerprint: pageFp })
        await this.writeAudit({
          outcome: "updated",
          candidate,
          now,
          policyId: updated.id,
          versionId: updated.currentVersionId,
          detail: { pageFingerprint: pageFp, candidateFp: updatedFp },
        })
        return {
          outcome: "updated",
          policyId: updated.id,
          versionId: updated.currentVersionId ?? undefined,
          record: updated,
        }
      } catch (error) {
        const reason = error instanceof PolicyError ? error.code : "revise_failed"
        await this.writeAudit({ outcome: "rejected", reason, candidate, now, policyId: existing.id })
        throw error
      }
    }

    try {
      const created = await this.policies.create(
        { ...input, entryMethod: "auto", changeSummary: `auto create from intel (${candidate.eventType})` },
        now,
      )
      const createdFp = fingerprintFields({
        category: EVENT_CATEGORY[candidate.eventType],
        countryCode: candidate.countryCode,
        platform: (candidate.platform ?? null) as string | null,
        title: candidate.title.trim(),
        documentNumber,
        publisher,
        publishedAt: trimOrNull(candidate.publishedAt ?? null),
        effectiveAt: trimOrNull(candidate.effectiveAt ?? null),
        expiresAt: trimOrNull(candidate.expiresAt ?? null),
        status: candidate.status as string,
        sourceType: candidate.sourceType,
        sourceUrl: candidate.sourceUrl.trim(),
        bodyExcerpt: trimOrNull(candidate.bodyExcerpt ?? null),
        fullText: typeof candidate.fullText === "string" && candidate.fullText.trim() ? candidate.fullText.trim() : null,
        basisText: candidate.basisText.trim(),
        scopeText: trimOrNull(candidate.scopeText ?? null),
        stage: trimOrNull(candidate.stage ?? null),
        pageFingerprint: pageFp,
      })
      await this.writeAudit({
        outcome: "created",
        candidate,
        now,
        policyId: created.id,
        versionId: created.currentVersionId,
        detail: { pageFingerprint: pageFp, candidateFp: createdFp },
      })
      return {
        outcome: "created",
        policyId: created.id,
        versionId: created.currentVersionId ?? undefined,
        record: created,
      }
    } catch (error) {
      const reason = error instanceof PolicyError ? error.code : "create_failed"
      await this.writeAudit({ outcome: "rejected", reason, candidate, now })
      throw error
    }
  }

  async listPending(status: "pending" | "resolved" | "dismissed" | "all" = "pending"): Promise<Array<{
    id: string
    countryCode: string
    publisher: string | null
    documentNumber: string | null
    reason: string
    status: string
    createdAt: string
    candidate: PolicyAutoCandidate
  }>> {
    const rows = status === "all"
      ? await this.db.prepare("SELECT * FROM policy_auto_pending ORDER BY created_at, id").all() as Array<Record<string, unknown>>
      : await this.db.prepare("SELECT * FROM policy_auto_pending WHERE status = ? ORDER BY created_at, id").all(status) as Array<Record<string, unknown>>
    return rows.map(r => ({
      id: String(r.id),
      countryCode: String(r.country_code),
      publisher: r.publisher == null ? null : String(r.publisher),
      documentNumber: r.document_number == null ? null : String(r.document_number),
      reason: String(r.reason),
      status: String(r.status),
      createdAt: String(r.created_at),
      candidate: JSON.parse(String(r.candidate_json)) as PolicyAutoCandidate,
    }))
  }

  async listAudit(policyId?: string): Promise<Array<Record<string, unknown>>> {
    const rows = policyId
      ? await this.db.prepare("SELECT * FROM policy_auto_audit WHERE policy_id = ? ORDER BY created_at, rowid").all(policyId) as Array<Record<string, unknown>>
      : await this.db.prepare("SELECT * FROM policy_auto_audit ORDER BY created_at, rowid").all() as Array<Record<string, unknown>>
    return rows
  }

  /** Browse/read paths must not call this service or any model — documented for regression tests. */
  static readonly browseGetsMustNotCallApply = true

  private precheck(candidate: PolicyAutoCandidate): PolicyAutoResult | null {
    if (!candidate.eventType || !(candidate.eventType in EVENT_CATEGORY)) {
      return { outcome: "rejected", reason: "invalid_event_type" }
    }
    if (candidate.eventType === "platform_rule") {
      if (candidate.platform === "shopee" || candidate.platform === "lazada") {
        return { outcome: "rejected", reason: "platform_out_of_auto_scope" }
      }
      if (candidate.platform !== "tiktok_shop") {
        return { outcome: "rejected", reason: "platform_required_tiktok_shop" }
      }
    }
    if (candidate.sourceType === "media") {
      if (candidate.status != null && candidate.status !== "rumor") {
        return { outcome: "rejected", reason: "media_source_must_be_rumor" }
      }
    }
    if (candidate.sourceType === "platform" && candidate.status === "rumor") {
      return { outcome: "rejected", reason: "rumor_requires_media_source" }
    }
    if (candidate.status == null) {
      if (candidate.sourceType === "media") {
        candidate.status = "rumor"
      } else {
        return { outcome: "needs_human_confirm", reason: "status_evidence_insufficient" }
      }
    }
    if (candidate.sourceType === "official" && candidate.status === "rumor") {
      return { outcome: "rejected", reason: "rumor_requires_media_source" }
    }
    if (!trimOrNull(candidate.documentNumber)) {
      return { outcome: "needs_human_confirm", reason: "missing_document_number" }
    }
    if (!trimOrNull(candidate.publisher)) {
      return { outcome: "needs_human_confirm", reason: "missing_publisher" }
    }
    if (!candidate.title?.trim() || !candidate.sourceUrl?.trim() || !candidate.basisText?.trim()) {
      return { outcome: "rejected", reason: "required_fields_missing" }
    }
    if (!Array.isArray(candidate.analysisIds)) {
      return { outcome: "rejected", reason: "analysis_ids_required" }
    }
    return null
  }

  private toPolicyInput(candidate: PolicyAutoCandidate): PolicyInput & { entryMethod?: string } {
    return {
      category: EVENT_CATEGORY[candidate.eventType],
      countryCode: candidate.countryCode,
      platform: candidate.platform ?? undefined,
      title: candidate.title,
      documentNumber: trimOrNull(candidate.documentNumber) ?? undefined,
      publisher: trimOrNull(candidate.publisher) ?? undefined,
      publishedAt: candidate.publishedAt ?? undefined,
      effectiveAt: candidate.effectiveAt ?? undefined,
      expiresAt: candidate.expiresAt ?? undefined,
      status: candidate.status!,
      sourceType: candidate.sourceType,
      sourceUrl: candidate.sourceUrl,
      bodyExcerpt: candidate.bodyExcerpt ?? undefined,
      fullText: candidate.fullText ?? undefined,
      basisText: candidate.basisText,
      scopeText: candidate.scopeText ?? undefined,
      stage: candidate.stage ?? undefined,
      applicableTimezone: candidate.applicableTimezone ?? undefined,
      enteredBy: candidate.enteredBy?.trim() || "policy-auto",
      isFixture: candidate.isFixture ?? true,
      entryMethod: "auto",
    }
  }

  private sameMeaningful(
    existing: PolicyRecordView,
    prospective: {
      title: string
      status: string
      sourceUrl: string
      bodyExcerpt: string | null
      fullText: string | null
      basisText: string
      publishedAt: string | null
      effectiveAt: string | null
      expiresAt: string | null
    },
  ): boolean {
    return (
      existing.title === prospective.title
      && existing.status === prospective.status
      && existing.sourceUrl === prospective.sourceUrl
      && (existing.bodyExcerpt ?? null) === prospective.bodyExcerpt
      && (existing.fullText ?? null) === prospective.fullText
      && existing.basisText === prospective.basisText
      && (existing.publishedAt ?? null) === prospective.publishedAt
      && (existing.effectiveAt ?? null) === prospective.effectiveAt
      && (existing.expiresAt ?? null) === prospective.expiresAt
    )
  }

  private async enqueuePending(candidate: PolicyAutoCandidate, reason: string, now: Date): Promise<string> {
    const id = `policy-auto-pending:${randomUUID()}`
    const at = now.toISOString()
    const existing = await this.db.prepare(
      `SELECT id FROM policy_auto_pending
       WHERE status = 'pending' AND country_code = ? AND IFNULL(publisher,'') = ? AND IFNULL(document_number,'') = ?
         AND reason = ? AND candidate_json = ?
       LIMIT 1`,
    ).get(
      candidate.countryCode,
      trimOrNull(candidate.publisher) ?? "",
      trimOrNull(candidate.documentNumber) ?? "",
      reason,
      JSON.stringify(candidate),
    ) as { id: string } | undefined
    if (existing?.id) return existing.id
    await this.db.prepare(
      `INSERT INTO policy_auto_pending
        (id, country_code, publisher, document_number, reason, candidate_json, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)`,
    ).run(
      id,
      candidate.countryCode,
      trimOrNull(candidate.publisher),
      trimOrNull(candidate.documentNumber),
      reason,
      JSON.stringify(candidate),
      at,
    )
    return id
  }

  private async writeAudit(args: {
    outcome: PolicyAutoOutcome
    reason?: string
    candidate: PolicyAutoCandidate
    now: Date
    policyId?: string | null
    versionId?: string | null
    pendingId?: string
    detail?: Record<string, unknown>
  }): Promise<void> {
    const id = `policy-auto-audit:${randomUUID()}`
    await this.db.prepare(
      `INSERT INTO policy_auto_audit
        (id, policy_id, version_id, outcome, reason, analysis_ids_json, model_id, model_name, prompt_hash,
         intel_item_id, intel_version_id, content_hash, source_url, detail_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      args.policyId ?? null,
      args.versionId ?? null,
      args.outcome,
      args.reason ?? null,
      JSON.stringify(args.candidate.analysisIds ?? []),
      args.candidate.modelId ?? null,
      args.candidate.modelName ?? null,
      args.candidate.promptHash ?? null,
      args.candidate.intelItemId ?? null,
      args.candidate.intelVersionId ?? null,
      args.candidate.contentHash ?? null,
      args.candidate.sourceUrl ?? null,
      JSON.stringify({ ...(args.detail ?? {}), pendingId: args.pendingId ?? null }),
      args.now.toISOString(),
    )
  }
}
