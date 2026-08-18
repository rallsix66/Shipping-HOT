import { env } from "node:process"
import type { DataEvidence, DataProvenance } from "@shared/shipping"
import { type BusinessImpact, type CalendarCountryCode, type CalendarCoverage, type CalendarCoverageStatus, type CalendarEvent, type CalendarEventType, type CalendarProviderResult, type CalendarQuery, type CalendarSourceKind, calendarCountries, calendarEventId, calendarEventKey, calendarSeverity } from "@shared/calendar"

export interface CalendarProvider {
  getEvents: (query: CalendarQuery) => Promise<CalendarProviderResult>
}

export interface CalendarResponse {
  ok: boolean
  status: number
  json: () => Promise<unknown>
}

export type CalendarFetcher = (url: string) => Promise<CalendarResponse>

export const calendarProviderSourceIds = {
  calendarific: "calendarific",
  official: "official-holiday-source",
  manual: "manual-holiday",
  mock: "mock-calendar",
} as const

export const calendarProvenances = {
  calendarific: { sourceType: "third_party", dataNature: "reported", sourceId: calendarProviderSourceIds.calendarific, sourceUrl: "https://calendarific.com/", verified: false },
  official: { sourceType: "official", dataNature: "reported", sourceId: calendarProviderSourceIds.official, verified: true },
  manual: { sourceType: "user", dataNature: "reported", sourceId: calendarProviderSourceIds.manual, verified: true },
  mock: { sourceType: "mock", dataNature: "reported", sourceId: calendarProviderSourceIds.mock, sourceUrl: "https://example.com/mock/calendar", verified: false },
} as const satisfies Record<string, DataProvenance>

export const officialHolidaySources: Record<CalendarCountryCode, string> = {
  TH: "https://www.bot.or.th/en/financial-institutions-holiday.html",
  ID: "https://www.kemenkopmk.go.id/pemerintah-tetapkan-17-hari-libur-nasional-dan-8-cuti-bersama-tahun-2026",
  MY: "https://www.kabinet.gov.my/hari-kelepasan-am/",
  PH: "https://www.officialgazette.gov.ph/",
  VN: "https://xaydungchinhsach.chinhphu.vn/nghi-le.html",
}

export const officialHolidayProviderStatus = "contract_available_live_sync_pending" as const

interface CalendarificHoliday {
  name?: unknown
  description?: unknown
  date?: { iso?: unknown }
  type?: unknown
}

interface CalendarificPayload {
  response?: { holidays?: unknown, coverage?: unknown }
  meta?: { coverage?: unknown }
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
  note?: string
  internalReminder?: string
  operator?: string
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
    note: options.note,
    internalReminder: options.internalReminder,
    operator: options.operator,
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
  if (types.some(type => /\b(?:national|public|local)\b/.test(type))) return { type: "public_holiday", isPublicHoliday: true }
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
  const events = holidays.flatMap((item) => {
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
  return [...new Map(events.map(event => [calendarEventKey(event), event])).values()]
}

export function calendarificCoverageStatus(value: unknown, eventCount: number): CalendarCoverageStatus {
  const payload = value as CalendarificPayload
  const explicit = asString(payload?.response?.coverage ?? payload?.meta?.coverage)?.toLowerCase()
  if (explicit === "complete") return "complete"
  if (explicit === "partial") return "partial"
  return eventCount > 0 ? "partial" : "unknown"
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
          const payload = await response.json()
          const countryEvents = normalizeCalendarificPayload(payload, countryCode, query.year, fetchedAt)
          events.push(...countryEvents)
          coverage.push({ countryCode, year: query.year, status: calendarificCoverageStatus(payload, countryEvents.length), sourceId: "calendarific", lastCheckedAt: fetchedAt })
        } catch (error) {
          coverage.push({ countryCode, year: query.year, status: "unknown", sourceId: "calendarific", lastCheckedAt: fetchedAt, error: sanitizeCalendarError(error) })
        }
      }
      return { events, coverage, fetchedAt }
    },
  }
}

