import { withPolicyErrors } from "#/utils/policy-api"
import { policyClock } from "#/services/policy-clock"
import { getPolicyRepository } from "#/shipping-store"

/** Explicit write: revise (append a new version with the complete new state + change summary). */
export default defineEventHandler(async (event) => {
  const id = decodeURIComponent(getRouterParam(event, "id") ?? "")
  const body = await readBody<Record<string, unknown>>(event)
  if (!body || typeof body !== "object") throw createError({ statusCode: 400, statusMessage: "body_required" })
  const repository = await getPolicyRepository()
  return withPolicyErrors(() => repository.revise(id, body as never, policyClock().now))
})
