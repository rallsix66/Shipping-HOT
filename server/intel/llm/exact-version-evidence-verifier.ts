/**
 * Fail-closed ExactVersion evidence verifier (R3-A2 / ADR-007).
 *
 * Read-only verification boundary: validates caller-provided trusted evidence
 * against ExactVersion identity / clip hard-deny contracts. Does NOT write auth
 * records, open HTTP, call Providers, auto-grant, or claim a production issuer.
 *
 * A successful verify result returns evidenceRef only — it does NOT construct or
 * return a consumable ExactVersionModelLicense. Callers must NOT treat verify
 * success as permission to feed admitModelPayload / the existing model-send gate.
 * Fixture-trusted evidence ≠ production permit.
 *
 * Content-scope honesty: this API matches requested scope against evidence
 * allowance AND a read-only, precisely-bound stored material persistence signal.
 * Missing / unreadable persistence → BLOCKED. Storage may only narrow; it never
 * produces a grant. disallowed / excerpt_only must not pass solely because
 * evidence allows full_text.
 *
 * PRODUCTION BOUNDARY (honest): trusted production evidence ingress / issuer
 * wiring remains unfinished. Only an isolated TrustedEvidenceSource (e.g. test
 * fixtures) can supply records today.
 */
import type { ClipAudit } from "@shared/manual-clip"
import type { IntelAnalysisStep } from "#/database/intel-analysis"
import type { IntelContentScope } from "#/database/intel"
import {
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

/** Read-only stored material persistence bound to the exact item/version/hash. */
export type StoredMaterialPersistence = "full" | "excerpt_only" | "disallowed"

export type EvidenceVerifyDenyCode =
  | ModelPayloadDenyCode
  | "purpose_out_of_scope"
  | "license_revoked"
  | "evidence_read_failed"
  | "evidence_malformed"
  | "time_unknown"
  | "service_mismatch"
  | "content_scope_exceeded"
  | "material_scope_unverified"

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
   * Inclusive validity start (strict ISO-8601 with explicit timezone).
   * Missing / malformed / calendar-overflow / unknown zone → time_unknown deny.
   * Unknown time must never allow.
   */
  validFrom: string
  /**
   * Exclusive validity end (strict ISO-8601 with explicit timezone), or null only
   * when explicitly open-ended after a known validFrom.
   * Undefined / "" / unparsable non-null → time_unknown.
   */
  validUntil: string | null
  /** When set, evidence is revoked at/after this strict instant. Malformed → time_unknown. */
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
   * Read-only current stored material persistence for the exact item/version/hash.
   * Required for content-scope honesty. Missing / null / unreadable →
   * material_scope_unverified BLOCKED. Storage only narrows; never grants.
   */
  persistence?: StoredMaterialPersistence | null
  /**
   * @deprecated Ignored for permission. Documented so callers that still pass it
   * cannot escalate; verify never treats bare true as evidence.
   */
  modelUsePermitted?: boolean
  /** Public URL / catalog flags are ignored and never grant. */
  publicReadable?: boolean
  catalogIncluded?: boolean
  now?: () => Date
}

export type EvidenceVerifyResult =
  | {
    ok: true
    /** Contract match for this call only — not a newly issued grant / license. */
    evidenceRef: {
      evidenceId: string
      itemId: string
      versionId: string
      contentHash: string
      modelServiceId: string
      step: ModelUseVerifyStep
      requestedContentScope: IntelContentScope
      evidenceAllowedContentScope: IntelContentScope
      storedPersistence: StoredMaterialPersistence
      effectiveContentScope: IntelContentScope
    }
    /**
     * Explicit reminder: fixture / verify success ≠ production authorization,
     * and this result does NOT include a consumable ExactVersionModelLicense.
     */
    productionAuthorized: false
    /** Always false — verify must not mint a gate-consumable license object. */
    licenseIssued: false
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

/** Strict ISO-8601 instant with explicit timezone (Z or ±HH:MM). */
const STRICT_INSTANT_RE
  = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|[+-]\d{2}:\d{2})$/

function deny(code: EvidenceVerifyDenyCode, reason: string): EvidenceVerifyResult {
  return { ok: false, blocked: true, code, reason }
}

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) return isLeapYear(year) ? 29 : 28
  if (month === 4 || month === 6 || month === 9 || month === 11) return 30
  return 31
}

