import type { DataEvidence, Freshness, ProvenanceAware } from "./shipping"

export type CalendarCountryCode = "CN" | "TH" | "ID" | "MY" | "PH" | "VN"
export type CalendarEventType = "public_holiday" | "observance" | "religious" | "commercial" | "government_special" | "company_custom"
export type BusinessImpact = "low" | "medium" | "high" | "critical"
export type CalendarCoverageStatus = "complete" | "partial" | "unknown"
export type CalendarSyncStatus = "synced" | "partial_failure" | "uncovered"
export type CalendarCacheStatus = "fresh" | "stale" | "missing"
export type CalendarSourceKind = "official" | "third_party" | "user" | "mock"
export type CalendarEventScope = "national" | "subdivision" | "unknown"

export const calendarCountries: Record<CalendarCountryCode, string> = {
  CN: "中国",
  TH: "泰国",
  ID: "印度尼西亚",
  MY: "马来西亚",
  PH: "菲律宾",
  VN: "越南",
}

export interface CalendarEvent extends Freshness, ProvenanceAware {
  id: string
  countryCode: CalendarCountryCode
  scope?: CalendarEventScope
  subdivisionCode?: string
  subdivisionCodes?: string[]
  scopeLabel?: string
  name: string
  description?: string
  date: string
  endDate?: string
  type: CalendarEventType
  isPublicHoliday: boolean
  businessImpact: BusinessImpact
  sourceId: string
  sourceUrl?: string
  sourceKind: CalendarSourceKind
  verified: boolean
  lastCheckedAt: string
  note?: string
  internalReminder?: string
  operator?: string
  conflictFlag?: boolean
  conflictReason?: string
  conflictOperator?: string
  conflictingSourceIds?: string[]
  evidence?: DataEvidence[]
}

export interface CalendarCoverage {
  countryCode: CalendarCountryCode
  year: number
  status: CalendarCoverageStatus
  sourceId: string
  lastCheckedAt?: string
  error?: string
  errorCode?: string
}

export interface CalendarCoverageStatusSummary {
  countryCode: CalendarCountryCode
  year: number
  syncStatus: CalendarSyncStatus
  cacheStatus: CalendarCacheStatus
  providerStatus: CalendarCoverageStatus
  sourceIds: string[]
  checkedSourceIds: string[]
  failedSourceIds: string[]
  lastCheckedAt?: string
  eventCount: number
  errors: Array<{ sourceId: string, error?: string, errorCode?: string }>
}

export interface CalendarCoverageStatusOptions {
  coverage: CalendarCoverage[]
  events: CalendarEvent[]
  year: number
  countries?: readonly CalendarCountryCode[]
  sourceIds?: readonly string[]
  now?: Date | string
  staleAfterMs?: number
}

/**
 * The provider-free read contract for Calendar coverage. Raw Provider rows keep
 * their `complete|partial|unknown` meaning; this summary adds operational sync
 * and cache states without treating partial Provider coverage as a failure.
 */
export function summarizeCalendarCoverage(options: CalendarCoverageStatusOptions): CalendarCoverageStatusSummary[] {
  const countries = options.countries ?? Object.keys(calendarCountries) as CalendarCountryCode[]
  const configuredSourceIds = options.sourceIds ? [...new Set(options.sourceIds)] : undefined
  const now = typeof options.now === "string" ? Date.parse(options.now) : (options.now ?? new Date()).getTime()
  const nowMs = Number.isFinite(now) ? now : Date.now()
  const staleAfterMs = options.staleAfterMs ?? 7 * 24 * 60 * 60 * 1000

  return countries.map((countryCode) => {
    const rowsByKey = new Map<string, CalendarCoverage>()
    for (const item of options.coverage) {
      if (item.countryCode !== countryCode || item.year !== options.year || (configuredSourceIds && !configuredSourceIds.includes(item.sourceId))) continue
      rowsByKey.set(`${item.countryCode}/${item.year}/${item.sourceId}`, item)
    }
    const rows = [...rowsByKey.values()]
    const events = options.events.filter(item => item.countryCode === countryCode && item.date.startsWith(String(options.year)) && (!configuredSourceIds || configuredSourceIds.includes(item.sourceId)))
    const sourceIds = configuredSourceIds ?? [...new Set(rows.map(item => item.sourceId))]
    const checkedSourceIds = [...new Set(rows.filter(item => item.lastCheckedAt).map(item => item.sourceId))]
    const failedRows = rows.filter(item => Boolean(item.error))
    const failedSourceIds = [...new Set(failedRows.map(item => item.sourceId))]
    const timestamps = rows
      .map(item => item.lastCheckedAt ? Date.parse(item.lastCheckedAt) : Number.NaN)
      .filter(timestamp => Number.isFinite(timestamp))
    const lastCheckedAt = timestamps.length ? new Date(Math.max(...timestamps)).toISOString() : undefined
    const successfulTimestamps = rows
      .filter(item => !item.error && item.status !== "unknown")
      .map(item => item.lastCheckedAt ? Date.parse(item.lastCheckedAt) : Number.NaN)
      .filter(timestamp => Number.isFinite(timestamp))
    const providerStatus: CalendarCoverageStatus = rows.length === 0
      ? "unknown"
      : rows.every(item => item.status === "complete")
        ? "complete"
        : rows.some(item => item.status === "partial" || item.status === "complete")
          ? "partial"
          : "unknown"
    const syncStatus: CalendarSyncStatus = rows.length === 0
      ? "uncovered"
      : failedRows.length > 0
        ? "partial_failure"
        : rows.every(item => item.status === "unknown")
          ? "uncovered"
          : "synced"
    const cacheStatus: CalendarCacheStatus = rows.length === 0 || successfulTimestamps.length === 0
      ? (events.length ? "stale" : "missing")
      : Math.max(...successfulTimestamps) >= nowMs - staleAfterMs ? "fresh" : "stale"

    return {
      countryCode,
      year: options.year,
      syncStatus,
      cacheStatus,
      providerStatus,
      sourceIds,
      checkedSourceIds,
      failedSourceIds,
      lastCheckedAt,
      eventCount: events.length,
      errors: failedRows.map(item => ({ sourceId: item.sourceId, error: item.error, errorCode: item.errorCode })),
    }
  })
}

