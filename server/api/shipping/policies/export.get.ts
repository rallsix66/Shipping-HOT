import { policyCsv } from "@shared/policy"
import { policyFilterFromQuery } from "#/utils/policy-api"
import { policyClock } from "#/services/policy-clock"
import { getPolicyRepository } from "#/shipping-store"

/** Query-only CSV export of exactly the filtered list (same filter parameters as GET /api/shipping/policies). */
export default defineEventHandler(async (event) => {
  const { now } = policyClock()
  const records = await (await getPolicyRepository()).list(policyFilterFromQuery(event), now)
  setHeader(event, "content-type", "text/csv; charset=utf-8")
  setHeader(event, "content-disposition", "attachment; filename=\"policies.csv\"")
  return policyCsv(records)
})
