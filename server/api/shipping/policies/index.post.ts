import { withPolicyErrors } from "#/utils/policy-api"
import { policyClock } from "#/services/policy-clock"
import { getPolicyRepository } from "#/shipping-store"

/** Explicit write: manual entry (optionally superseding/repealing an existing record via supersedesPolicyId + relation). */
export default defineEventHandler(async (event) => {
  const body = await readBody<Record<string, unknown>>(event)
  if (!body || typeof body !== "object") throw createError({ statusCode: 400, statusMessage: "body_required" })
  const repository = await getPolicyRepository()
  return withPolicyErrors(() => repository.create(body as never, policyClock().now))
})
