import { describe, expect, it } from "vitest"
import { buildTranslationAcceptanceEvidence, buildTranslationAcceptancePlan } from "./translation-live-acceptance"

const enabled = { enabled: true, providerId: "deepseek" as const, model: "deepseek-v4-flash" as const, targetLanguage: "zh-CN", monthlyBudget: 1 }

describe("translation T3D bounded acceptance evidence", () => {
  it("blocks external work unless every gate and explicit authorization passes", () => {
    const plan = buildTranslationAcceptancePlan({ settings: enabled, configured: true, estimatedMonthSpend: 0, allowExternalCalls: false })
    expect(plan.allowed).toBe(false)
    expect(plan.maxExternalCalls).toBe(0)
    expect(plan.checks.fixedInputOnly).toBe(true)
    expect(plan.checks.backlogExcluded).toBe(true)
    expect(plan.blockers).toContain("external_call_not_authorized_for_this_run")
    expect(buildTranslationAcceptanceEvidence(plan).liveVerification).toBe("pending")
  })

  it("blocks disabled, zero-budget, missing-secret and circuit-blocked states", () => {
    const plan = buildTranslationAcceptancePlan({
      settings: { ...enabled, enabled: false, monthlyBudget: 0 },
      configured: false,
      estimatedMonthSpend: 0,
      runtime: { providerId: "deepseek", capability: "translation", status: "failed", errorCode: "auth_failed", consecutiveFailures: 1, updatedAt: "2026-09-03T00:00:00.000Z" },
      allowExternalCalls: true,
    })
    expect(plan.allowed).toBe(false)
    expect(plan.maxExternalCalls).toBe(0)
    expect(plan.blockers).toEqual(expect.arrayContaining(["translation_settings_invalid_or_disabled", "translation_secret_missing", "translation_budget_zero", "translation_provider_circuit_blocked"]))
  })

  it("caps an authorized acceptance sequence at one external call", () => {
    const plan = buildTranslationAcceptancePlan({ settings: enabled, configured: true, estimatedMonthSpend: 0, allowExternalCalls: true })
    expect(plan.allowed).toBe(true)
    expect(plan.maxExternalCalls).toBe(1)
    expect(buildTranslationAcceptanceEvidence(plan, { externalCalls: 2, providerCalled: true }).liveVerification).toBe("pending")
    expect(buildTranslationAcceptanceEvidence(plan, { externalCalls: 0 }).externalCalls).toBe(0)
  })
})
