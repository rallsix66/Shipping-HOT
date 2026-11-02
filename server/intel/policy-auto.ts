/**
 * R3-8 policy library auto create/update (offline only, §4.11).
 * Reuses PolicyRepository create/revise + validatePolicyInput.
 * Exact match: country + publisher + documentNumber. No doc# / ambiguity → human pending.
 * Idempotent only when candidate matches *current* version content (not any historical fingerprint).
 * TikTok Shop platform pages may use dated-paragraph fingerprints; Shopee/Lazada out of auto scope.
 * All persist paths (pending/audit/create/revise) sanitize body rights first (platform = excerpt+link only).
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
import { policyCountries, policyDefaultTimezone } from "@shared/policy"
import type { IntelAnalysisRepository } from "#/database/intel-analysis"
import type { IntelContentScope, IntelRepository } from "#/database/intel"
import type { PolicyRepository } from "#/database/policy"
import { PolicyError } from "#/database/policy"
import { selectConsistentAnalysisRun } from "#/intel/label-service"
import { readIntelMaterial } from "#/intel/material-read"
import { type DatedParagraph, pageContentFingerprint } from "#/intel/policy-page-diff"
import { parseExtractOutput } from "#/intel/llm/analyze-pipeline"

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
  /** Current material rights; used to constrain every persist path. */
  contentScope?: IntelContentScope | null
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

export interface PolicyAutoFromIntelInput {
  itemId: string
  versionId: string
  contentHash: string
  /** When omitted, pick one selectable consistent analyze run for the exact version. */
  runId?: string | null
  enteredBy?: string
  isFixture?: boolean
}

type MaterialRepo = Pick<IntelRepository, "getItem" | "getSource" | "getVersion" | "readVersionBlocks" | "getManualVersionAction">
type AnalysisRepo = Pick<IntelAnalysisRepository, "listForVersion">

const EVENT_CATEGORY: Record<PolicyAutoEventType, PolicyCategory> = {
  customs_rule: "customs_tax",
  trade_policy: "trade_export",
  platform_rule: "ecommerce_platform",
}

const POLICY_EVENT_TYPES = new Set<string>(["customs_rule", "trade_policy", "platform_rule"])

/** True only for event types PolicyAutoService will consider for auto入库. */
export function isPolicyAutoEventType(value: string | null | undefined): value is PolicyAutoEventType {
  return typeof value === "string" && POLICY_EVENT_TYPES.has(value)
}

let invokeCount = 0

/** Actual call counter for browse-GET zero-model assertions (not string/import checks). */
export function policyAutoInvokeCount(): number {
  return invokeCount
}

export function resetPolicyAutoInvokeCount(): void {
  invokeCount = 0
}

function trimOrNull(v: string | null | undefined): string | null {
  if (v == null) return null
  const t = String(v).trim()
  return t || null
}

function candidateFingerprintKey(candidate: PolicyAutoCandidate): string {
  return createHash("sha256").update(JSON.stringify(candidate), "utf8").digest("hex")
}

/**
 * Rights-narrow every persist path: platform never stores fullText; excerpt/metadata scopes strip body.
 * Call before pending JSON, audit detail, and create/revise.
 */
function clipExcerpt(text: string | null | undefined, max = 280): string | null {
  const s = trimOrNull(text ?? null)
  if (!s) return null
  return s.length <= max ? s : `${s.slice(0, max - 1).trimEnd()}…`
}

/** Persist only date+hash (+ allowed excerpt text). Never stash forbidden full page text in paragraphs. */
function sanitizePageParagraphsForPersist(
  paragraphs: DatedParagraph[] | undefined,
  scope: string | null,
  sourceType: PolicySourceType,
): DatedParagraph[] | undefined {
  if (!paragraphs?.length) return paragraphs
  const allowFullText = scope === "full_text" && sourceType !== "platform"
  const allowExcerpt = scope === "excerpt" && sourceType !== "platform"
  return paragraphs.map((p) => {
    const date = String(p.date || "").trim()
    const hash = String(p.hash || "").trim()
    let text = ""
    if (allowFullText) {
      text = normalizePersistText(p.text)
    } else if (allowExcerpt) {
      text = clipExcerpt(p.text, 280) ?? ""
    }
    // Platform / metadata_only: identity only (date + hash); text cleared.
    return { date, hash, text }
  })
}

