import { policyClock } from "#/services/policy-clock"
import { getPolicyRepository } from "#/shipping-store"

/** Query-only detail: current record, every version (full snapshots) and the change log. */
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, "id") ?? ""
  const { now, clock } = policyClock()
  const detail = await (await getPolicyRepository()).detail(decodeURIComponent(id), now)
  if (!detail) throw createError({ statusCode: 404, statusMessage: "policy_not_found" })
  return { ...detail, clock }
})
