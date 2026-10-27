/**
 * Step → model resolution for the LLM registry (R3-1).
 * No silent fallback: missing/disabled binding or model returns a typed miss.
 */
import type { Database } from "db0"
import {
  type LlmModelRecord,
  type LlmProviderRecord,
  LlmRegistryRepository,
  type LlmStep,
  type LlmStepBindingRecord,
} from "#/database/llm-registry"

export type ResolveBindingResult =
  | {
    ok: true
    step: LlmStep
    binding: LlmStepBindingRecord
    model: LlmModelRecord
    provider: LlmProviderRecord
  }
  | {
    ok: false
    step: LlmStep
    code: "binding_missing" | "model_missing" | "model_disabled" | "provider_missing" | "provider_disabled" | "purpose_mismatch" | "second_opinion_same_provider"
  }

export async function resolveStepBinding(db: Database, step: LlmStep): Promise<ResolveBindingResult> {
  const repo = new LlmRegistryRepository(db)
  const binding = await repo.getBinding(step)
  if (!binding) return { ok: false, step, code: "binding_missing" }
  const model = await repo.getModel(binding.modelId)
  if (!model) return { ok: false, step, code: "model_missing" }
  if (!model.enabled) return { ok: false, step, code: "model_disabled" }
  const provider = await repo.getProvider(model.providerId)
  if (!provider) return { ok: false, step, code: "provider_missing" }
  if (!provider.enabled) return { ok: false, step, code: "provider_disabled" }
  if (step === "embeddings" && model.purpose !== "embedding") return { ok: false, step, code: "purpose_mismatch" }
  if (step !== "embeddings" && model.purpose !== "chat") return { ok: false, step, code: "purpose_mismatch" }
  if (step === "group" || step === "group_second_opinion") {
    const otherStep: LlmStep = step === "group" ? "group_second_opinion" : "group"
    const other = await repo.getBinding(otherStep)
    if (other) {
      const otherModel = await repo.getModel(other.modelId)
      if (otherModel && otherModel.providerId === model.providerId) {
        return { ok: false, step, code: "second_opinion_same_provider" }
      }
    }
  }
  return { ok: true, step, binding, model, provider }
}

/** Estimate USD cost from unit prices (per 1M tokens) and token counts. */
export function estimateTokenCost(model: LlmModelRecord, tokensIn: number, tokensOut: number): number {
  const inCost = (Math.max(0, tokensIn) / 1_000_000) * model.unitPriceIn
  const outCost = (Math.max(0, tokensOut) / 1_000_000) * model.unitPriceOut
  return Number((inCost + outCost).toFixed(8))
}