function normalizePersistText(raw: string | null | undefined): string {
  return String(raw ?? "").replace(/\s+/g, " ").trim()
}

export function sanitizeCandidateForPersist(candidate: PolicyAutoCandidate): PolicyAutoCandidate {
  const scope = candidate.contentScope ?? null
  const next: PolicyAutoCandidate = {
    ...candidate,
    publisher: trimOrNull(candidate.publisher),
    documentNumber: trimOrNull(candidate.documentNumber),
    title: candidate.title?.trim() ?? "",
    sourceUrl: candidate.sourceUrl?.trim() ?? "",
    basisText: candidate.basisText?.trim() ?? "",
    bodyExcerpt: trimOrNull(candidate.bodyExcerpt ?? null),
    fullText: trimOrNull(candidate.fullText ?? null),
    pageParagraphs: undefined,
    analysisIds: Array.isArray(candidate.analysisIds) ? [...candidate.analysisIds] : [],
  }

  if (next.sourceType === "platform") {
    const fromFull = next.fullText
    next.fullText = null
    if (!next.bodyExcerpt && fromFull) {
      next.bodyExcerpt = clipExcerpt(fromFull, 280)
    }
  }

  if (scope === "metadata_only") {
    next.fullText = null
    next.bodyExcerpt = null
  } else if (scope === "excerpt") {
    next.fullText = null
    if (next.bodyExcerpt && next.bodyExcerpt.length > 280) {
      next.bodyExcerpt = clipExcerpt(next.bodyExcerpt, 280)
    }
  }

  next.pageParagraphs = sanitizePageParagraphsForPersist(
    candidate.pageParagraphs,
    scope,
    next.sourceType,
  )

  return next
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
  applicableTimezone: string | null
  pageFingerprint?: string | null
}): string {
  const payload = JSON.stringify(input)
  return createHash("sha256").update(payload, "utf8").digest("hex")
}

function civilDate(v: unknown): string | null {
  if (typeof v !== "string") return null
  const t = v.trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t
  // ISO datetime → civil date only when clearly dated
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(t)
  return m ? m[1]! : null
}

function asString(v: unknown): string | null {
  if (typeof v !== "string") return null
  const t = v.trim()
  return t || null
}

function resolveApplicableTimezone(candidate: PolicyAutoCandidate): string | null {
  const explicit = trimOrNull(candidate.applicableTimezone ?? null)
  if (explicit) return explicit
  return policyDefaultTimezone[candidate.countryCode] ?? null
}

function buildProspective(candidate: PolicyAutoCandidate, pageFp: string | null) {
  return {
    category: EVENT_CATEGORY[candidate.eventType],
    countryCode: candidate.countryCode,
    platform: (candidate.platform ?? null) as string | null,
    title: candidate.title.trim(),
    documentNumber: trimOrNull(candidate.documentNumber),
    publisher: trimOrNull(candidate.publisher),
    publishedAt: trimOrNull(candidate.publishedAt ?? null),
    effectiveAt: trimOrNull(candidate.effectiveAt ?? null),
    expiresAt: trimOrNull(candidate.expiresAt ?? null),
    status: String(candidate.status),
    sourceType: candidate.sourceType,
    sourceUrl: candidate.sourceUrl.trim(),
    bodyExcerpt: trimOrNull(candidate.bodyExcerpt ?? null),
    fullText: typeof candidate.fullText === "string" && candidate.fullText.trim() ? candidate.fullText.trim() : null,
    basisText: candidate.basisText.trim(),
    scopeText: trimOrNull(candidate.scopeText ?? null),
    stage: trimOrNull(candidate.stage ?? null),
    // Match stored default so timezone-only omission does not spuriously bump versions.
    applicableTimezone: resolveApplicableTimezone(candidate),
    pageFingerprint: pageFp,
  }
}

function fingerprintFromRecord(existing: PolicyRecordView, pageFp: string | null): string {
  return fingerprintFields({
    category: existing.category,
    countryCode: existing.countryCode,
    platform: (existing.platform ?? null) as string | null,
    title: existing.title,
    documentNumber: existing.documentNumber ?? null,
    publisher: existing.publisher ?? null,
    publishedAt: existing.publishedAt ?? null,
    effectiveAt: existing.effectiveAt ?? null,
    expiresAt: existing.expiresAt ?? null,
    status: existing.status,
    sourceType: existing.sourceType,
    sourceUrl: existing.sourceUrl,
    bodyExcerpt: existing.bodyExcerpt ?? null,
    fullText: existing.fullText ?? null,
    basisText: existing.basisText,
    scopeText: existing.scopeText ?? null,
    stage: existing.stage ?? null,
    applicableTimezone: existing.applicableTimezone ?? null,
    pageFingerprint: pageFp,
  })
}

