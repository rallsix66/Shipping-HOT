import { generatePromoCandidates } from "#/services/promo-calendar"
import { getPromoCalendarRepository } from "#/shipping-store"

/** Explicit write: (re)generate catalog §9 rule dates for one year. Idempotent; never overwrites confirmations or manual edits. */
export default defineEventHandler(async (event) => {
  const body = await readBody<{ year?: unknown }>(event)
  const year = body?.year
  if (typeof year !== "number" || !Number.isInteger(year) || year < 2000 || year > 2100) throw createError({ statusCode: 400, statusMessage: "invalid_year" })
  const { candidates, gaps } = generatePromoCandidates(year)
  const repository = await getPromoCalendarRepository()
  const result = await repository.upsertGenerated(candidates, new Date().toISOString())
  return { year, candidates: candidates.length, ...result, gaps }
})
