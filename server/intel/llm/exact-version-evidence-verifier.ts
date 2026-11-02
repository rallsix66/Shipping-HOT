/**
 * Fail-closed ExactVersion evidence verifier (R3-A2 / ADR-007).
 *
 * Read-only verification boundary: validates caller-provided trusted evidence
 * against the ExactVersion / admitModelPayload contracts. Does NOT write auth
 * records, open HTTP, call Providers, auto-grant, or claim a production issuer.
 *
 * A successful verify result is a contract match for this call only — it is NOT
 * a newly created authorization and MUST NOT be cached across revoke/version changes.
 * Fixture-trusted evidence ≠ production permit.
 *
 * PRODUCTION BOUNDARY (honest): trusted production evidence ingress / issuer
 * wiring remains unfinished. Only an isolated TrustedEvidenceSource (e.g. test
 * fixtures) can supply records today.
 */
import type { ClipAudit } from "@shared/manual-clip"
import type { IntelAnalysisStep } from "#/database/intel-analysis"
import type { IntelContentScope } from "#/database/intel"
import {
  type ExactVersionModelLicense,
  type ModelPayloadDenyCode,
  admitModelPayload,
} from "#/intel/llm/model-payload-gate"

/** Real analyze-chain steps that purpose evidence must cover explicitly. */
export const MODEL_USE_VERIFY_STEPS = [
  "prefilter",
  "extract",
  "severity",
  "severity_tiebreak",
] as const satisfies readonly IntelAnalysisStep[]

export type ModelUseVerifyStep = (typeof MODEL_USE_VERIFY_STEPS)[number]

export type EvidenceVerifyDenyCode =
  | ModelPayloadDenyCode
  | "purpose_out_of_scope"
  | "license_revoked"
  | "evidence_read_failed"
  | "evidence_malformed"
  | "time_unknown"
  | "service_mismatch"
  | "content_scope_exceeded"

/**
 * Trusted evidence record shape. Callers MUST obtain this from a TrustedEvidenceSource;
 * inventing fields from clip audit, persistence, public URL, or boolean flags is forbidden.
 */
export interface TrustedModelUseEvidence {
  evidenceId: string
  itemId: string
  versionId: string
  contentHash: string
  /** Named model service this evidence authorizes (not "any provider"). */
  modelServiceId: string
  /** Explicit step allow-list. Embeddings / training / secondary share are never implied. */
  allowedSteps: readonly ModelUseVerifyStep[]
  /** Max body scope that may be sent; requested scope must not exceed this. */
  allowedContentScope: IntelContentScope
  /**
   * Inclusive validity start (ISO-8601). Missing / unparsable → time_unknown deny.
   * Unknown time must never allow.
   */
  validFrom: string
  /**
   * Exclusive validity end (ISO-8601), or null only when explicitly open-ended
   * after a known validFrom. Undefined / "" / unparsable non-null → time_unknown.
   */
  validUntil: string | null
  /** When set and parseable, evidence is revoked at/after this instant. */
  revokedAt: string | null
}

export interface TrustedEvidenceSource {
  /**
   * Look up one evidence record by id. Return null when missing.
   * Throwing or rejecting → evidence_read_failed (fail-closed).
   * Implementations MUST NOT invent grants from persistence / clip / URLs.
   */
  getById: (evidenceId: string) => TrustedModelUseEvidence | null | Promise<TrustedModelUseEvidence | null>
}

export interface EvidenceVerifyInput {
  itemId: string
  versionId: string
  contentHash: string
  modelServiceId: string
  step: ModelUseVerifyStep
  requestedContentScope: IntelContentScope
  /** Required. Empty / missing → BLOCKED (rights_missing). */
  evidenceId?: string | null
  clipAudit?: ClipAudit | null
  /**
   * Isolated trusted source. Absence → BLOCKED. Production ingress is not wired;
   * tests supply an in-memory fixture source only.
   */
  evidenceSource?: TrustedEvidenceSource | null
  /**
   * @deprecated Ignored for permission. Documented so callers that still pass it
   * cannot escalate; verify never treats bare true as evidence.
   */
  modelUsePermitted?: boolean
  /** Public URL / catalog flags are ignored and never grant. */
  publicReadable?: boolean
  catalogIncluded?: boolean
  /** Persistence / storage-only signals never grant model-send permission. */
  persistence?: "full" | "excerpt_only" | "disallowed" | null
  now?: () => Date
}

