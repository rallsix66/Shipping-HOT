import { getAnnualCalendar } from "#/services/annual-calendar"

export default defineEventHandler((event) => {
  const query = getQuery(event)
  const year = query.year === undefined ? new Date().getFullYear() : Number(query.year)
  if (!Number.isInteger(year) || year < 1900 || year > 2100) {
    throw createError({ statusCode: 400, statusMessage: "Invalid reference calendar year" })
  }
  return getAnnualCalendar(year)
})
