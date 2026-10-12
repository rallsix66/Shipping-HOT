import { type PolicyListResponse, policyToday } from "@shared/policy"
import { policyFilterFromQuery } from "#/utils/policy-api"
import { policyClock } from "#/services/policy-clock"
import { getPolicyRepository } from "#/shipping-store"

/** Query-only list with filters (country, platform, category, status, effective date range, text). */
export default defineEventHandler(async (event): Promise<PolicyListResponse> => {
  const { now, clock } = policyClock()
  const repository = await getPolicyRepository()
  const records = await repository.list(policyFilterFromQuery(event), now)
  return { records, total: records.length, today: policyToday(now), clock }
})