function scopedEvents(options: { events?: CalendarEvent[], now?: () => Date }, query: CalendarQuery, sourceId: string): CalendarProviderResult {
  const fetchedAt = (options.now ?? (() => new Date()))().toISOString()
  const events = (options.events ?? []).filter(event => query.countries.includes(event.countryCode) && event.date.startsWith(String(query.year))).map(event => ({
    ...event,
    lastCheckedAt: fetchedAt,
    fetchedAt,
    stale: false,
    sourceStatus: "healthy" as const,
  }))
  return {
    events,
    coverage: query.countries.map(countryCode => ({
      countryCode,
      year: query.year,
      status: events.some(event => event.countryCode === countryCode) ? "partial" as const : "unknown" as const,
      sourceId,
      lastCheckedAt: fetchedAt,
    })),
    fetchedAt,
  }
}

export interface OfficialHolidayProviderOptions {
  events?: CalendarEvent[]
  now?: () => Date
}

export function createOfficialHolidayProvider(options: OfficialHolidayProviderOptions = {}): CalendarProvider {
  return { getEvents: async query => scopedEvents(options, query, "official-holiday-source") }
}

export interface ManualHolidayProviderOptions {
  events?: CalendarEvent[]
  now?: () => Date
}

export function createManualHolidayProvider(options: ManualHolidayProviderOptions = {}): CalendarProvider {
  return { getEvents: async query => scopedEvents(options, query, "manual-holiday") }
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

export function createMockCalendarProvider(now = () => new Date()): CalendarProvider {
  return {
    async getEvents(query) {
      const fetchedAt = now().toISOString()
      const events = createMockCalendarEvents(query.year, fetchedAt).filter(event => query.countries.includes(event.countryCode))
      return {
        events,
        coverage: query.countries.map(countryCode => ({ countryCode, year: query.year, status: "complete" as const, sourceId: "mock-calendar", lastCheckedAt: fetchedAt })),
        fetchedAt,
      }
    },
  }
}

export function createUnavailableCalendarProvider(sourceId: string, error: string, now = () => new Date()): CalendarProvider {
  return {
    async getEvents(query) {
      const fetchedAt = now().toISOString()
      return {
        events: [],
        coverage: query.countries.map(countryCode => ({ countryCode, year: query.year, status: "unknown" as const, sourceId, lastCheckedAt: fetchedAt, error })),
        fetchedAt,
      }
    },
  }
}

export function filterCalendarEventsForMode(events: CalendarEvent[], mode: string): CalendarEvent[] {
  const allowed = mode === "mock"
    ? new Set(["mock-calendar"])
    : mode === "calendarific"
      ? new Set(["calendarific", "official-holiday-source", "manual-holiday"])
      : mode === "official"
        ? new Set(["official-holiday-source", "manual-holiday"])
        : new Set(["manual-holiday"])
  return events.filter(event => allowed.has(event.sourceId))
}

export function filterCalendarEventsForSourceIds(events: CalendarEvent[], sourceIds: ReadonlySet<string> | readonly string[]): CalendarEvent[] {
  const allowed = sourceIds instanceof Set ? sourceIds : new Set(sourceIds)
  return events.filter(event => allowed.has(event.sourceId))
}

export function filterCalendarCoverageForMode(coverage: CalendarCoverage[], mode: string): CalendarCoverage[] {
  const allowed = mode === "mock"
    ? new Set(["mock-calendar"])
    : mode === "calendarific"
      ? new Set(["calendarific", "official-holiday-source", "manual-holiday"])
      : mode === "official"
        ? new Set(["official-holiday-source", "manual-holiday"])
        : new Set(["manual-holiday"])
  return coverage.filter(item => allowed.has(item.sourceId))
}

export function filterCalendarCoverageForSourceIds(coverage: CalendarCoverage[], sourceIds: ReadonlySet<string> | readonly string[]): CalendarCoverage[] {
  const allowed = sourceIds instanceof Set ? sourceIds : new Set(sourceIds)
  return coverage.filter(item => allowed.has(item.sourceId))
}

export interface CompositeCalendarProviderOptions {
  calendarific?: CalendarProvider
  official?: CalendarProvider
  manual?: CalendarProvider
}

export function createCompositeCalendarProvider(options: CompositeCalendarProviderOptions): CalendarProvider {
  const sourceOptions: Array<{ sourceId: string, provider: CalendarProvider } | undefined> = [
    options.calendarific ? { sourceId: calendarProviderSourceIds.calendarific, provider: options.calendarific } : undefined,
    options.official ? { sourceId: calendarProviderSourceIds.official, provider: options.official } : undefined,
    options.manual ? { sourceId: calendarProviderSourceIds.manual, provider: options.manual } : undefined,
  ]
  const sources = sourceOptions.filter((value): value is { sourceId: string, provider: CalendarProvider } => value !== undefined)
  return {
    async getEvents(query) {
      const fetchedAt = new Date().toISOString()
      const results = await Promise.all(sources.map(async (source) => {
        try {
          return await source.provider.getEvents(query)
        } catch (error) {
          return {
            events: [] as CalendarEvent[],
            coverage: query.countries.map(countryCode => ({ countryCode, year: query.year, status: "unknown" as const, sourceId: source.sourceId, lastCheckedAt: fetchedAt, error: sanitizeCalendarError(error) })),
            fetchedAt,
          }
        }
      }))
      return {
        events: results.flatMap(result => result.events),
        coverage: results.flatMap(result => result.coverage),
        fetchedAt: results.at(-1)?.fetchedAt ?? fetchedAt,
      }
    },
  }
}

function normalizedName(value: string): string {
  return value.trim().toLocaleLowerCase().normalize("NFKC").replace(/\s+/g, " ")
}

function factKey(event: Pick<CalendarEvent, "countryCode" | "name" | "type">): string {
  return `${event.countryCode}:${normalizedName(event.name)}:${event.type}`
}

function factNameKey(event: Pick<CalendarEvent, "countryCode" | "name">): string {
  return `${event.countryCode}:${normalizedName(event.name)}`
}

function factsChanged(base: CalendarEvent, override: CalendarEvent): boolean {
  return base.date !== override.date || base.endDate !== override.endDate || base.type !== override.type || base.isPublicHoliday !== override.isPublicHoliday
}

function evidenceFor(event: CalendarEvent): DataEvidence {
  return { provenance: event.provenance ?? { sourceType: event.sourceKind, dataNature: "reported", sourceId: event.sourceId, sourceUrl: event.sourceUrl, verified: event.verified }, sourceUpdatedAt: event.sourceUpdatedAt ?? event.updatedAt }
}

function mergeFactGroup(events: CalendarEvent[], manualEvent: CalendarEvent | undefined): CalendarEvent | undefined {
  const officialEvent = events.find(event => event.sourceKind === "official")
  const thirdPartyEvent = events.find(event => event.sourceKind === "third_party" || event.sourceKind === "mock")
  const selected = officialEvent ?? thirdPartyEvent ?? events[0]
  if (!selected) return manualEvent
  const factConflict = Boolean(officialEvent && thirdPartyEvent && factsChanged(thirdPartyEvent, officialEvent))
  if (!manualEvent && !factConflict && events.length === 1 && !selected.evidence?.length) return selected
  const baseEvidence = [...events.flatMap(event => event.evidence ?? []), ...events.map(evidenceFor)]
  const base = {
    ...selected,
    conflictFlag: factConflict || selected.conflictFlag,
    conflictReason: factConflict ? "Official source overrides a third-party calendar fact" : selected.conflictReason,
    conflictingSourceIds: factConflict ? [...new Set([thirdPartyEvent!.sourceId, ...(selected.conflictingSourceIds ?? [])])] : selected.conflictingSourceIds,
    evidence: [...new Map(baseEvidence.map(item => [`${item.provenance.sourceId}:${item.sourceUpdatedAt ?? ""}`, item])).values()],
  }
  if (!manualEvent) return base
  const changed = factsChanged(base, manualEvent)
  const manualEvidence = [...(manualEvent.evidence ?? []), evidenceFor(manualEvent)]
  return {
    ...base,
    ...manualEvent,
    id: manualEvent.id,
    date: changed ? manualEvent.date : base.date,
    endDate: changed ? manualEvent.endDate : base.endDate,
    type: changed ? manualEvent.type : base.type,
    isPublicHoliday: changed ? manualEvent.isPublicHoliday : base.isPublicHoliday,
    name: base.name,
    businessImpact: manualEvent.businessImpact,
    description: manualEvent.description ?? base.description,
    note: manualEvent.note ?? base.note,
    internalReminder: manualEvent.internalReminder ?? base.internalReminder,
    sourceId: manualEvent.sourceId,
    sourceKind: "user",
    verified: true,
    conflictFlag: changed || base.conflictFlag,
    conflictReason: changed ? manualEvent.conflictReason ?? "Manual override changes a source fact" : base.conflictReason,
    conflictOperator: changed ? manualEvent.conflictOperator ?? manualEvent.operator : base.conflictOperator,
    conflictingSourceIds: changed ? [...new Set([base.sourceId, ...(base.conflictingSourceIds ?? [])])] : base.conflictingSourceIds,
    evidence: [...base.evidence ?? [], ...manualEvidence],
  }
}

export function mergeCalendarSources(thirdParty: CalendarEvent[], official: CalendarEvent[], manual: CalendarEvent[]): CalendarEvent[] {
  const grouped = new Map<string, CalendarEvent[]>()
  for (const event of [...thirdParty, ...official]) grouped.set(factKey(event), [...(grouped.get(factKey(event)) ?? []), event])
  const manualByFact = new Map(manual.map(event => [factKey(event), event]))
  const manualByName = new Map(manual.map(event => [factNameKey(event), event]))
  const matchedManualIds = new Set<string>()
  const result = [...grouped.entries()].map(([key, events]) => {
    const manualEvent = manualByFact.get(key) ?? manualByName.get(factNameKey(events[0]))
    if (manualEvent) matchedManualIds.add(manualEvent.id)
    return mergeFactGroup(events, manualEvent)
  }).filter((event): event is CalendarEvent => event !== undefined)
  for (const event of manual) {
    if (!matchedManualIds.has(event.id)) result.push(event)
  }
  return result.sort((a, b) => a.date.localeCompare(b.date) || a.countryCode.localeCompare(b.countryCode) || a.name.localeCompare(b.name))
}

export function configureCalendarProviders(environment: { [key: string]: string | undefined } = { ...env }) {
  const key = environment.CALENDARIFIC_API_KEY
  const requested = environment.SHIPPING_CALENDAR_PROVIDER
  const mode = requested === "calendarific" ? "calendarific" : requested === "official" ? "official" : requested === "manual" ? "manual" : "mock"
  const calendarific = key ? createCalendarificProvider({ apiKey: key }) : requested === "calendarific" ? createUnavailableCalendarProvider("calendarific", "CALENDARIFIC_API_KEY missing") : undefined
  const official = createOfficialHolidayProvider()
  const manual = createManualHolidayProvider()
  const selected = mode === "calendarific"
    ? key ? { calendarific, official, manual } : { calendarific }
    : mode === "official" ? { official, manual } : mode === "manual" ? { manual } : {}
  const provider = mode === "mock" ? createMockCalendarProvider() : createCompositeCalendarProvider(selected)
  const calendarSourceIds = mode === "mock"
    ? [calendarProviderSourceIds.mock]
    : Object.entries(selected)
        .filter(([, source]) => source !== undefined)
        .map(([source]) => calendarProviderSourceIds[source as keyof typeof calendarProviderSourceIds])
  return {
    provider,
    modes: { calendar: mode, calendarSourceIds },
    calendarific,
    official,
    manual,
  }
}

const configured = configureCalendarProviders()
export const calendarProvider = configured.provider
export const calendarProviderModes = configured.modes
export const calendarProviders = { calendarific: configured.calendarific, official: configured.official, manual: configured.manual }

export function calendarAttribution(options: { provider?: string, events?: CalendarEvent[] } = {}): string | undefined {
  return options.provider === "calendarific" || options.events?.some(event => event.sourceId === "calendarific") ? "Powered by Calendarific" : undefined
}

export { calendarSeverity }
