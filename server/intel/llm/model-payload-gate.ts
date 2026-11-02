/**
 * Model payload admission gate (R3-1 / ADR-007).
 * `readIntelMaterial` returns stored material for internal use -- that is NOT permission
 * to send content to a model. Default deny for private_material and unknown rights.
 *
 * PRODUCTION BOUNDARY (honest): this is still an injectable offline helper.
 * It does NOT itself prove a production rights/annotation store, HTTP route, or
 * authoritative total-pool wiring. Read-only fail-closed verify lives in
 * exact-version-evidence-verifier.ts; trusted production evidence ingress/issuer
 * remain unfinished. Callers must supply a verifiable
 * ExactVersionModelLicense bound to the exact item/version/contentHash.
 * Passing bare `true` is NOT authorization evidence.
 */
import type { ClipAudit } from "@shared/manual-clip"

export type ModelPayloadDenyCode =
  | "private_material"
  | "rights_unknown"
  | "rights_missing"
  | "no_model_permission"
  | "license_mismatch"

export type ModelPayloadGateResult =
  | { allow: true }
  | { allow: false, code: ModelPayloadDenyCode, reason: string }

/** Verifiable exact-version model-use license. Bare boolean true is not a substitute. */
export interface ExactVersionModelLicense {
  itemId: string
  versionId: string
  contentHash: string
  permitted: true
  /** Optional opaque evidence id from a future rights store -- not required here. */
  evidenceId?: string
}

export interface ModelPayloadCandidate {
  /** Manual clip audit metadata when present on the stored version. */
  clipAudit?: ClipAudit | null
  /**
   * Exact-version license. Prefer this over legacy modelUsePermitted.
   * Must match the material under analysis (checked by caller or via materialRef).
   */
  license?: ExactVersionModelLicense | null
  /**
   * @deprecated Bare true is NOT authorization evidence. Kept only so callers that
   * still pass a boolean fail closed unless a matching ExactVersionModelLicense is also present.
   */
  modelUsePermitted?: boolean
  /** Material identity used to verify ExactVersionModelLicense binding. */
  materialRef?: { itemId: string, versionId: string, contentHash: string }
}

/**
 * Decide whether candidate text/blocks may enter an LLM prompt.
 * Pipeline call sites must invoke this before prefilter/extract.
 * Offline helper only -- not a claim of production rights authority.
 */
export function admitModelPayload(candidate: ModelPayloadCandidate): ModelPayloadGateResult {
  const audit = candidate.clipAudit
  if (audit && "usage" in audit && audit.usage === "private_material") {
    return {
      allow: false,
      code: "private_material",
      reason: "manual private_material is never admitted to model payloads by default",
    }
  }
  if (audit && "rightsStatus" in audit && audit.rightsStatus === "unknown") {
    return {
      allow: false,
      code: "rights_unknown",
      reason: "rightsStatus unknown denies model payload admission",
    }
  }
  if (audit && "rights" in audit) {
    if (audit.verification === "user_declaration_unverified") {
      return {
        allow: false,
        code: "rights_unknown",
        reason: "unverified rights declaration does not grant model permission",
      }
    }
  }

  const license = candidate.license
  if (license && license.permitted === true) {
    const ref = candidate.materialRef
    if (!ref
      || license.itemId !== ref.itemId
      || license.versionId !== ref.versionId
      || license.contentHash !== ref.contentHash) {
      return {
        allow: false,
        code: "license_mismatch",
        reason: "ExactVersionModelLicense must bind to the exact item/version/contentHash under analysis",
      }
    }
    return { allow: true }
  }

  // Bare modelUsePermitted=true is intentionally insufficient.
  if (candidate.modelUsePermitted === true) {
    return {
      allow: false,
      code: "no_model_permission",
      reason: "bare modelUsePermitted=true is not authorization evidence; ExactVersionModelLicense required",
    }
  }
  return {
    allow: false,
    code: "no_model_permission",
    reason: "explicit ExactVersionModelLicense required; readIntelMaterial is not a grant",
  }
}
