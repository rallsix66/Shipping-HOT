import type { DataEvidence, Freshness, ProvenanceAware } from "./shipping"

export type CalendarCountryCode = "TH" | "ID" | "MY" | "PH" | "VN"
export type CalendarEventType = "public_holiday" | "observance" | "religious" | "commercial" | "government_special" | "company_custom"
export type BusinessImpact = "low" | "medium" | "high" | "critical"
export type CalendarCoverageStatus = "complete" | "partial" | "unknown"
export type CalendarSourceKind = "official" | "third_party" | "user" | "mock"
export type CalendarEventScope = "national" | "subdivision" | "unknown"

export const calendarCountries: Record<CalendarCountryCode, string> = {
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
