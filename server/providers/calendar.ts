import { env } from "node:process"
import type { DataEvidence, DataProvenance } from "@shared/shipping"
import { type BusinessImpact, type CalendarCountryCode, type CalendarEvent, type CalendarEventType, type CalendarProviderResult, type CalendarQuery, type CalendarSourceKind, calendarCountries, calendarEventId, calendarEventKey, calendarSeverity } from "@shared/calendar"

export interface CalendarProvider {
  getEvents: (query: CalendarQuery) => Promise<CalendarProviderResult>
}

export interface CalendarResponse {
  ok: boolean
  status: number
  json: () => Promise<unknown>
}

export type CalendarFetcher = (url: string) => Promise<CalendarResponse>

export const calendarProvenances = {
  calendarific: { sourceType: "third_party", dataNature: "reported", sourceId: "calendarific", sourceUrl: "https://calendarific.com/", verified: false },
  official: { sourceType: "official", dataNature: "reported", sourceId: "official-holiday-source", verified: true },
  manual: { sourceType: "user", dataNature: "reported", sourceId: "manual-holiday", verified: true },
  mock: { sourceType: "mock", dataNature: "reported", sourceId: "mock-calendar", sourceUrl: "https://example.com/mock/calendar", verified: false },
} as const satisfies Record<string, DataProvenance>

export const officialHolidaySources: Record<CalendarCountryCode, string> = {
  TH: "https://www.bot.or.th/en/financial-institutions-holiday.html",
  ID: "https://www.kemenkopmk.go.id/pemerintah-tetapkan-17-hari-libur-nasional-dan-8-cuti-bersama-tahun-2026",
  MY: "https://www.kabinet.gov.my/hari-kelepasan-am/",
  PH: "https://www.officialgazette.gov.ph/",
  VN: "https://xaydungchinhsach.chinhphu.vn/nghi-le.html",
}

interface CalendarificHoliday {
  name?: unknown
  description?: unknown
  date?: { iso?: unknown }
  type?: unknown
}

interface CalendarificPayload {
  response?: { holidays?: unknown }
}

interface CalendarEventOptions {
  countryCode: CalendarCountryCode
  name: string
  date: string
  endDate?: string
  type: CalendarEventType
  isPublicHoliday: boolean
  businessImpact: BusinessImpact
  sourceId: string
  sourceKind: CalendarSourceKind
  sourceUrl?: string
  verified: boolean
  description?: string
  lastCheckedAt: string
  stale?: boolean
  sourceStatus?: CalendarEvent["sourceStatus"]
  error?: string
  provenance: DataProvenance
  evidence?: DataEvidence[]
}

function calendarEvent(options: CalendarEventOptions): CalendarEvent {
  const updatedAt = options.lastCheckedAt
  return {
    id: calendarEventId(options, options.sourceId),
    countryCode: options.countryCode,
    name: options.name,
    description: options.description,
    date: options.date,
    endDate: options.endDate,
    type: options.type,
    isPublicHoliday: options.isPublicHoliday,
    businessImpact: options.businessImpact,
    sourceId: options.sourceId,
    sourceUrl: options.sourceUrl,
    sourceKind: options.sourceKind,
    verified: options.verified,
    lastCheckedAt: options.lastCheckedAt,
    updatedAt,
    fetchedAt: updatedAt,
    stale: options.stale ?? false,
    sourceStatus: options.sourceStatus ?? "healthy",
    error: options.error,
    provenance: options.provenance,
    evidence: options.evidence,
  }
}

function calendarFetcher(): CalendarFetcher {
  const fetchImplementation = (globalThis as typeof globalThis & { fetch?: CalendarFetcher }).fetch
  if (!fetchImplementation) throw new Error("Fetch runtime is unavailable")
  return fetchImplementation
}

function holidayType(types: string[]): { type: CalendarEventType, isPublicHoliday: boolean } {
  if (types.includes("national") || types.includes("local")) return { type: "public_holiday", isPublicHoliday: true }
  if (types.includes("religious")) return { type: "religious", isPublicHoliday: false }
  if (types.includes("observance")) return { type: "observance", isPublicHoliday: false }
  return { type: "commercial", isPublicHoliday: false }
}