/** Serialize apply/entry across PolicyAutoService instances that share one db0 connection. */
const policyAutoWriteTails = new WeakMap<object, Promise<unknown>>()

/** Outcomes that mean the source-op completed and may be replayed. Rejected audits stay for forensics but do not block retry. */
const POLICY_AUTO_COMPLETED_OUTCOMES = new Set<PolicyAutoOutcome>([
  "created",
  "updated",
  "unchanged",
  "needs_human_confirm",
])

export class PolicyAutoService {
  constructor(
    private readonly db: Database,
    private readonly policies: PolicyRepository,
  ) {}

  private enqueueWrite<T>(fn: () => Promise<T>): Promise<T> {
    const key = this.db as unknown as object
    const previous = policyAutoWriteTails.get(key) ?? Promise.resolve()
    const run = previous.then(fn, fn)
    policyAutoWriteTails.set(key, run.then(() => undefined, () => undefined))
    return run
  }

  async apply(candidateIn: PolicyAutoCandidate, now: Date): Promise<PolicyAutoResult> {
    return await this.enqueueWrite(() => this.applyUnlocked(candidateIn, now))
  }

  private async applyUnlocked(candidateIn: PolicyAutoCandidate, now: Date): Promise<PolicyAutoResult> {
    invokeCount += 1
    // Sanitize before any branch that may persist (pending / audit / policy).
    const candidate = sanitizeCandidateForPersist(candidateIn)

    // Same source operation (intelVersionId + contentHash) replay returns prior result; does not rewrite current.
    const priorEarly = await this.findPriorSourceOpResult(candidate)
    if (priorEarly) return priorEarly

    const gate = this.precheck(candidate)
    if (gate) {
      if (gate.outcome === "needs_human_confirm") {
        return await this.persistPendingWithAudit(candidate, gate.reason || "needs_human_confirm", now, gate)
      }
      await this.writeAudit({ outcome: gate.outcome, reason: gate.reason, candidate, now })
      return gate
    }

    const publisher = trimOrNull(candidate.publisher)!
    const documentNumber = trimOrNull(candidate.documentNumber)!
    const pageFp = candidate.pageParagraphs?.length
      ? pageContentFingerprint(candidate.pageParagraphs)
      : null
    const input = this.toPolicyInput(candidate)
    const prospective = buildProspective(candidate, pageFp)
    const candidateFp = fingerprintFields(prospective)

    try {
      return await this.policies.runInTransaction(async () => {
        // Re-check source-op inside the write lock (concurrent same-op converges).
        const priorLocked = await this.findPriorSourceOpResult(candidate)
        if (priorLocked) return priorLocked

        const matches = await this.policies.findExactIdentity(candidate.countryCode, publisher, documentNumber)
        if (matches.length > 1) {
          const pendingId = await this.enqueuePending(candidate, "ambiguous_identity", now)
          await this.writeAudit({
            outcome: "needs_human_confirm",
            reason: "ambiguous_identity",
            pendingId,
            candidate,
            now,
            detail: { matchIds: matches.map(m => m.id), candidateFp },
          })
          return { outcome: "needs_human_confirm" as const, reason: "ambiguous_identity", pendingId }
        }

        if (matches.length === 1) {
          const existing = matches[0]!
          const currentPageFp = await this.pageFpForCurrentVersion(existing)
          const currentFp = fingerprintFromRecord(existing, pageFp != null ? currentPageFp : null)
          // Only current-version content match is idempotent (A→B→A must bump a new version).
          if (candidateFp === currentFp) {
            const detail = await this.policies.detail(existing.id, now)
            const versionId = detail?.record.currentVersionId ?? existing.currentVersionId
            await this.writeAudit({
              outcome: "unchanged",
              reason: "idempotent_current_fingerprint_match",
              candidate,
              now,
              policyId: existing.id,
              versionId,
              detail: { pageFingerprint: pageFp, candidateFp, currentFp },
            })
            return {
              outcome: "unchanged" as const,
              reason: "idempotent_current_fingerprint_match",
              policyId: existing.id,
              versionId: versionId ?? undefined,
              record: existing,
            }
          }

          const updated = await this.policies.revise(
            existing.id,
            {
              ...input,
              changeSummary: `auto update from intel (${candidate.eventType}); source=${candidate.sourceType}`,
            },
            now,
          )
          await this.writeAudit({
            outcome: "updated",
            candidate,
            now,
            policyId: updated.id,
            versionId: updated.currentVersionId,
            detail: { pageFingerprint: pageFp, candidateFp },
          })
          return {
            outcome: "updated" as const,
            policyId: updated.id,
            versionId: updated.currentVersionId ?? undefined,
            record: updated,
          }
        }

        const created = await this.policies.create(
          { ...input, entryMethod: "auto", changeSummary: `auto create from intel (${candidate.eventType})` },
          now,
        )
        await this.writeAudit({
          outcome: "created",
          candidate,
          now,
          policyId: created.id,
          versionId: created.currentVersionId,
          detail: { pageFingerprint: pageFp, candidateFp },
        })
        return {
          outcome: "created" as const,
          policyId: created.id,
          versionId: created.currentVersionId ?? undefined,
          record: created,
        }
      })
    } catch (error) {
      const reason = error instanceof PolicyError ? error.code : "apply_failed"
      try {
        await this.writeAudit({
          outcome: "rejected",
          reason,
          candidate,
          now,
        })
      } catch {
        /* audit best-effort after rollback */
      }
      throw error
    }
  }

