import { PromoCalendarError } from "#/database/promo-calendar"
import { getPromoCalendarRepository } from "#/shipping-store"

/** Explicit confirmation with evidence. `confirmed: true` alone is never accepted. */
export default defineEventHandler(async (event) => {
  const body = await readBody<Record<string, unknown>>(event)
  const repository = await getPromoCalendarRepository()
  try {
    return await repository.confirm({ id: body?.id, countryCode: body?.countryCode, platform: body?.platform, evidenceSourceId: body?.evidenceSourceId, evidenceRef: body?.evidenceRef, note: body?.note }, new Date().toISOString())
  } catch (error) {
    if (error instanceof PromoCalendarError) throw createError({ statusCode: error.statusCode, statusMessage: error.code })
    throw error
  }
})