export type EvidenceVerifyResult =
  | {
    ok: true
    /** Contract match for this call only — not a newly issued grant. */
    evidenceRef: {
      evidenceId: string
      itemId: string
      versionId: string
      contentHash: string
      modelServiceId: string
      step: ModelUseVerifyStep
    }
    license: ExactVersionModelLicense
    /** Explicit reminder: fixture / verify success ≠ production authorization. */
    productionAuthorized: false
  }
  | {
    ok: false
    blocked: true
    code: EvidenceVerifyDenyCode
    reason: string
  }

const SCOPE_RANK: Record<IntelContentScope, number> = {
  metadata_only: 0,
  excerpt: 1,
  full_text: 2,
}

const STEP_SET = new Set<string>(MODEL_USE_VERIFY_STEPS)

function deny(code: EvidenceVerifyDenyCode, reason: string): EvidenceVerifyResult {
  return { ok: false, blocked: true, code, reason }
}

function parseInstant(value: string | null | undefined, field: string):
  | { ok: true, ms: number | null }
  | { ok: false, reason: string } {
  if (value === null) return { ok: true, ms: null }
  if (typeof value !== "string" || !value.trim()) {
    return { ok: false, reason: `${field} missing or empty; unknown time must not allow` }
  }
  const ms = Date.parse(value)
  if (!Number.isFinite(ms)) {
    return { ok: false, reason: `${field} is not a parseable instant; unknown time must not allow` }
  }
  return { ok: true, ms }
}

function isIntelContentScope(value: unknown): value is IntelContentScope {
  return value === "metadata_only" || value === "excerpt" || value === "full_text"
}

function isModelUseVerifyStep(value: unknown): value is ModelUseVerifyStep {
  return typeof value === "string" && STEP_SET.has(value)
}

/**
 * Structural validation for a trusted evidence record.
 * Malformed → deny (never allow).
 */
export function validateTrustedEvidenceShape(record: unknown):
  | { ok: true, evidence: TrustedModelUseEvidence }
  | { ok: false, reason: string } {
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    return { ok: false, reason: "evidence record is not an object" }
  }
  const row = record as Record<string, unknown>
  const evidenceId = row.evidenceId
  const itemId = row.itemId
  const versionId = row.versionId
  const contentHash = row.contentHash
  const modelServiceId = row.modelServiceId
  if (typeof evidenceId !== "string" || !evidenceId.trim()) {
    return { ok: false, reason: "evidenceId missing or empty" }
  }
  if (typeof itemId !== "string" || !itemId.trim()) {
    return { ok: false, reason: "itemId missing or empty" }
  }
  if (typeof versionId !== "string" || !versionId.trim()) {
    return { ok: false, reason: "versionId missing or empty" }
  }
  if (typeof contentHash !== "string" || !contentHash.trim()) {
    return { ok: false, reason: "contentHash missing or empty" }
  }
  if (typeof modelServiceId !== "string" || !modelServiceId.trim()) {
    return { ok: false, reason: "modelServiceId missing or empty" }
  }
  if (!isIntelContentScope(row.allowedContentScope)) {
    return { ok: false, reason: "allowedContentScope malformed" }
  }
  if (!Array.isArray(row.allowedSteps) || row.allowedSteps.length === 0) {
    return { ok: false, reason: "allowedSteps missing or empty" }
  }
  const steps: ModelUseVerifyStep[] = []
  for (const step of row.allowedSteps) {
    if (!isModelUseVerifyStep(step)) {
      return { ok: false, reason: `allowedSteps contains non-chain step or unknown value: ${String(step)}` }
    }
    steps.push(step)
  }
  if (typeof row.validFrom !== "string") {
    return { ok: false, reason: "validFrom must be an ISO string; unknown time must not allow" }
  }
  if (!(row.validUntil === null || typeof row.validUntil === "string")) {
    return { ok: false, reason: "validUntil must be ISO string or null" }
  }
  if (!(row.revokedAt === null || typeof row.revokedAt === "string")) {
    return { ok: false, reason: "revokedAt must be ISO string or null" }
  }
  return {
    ok: true,
    evidence: {
      evidenceId,
      itemId,
      versionId,
      contentHash,
      modelServiceId,
      allowedSteps: steps,
      allowedContentScope: row.allowedContentScope,
      validFrom: row.validFrom,
      validUntil: row.validUntil,
      revokedAt: row.revokedAt,
    },
  }
}