  /**
   * Authoritative offline entry: exact item/version/contentHash + selectable analysis run + current rights.
   * Missing publisher / document number / status evidence → needs_human_confirm (no invention).
   */
  async applyFromExactIntel(
    deps: { intelRepo: MaterialRepo, analysisRepo: AnalysisRepo },
    input: PolicyAutoFromIntelInput,
    now: Date,
  ): Promise<PolicyAutoResult> {
    return await this.enqueueWrite(() => this.applyFromExactIntelUnlocked(deps, input, now))
  }

  private async applyFromExactIntelUnlocked(
    deps: { intelRepo: MaterialRepo, analysisRepo: AnalysisRepo },
    input: PolicyAutoFromIntelInput,
    now: Date,
  ): Promise<PolicyAutoResult> {
    invokeCount += 1
    const built = await this.buildCandidateFromExactIntel(deps, input)
    if (!built.ok) {
      const rejected: PolicyAutoResult = { outcome: "rejected", reason: built.reason }
      await this.writeAudit({
        outcome: "rejected",
        reason: built.reason,
        candidate: {
          eventType: "customs_rule",
          countryCode: "VN",
          publisher: null,
          documentNumber: null,
          title: "unbuilt",
          sourceUrl: "https://example.org/fixture/unbuilt",
          sourceType: "official",
          status: null,
          basisText: "unbuilt",
          analysisIds: [],
          intelItemId: input.itemId,
          intelVersionId: input.versionId,
          contentHash: input.contentHash,
          isFixture: input.isFixture ?? true,
          enteredBy: input.enteredBy || "policy-auto",
        },
        now,
      })
      return rejected
    }
    // Stay on the unlocked path: apply() would re-enter the write mutex and deadlock.
    invokeCount -= 1
    return await this.applyUnlocked(built.candidate, now)
  }

