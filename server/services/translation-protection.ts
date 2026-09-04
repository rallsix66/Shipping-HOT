import { createHash } from "node:crypto"

export const TRANSLATION_PLACEHOLDER_CHANGED = "translation_placeholder_changed" as const
export const TRANSLATION_PLACEHOLDER_CHANGED_MESSAGE = "translation placeholders changed"

export class TranslationValidationError extends Error {
  readonly code = TRANSLATION_PLACEHOLDER_CHANGED

  constructor(message = TRANSLATION_PLACEHOLDER_CHANGED_MESSAGE) {
    super(message)
    this.name = "TranslationValidationError"
  }
}

export interface TranslationPlaceholder {
  marker: string
  literal: string
}

export interface ProtectedTranslationText {
  protectedText: string
  placeholders: TranslationPlaceholder[]
}

interface Span {
  start: number
  end: number
  literal: string
}

const placeholderMarkerPattern = /__SH_\d+_[A-F0-9]{10}__/g
const placeholderMarkerLikePattern = /__SH_\w+__/gi

const automaticPatterns = [
  placeholderMarkerLikePattern,
  /https?:\/\/[^\s<>"']+/gi,
  /\b(?:IMO|MMSI)\s*(?:[:#-]\s*)?\d{7,9}\b/gi,
  /\b\d{4}[-/]\d{1,2}[-/]\d{1,2}\b/g,
  /\b\d{1,2}:\d{2}(?::\d{2})?Z?\b/gi,
  /\b[A-Z]{2,6}\d{2,10}\b/g,
  /\b[A-Z]{2}[A-Z0-9]{3}\b/g,
  /(?<![A-Z])[-+]?\d+(?:\.\d+)?[NSEW]\b/gi,
  /(?<![A-Z])[-+]?\d+(?:\.\d+)?(?![A-Z0-9])/gi,
]

function spansForPattern(sourceText: string, pattern: RegExp): Span[] {
  return [...sourceText.matchAll(pattern)].flatMap((match) => {
    const literal = match[0]
    const start = match.index ?? -1
    return start >= 0 && literal ? [{ start, end: start + literal.length, literal }] : []
  })
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function markerFor(sourceText: string, literal: string, index: number, collisionNonce: number): string {
  const digest = createHash("sha256")
    .update(`${sourceText}\u0000${literal}\u0000${index}\u0000${collisionNonce}`, "utf8")
    .digest("hex")
    .slice(0, 10)
    .toUpperCase()
  return `__SH_${index}_${digest}__`
}

function selectedSpans(sourceText: string, protectedTerms: string[]): Span[] {
  const candidates = automaticPatterns.flatMap(pattern => spansForPattern(sourceText, pattern))
  for (const term of protectedTerms) {
    if (!term) continue
    candidates.push(...spansForPattern(sourceText, new RegExp(escapeRegExp(term), "g")))
  }
  candidates.sort((left, right) => left.start - right.start || (right.end - right.start) - (left.end - left.start) || left.literal.localeCompare(right.literal))
  const selected: Span[] = []
  for (const candidate of candidates) {
    if (selected.some(existing => candidate.start < existing.end && existing.start < candidate.end)) continue
    selected.push(candidate)
  }
  return selected.sort((left, right) => left.start - right.start)
}

export function protectTranslationText(sourceText: string, protectedTerms: string[] = []): ProtectedTranslationText {
  const spans = selectedSpans(sourceText, protectedTerms)
  const placeholders: TranslationPlaceholder[] = []
  let protectedText = ""
  let cursor = 0
  spans.forEach((span, index) => {
    protectedText += sourceText.slice(cursor, span.start)
    let collisionNonce = 0
    let marker = markerFor(sourceText, span.literal, index, collisionNonce)
    while (sourceText.includes(marker) || placeholders.some(entry => entry.marker === marker)) {
      collisionNonce += 1
      marker = markerFor(sourceText, span.literal, index, collisionNonce)
    }
    protectedText += marker
    placeholders.push({ marker, literal: span.literal })
    cursor = span.end
  })
  protectedText += sourceText.slice(cursor)
  return { protectedText, placeholders }
}

export function restoreAndValidateProtectedTranslation(protectedText: ProtectedTranslationText, translatedText: string): string {
  const expected = new Map(protectedText.placeholders.map(entry => [entry.marker, entry.literal]))
  const actualMarkers = translatedText.match(placeholderMarkerPattern) ?? []
  const actualCounts = new Map<string, number>()
  for (const marker of actualMarkers) actualCounts.set(marker, (actualCounts.get(marker) ?? 0) + 1)
  const restoredText = translatedText.replace(placeholderMarkerPattern, marker => expected.get(marker) as string)
  const expectedLiterals = new Set(expected.values())
  const unexpectedResidualMarker = (restoredText.match(placeholderMarkerLikePattern) ?? []).some(marker => !expectedLiterals.has(marker))
  if (actualMarkers.length !== protectedText.placeholders.length || [...expected].some(([marker]) => actualCounts.get(marker) !== 1) || actualMarkers.some(marker => !expected.has(marker)) || unexpectedResidualMarker) {
    throw new TranslationValidationError()
  }
  return restoredText
}
