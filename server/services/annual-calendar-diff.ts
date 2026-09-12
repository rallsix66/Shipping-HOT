import { readFileSync } from "node:fs"
import type { AnnualEvent, AnnualSource } from "@shared/annual-calendar"

/**
 * Deterministic validator and diff for the annual reference calendar.
 * Candidate work files live under `docs/data-candidates/calendar/<COUNTRY>/<YEAR>/`;
 * runtime snapshots live under `server/data/annual-calendar/<COUNTRY>-<YEAR>.json`.
 * This module only reads files and returns a report; it never writes, commits or pushes.
 */
export interface AnnualFile {
  countryCode?: string
  year?: number
  sourceDocuments?: AnnualSource[]
  events?: AnnualEvent[]
}

export interface AnnualDiffResult {
  added: string[]
  changed: string[]
  removed: string[]
  unchanged: number
}

const COMPARED_FIELDS: Array<keyof AnnualEvent> = [
  "countryCode",
  "date",
  "nameZh",
  "shortNameZh",
  "nameLocal",
  "type",
  "holidaySubtype",
  "geographicScope",
  "subjectAndConditionsZh",
  "verificationStatus",
]

function validDate(date: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false
  const parsed = new Date(`${date}T00:00:00Z`)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date
}

/** Validates one dataset's events and source references. Returns human-readable issues (empty == valid). */
export function validateAnnualDataset(file: AnnualFile, expectedCountry?: string, expectedYear?: number): string[] {
  const issues: string[] = []
  const events = file.events ?? []
  const sourceDocuments = file.sourceDocuments ?? []
  const countryCode = file.countryCode
  const year = file.year

  if (expectedCountry && countryCode !== expectedCountry) issues.push(`countryCode ${countryCode} != ${expectedCountry}`)
  if (expectedYear && year !== expectedYear) issues.push(`year ${year} != ${expectedYear}`)

  const sourceIds = new Set<string>()
  for (const source of sourceDocuments) {
    if (sourceIds.has(source.id)) issues.push(`duplicate sourceDocument id ${source.id}`)
    sourceIds.add(source.id)
    if (!/^https:\/\//.test(source.url)) issues.push(`sourceDocument ${source.id} url is not https`)
    if (!(source.evidenceStatus && source.evidenceStatus.length > 0)) issues.push(`sourceDocument ${source.id} missing evidenceStatus`)
  }

  const ids = new Set<string>()
  const facts = new Set<string>()
  for (const event of events) {
    if (!event.id) issues.push("event missing id")
    if (ids.has(event.id)) issues.push(`duplicate event id ${event.id}`)
    ids.add(event.id)
    if (countryCode && event.countryCode !== countryCode) issues.push(`${event.id}: country mismatch`)
    if (!validDate(event.date)) issues.push(`${event.id}: invalid date ${event.date}`)
    if (year && !event.date.startsWith(`${year}-`)) issues.push(`${event.id}: date outside year ${year}`)
    if (!event.geographicScope || !event.geographicScope.trim()) issues.push(`${event.id}: empty geographicScope`)
    if (!event.sourceDocumentIds || event.sourceDocumentIds.length === 0) issues.push(`${event.id}: no sourceDocumentIds`)
    for (const ref of event.sourceDocumentIds ?? []) {
      if (!sourceIds.has(ref)) issues.push(`${event.id}: unknown sourceDocumentId ${ref}`)
    }
    const factKey = [event.date, event.type, event.geographicScope, event.nameLocal].join("|")
    if (facts.has(factKey)) issues.push(`${event.id}: duplicate fact ${factKey}`)
    facts.add(factKey)
  }
  return issues
}

function comparable(event: AnnualEvent): string {
  return JSON.stringify(COMPARED_FIELDS.map(field => event[field] ?? null))
}

/** Stable-ID diff between a candidate dataset and the current runtime dataset. */
export function diffAnnualDatasets(candidate: AnnualEvent[], runtime: AnnualEvent[]): AnnualDiffResult {
  const runtimeById = new Map(runtime.map(event => [event.id, event]))
  const remaining = new Set(runtimeById.keys())
  const added: string[] = []
  const changed: string[] = []
  let unchanged = 0
  for (const event of candidate) {
    remaining.delete(event.id)
    const current = runtimeById.get(event.id)
    if (!current) added.push(event.id)
    else if (comparable(current) !== comparable(event)) changed.push(event.id)
    else unchanged += 1
  }
  return { added: added.sort(), changed: changed.sort(), removed: [...remaining].sort(), unchanged }
}

export function parseAnnualFile(path: string): AnnualFile {
  return JSON.parse(readFileSync(path, "utf8")) as AnnualFile
}

export function formatAnnualDiff(label: string, result: AnnualDiffResult, issues: string[]): string {
  const lines = [
    `# ${label}`,
    `valid=${issues.length === 0}`,
    `added=${result.added.length} changed=${result.changed.length} removed=${result.removed.length} unchanged=${result.unchanged}`,
  ]
  for (const issue of issues) lines.push(`issue: ${issue}`)
  for (const id of result.added) lines.push(`+ ${id}`)
  for (const id of result.changed) lines.push(`~ ${id}`)
  for (const id of result.removed) lines.push(`- ${id}`)
  return lines.join("\n")
}
