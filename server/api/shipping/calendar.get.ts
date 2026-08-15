import { type CalendarCountryCode, calendarCountries } from "@shared/calendar"
import { calendarAttribution } from "#/providers/calendar"
import { getShippingSnapshot } from "#/shipping-store"
import { calendarProviderModes } from "#/providers/shipping"

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const year = Number(query.year ?? new Date().getUTCFullYear())
  const country = typeof query.country === "string" && Object.prototype.hasOwnProperty.call(calendarCountries, query.country) ? query.country as CalendarCountryCode : undefined
  const snapshot = await getShippingSnapshot()
  return {
    year,
    country,
    events: (snapshot.calendarEvents ?? []).filter(item => item.date.startsWith(String(year)) && (!country || item.countryCode === country)),
    coverage: (snapshot.calendarCoverage ?? []).filter(item => item.year === year && (!country || item.countryCode === country)),
    provider: calendarProviderModes.calendar,
    attribution: calendarAttribution({ provider: calendarProviderModes.calendar, events: snapshot.calendarEvents }),
  }
})