function impactFor(type: CalendarEventType, isPublicHoliday: boolean): BusinessImpact {
  return type === "government_special" ? "high" : isPublicHoliday ? "medium" : type === "observance" ? "low" : "medium"
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

function asTypes(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string").map(item => item.toLowerCase()) : []
}

export function sanitizeCalendarError(value: unknown): string {
  const message = value instanceof Error ? value.message : String(value)
  return message.replace(/([?&]api_key=)[^&\s]+/gi, "$1***").slice(0, 240)
}

export function normalizeCalendarificPayload(value: unknown, countryCode: CalendarCountryCode, year: number, fetchedAt: string): CalendarEvent[] {
  const holidays = (value as CalendarificPayload)?.response?.holidays
  if (!Array.isArray(holidays)) throw new Error("Calendarific response is malformed")
  return holidays.flatMap((item) => {
    if (!item || typeof item !== "object") return []
    const holiday = item as CalendarificHoliday
    const name = asString(holiday.name)
    const date = asString(holiday.date?.iso)
    if (!name || !date || !new RegExp(`^${year}-\\d{2}-\\d{2}$`).test(date)) return []
    const { type, isPublicHoliday } = holidayType(asTypes(holiday.type))
    return [calendarEvent({
      countryCode,
      name,
      date,
      type,
      isPublicHoliday,
      businessImpact: impactFor(type, isPublicHoliday),
      sourceId: "calendarific",
      sourceKind: "third_party",
      sourceUrl: `https://calendarific.com/holidays/${year}/${countryCode}`,
      verified: false,
      description: asString(holiday.description),
      lastCheckedAt: fetchedAt,
      provenance: { ...calendarProvenances.calendarific, sourceUrl: `https://calendarific.com/holidays/${year}/${countryCode}` },
    })]
  })
}

export interface CalendarificProviderOptions {
  apiKey: string
  fetcher?: CalendarFetcher
  now?: () => Date
}

export function createCalendarificProvider(options: CalendarificProviderOptions): CalendarProvider {
  const fetcher = options.fetcher ?? calendarFetcher()
  const now = options.now ?? (() => new Date())
  return {
    async getEvents(query) {
      const fetchedAt = now().toISOString()
      const events: CalendarEvent[] = []
      const coverage = [] as CalendarProviderResult["coverage"]
      for (const countryCode of query.countries) {
        const url = new URL("https://calendarific.com/api/v2/holidays")
        url.searchParams.set("api_key", options.apiKey)
        url.searchParams.set("country", countryCode)
        url.searchParams.set("year", String(query.year))
        try {
          const response = await fetcher(url.toString())
          if (!response.ok) throw new Error(`Calendarific request failed (${response.status})`)
          events.push(...normalizeCalendarificPayload(await response.json(), countryCode, query.year, fetchedAt))
          coverage.push({ countryCode, year: query.year, status: "complete", sourceId: "calendarific", lastCheckedAt: fetchedAt })
        } catch (error) {
          coverage.push({ countryCode, year: query.year, status: "unknown", sourceId: "calendarific", lastCheckedAt: fetchedAt, error: sanitizeCalendarError(error) })
        }
      }
      return { events, coverage, fetchedAt }
    },
  }
}

export interface OfficialHolidayProviderOptions {
  events?: CalendarEvent[]
  now?: () => Date
}

export function createOfficialHolidayProvider(options: OfficialHolidayProviderOptions = {}): CalendarProvider {
  const now = options.now ?? (() => new Date())
  return {
    async getEvents(query) {
      const fetchedAt = now().toISOString()
      const events = (options.events ?? []).filter(event => query.countries.includes(event.countryCode) && event.date.startsWith(String(query.year)))
      return {
        events,
        coverage: query.countries.map(countryCode => ({ countryCode, year: query.year, status: events.some(event => event.countryCode === countryCode) ? "partial" as const : "unknown" as const, sourceId: "official-holiday-source", lastCheckedAt: fetchedAt })),
        fetchedAt,
      }
    },
  }
}

export interface ManualHolidayProviderOptions {
  events?: CalendarEvent[]
  now?: () => Date
}

export function createManualHolidayProvider(options: ManualHolidayProviderOptions = {}): CalendarProvider {
  const now = options.now ?? (() => new Date())
  return {
    async getEvents(query) {
      const fetchedAt = now().toISOString()
      const events = (options.events ?? []).filter(event => query.countries.includes(event.countryCode) && event.date.startsWith(String(query.year)))
      return { events, coverage: query.countries.map(countryCode => ({ countryCode, year: query.year, status: events.some(event => event.countryCode === countryCode) ? "partial" as const : "unknown" as const, sourceId: "manual-holiday", lastCheckedAt: fetchedAt })), fetchedAt }
    },
  }
}

function mockDate(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`
}

export function createMockCalendarEvents(year: number, now = new Date().toISOString()): CalendarEvent[] {
  return (Object.keys(calendarCountries) as CalendarCountryCode[]).flatMap(countryCode => [
    calendarEvent({ countryCode, name: `${calendarCountries[countryCode]} Mock 元旦`, date: mockDate(year, 1, 1), type: "public_holiday", isPublicHoliday: true, businessImpact: "medium", sourceId: "mock-calendar", sourceKind: "mock", sourceUrl: calendarProvenances.mock.sourceUrl, verified: false, lastCheckedAt: now, provenance: calendarProvenances.mock }),
    calendarEvent({ countryCode, name: `${calendarCountries[countryCode]} Mock 运营日`, date: mockDate(year, 6, 15), type: "company_custom", isPublicHoliday: false, businessImpact: "low", sourceId: "mock-calendar", sourceKind: "mock", sourceUrl: calendarProvenances.mock.sourceUrl, verified: false, lastCheckedAt: now, provenance: calendarProvenances.mock }),
  ])
}

function factsChanged(base: CalendarEvent, override: CalendarEvent): boolean {
  return base.date !== override.date || base.endDate !== override.endDate || base.type !== override.type || base.isPublicHoliday !== override.isPublicHoliday
}

export function mergeCalendarSources(thirdParty: CalendarEvent[], official: CalendarEvent[], manual: CalendarEvent[]): CalendarEvent[] {
  const grouped = new Map<string, CalendarEvent[]>()
  for (const event of [...thirdParty, ...official]) {
    const key = calendarEventKey(event)
    grouped.set(key, [...(grouped.get(key) ?? []), event])
  }
  const result: CalendarEvent[] = []
  for (const events of grouped.values()) {
    const officialEvent = events.find(event => event.sourceKind === "official")
    const thirdPartyEvent = events.find(event => event.sourceKind === "third_party" || event.sourceKind === "mock")
    const manualEvent = events.find(event => event.sourceKind === "user")
    const selected = officialEvent ?? thirdPartyEvent ?? manualEvent ?? events[0]
    if (!selected) continue
    if (manualEvent && manualEvent !== selected) {
      const changed = factsChanged(selected, manualEvent)
      result.push({
        ...selected,
        ...manualEvent,
        id: manualEvent.id,
        conflictFlag: changed || selected.conflictFlag,
        conflictReason: changed ? manualEvent.conflictReason ?? "Manual override changes a source fact" : manualEvent.conflictReason,
        conflictingSourceIds: changed ? [...new Set([selected.sourceId, ...(selected.conflictingSourceIds ?? [])])] : selected.conflictingSourceIds,
        evidence: [...(selected.evidence ?? []), ...(manualEvent.evidence ?? [])],
      })
    } else {
      result.push(selected)
    }
  }
  for (const manualEvent of manual) {
    const matchingIndex = result.findIndex(event => event.countryCode === manualEvent.countryCode && event.type === manualEvent.type && event.name.trim().toLocaleLowerCase() === manualEvent.name.trim().toLocaleLowerCase())
    const matching = matchingIndex < 0 ? undefined : result[matchingIndex]
    if (!matching) {
      result.push(manualEvent)
      continue
    }
    if (matching.id === manualEvent.id) continue
    const changed = factsChanged(matching, manualEvent)
    result[matchingIndex] = {
      ...matching,
      ...manualEvent,
      id: manualEvent.id,
      conflictFlag: changed || matching.conflictFlag,
      conflictReason: changed ? manualEvent.conflictReason ?? "Manual override changes a source fact" : manualEvent.conflictReason,
      conflictingSourceIds: changed ? [...new Set([matching.sourceId, ...(matching.conflictingSourceIds ?? [])])] : matching.conflictingSourceIds,
      evidence: [...(matching.evidence ?? []), ...(manualEvent.evidence ?? [])],
    }
  }
  return result.sort((a, b) => a.date.localeCompare(b.date) || a.countryCode.localeCompare(b.countryCode) || a.name.localeCompare(b.name))
}

export function configureCalendarProviders(environment: { [key: string]: string | undefined } = { ...env }) {
  const key = environment.CALENDARIFIC_API_KEY
  const requested = environment.SHIPPING_CALENDAR_PROVIDER
  const mode = requested === "calendarific" && key ? "calendarific" : requested === "official" ? "official" : requested === "manual" ? "manual" : "mock"
  const mock = createManualHolidayProvider({ events: createMockCalendarEvents(new Date().getUTCFullYear()) })
  return {
    provider: mode === "calendarific" ? createCalendarificProvider({ apiKey: key! }) : mode === "official" ? createOfficialHolidayProvider() : mode === "manual" ? createManualHolidayProvider() : mock,
    modes: { calendar: mode },
    calendarific: key ? createCalendarificProvider({ apiKey: key }) : undefined,
    official: createOfficialHolidayProvider(),
    manual: mock,
  }
}

const configured = configureCalendarProviders()
export const calendarProvider = configured.provider
export const calendarProviderModes = configured.modes
export const calendarProviders = { calendarific: configured.calendarific, official: configured.official, manual: configured.manual }

export function calendarAttribution(): string {
  return "Powered by Calendarific"
}

export { calendarSeverity }