function parseOffsetMinutes(zone: string): number | null {
  if (zone === "Z") return 0
  const match = /^([+-])(\d{2}):(\d{2})$/.exec(zone)
  if (!match) return null
  const sign = match[1] === "-" ? -1 : 1
  const hours = Number(match[2])
  const minutes = Number(match[3])
  // Reject absurd / unknown zones (hours > 14 or minutes >= 60).
  if (!Number.isInteger(hours) || !Number.isInteger(minutes)) return null
  if (hours > 14 || minutes > 59) return null
  return sign * (hours * 60 + minutes)
}

/**
 * Strict calendar + timezone instant parse.
 * Rejects Date.parse leniency ("1", "2026-02-30"→March, missing zone, illegal zone).
 * Does not relax explicit null open-ended semantics for validUntil / revokedAt —
 * callers pass null separately before invoking this.
 */
export function parseStrictInstant(value: string, field: string):
  | { ok: true, ms: number }
  | { ok: false, reason: string } {
  if (typeof value !== "string" || !value.trim()) {
    return { ok: false, reason: `${field} missing or empty; unknown time must not allow` }
  }
  const trimmed = value.trim()
  const match = STRICT_INSTANT_RE.exec(trimmed)
  if (!match) {
    return {
      ok: false,
      reason: `${field} must be strict ISO-8601 with explicit timezone (Z or ±HH:MM); unknown/malformed time must not allow`,
    }
  }
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const hour = Number(match[4])
  const minute = Number(match[5])
  const second = Number(match[6])
  const fraction = match[7] ?? "0"
  const zone = match[8]
  if (
    !Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)
    || !Number.isInteger(hour) || !Number.isInteger(minute) || !Number.isInteger(second)
  ) {
    return { ok: false, reason: `${field} has non-integer date/time components` }
  }
  if (month < 1 || month > 12) {
    return { ok: false, reason: `${field} month out of range` }
  }
  if (day < 1 || day > daysInMonth(year, month)) {
    return { ok: false, reason: `${field} is not a real calendar date (overflow/invalid day)` }
  }
  if (hour > 23 || minute > 59 || second > 59) {
    return { ok: false, reason: `${field} has out-of-range clock components` }
  }
  const offsetMinutes = parseOffsetMinutes(zone)
  if (offsetMinutes === null) {
    return { ok: false, reason: `${field} has illegal or unknown timezone offset` }
  }
  // Normalize fractional seconds to milliseconds (truncate beyond ms).
  const msFrac = Number(fraction.padEnd(3, "0").slice(0, 3))
  if (!Number.isFinite(msFrac)) {
    return { ok: false, reason: `${field} fractional seconds malformed` }
  }
  const utcMs = Date.UTC(year, month - 1, day, hour, minute, second, msFrac) - offsetMinutes * 60_000
  if (!Number.isFinite(utcMs)) {
    return { ok: false, reason: `${field} did not resolve to a finite instant` }
  }
  // Round-trip calendar check in the stated local components (pre-offset).
  const probe = new Date(Date.UTC(year, month - 1, day, hour, minute, second, msFrac))
  if (
    probe.getUTCFullYear() !== year
    || probe.getUTCMonth() + 1 !== month
    || probe.getUTCDate() !== day
    || probe.getUTCHours() !== hour
    || probe.getUTCMinutes() !== minute
    || probe.getUTCSeconds() !== second
  ) {
    return { ok: false, reason: `${field} failed calendar round-trip; overflow rejected` }
  }
  return { ok: true, ms: utcMs }
}

function parseOptionalInstant(value: string | null | undefined, field: string):
  | { ok: true, ms: number | null }
  | { ok: false, reason: string } {
  if (value === null) return { ok: true, ms: null }
  if (typeof value !== "string") {
    return { ok: false, reason: `${field} must be ISO string or null` }
  }
  if (!value.trim()) {
    return { ok: false, reason: `${field} missing or empty; unknown time must not allow` }
  }
  const parsed = parseStrictInstant(value, field)
  if (!parsed.ok) return parsed
  return { ok: true, ms: parsed.ms }
}

function isIntelContentScope(value: unknown): value is IntelContentScope {
  return value === "metadata_only" || value === "excerpt" || value === "full_text"
}

function isModelUseVerifyStep(value: unknown): value is ModelUseVerifyStep {
  return typeof value === "string" && STEP_SET.has(value)
}

function isStoredMaterialPersistence(value: unknown): value is StoredMaterialPersistence {
  return value === "full" || value === "excerpt_only" || value === "disallowed"
}

