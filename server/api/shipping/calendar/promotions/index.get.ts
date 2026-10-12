import type { PromoCalendarResponse } from "@shared/promo-calendar"
import { generatePromoCandidates } from "#/services/promo-calendar"
import { getPromoCalendarRepository } from "#/shipping-store"

/** Query-only: reads stored promo rows; rule gaps are computed in memory (nothing is written). */
export default defineEventHandler(async (event): Promise<PromoCalendarResponse> => {
  const query = getQuery(event)
  const year = query.year === undefined ? new Date().getFullYear() : Number(query.year)
  if (!Number.isInteger(year) || year < 2000 || year > 2100) throw createError({ statusCode: 400, statusMessage: "Invalid promo calendar year" })
  const repository = await getPromoCalendarRepository()
  return { year, events: await repository.listForYear(year), gaps: generatePromoCandidates(year).gaps }
})