export interface CalendarSnapshot {
  events: CalendarEvent[]
  coverage: CalendarCoverage[]
}

export interface CalendarQuery {
  year: number
  countries: CalendarCountryCode[]
}

export interface CalendarProviderResult extends CalendarSnapshot {
  fetchedAt: string
}

export type CalendarEventIdentity = Pick<CalendarEvent, "countryCode" | "date" | "name" | "type"> & Partial<Pick<CalendarEvent, "scope" | "subdivisionCode" | "subdivisionCodes" | "scopeLabel">>

export function calendarEventScopeKey(event: Pick<CalendarEvent, "scope" | "subdivisionCode" | "subdivisionCodes" | "scopeLabel">): string | undefined {
  if (!event.scope || event.scope === "national") return undefined
  const codes = [...new Set([...(event.subdivisionCodes ?? []), ...(event.subdivisionCode ? [event.subdivisionCode] : [])])].sort()
  if (codes.length) return `subdivision:${codes.join(",")}`
  if (event.scopeLabel?.trim()) return `${event.scope}:${event.scopeLabel.trim().toLowerCase().normalize("NFKC").replace(/\s+/g, " ")}`
  return `scope:${event.scope}`
}

export function calendarEventKey(event: CalendarEventIdentity): string {
  return `${calendarEventNameKey(event)}:${event.type}`
}

export function calendarEventNameKey(event: Omit<CalendarEventIdentity, "type">): string {
  const scopeKey = calendarEventScopeKey(event)
  return `${event.countryCode}:${event.date}:${event.name.trim().toLowerCase()}${scopeKey ? `:${scopeKey}` : ""}`
}

export function calendarEventId(event: CalendarEventIdentity, sourceId: string): string {
  return `calendar:${calendarEventKey(event)}:${sourceId}`
}

export function calendarEventLegacyId(event: CalendarEventIdentity, sourceId: string): string {
  return calendarEventId({ ...event, scope: undefined, subdivisionCode: undefined, subdivisionCodes: undefined, scopeLabel: undefined }, sourceId)
}

export function calendarSeverity(impact: BusinessImpact): "info" | "watch" | "warning" | "critical" {
  return impact === "critical" ? "critical" : impact === "high" ? "warning" : impact === "medium" ? "watch" : "info"
}

export function calendarLeadDays(event: Pick<CalendarEvent, "businessImpact" | "type" | "date" | "endDate">): number[] {
  const start = Date.parse(`${event.date}T00:00:00Z`)
  const end = Date.parse(`${event.endDate ?? event.date}T00:00:00Z`)
  const durationDays = Number.isNaN(start) || Number.isNaN(end) ? 0 : Math.floor((end - start) / 86400000) + 1
  if (event.type === "government_special") return [0]
  if (event.businessImpact === "high" || event.businessImpact === "critical" || durationDays >= 3) return [14, 3]
  if (event.businessImpact === "medium") return [7]
  return []
}

export function daysUntilCalendarEvent(date: string, today: string): number {
  return Math.floor((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86400000)
}
