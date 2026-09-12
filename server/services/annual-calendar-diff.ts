import { readFileSync } from "node:fs"
import { type AnnualEvent, type AnnualSource, annualTypes } from "@shared/annual-calendar"

/**
 * Deterministic, source-aware validator and diff for the annual reference calendar.
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

export interface AnnualSourceDiff {
  added: string[]
  changed: string[]
  removed: string[]
}

export interface AnnualDiffResult {
  /** Fact-level or notes-level event changes (ids). */
  added: string[]
  changed: string[]
  removed: string[]
  unchanged: number
  /** Events whose evidence references (`sourceDocumentIds`) changed (ids). */
  evidenceChanged: string[]
  /** Events whose only difference is `notesZh` (ids, subset of `changed`). */
  notesOnly: string[]
  /** Source-document-level diff. */
  sources: AnnualSourceDiff
}

// Fact fields: a change here changes the recorded fact.
const FACT_FIELDS: Array<keyof AnnualEvent> = [
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
// Provenance-inspection fields for source documents (order-stable collections are sorted).
const SOURCE_FIELDS = ["url", "officialInstitutions", "documentNumbers", "publishedAt", "evidenceStatus", "relationshipToAnnualCalendar"] as const

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
    if (!annualTypes[event.type]) issues.push(`${event.id}: unknown event type ${event.type}`)
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

function factSignature(event: AnnualEvent): string {
  return JSON.stringify(FACT_FIELDS.map(field => event[field] ?? null))
}

/** Order-stable evidence signature, so reordering `sourceDocumentIds` is not a diff. */
function evidenceSignature(event: AnnualEvent): string {
  return JSON.stringify([...(event.sourceDocumentIds ?? [])].sort())
}

function notesSignature(event: AnnualEvent): string {
  return String(event.notesZh ?? "")
}

function sourceSignature(source: AnnualSource): string {
  const record = source as unknown as Record<string, unknown>
  return JSON.stringify(SOURCE_FIELDS.map((field) => {
    const value = record[field]
    return Array.isArray(value) ? [...value].sort() : value ?? null
  }))
}

/** Stable-ID, source-aware diff between a candidate dataset and the current runtime dataset. */
export function diffAnnualDatasets(
  candidate: { events?: AnnualEvent[], sourceDocuments?: AnnualSource[] },
  runtime: { events?: AnnualEvent[], sourceDocuments?: AnnualSource[] },
): AnnualDiffResult {
  const candidateEvents = candidate.events ?? []
  const candidateSources = candidate.sourceDocuments ?? []
  const runtimeById = new Map((runtime.events ?? []).map(event => [event.id, event]))
  const remaining = new Set(runtimeById.keys())

  const added: string[] = []
  const changed: string[] = []
  const evidenceChanged: string[] = []
  const notesOnly: string[] = []
  let unchanged = 0

  for (const event of candidateEvents) {
    remaining.delete(event.id)
    const current = runtimeById.get(event.id)
    if (!current) {
      added.push(event.id)
      continue
    }
    const factChanged = factSignature(current) !== factSignature(event)
    const evidence = evidenceSignature(current) !== evidenceSignature(event)
    const notes = notesSignature(current) !== notesSignature(event)
    if (evidence) evidenceChanged.push(event.id)
    if (factChanged || notes) changed.push(event.id)
    if (!factChanged && notes && !evidence) notesOnly.push(event.id)
    if (!factChanged && !notes && !evidence) unchanged += 1
  }

  const runtimeSources = new Map((runtime.sourceDocuments ?? []).map(source => [source.id, source]))
  const sourceAdded: string[] = []
  const sourceChanged: string[] = []
  const sourceRemaining = new Set(runtimeSources.keys())
  for (const source of candidateSources) {
    sourceRemaining.delete(source.id)
    const current = runtimeSources.get(source.id)
    if (!current) sourceAdded.push(source.id)
    else if (sourceSignature(current) !== sourceSignature(source)) sourceChanged.push(source.id)
  }

  return {
    added: added.sort(),
    changed: changed.sort(),
    removed: [...remaining].sort(),
    unchanged,
    evidenceChanged: evidenceChanged.sort(),
    notesOnly: notesOnly.sort(),
    sources: { added: sourceAdded.sort(), changed: sourceChanged.sort(), removed: [...sourceRemaining].sort() },
  }
}

export function parseAnnualFile(path: string): AnnualFile {
  return JSON.parse(readFileSync(path, "utf8")) as AnnualFile
}

export function formatAnnualDiff(label: string, result: AnnualDiffResult, issues: string[]): string {
  const lines = [
    `# ${label}`,
    `valid=${issues.length === 0}`,
    `events added=${result.added.length} changed=${result.changed.length} removed=${result.removed.length} unchanged=${result.unchanged}`,
    `evidence-changed=${result.evidenceChanged.length} notes-only=${result.notesOnly.length}`,
    `sources added=${result.sources.added.length} changed=${result.sources.changed.length} removed=${result.sources.removed.length}`,
  ]
  for (const issue of issues) lines.push(`issue: ${issue}`)
  for (const id of result.added) lines.push(`+ ${id}`)
  for (const id of result.changed) lines.push(`~ ${id}`)
  for (const id of result.removed) lines.push(`- ${id}`)
  for (const id of result.evidenceChanged) lines.push(`~evidence ${id}`)
  for (const id of result.sources.added) lines.push(`+source ${id}`)
  for (const id of result.sources.changed) lines.push(`~source ${id}`)
  for (const id of result.sources.removed) lines.push(`-source ${id}`)
  return lines.join("\n")
}
