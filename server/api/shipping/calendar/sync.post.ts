import { type CalendarCountryCode, calendarCountries } from "@shared/calendar"
import { calendarAttribution } from "#/providers/calendar"
import { calendarProviderModes } from "#/providers/shipping"
import { syncCalendarEvents } from "#/shipping-store"

export default defineEventHandler(async (event) => {
  const body = await readBody<{ year?: unknown, countries?: unknown }>(event)
  const year = typeof body?.year === "number" && Number.isInteger(body.year) ? body.year : new Date().getUTCFullYear()
  const countries = Array.isArray(body?.countries)
    ? body.countries.filter((country): country is CalendarCountryCode => typeof country === "string" && Object.prototype.hasOwnProperty.call(calendarCountries, country))
    : undefined
  const result = await syncCalendarEvents(year, countries)
  return { ...result, attribution: calendarAttribution({ provider: calendarProviderModes.calendar, events: result.events }) }
})