  async buildCandidateFromExactIntel(
    deps: { intelRepo: MaterialRepo, analysisRepo: AnalysisRepo },
    input: PolicyAutoFromIntelInput,
  ): Promise<{ ok: true, candidate: PolicyAutoCandidate } | { ok: false, reason: string }> {
    if (![input.itemId, input.versionId, input.contentHash].every(v => typeof v === "string" && v.length > 0)) {
      return { ok: false, reason: "invalid_exact_identity" }
    }
    const materialResult = await readIntelMaterial(deps.intelRepo, input.itemId, input.versionId)
    if (!materialResult.ok) return { ok: false, reason: `material_${materialResult.code}` }
    const material = materialResult.material
    if (material.version.contentHash !== input.contentHash) {
      return { ok: false, reason: "content_hash_mismatch" }
    }

    const rows = await deps.analysisRepo.listForVersion(input.itemId, input.versionId)
    // Do NOT pre-filter/trim by hash before selecting the target run — that would turn a
    // mixed-hash run into extract-only, or drop the newest bad run and fall back to an older one.
    // Pick the run from the untrimmed set first, then require *every* member to match identity.
    const mapped = rows.map(r => ({
      id: r.id,
      itemId: r.itemId,
      versionId: r.versionId,
      contentHash: r.contentHash,
      step: r.step,
      status: r.status,
      createdAt: r.createdAt,
      attemptIndex: r.attemptIndex,
      runId: r.runId,
      modelId: r.modelId,
      modelName: r.modelName,
      promptHash: r.promptHash,
      output: r.outputJson ? JSON.parse(r.outputJson) : null,
      outputJson: r.outputJson,
    }))
    let selection = selectConsistentAnalysisRun(mapped)
    if (input.runId) {
      const filtered = mapped.filter(r => r.runId === input.runId)
      selection = selectConsistentAnalysisRun(filtered)
      if (selection.runId !== input.runId) {
        return { ok: false, reason: "run_not_selectable" }
      }
    }
    if (!selection.complete || !selection.runId || !selection.rows.length) {
      return { ok: false, reason: selection.reason || "analysis_run_unselectable" }
    }
    // Any member mismatch → refuse this run; do not try another run.
    if (selection.rows.some(r =>
      r.itemId !== input.itemId
      || r.versionId !== input.versionId
      || r.contentHash !== input.contentHash,
    )) {
      return { ok: false, reason: "analysis_content_hash_mismatch" }
    }

    const extractRow = selection.rows.find(r => r.step === "extract" && (r.status === "completed" || r.status === "reused"))
    if (!extractRow) return { ok: false, reason: "extract_missing" }
    const rawOut = extractRow.output
    if (!rawOut || typeof rawOut !== "object" || Array.isArray(rawOut)) return { ok: false, reason: "extract_invalid" }
    const extractWrap = rawOut as Record<string, unknown>
    const extractRaw = (extractWrap.extract && typeof extractWrap.extract === "object" && !Array.isArray(extractWrap.extract))
      ? extractWrap.extract
      : extractWrap

    // Authority entry must use the same parseExtractOutput contract as the offline pipeline.
    const extract = parseExtractOutput(extractRaw)
    if (!extract) return { ok: false, reason: "extract_parse_failed" }

    const eventTypeRaw = extract.eventType
    if (!eventTypeRaw || !POLICY_EVENT_TYPES.has(eventTypeRaw)) {
      return { ok: false, reason: "event_type_not_policy" }
    }
    const eventType = eventTypeRaw as PolicyAutoEventType

    const countries = Array.isArray(extract.countries) ? extract.countries.filter((c): c is string => typeof c === "string") : []
    const countryCode = countries.find(c => Object.prototype.hasOwnProperty.call(policyCountries, c)) as PolicyCountry | undefined
    if (!countryCode) return { ok: false, reason: "country_evidence_insufficient" }

    // Publisher / document number: only parser-accepted explicit evidence — never invent from title.
    const documentNumber = trimOrNull(extract.documentNumber)
      ?? asString((extract.numbers as Record<string, unknown> | undefined)?.documentNumber)
    const publisher = trimOrNull(extract.publisher)

    const isOfficialStatement = extract.isOfficialStatement === true
    // Platform only from explicit extract.platform — never guess from eventType.
    let platform: PolicyPlatform | null = extract.platform
    let sourceType: PolicySourceType
    if (isOfficialStatement) {
      // Government / regulator formal notice. Platform self-pages are NOT official.
      sourceType = "official"
      platform = null
    } else if (platform != null) {
      // Explicit platform-identity evidence → platform source (not government).
      sourceType = "platform"
    } else {
      // Media / rumor path. isFirstParty alone does NOT upgrade to official.
      sourceType = "media"
    }

    // Status: media → rumor; otherwise only parser-accepted declared status. Never map expired→repealed.
    let status: PolicyDeclaredStatus | null = null
    if (sourceType === "media") {
      status = "rumor"
    } else if (extract.status) {
      status = extract.status
    }

    const effectiveAt = civilDate(extract.effectiveFrom)
    const expiresAt = civilDate(extract.effectiveUntil)
    const publishedAt = civilDate(extract.occurredAt)

    const scope = material.contentScope
    let bodyExcerpt: string | null = null
    let fullText: string | null = null
    if (scope === "full_text") {
      fullText = material.bodyText
      bodyExcerpt = material.bodyText && material.bodyText.length > 280
        ? `${material.bodyText.slice(0, 279).trimEnd()}…`
        : material.bodyText
    } else if (scope === "excerpt") {
      bodyExcerpt = material.bodyText
      fullText = null
    }

    if (sourceType === "platform") {
      fullText = null
      if (!bodyExcerpt && material.bodyText) {
        bodyExcerpt = material.bodyText.length <= 280 ? material.bodyText : `${material.bodyText.slice(0, 279).trimEnd()}…`
      }
    }

    const analysisIds = selection.rows.map(r => r.id)
    const extractMeta = selection.rows.find(r => r.step === "extract")

    const candidate: PolicyAutoCandidate = sanitizeCandidateForPersist({
      eventType,
      countryCode,
      publisher,
      documentNumber,
      title: material.title,
      sourceUrl: material.canonicalUrl.startsWith("http") ? material.canonicalUrl : material.source.url,
      sourceType,
      status,
      publishedAt,
      effectiveAt,
      expiresAt,
      bodyExcerpt,
      fullText,
      platform,
      basisText: `auto from intel extract run=${selection.runId}; item=${input.itemId}; version=${input.versionId}`,
      analysisIds,
      modelId: extractMeta?.modelId ?? null,
      modelName: extractMeta?.modelName ?? null,
      promptHash: extractMeta?.promptHash ?? null,
      intelItemId: input.itemId,
      intelVersionId: input.versionId,
      contentHash: input.contentHash,
      contentScope: scope,
      isFixture: input.isFixture ?? true,
      enteredBy: input.enteredBy || "policy-auto",
    })

    return { ok: true, candidate }
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

  private async pageFpForCurrentVersion(existing: PolicyRecordView): Promise<string | null> {
    const versionId = existing.currentVersionId
    if (!versionId) return null
    const rows = await this.db.prepare(
      `SELECT detail_json FROM policy_auto_audit
       WHERE policy_id = ? AND version_id = ? AND outcome IN ('created','updated')
       ORDER BY created_at DESC, rowid DESC LIMIT 1`,
    ).all(existing.id, versionId) as Array<{ detail_json: string | null }>
    const row = rows[0]
    if (!row?.detail_json) return null
    try {
      const detail = JSON.parse(String(row.detail_json)) as { pageFingerprint?: string | null }
      return detail.pageFingerprint ?? null
    } catch {
      return null
    }
  }

  /**
   * Source-op identity = intelVersionId + contentHash.
   * Replay of an already-handled intel version returns its original outcome/version and does not mutate current.
   * A *new* intel version/hash whose content regresses to historical A may still create a new policy version.
   */
  private async findPriorSourceOpResult(candidate: PolicyAutoCandidate): Promise<PolicyAutoResult | null> {
    const versionId = trimOrNull(candidate.intelVersionId ?? null)
    const contentHash = trimOrNull(candidate.contentHash ?? null)
    if (!versionId || !contentHash) return null

    // Only reuse successfully completed source-ops. A rejected audit is retained for forensics
    // but must not permanently short-circuit retry after a rolled-back apply.
    const row = await this.db.prepare(
      `SELECT outcome, reason, policy_id, version_id, detail_json
       FROM policy_auto_audit
       WHERE intel_version_id = ? AND content_hash = ?
         AND outcome IN ('created', 'updated', 'unchanged', 'needs_human_confirm')
       ORDER BY created_at ASC, id ASC
       LIMIT 1`,
    ).get(versionId, contentHash) as {
      outcome: string
      reason: string | null
      policy_id: string | null
      version_id: string | null
      detail_json: string | null
    } | undefined
    if (!row) return null

    const outcome = row.outcome as PolicyAutoOutcome
    if (!POLICY_AUTO_COMPLETED_OUTCOMES.has(outcome)) return null
    const detail = row.detail_json ? JSON.parse(String(row.detail_json)) as { pendingId?: string | null } : {}
    const result: PolicyAutoResult = {
      outcome,
      reason: row.reason ?? undefined,
      policyId: row.policy_id ?? undefined,
      versionId: row.version_id ?? undefined,
      pendingId: detail.pendingId ?? undefined,
    }

    if (row.policy_id) {
      try {
        const detailView = await this.policies.detail(row.policy_id, new Date(0))
        // Do not attach the *current* record when it has moved past the audited version
        // (would present B's content as if it were the prior A outcome).
        if (
          detailView?.record
          && (!row.version_id || detailView.record.currentVersionId === row.version_id)
        ) {
          result.record = detailView.record
        }
      } catch {
        /* best-effort attach */
      }
    }
    return result
  }

  private precheck(candidate: PolicyAutoCandidate): PolicyAutoResult | null {
    if (!candidate.eventType || !(candidate.eventType in EVENT_CATEGORY)) {
      return { outcome: "rejected", reason: "invalid_event_type" }
    }
    if (candidate.eventType === "platform_rule") {
      if (candidate.platform === "shopee" || candidate.platform === "lazada") {
        return { outcome: "rejected", reason: "platform_out_of_auto_scope" }
      }
      if (candidate.platform !== "tiktok_shop") {
        // Unknown / missing platform evidence → human; never invent TikTok from eventType.
        return { outcome: "needs_human_confirm", reason: "platform_evidence_insufficient" }
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

  private async persistPendingWithAudit(
    candidate: PolicyAutoCandidate,
    reason: string,
    now: Date,
    gate: PolicyAutoResult,
  ): Promise<PolicyAutoResult> {
    return await this.policies.runInTransaction(async () => {
      const pendingId = await this.enqueuePending(candidate, reason, now)
      await this.writeAudit({
        outcome: "needs_human_confirm",
        reason,
        pendingId,
        candidate,
        now,
      })
      return { ...gate, pendingId }
    })
  }

  private async enqueuePending(candidate: PolicyAutoCandidate, reason: string, now: Date): Promise<string> {
    const at = now.toISOString()
    const fp = candidateFingerprintKey(candidate)
    const existing = await this.db.prepare(
      `SELECT id FROM policy_auto_pending
       WHERE status = 'pending' AND country_code = ? AND IFNULL(publisher,'') = ? AND IFNULL(document_number,'') = ?
         AND reason = ? AND IFNULL(candidate_fp,'') = ?
       LIMIT 1`,
    ).get(
      candidate.countryCode,
      trimOrNull(candidate.publisher) ?? "",
      trimOrNull(candidate.documentNumber) ?? "",
      reason,
      fp,
    ) as { id: string } | undefined
    if (existing?.id) return existing.id

    const id = `policy-auto-pending:${randomUUID()}`
    try {
      await this.db.prepare(
        `INSERT INTO policy_auto_pending
          (id, country_code, publisher, document_number, reason, candidate_json, status, created_at, candidate_fp)
         VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
      ).run(
        id,
        candidate.countryCode,
        trimOrNull(candidate.publisher),
        trimOrNull(candidate.documentNumber),
        reason,
        JSON.stringify(candidate),
        at,
        fp,
      )
      return id
    } catch (error) {
      // Concurrent insert of the same pending key → re-select winner.
      const raced = await this.db.prepare(
        `SELECT id FROM policy_auto_pending
         WHERE status = 'pending' AND country_code = ? AND IFNULL(publisher,'') = ? AND IFNULL(document_number,'') = ?
           AND reason = ? AND IFNULL(candidate_fp,'') = ?
         LIMIT 1`,
      ).get(
        candidate.countryCode,
        trimOrNull(candidate.publisher) ?? "",
        trimOrNull(candidate.documentNumber) ?? "",
        reason,
        fp,
      ) as { id: string } | undefined
      if (raced?.id) return raced.id
      throw error
    }
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
    // Defense in depth: never persist unsanitized platform fullText into audit detail/candidate snapshot.
    const candidate = sanitizeCandidateForPersist(args.candidate)
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
      JSON.stringify(candidate.analysisIds ?? []),
      candidate.modelId ?? null,
      candidate.modelName ?? null,
      candidate.promptHash ?? null,
      candidate.intelItemId ?? null,
      candidate.intelVersionId ?? null,
      candidate.contentHash ?? null,
      candidate.sourceUrl ?? null,
      JSON.stringify({
        ...(args.detail ?? {}),
        pendingId: args.pendingId ?? null,
        // Persist sanitized candidate snapshot for rights audit (not raw caller blob).
        candidateSnapshot: {
          sourceType: candidate.sourceType,
          contentScope: candidate.contentScope ?? null,
          bodyExcerpt: candidate.bodyExcerpt ?? null,
          fullText: candidate.fullText ?? null,
          publisher: candidate.publisher,
          documentNumber: candidate.documentNumber,
          status: candidate.status,
        },
      }),
      args.now.toISOString(),
    )
  }
}