/**
 * In-memory fixture source for isolated tests. Not a production issuer.
 * No caching layer — each getById re-reads the map so later revoke/version edits apply.
 */
export function createFixtureTrustedEvidenceSource(
  records: Iterable<TrustedModelUseEvidence>,
): TrustedEvidenceSource & { upsert: (record: TrustedModelUseEvidence) => void, revoke: (evidenceId: string, revokedAt: string) => void } {
  const map = new Map<string, TrustedModelUseEvidence>()
  for (const record of records) {
    const shaped = validateTrustedEvidenceShape(record)
    if (!shaped.ok) throw new Error(`fixture_invalid:${shaped.reason}`)
    map.set(shaped.evidence.evidenceId, { ...shaped.evidence, allowedSteps: [...shaped.evidence.allowedSteps] })
  }
  return {
    getById(evidenceId: string) {
      const hit = map.get(evidenceId)
      return hit ? { ...hit, allowedSteps: [...hit.allowedSteps] } : null
    },
    upsert(record: TrustedModelUseEvidence) {
      const shaped = validateTrustedEvidenceShape(record)
      if (!shaped.ok) throw new Error(`fixture_invalid:${shaped.reason}`)
      map.set(shaped.evidence.evidenceId, { ...shaped.evidence, allowedSteps: [...shaped.evidence.allowedSteps] })
    },
    revoke(evidenceId: string, revokedAt: string) {
      const hit = map.get(evidenceId)
      if (!hit) return
      map.set(evidenceId, { ...hit, allowedSteps: [...hit.allowedSteps], revokedAt })
    },
  }
}

/**
 * Fail-closed verify. Order: clip hard-deny → evidence presence → source read →
 * shape → binding → service → step → content scope → validity/revoke →
 * ExactVersion + admitModelPayload. Never grants from boolean/URL/persistence.
 */
