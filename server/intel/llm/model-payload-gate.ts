/**
 * Model payload admission gate (R3-1 / ADR-007).
 * `readIntelMaterial` returns stored material for internal use — that is NOT permission
 * to send content to a model. Default deny for private_material and unknown rights.
 */
import type { ClipAudit } from "@shared/manual-clip"

export type ModelPayloadDenyCode =
  | "private_material"
  | "rights_unknown"
  | "rights_missing"
  | "no_model_permission"

export type ModelPayloadGateResult =
  | { allow: true }
  | { allow: false, code: ModelPayloadDenyCode, reason: string }

export interface ModelPayloadCandidate {
  /** Manual clip audit metadata when present on the stored version. */
  clipAudit?: ClipAudit | null
  /**
   * Explicit model-use permission record (defined by a later rights/annotation slice).
   * Absent/false → deny. This slice only consumes the flag; it does not invent grants.
   */
  modelUsePermitted?: boolean
}

/**
 * Decide whether candidate text/blocks may enter an LLM prompt.
 * Pipeline call sites must invoke this before prefilter/extract; this module alone does not call models.
 * R3-1 STATUS: skeleton only — NOT WIRED into the prefilter/extract/runtime pipeline yet
 * (call sites still pending a later slice). Unit tests cover the pure gate function.
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
    // Legacy declaration exists but is unverified — still not automatic model permission.
    if (audit.verification === "user_declaration_unverified") {
      return {
        allow: false,
        code: "rights_unknown",
        reason: "unverified rights declaration does not grant model permission",
      }
    }
  }
  if (candidate.modelUsePermitted !== true) {
    return {
      allow: false,
      code: "no_model_permission",
      reason: "explicit model-use permission record required; readIntelMaterial is not a grant",
    }
  }
  return { allow: true }
}