/** Map stored persistence to max sendable content scope. disallowed → no sendable body. */
function persistenceCeiling(persistence: StoredMaterialPersistence): IntelContentScope | null {
  if (persistence === "disallowed") return null
  if (persistence === "excerpt_only") return "excerpt"
  return "full_text"
}

function narrowerScope(a: IntelContentScope, b: IntelContentScope): IntelContentScope {
  return SCOPE_RANK[a] <= SCOPE_RANK[b] ? a : b
}

/**
 * Structural validation for a trusted evidence record.
 * Malformed → deny (never allow). Time string strictness is enforced at verify time.
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
 * shape → binding → service → step → content scope (evidence ∩ stored persistence) →
 * validity/revoke. Never grants from boolean/URL/persistence alone.
 * Never returns a consumable ExactVersionModelLicense.
 */
export async function tryVerifyExactVersionEvidence(
  input: EvidenceVerifyInput,
): Promise<EvidenceVerifyResult> {
  // Clip hard-deny first — same private/unknown/unverified posture as admitModelPayload.
  // Probe without a license so only clip codes surface; ignore no_model_permission.
  const clipGate = admitModelPayload({
    clipAudit: input.clipAudit,
  })
  if (!clipGate.allow && (clipGate.code === "private_material" || clipGate.code === "rights_unknown")) {
    return deny(clipGate.code, clipGate.reason)
  }

  // Caller boolean / public URL / catalog MUST NOT grant.
  // persistence is consulted only as a narrowing bound after evidence match — never as a grant.

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

  // Material scope honesty: missing/unreadable stored persistence → BLOCKED.
  if (!isStoredMaterialPersistence(input.persistence)) {
    return deny(
      "material_scope_unverified",
      "stored material persistence missing or unreadable; cannot claim send scope ≤ actual stored/readable scope",
    )
  }
  const storedPersistence = input.persistence

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

  const persistenceMax = persistenceCeiling(storedPersistence)
  if (persistenceMax === null) {
    return deny(
      "content_scope_exceeded",
      "stored material persistence is disallowed; storage scope only narrows and cannot admit model-send",
    )
  }

  const effectiveContentScope = narrowerScope(evidence.allowedContentScope, persistenceMax)
  if (SCOPE_RANK[input.requestedContentScope] > SCOPE_RANK[effectiveContentScope]) {
    return deny(
      "content_scope_exceeded",
      `requestedContentScope ${input.requestedContentScope} exceeds effective scope ${effectiveContentScope} (evidence ${evidence.allowedContentScope} ∩ persistence ${storedPersistence})`,
    )
  }

  let nowMs: number
  try {
    nowMs = (input.now ?? (() => new Date()))().getTime()
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown now() failure"
    return deny("time_unknown", `now() threw: ${message}; unknown time must not allow`)
  }
  if (!Number.isFinite(nowMs)) {
    return deny("time_unknown", "now() did not yield a finite instant; unknown time must not allow")
  }

  const validFrom = parseStrictInstant(evidence.validFrom, "validFrom")
  if (!validFrom.ok) return deny("time_unknown", validFrom.reason)
  if (nowMs < validFrom.ms) {
    return deny("no_model_permission", "evidence not yet valid (validFrom in the future)")
  }

  const validUntil = parseOptionalInstant(evidence.validUntil, "validUntil")
  if (!validUntil.ok) return deny("time_unknown", validUntil.reason)
  if (validUntil.ms !== null && nowMs >= validUntil.ms) {
    return deny("license_revoked", "evidence expired (validUntil reached)")
  }

  const revokedAt = parseOptionalInstant(evidence.revokedAt, "revokedAt")
  if (!revokedAt.ok) return deny("time_unknown", revokedAt.reason)
  if (revokedAt.ms !== null && nowMs >= revokedAt.ms) {
    return deny("license_revoked", "evidence revoked")
  }

  // Intentionally do NOT construct ExactVersionModelLicense / call admit with a minted license.
  // Verify success is evidenceRef-only and must not be directly consumable by the old gate.
  return {
    ok: true,
    evidenceRef: {
      evidenceId: evidence.evidenceId,
      itemId: evidence.itemId,
      versionId: evidence.versionId,
      contentHash: evidence.contentHash,
      modelServiceId: evidence.modelServiceId,
      step: input.step,
      requestedContentScope: input.requestedContentScope,
      evidenceAllowedContentScope: evidence.allowedContentScope,
      storedPersistence,
      effectiveContentScope,
    },
    productionAuthorized: false,
    licenseIssued: false,
  }
}