export async function tryVerifyExactVersionEvidence(
  input: EvidenceVerifyInput,
): Promise<EvidenceVerifyResult> {
  // Clip hard-deny first — same private/unknown/unverified posture as admitModelPayload.
  // No higher-evidence bypass is designed here.
  // Probe without a license so only clip codes surface; ignore no_model_permission
  // (that is expected until evidence yields an ExactVersionModelLicense).
  const clipGate = admitModelPayload({
    clipAudit: input.clipAudit,
  })
  if (!clipGate.allow && (clipGate.code === "private_material" || clipGate.code === "rights_unknown")) {
    return deny(clipGate.code, clipGate.reason)
  }

  // Caller boolean / public URL / catalog / persistence MUST NOT grant.
  // (We deliberately ignore modelUsePermitted, publicReadable, catalogIncluded, persistence.)

  const evidenceId = typeof input.evidenceId === "string" ? input.evidenceId.trim() : ""
  if (!evidenceId) {
    return deny(
      "rights_missing",
      "no trusted evidenceId; BLOCKED until a trusted evidence record is provided",
    )
  }

  if (!input.evidenceSource) {
    return deny(
      "rights_missing",
      "no TrustedEvidenceSource wired; production evidence ingress unfinished; BLOCKED",
    )
  }

  if (!isModelUseVerifyStep(input.step)) {
    return deny(
      "purpose_out_of_scope",
      `step ${String(input.step)} is outside prefilter/extract/severity/severity_tiebreak`,
    )
  }

  if (!isIntelContentScope(input.requestedContentScope)) {
    return deny("evidence_malformed", "requestedContentScope malformed")
  }

  if (
    typeof input.itemId !== "string" || !input.itemId.trim()
    || typeof input.versionId !== "string" || !input.versionId.trim()
    || typeof input.contentHash !== "string" || !input.contentHash.trim()
    || typeof input.modelServiceId !== "string" || !input.modelServiceId.trim()
  ) {
    return deny("evidence_malformed", "request identity fields missing or empty")
  }

  let raw: TrustedModelUseEvidence | null
  try {
    raw = await input.evidenceSource.getById(evidenceId)
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown read failure"
    return deny("evidence_read_failed", `trusted evidence source read failed: ${message}`)
  }

  if (!raw) {
    return deny("rights_missing", `evidenceId ${evidenceId} not found in trusted evidence source`)
  }

  const shaped = validateTrustedEvidenceShape(raw)
  if (!shaped.ok) {
    return deny("evidence_malformed", shaped.reason)
  }
  const evidence = shaped.evidence

  if (evidence.evidenceId !== evidenceId) {
    return deny("evidence_malformed", "evidence record evidenceId does not match lookup key")
  }

  if (
    evidence.itemId !== input.itemId
    || evidence.versionId !== input.versionId
    || evidence.contentHash !== input.contentHash
  ) {
    return deny(
      "license_mismatch",
      "evidence itemId/versionId/contentHash must bind the exact material under analysis",
    )
  }

  if (evidence.modelServiceId !== input.modelServiceId) {
    return deny(
      "service_mismatch",
      "evidence modelServiceId does not match the requested named model service",
    )
  }

  if (!evidence.allowedSteps.includes(input.step)) {
    return deny(
      "purpose_out_of_scope",
      `evidence allowedSteps does not cover requested step ${input.step}; embeddings/training/secondary share are never auto-included`,
    )
  }

  if (SCOPE_RANK[input.requestedContentScope] > SCOPE_RANK[evidence.allowedContentScope]) {
    return deny(
      "content_scope_exceeded",
      `requestedContentScope ${input.requestedContentScope} exceeds evidence allowedContentScope ${evidence.allowedContentScope}`,
    )
  }

  const nowMs = (input.now ?? (() => new Date()))().getTime()
  if (!Number.isFinite(nowMs)) {
    return deny("time_unknown", "now() did not yield a finite instant; unknown time must not allow")
  }

  const validFrom = parseInstant(evidence.validFrom, "validFrom")
  if (!validFrom.ok) return deny("time_unknown", validFrom.reason)
  if (validFrom.ms === null) {
    return deny("time_unknown", "validFrom must be a known instant; unknown time must not allow")
  }
  if (nowMs < validFrom.ms) {
    return deny("no_model_permission", "evidence not yet valid (validFrom in the future)")
  }

  const validUntil = parseInstant(evidence.validUntil, "validUntil")
  if (!validUntil.ok) return deny("time_unknown", validUntil.reason)
  if (validUntil.ms !== null && nowMs >= validUntil.ms) {
    return deny("license_revoked", "evidence expired (validUntil reached)")
  }

  const revokedAt = parseInstant(evidence.revokedAt, "revokedAt")
  if (!revokedAt.ok) return deny("time_unknown", revokedAt.reason)
  if (revokedAt.ms !== null && nowMs >= revokedAt.ms) {
    return deny("license_revoked", "evidence revoked")
  }

  const license: ExactVersionModelLicense = {
    itemId: evidence.itemId,
    versionId: evidence.versionId,
    contentHash: evidence.contentHash,
    permitted: true,
    evidenceId: evidence.evidenceId,
  }

  // Re-enter admitModelPayload with the constructed license + materialRef.
  // Clip hard-deny already applied; binding mismatch would still fail closed.
  const admit = admitModelPayload({
    clipAudit: input.clipAudit,
    license,
    materialRef: {
      itemId: input.itemId,
      versionId: input.versionId,
      contentHash: input.contentHash,
    },
    // Bare boolean still insufficient if somehow present — admitModelPayload ignores it when license matches.
    modelUsePermitted: input.modelUsePermitted,
  })
  if (!admit.allow) {
    return deny(admit.code, admit.reason)
  }

  return {
    ok: true,
    evidenceRef: {
      evidenceId: evidence.evidenceId,
      itemId: evidence.itemId,
      versionId: evidence.versionId,
      contentHash: evidence.contentHash,
      modelServiceId: evidence.modelServiceId,
      step: input.step,
    },
    license,
    productionAuthorized: false,
  }
}
