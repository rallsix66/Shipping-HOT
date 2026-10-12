import { withPolicyErrors } from "#/utils/policy-api"
import { policyClock } from "#/services/policy-clock"
import { getPolicyRepository } from "#/shipping-store"

/** Explicit write: repeal without replacement (actor, reason and HTTPS source required). */
export default defineEventHandler(async (event) => {
  const id = decodeURIComponent(getRouterParam(event, "id") ?? "")
  const body = await readBody<Record<string, unknown>>(event)
  const repository = await getPolicyRepository()
  return withPolicyErrors(() => repository.repeal(id, body ?? {}, policyClock().now))
})
